// Checkpoint-1 simulation store. Holds three independent concerns:
//   1. the run recording — the compiled scenario and RunResult (immutable);
//   2. the playback position — a cursor, from which ReplayState is derived;
//   3. viewer state — the pinned selection.
// The engine runs once, synchronously, in start(). Everything the UI shows is
// derived from the recorded events via the replay reducer, never recomputed.

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
import type { Selection } from './view'

export type Phase = 'idle' | 'ready' | 'error'

const EMPTY_LAYOUT: ReadonlyMap<string, GridPosition> = new Map()

export function createSimulationStore() {
  const [phase, setPhase] = createSignal<Phase>('idle')
  const [diagnostics, setDiagnostics] = createSignal<readonly Diagnostic[]>([])
  const [compiled, setCompiled] = createSignal<CompiledScenario | null>(null)
  const [run, setRun] = createSignal<RunResult | null>(null)
  const [layout, setLayout] = createSignal<ReadonlyMap<string, GridPosition>>(EMPTY_LAYOUT)
  const [cursor, setCursor] = createSignal(0)
  const [selection, setSelection] = createSignal<Selection>(null)

  // Derived playback state — recomputed from the recorded events alone.
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

  function start(): void {
    const result = importScenario(BUILTIN_SCENARIO_TEXT, { fileName: BUILTIN_SCENARIO_FILE })
    setDiagnostics(result.diagnostics)
    if (!result.ok) {
      setPhase('error')
      setCompiled(null)
      setRun(null)
      setLayout(EMPTY_LAYOUT)
      return
    }
    const compiledScenario = result.value
    setCompiled(compiledScenario)
    setRun(runScenario(compiledScenario))
    setLayout(computeLayout(compiledScenario.effective.network.assets))
    setCursor(0) // initialize replay at the beginning of the recording
    setSelection(null)
    setPhase('ready')
  }

  function stepForward(): void {
    const current = run()
    if (current !== null) setCursor((c) => Math.min(c + 1, current.events.length))
  }
  function stepBackward(): void {
    setCursor((c) => Math.max(0, c - 1))
  }
  function restart(): void {
    setCursor(0)
  }

  function selectAsset(id: string): void {
    setSelection({ type: 'asset', id })
  }
  function selectAttempt(id: string): void {
    setSelection({ type: 'attempt', id })
  }
  function clearSelection(): void {
    setSelection(null)
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
    atStart: () => cursor() === 0,
    atEnd: () => cursor() >= totalEvents(),
    start,
    stepForward,
    stepBackward,
    restart,
    selectAsset,
    selectAttempt,
    clearSelection,
  }
}

export type SimulationStore = ReturnType<typeof createSimulationStore>
