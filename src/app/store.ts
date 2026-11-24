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
import { BUILTIN_SCENARIOS, DEFAULT_SCENARIO, scenarioFacts, selectBuiltinScenario } from './scenario'
import { computeLayout, EMPTY_LAYOUT, type MapLayout } from './layout'
import { backCursor, isStepComplete, nextCursor, stepIndexAt } from './view'
import {
  bestAlternative,
  defenseChanges,
  defenseMarks,
  parseDefenses,
  runDefense,
  type Alternative,
  type DefenseChanges,
  type DefenseMarks,
  type DefenseOption,
  type DefenseRun,
} from './defenses'

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

export type ScenarioSource = {
  readonly key: string | null
  readonly file: string
  readonly title: string
  readonly description: string
  readonly compiled: CompiledScenario | null
  readonly diagnostics: readonly Diagnostic[]
  readonly defenses: readonly DefenseOption[]
}

export type DefenseComparison = {
  readonly result: DefenseRun
  readonly baseRun: RunResult
  readonly changes: DefenseChanges
  readonly marks: DefenseMarks
  readonly alternative: Alternative | null
}

type SourceInput = {
  readonly key: string | null
  readonly file: string
  readonly text: string
  readonly title?: string
  readonly description?: string
  readonly defenses?: string
}

export function loadSource(input: SourceInput): ScenarioSource {
  const prepared = importScenario(input.text, { fileName: input.file })
  const compiled = prepared.ok ? prepared.value : null
  return {
    key: input.key,
    file: input.file,
    title: input.title ?? compiled?.name ?? input.file,
    description: input.description ?? (compiled === null ? input.file : `${input.file} · ${scenarioFacts(compiled)}`),
    compiled,
    diagnostics: prepared.diagnostics,
    defenses: compiled === null || input.defenses === undefined ? [] : parseDefenses(input.defenses).options,
  }
}

function reducedMotionSignal() {
  const query = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)')
  const [reduced, setReduced] = createSignal(query?.matches ?? false)
  query?.addEventListener('change', (event) => setReduced(event.matches))
  return reduced
}

export function createSimulationStore(search = typeof window === 'undefined' ? '' : window.location.search) {
  const initial = loadSource(selectBuiltinScenario(search))
  const [source, setSource] = createSignal<ScenarioSource>(initial)
  const [phase, setPhase] = createSignal<Phase>(initial.compiled === null ? 'error' : 'prepared')
  const diagnostics = () => source().diagnostics
  const baseCompiled = () => source().compiled
  const [baseRun, setBaseRun] = createSignal<RunResult | null>(null)
  const [defense, setDefense] = createSignal<DefenseRun | null>(null)
  const [defenseChoice, setDefenseChoice] = createSignal<string | null>(null)
  const [defenseError, setDefenseError] = createSignal<string | null>(null)
  const compiled = createMemo<CompiledScenario | null>(() => defense()?.compiled ?? baseCompiled())
  const layout = createMemo<MapLayout>(() => {
    const base = baseCompiled()
    return base === null ? EMPTY_LAYOUT : computeLayout(base.effective.network, base.effective.initial_asset_id)
  })
  const [run, setRun] = createSignal<RunResult | null>(null)
  const [cursor, setCursor] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [travel, setTravel] = createSignal(1)
  const [mode, setModeSignal] = createSignal<Mode>('story')
  const [logOpen, setLogOpen] = createSignal(false)
  const [selectedHost, setSelectedHost] = createSignal<string | null>(null)
  const reducedMotion = reducedMotionSignal()

  const defenseLabels = createMemo(() => {
    const applied = defense()
    return applied === null ? undefined : new Map(applied.option.interventions.map((i) => [i.id, applied.option.label]))
  })
  const comparison = createMemo<DefenseComparison | null>(() => {
    const result = defense()
    const original = baseRun()
    const base = baseCompiled()
    if (result === null || original === null || base === null) return null
    return {
      result,
      baseRun: original,
      changes: defenseChanges(original, result),
      marks: defenseMarks(result),
      alternative: bestAlternative(base, original, source().defenses, result.option.id),
    }
  })

  const steps = createMemo<readonly Step[]>(() => {
    const current = run()
    return current === null ? [] : groupSteps(current.events)
  })
  const narrations = createMemo<readonly Narration[]>(() => {
    const current = run()
    const scenarioValue = compiled()
    if (current === null || scenarioValue === null) return []
    const labels = defenseLabels()
    return steps().map((step) => narrate(step, current.events, scenarioValue, labels === undefined ? {} : { defenseLabels: labels }))
  })
  const replay = createMemo<ReplayState>(() => {
    const current = run()
    return current === null ? initialReplayState() : seekReplay(current.events, cursor())
  })
  const stepIndex = createMemo(() => stepIndexAt(steps(), cursor()))
  const stepComplete = createMemo(() => isStepComplete(steps(), cursor()))
  const totalEvents = createMemo(() => run()?.events.length ?? 0)
  const atEnd = createMemo(() => run() !== null && cursor() >= totalEvents())
  const atResults = createMemo(() => defense() !== null && steps()[stepIndex()]?.kind === 'summary')

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

  function ensureBaseRun(): RunResult | null {
    const base = baseCompiled()
    if (base === null) return null
    const existing = baseRun()
    if (existing !== null) return existing
    const fresh = runScenario(base)
    setBaseRun(fresh)
    return fresh
  }

  function begin(current: RunResult): void {
    clearClock()
    setRun(current)
    setCursor(0)
    setTravel(1)
    setSelectedHost(null)
    setPhase('ready')
    setPlaying(true)
    schedule()
  }

  function start(): void {
    const applied = defense()
    const current = applied === null ? ensureBaseRun() : applied.run
    if (current !== null) begin(current)
  }

  function load(next: ScenarioSource): void {
    clearClock()
    setPlaying(false)
    setSource(next)
    setBaseRun(null)
    setDefense(null)
    setDefenseChoice(null)
    setDefenseError(null)
    setRun(null)
    setCursor(0)
    setTravel(1)
    setSelectedHost(null)
    setPhase(next.compiled === null ? 'error' : 'prepared')
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
    scenario: source,
    scenarios: BUILTIN_SCENARIOS,
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
    atResults,
    playing,
    travel,
    reducedMotion,
    mode,
    logOpen,
    setLogOpen,
    selectedHost,
    hasRun: () => run() !== null,
    defense,
    defenseChoice,
    defenseError,
    comparison,
    selectScenario(key: string): void {
      const entry = BUILTIN_SCENARIOS.find((scenario) => scenario.key === key)
      if (entry === undefined) return
      load(loadSource(entry))
      if (typeof window !== 'undefined') {
        const query = entry.key === DEFAULT_SCENARIO.key ? '' : `?scenario=${encodeURIComponent(entry.key)}`
        window.history.replaceState(null, '', `${window.location.pathname}${query}${window.location.hash}`)
      }
    },
    openScenarioFile(file: string, text: string): void {
      load(loadSource({ key: null, file, text }))
    },
    chooseDefense(id: string): void {
      setDefenseChoice(id)
    },
    applyDefense(id: string): void {
      const base = baseCompiled()
      const option = source().defenses.find((entry) => entry.id === id)
      const original = ensureBaseRun()
      if (base === null || option === undefined || original === null) return
      const result = runDefense(base, original, option)
      if (!result.ok) {
        setDefenseError(result.diagnostics.map((d) => d.message).join(' '))
        return
      }
      setDefenseError(null)
      setDefenseChoice(id)
      setDefense(result.value)
      begin(result.value.run)
    },
    removeDefense(): void {
      setDefense(null)
      setDefenseError(null)
      const original = ensureBaseRun()
      if (original !== null) begin(original)
    },
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
