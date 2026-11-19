import { createMemo, createSignal } from 'solid-js'
import {
  groupSteps,
  importScenario,
  initialReplayState,
  runScenario,
  seekReplay,
  type CompiledScenario,
  type Diagnostic,
  type EventType,
  type ReplayState,
  type RunResult,
  type Step,
} from '../core'
import { narrate, type Narration } from './narration'
import { selectBuiltinScenario } from './scenario'
import { computeLayout, type GridPosition } from './layout'
import { backCursor, isStepComplete, nextCursor, stepIndexAt } from './view'

export type Phase = 'prepared' | 'ready' | 'error'
export type Mode = 'story' | 'command'

export const PACE: { readonly dwell: number; readonly travel: number; readonly after: Readonly<Record<EventType, number>> } = {
  dwell: 2400,
  travel: 900,
  after: {
    run_started: 450,
    asset_compromised: 700,
    asset_discovered: 700,
    propagation_attempted: 900,
    propagation_resolved: 900,
    propagation_skipped: 700,
    run_completed: 0,
    run_aborted: 0,
  },
}

const EMPTY_LAYOUT: ReadonlyMap<string, GridPosition> = new Map()

function reducedMotionSignal() {
  const query = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')
  const [reduced, setReduced] = createSignal(query?.matches ?? false)
  query?.addEventListener('change', (event) => setReduced(event.matches))
  return reduced
}

export function createSimulationStore(search = typeof window === 'undefined' ? '' : window.location.search) {
  const scenario = selectBuiltinScenario(search)
  const prepared = importScenario(scenario.text, { fileName: scenario.file })
  const preparedCompiled = prepared.ok ? prepared.value : null

  const [phase, setPhase] = createSignal<Phase>(prepared.ok ? 'prepared' : 'error')
  const [diagnostics] = createSignal<readonly Diagnostic[]>(prepared.diagnostics)
  const [compiled] = createSignal<CompiledScenario | null>(preparedCompiled)
  const [layout] = createSignal<ReadonlyMap<string, GridPosition>>(
    preparedCompiled === null ? EMPTY_LAYOUT : computeLayout(preparedCompiled.effective.network.assets),
  )
  const [run, setRun] = createSignal<RunResult | null>(null)
  const [cursor, setCursor] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [travel, setTravel] = createSignal(1)
  const [mode, setModeSignal] = createSignal<Mode>('story')
  const [logOpen, setLogOpen] = createSignal(false)
  const [selectedHost, setSelectedHost] = createSignal<string | null>(null)
  const reducedMotion = reducedMotionSignal()

  const steps = createMemo<readonly Step[]>(() => {
    const current = run()
    return current === null ? [] : groupSteps(current.events)
  })
  const narrations = createMemo<readonly Narration[]>(() => {
    const current = run()
    const scenarioValue = compiled()
    if (current === null || scenarioValue === null) return []
    return steps().map((step) => narrate(step, current.events, scenarioValue))
  })
  const replay = createMemo<ReplayState>(() => {
    const current = run()
    return current === null ? initialReplayState() : seekReplay(current.events, cursor())
  })
  const stepIndex = createMemo(() => stepIndexAt(steps(), cursor()))
  const stepComplete = createMemo(() => isStepComplete(steps(), cursor()))
  const totalEvents = createMemo(() => run()?.events.length ?? 0)
  const atEnd = createMemo(() => run() !== null && cursor() >= totalEvents())

  let timer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined

  function clearClock(): void {
    if (timer !== undefined) clearTimeout(timer)
    if (frame !== undefined) cancelAnimationFrame(frame)
    timer = undefined
    frame = undefined
  }

  function schedule(): void {
    clearClock()
    const current = run()
    if (!playing() || current === null) return
    const position = cursor()
    if (position >= current.events.length) {
      setPlaying(false)
      setTravel(1)
      return
    }
    const list = steps()
    const index = stepIndexAt(list, position)
    const atBoundary = index === -1 || position === list[index]!.end
    if (reducedMotion()) {
      timer = setTimeout(() => {
        setCursor(nextCursor(list, cursor()))
        schedule()
      }, index === -1 ? 0 : PACE.dwell)
      return
    }
    if (atBoundary) {
      timer = setTimeout(applyNextEvent, index === -1 ? 0 : PACE.dwell)
      return
    }
    const last = current.events[position - 1]!
    if (last.type === 'propagation_attempted') travelThen(applyNextEvent)
    else timer = setTimeout(applyNextEvent, PACE.after[last.type])
  }

  function applyNextEvent(): void {
    const current = run()
    if (current === null) return
    const position = Math.min(cursor() + 1, current.events.length)
    setCursor(position)
    setTravel(current.events[position - 1]?.type === 'propagation_attempted' ? 0 : 1)
    schedule()
  }

  function travelThen(done: () => void): void {
    const started = performance.now()
    setTravel(0)
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / PACE.travel)
      setTravel(progress)
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        frame = undefined
        done()
      }
    }
    frame = requestAnimationFrame(tick)
  }

  function start(): void {
    const scenarioValue = compiled()
    if (scenarioValue === null) return
    clearClock()
    setRun(runScenario(scenarioValue))
    setCursor(0)
    setTravel(1)
    setSelectedHost(null)
    setPhase('ready')
    setPlaying(true)
    schedule()
  }

  function play(): void {
    if (phase() === 'error') return
    if (run() === null) {
      start()
      return
    }
    if (atEnd()) setCursor(0)
    setPlaying(true)
    schedule()
  }

  function pause(): void {
    setPlaying(false)
    clearClock()
    setTravel(1)
  }

  function navigate(position: number): void {
    pause()
    setCursor(position)
    setSelectedHost(null)
  }

  return {
    scenario,
    phase,
    diagnostics,
    compiled,
    layout,
    run,
    steps,
    narrations,
    cursor,
    replay,
    stepIndex,
    stepComplete,
    totalEvents,
    atEnd,
    playing,
    travel,
    reducedMotion,
    mode,
    logOpen,
    setLogOpen,
    selectedHost,
    hasRun: () => run() !== null,
    setMode(next: Mode): void {
      setModeSignal(next)
      setLogOpen(next === 'command')
    },
    selectHost(id: string): void {
      setSelectedHost(id)
    },
    clearHost(): void {
      setSelectedHost(null)
    },
    start,
    play,
    pause,
    togglePlay(): void {
      if (playing()) pause()
      else play()
    },
    next(): void {
      if (run() !== null) navigate(nextCursor(steps(), cursor()))
    },
    back(): void {
      if (run() !== null) navigate(backCursor(steps(), cursor()))
    },
    restart(): void {
      if (run() === null) {
        start()
        return
      }
      clearClock()
      setCursor(0)
      setTravel(1)
      setSelectedHost(null)
      setPlaying(true)
      schedule()
    },
    goToStep(index: number): void {
      const step = steps()[index]
      if (step !== undefined) navigate(step.end)
    },
    dispose: clearClock,
  }
}

export type SimulationStore = ReturnType<typeof createSimulationStore>
