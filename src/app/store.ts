import { createMemo, createSignal } from 'solid-js'
import {
  importScenario,
  initialReplayState,
  runScenario,
  seekReplay,
  type CompiledScenario,
  type Diagnostic,
  type ReplayState,
  type RunResult,
  type SimulationEvent,
} from '../core'
import { BUILTIN_SCENARIO_FILE, BUILTIN_SCENARIO_TEXT } from './scenario'
import { computeLayout, type GridPosition } from './layout'
import { attemptIdForLink, type Selection } from './view'

export type Phase = 'prepared' | 'ready' | 'error'

const EMPTY_LAYOUT: ReadonlyMap<string, GridPosition> = new Map()

export function createSimulationStore() {
  const prepared = importScenario(BUILTIN_SCENARIO_TEXT, { fileName: BUILTIN_SCENARIO_FILE })
  const preparedCompiled = prepared.ok ? prepared.value : null

  const [phase, setPhase] = createSignal<Phase>(prepared.ok ? 'prepared' : 'error')
  const [diagnostics] = createSignal<readonly Diagnostic[]>(prepared.diagnostics)
  const [compiled] = createSignal<CompiledScenario | null>(preparedCompiled)
  const [layout] = createSignal<ReadonlyMap<string, GridPosition>>(
    preparedCompiled === null ? EMPTY_LAYOUT : computeLayout(preparedCompiled.effective.network.assets),
  )
  const [run, setRun] = createSignal<RunResult | null>(null)
  const [cursor, setCursor] = createSignal(0)
  const [selection, setSelection] = createSignal<Selection>(null)

  const replay = createMemo<ReplayState>(() => {
    const current = run()
    return current === null ? initialReplayState() : seekReplay(current.events, cursor())
  })
  const totalEvents = createMemo(() => run()?.events.length ?? 0)
  const currentEvent = createMemo<SimulationEvent | null>(() => {
    const current = run()
    const position = cursor()
    return current !== null && position > 0 ? current.events[position - 1]! : null
  })

  function dropStaleEventSelection(next: number): void {
    const sel = selection()
    if (sel?.type === 'event' && sel.index >= next) setSelection(null)
  }
  function moveCursor(next: number): void {
    setCursor(next)
    dropStaleEventSelection(next)
  }

  function start(): void {
    const scenario = compiled()
    if (scenario === null) return
    setRun(runScenario(scenario))
    setCursor(0)
    setPhase('ready')
    const sel = selection()
    if (sel?.type === 'event' || sel?.type === 'attempt') setSelection(null)
  }

  function stepForward(): void {
    const current = run()
    if (current !== null) moveCursor(Math.min(cursor() + 1, current.events.length))
  }
  function stepBackward(): void {
    moveCursor(Math.max(0, cursor() - 1))
  }
  function restart(): void {
    moveCursor(0)
    if (selection()?.type === 'attempt') setSelection(null)
  }

  function selectAsset(id: string): void {
    setSelection({ type: 'asset', id })
  }
  function selectAttempt(id: string): void {
    setSelection({ type: 'attempt', id })
  }
  function selectEvent(index: number): void {
    setSelection({ type: 'event', index })
  }
  function jumpToEvent(index: number): void {
    const current = run()
    if (current === null) return
    setCursor(Math.max(0, Math.min(index + 1, current.events.length)))
    setSelection(null)
  }
  function followCurrentStep(): void {
    setSelection(null)
  }
  function selectLink(linkId: string): void {
    const current = run()
    if (current === null) return
    const attemptId = attemptIdForLink(current, linkId)
    if (attemptId !== null) setSelection({ type: 'attempt', id: attemptId })
  }

  return {
    phase,
    diagnostics,
    compiled,
    run,
    layout,
    cursor,
    totalEvents,
    currentEvent,
    replay,
    selection,
    hasRun: () => run() !== null,
    atStart: () => cursor() === 0,
    atEnd: () => cursor() >= totalEvents(),
    start,
    stepForward,
    stepBackward,
    restart,
    selectAsset,
    selectAttempt,
    selectEvent,
    jumpToEvent,
    selectLink,
    followCurrentStep,
  }
}

export type SimulationStore = ReturnType<typeof createSimulationStore>
