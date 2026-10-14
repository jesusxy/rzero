// Checkpoint-1 simulation store. Three independent concerns:
//   1. the run recording — the compiled scenario and RunResult (immutable);
//   2. the playback position — a cursor, from which ReplayState is derived;
//   3. viewer state — the pinned selection.
// Preparing and running are separate: the scenario is compiled once at creation
// so the network is visible and inspectable before Start; start() executes the
// engine on that prepared scenario and initializes replay. Everything the UI
// shows is derived from the recorded events via the replay reducer.

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
  // Prepare (compile) once at creation, without running the engine.
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

  // Drops a playback-relative selection that no longer has a visible event at
  // the given cursor (an inspected event that is now in the future), so the
  // inspector falls back to following the current step.
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
    setCursor(0) // initialize replay at the beginning of the recording
    setPhase('ready')
    // A new recording invalidates playback-relative selections (events and
    // attempts). Host selection is identity-stable, so it is kept.
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
    // Clear a pinned attempt too; at the start of the recording it has no
    // resolved facts to inspect. Host selection is kept.
    if (selection()?.type === 'attempt') setSelection(null)
  }

  function selectAsset(id: string): void {
    setSelection({ type: 'asset', id })
  }
  function selectAttempt(id: string): void {
    setSelection({ type: 'attempt', id })
  }
  /** Inspects a specific history event without moving the replay cursor. */
  function selectEvent(index: number): void {
    setSelection({ type: 'event', index })
  }
  /** Seeks to a history event (so it becomes the current step) and follows it. */
  function jumpToEvent(index: number): void {
    const current = run()
    if (current === null) return
    setCursor(Math.max(0, Math.min(index + 1, current.events.length)))
    setSelection(null)
  }
  /** Clears the pin so the inspector follows the current step again. */
  function followCurrentStep(): void {
    setSelection(null)
  }
  /** Selects the attempt recorded on a link, if the run has one (any cursor). */
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
