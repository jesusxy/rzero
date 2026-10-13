// Pure replay reducer (docs/event-model.md#replay-responsibilities).
//
// Reconstructs discovery, compromise and attempt state from a recorded event
// stream without re-running propagation. It is a fold: the state after applying
// the first `n` events depends only on the events, so stepping and seeking
// always agree and a run at a different playback speed yields the same state.
//
// Cursor semantics: `cursor` is the number of events applied, in [0,
// events.length]. Cursor 0 is the state before `run_started`; `events.length`
// is the final state. The state reflects `events[0 .. cursor - 1]`.
//
// Compromise and discovery are append-only here: a blocked or indeterminate
// attempt only updates the attempt ledger and can never remove a compromise or
// mark an asset permanently safe.
//
// Performance: a naive fold that rebuilt a frozen snapshot on every event copied
// the growing attempt ledger each step (O(n^2)), and seeking or stepping back
// re-folded from event 0. Instead, bulk traversal uses an internal *mutable*
// accumulator and materializes an immutable snapshot only at the boundary, and a
// cached checkpoint index lets a seek start from the nearest checkpoint at or
// before the target. Every returned state is an independent frozen value, so an
// earlier returned state never changes when replay advances.
//
// Ownership (input contract): the reducer owns an immutable view of the stream.
// `runScenario` output is already deep-frozen and is used directly. A stream
// that is not frozen — e.g. rebuilt from JSON or a structured clone across a
// worker — is defensively deep-copied and frozen once per array (cached), and
// every reducer function reads through that owned view. So later mutation of a
// caller-owned array can neither change an already-returned snapshot (snapshots
// hold references only into frozen data) nor desynchronize seeking from
// stepping (both read the same owned view). The reducer never mutates the
// caller's array, and the one-time copy is paid only for a non-frozen stream.

import { cloneJson, type JsonValue } from '../domain/json'
import type { Check, Outcome, SimulationEvent } from '../engine'
import { deepFreeze } from '../scenario/freeze'

export type AttemptStatus = 'pending' | Outcome

export type AttemptView = {
  readonly attempt_id: string
  readonly source_id: string
  readonly target_id: string
  readonly link_id: string
  readonly capability_id: string
  /** `pending` between the attempted and resolved events. */
  readonly status: AttemptStatus
  readonly checks: readonly Check[]
}

export type ReplayParent = {
  readonly parent_id: string
  readonly attempt_id: string | null
  readonly link_id: string | null
  readonly capability_id: string | null
  readonly hop: number
}

export type ReplayState = {
  /** Events applied so far, in [0, events.length]. */
  readonly cursor: number
  /** Assets discovered so far, in discovery order. */
  readonly discovered: readonly string[]
  /** Assets compromised so far, in compromise order (seed first). */
  readonly compromised: readonly string[]
  /** First-compromise linkage for each non-seed compromised asset. */
  readonly parents: Readonly<Record<string, ReplayParent>>
  /** Logical hop depth per compromised asset, seed at 0. */
  readonly hops: Readonly<Record<string, number>>
  /** The attempt ledger, keyed by attempt ID. */
  readonly attempts: Readonly<Record<string, AttemptView>>
  /** Set once the terminal event is applied. */
  readonly terminal: 'completed' | 'aborted' | null
}

// --- Internal mutable accumulator -------------------------------------------
// The single source of truth for the state transition. `applyEvent` (the pure
// per-event step) and the bulk fold both go through `applyMutable`, so they can
// never diverge. Attempt and parent entries are frozen on creation, so a
// snapshot only needs to copy-and-freeze the containers, not re-walk entries.

type MutableState = {
  cursor: number
  discovered: string[]
  compromised: string[]
  parents: Record<string, ReplayParent>
  hops: Record<string, number>
  attempts: Record<string, AttemptView>
  terminal: 'completed' | 'aborted' | null
}

const EMPTY_CHECKS: readonly Check[] = Object.freeze([])

function emptyMutable(): MutableState {
  return { cursor: 0, discovered: [], compromised: [], parents: {}, hops: {}, attempts: {}, terminal: null }
}

function toMutable(state: ReplayState): MutableState {
  return {
    cursor: state.cursor,
    discovered: [...state.discovered],
    compromised: [...state.compromised],
    parents: { ...state.parents },
    hops: { ...state.hops },
    attempts: { ...state.attempts },
    terminal: state.terminal,
  }
}

function snapshot(state: MutableState): ReplayState {
  return Object.freeze({
    cursor: state.cursor,
    discovered: Object.freeze([...state.discovered]),
    compromised: Object.freeze([...state.compromised]),
    parents: Object.freeze({ ...state.parents }),
    hops: Object.freeze({ ...state.hops }),
    attempts: Object.freeze({ ...state.attempts }),
    terminal: state.terminal,
  })
}

function applyMutable(state: MutableState, event: SimulationEvent): void {
  state.cursor += 1
  switch (event.type) {
    case 'asset_discovered':
      if (!state.discovered.includes(event.asset_id)) state.discovered.push(event.asset_id)
      return

    case 'propagation_attempted':
      state.attempts[event.attempt_id] = Object.freeze({
        attempt_id: event.attempt_id,
        source_id: event.source_id,
        target_id: event.target_id,
        link_id: event.link_id,
        capability_id: event.capability_id,
        status: 'pending',
        checks: EMPTY_CHECKS,
      })
      return

    case 'propagation_resolved':
      state.attempts[event.attempt_id] = Object.freeze({
        attempt_id: event.attempt_id,
        source_id: event.source_id,
        target_id: event.target_id,
        link_id: event.link_id,
        capability_id: event.capability_id,
        status: event.outcome,
        checks: event.checks,
      })
      return

    case 'asset_compromised': {
      if (!state.compromised.includes(event.asset_id)) state.compromised.push(event.asset_id)
      state.hops[event.asset_id] = event.hop
      if (event.parent_id !== null) {
        const attempt = event.attempt_id === null ? undefined : state.attempts[event.attempt_id]
        state.parents[event.asset_id] = Object.freeze({
          parent_id: event.parent_id,
          attempt_id: event.attempt_id,
          link_id: attempt?.link_id ?? null,
          capability_id: attempt?.capability_id ?? null,
          hop: event.hop,
        })
      }
      return
    }

    case 'run_completed':
      state.terminal = 'completed'
      return

    case 'run_aborted':
      state.terminal = 'aborted'
      return

    // run_started and propagation_skipped advance the cursor without changing
    // discovery or compromise state.
    case 'run_started':
    case 'propagation_skipped':
      return
  }
}

// --- Checkpoint index -------------------------------------------------------
// A transparent cache so a seek starts from the nearest checkpoint at or before
// the target rather than from event 0. Keyed by the events array identity in a
// WeakMap, so the checkpoints live exactly as long as that array (a new run's
// array gets its own, and old ones are collected with it). Memory is
// ceil(events.length / CHECKPOINT_INTERVAL) + 1 frozen snapshots; those
// snapshots share the same frozen attempt/parent entry objects, so only the
// container records are duplicated. A larger interval means fewer snapshots
// (less memory) but more events replayed per seek; a smaller one is the reverse.

const CHECKPOINT_INTERVAL = 1000

type CheckpointIndex = { readonly interval: number; readonly states: readonly ReplayState[] }

const checkpointCache = new WeakMap<readonly SimulationEvent[], CheckpointIndex>()

// Owned, immutable view of a non-frozen stream, cached by the caller's array.
const ownedCache = new WeakMap<readonly SimulationEvent[], readonly SimulationEvent[]>()

/**
 * Returns an immutable view of the stream the reducer owns. A deep-frozen array
 * (the engine's output) is used as-is; a non-frozen one is deep-copied and
 * frozen once and cached, so the reducer observes a stable snapshot and never
 * mutates the caller's data. All stream reads go through this.
 */
function own(events: readonly SimulationEvent[]): readonly SimulationEvent[] {
  if (Object.isFrozen(events)) return events
  const cached = ownedCache.get(events)
  if (cached !== undefined) return cached
  const owned = deepFreeze(
    events.map((event) => cloneJson(event as unknown as JsonValue) as unknown as SimulationEvent),
  )
  ownedCache.set(events, owned)
  return owned
}

/** Deep-freezes a single event, copying it first when it is not already frozen. */
function ownEvent(event: SimulationEvent): SimulationEvent {
  return Object.isFrozen(event) ? event : deepFreeze(cloneJson(event as unknown as JsonValue) as unknown as SimulationEvent)
}

function checkpointsFor(events: readonly SimulationEvent[]): CheckpointIndex {
  const cached = checkpointCache.get(events)
  if (cached !== undefined) return cached

  const states: ReplayState[] = []
  const working = emptyMutable()
  states.push(snapshot(working)) // index 0 → cursor 0
  for (let index = 0; index < events.length; index += 1) {
    applyMutable(working, events[index]!)
    if (working.cursor % CHECKPOINT_INTERVAL === 0) states.push(snapshot(working))
  }

  const built: CheckpointIndex = { interval: CHECKPOINT_INTERVAL, states }
  checkpointCache.set(events, built)
  return built
}

// --- Public API -------------------------------------------------------------

export function initialReplayState(): ReplayState {
  return snapshot(emptyMutable())
}

/**
 * Applies the single event at `state.cursor`, returning the next state. Pure;
 * never mutates `state`. Used for single forward steps. Producing an immutable
 * snapshot is O(current state size); the bulk paths below avoid doing that per
 * event.
 */
export function applyEvent(state: ReplayState, event: SimulationEvent): ReplayState {
  const working = toMutable(state)
  // Own the single event so a snapshot never aliases caller-owned mutable data.
  applyMutable(working, ownEvent(event))
  return snapshot(working)
}

/** State after the first `cursor` events, clamped to [0, events.length]. */
export function seekReplay(events: readonly SimulationEvent[], cursor: number): ReplayState {
  const owned = own(events)
  const target = Math.max(0, Math.min(cursor, owned.length))
  const checkpoints = checkpointsFor(owned)
  const baseIndex = Math.min(Math.floor(target / checkpoints.interval), checkpoints.states.length - 1)
  const base = checkpoints.states[baseIndex]!
  if (base.cursor === target) return base

  const working = toMutable(base)
  for (let index = base.cursor; index < target; index += 1) {
    applyMutable(working, owned[index]!)
  }
  return snapshot(working)
}

/** Advances one event; a no-op at the end of the stream. */
export function stepReplay(events: readonly SimulationEvent[], state: ReplayState): ReplayState {
  const owned = own(events)
  return state.cursor < owned.length ? applyEvent(state, owned[state.cursor]!) : state
}

/** Retreats one event; a no-op at the start of the stream. Checkpoint-accelerated. */
export function stepBackReplay(events: readonly SimulationEvent[], state: ReplayState): ReplayState {
  return seekReplay(events, state.cursor - 1)
}

/** The state after applying the whole stream. */
export function replayFinalState(events: readonly SimulationEvent[]): ReplayState {
  return seekReplay(events, events.length)
}
