// Pure replay reducer (docs/event-model.md#replay-responsibilities).
//
// Reconstructs discovery, compromise and attempt state from a recorded event
// stream without re-running propagation. It is a fold: `seekReplay(events, n)`
// is the state after applying the first `n` events, computed only from the
// events, so stepping and seeking always agree and a run at a different
// playback speed yields the same state.
//
// Cursor semantics: `cursor` is the number of events applied, in [0,
// events.length]. Cursor 0 is the state before `run_started`; `events.length`
// is the final state. The state reflects `events[0 .. cursor - 1]`.
//
// Compromise and discovery are append-only here: a blocked or indeterminate
// attempt only updates the attempt ledger and can never remove a compromise or
// mark an asset permanently safe.

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

export function initialReplayState(): ReplayState {
  return deepFreeze({
    cursor: 0,
    discovered: [],
    compromised: [],
    parents: {},
    hops: {},
    attempts: {},
    terminal: null,
  })
}

/** Applies the single event at `state.cursor`, returning the next state. Pure. */
export function applyEvent(state: ReplayState, event: SimulationEvent): ReplayState {
  const cursor = state.cursor + 1
  switch (event.type) {
    case 'asset_discovered':
      return deepFreeze({
        ...state,
        cursor,
        discovered: state.discovered.includes(event.asset_id)
          ? state.discovered
          : [...state.discovered, event.asset_id],
      })

    case 'propagation_attempted':
      return deepFreeze({
        ...state,
        cursor,
        attempts: {
          ...state.attempts,
          [event.attempt_id]: {
            attempt_id: event.attempt_id,
            source_id: event.source_id,
            target_id: event.target_id,
            link_id: event.link_id,
            capability_id: event.capability_id,
            status: 'pending',
            checks: [],
          },
        },
      })

    case 'propagation_resolved':
      return deepFreeze({
        ...state,
        cursor,
        attempts: {
          ...state.attempts,
          [event.attempt_id]: {
            attempt_id: event.attempt_id,
            source_id: event.source_id,
            target_id: event.target_id,
            link_id: event.link_id,
            capability_id: event.capability_id,
            status: event.outcome,
            checks: event.checks,
          },
        },
      })

    case 'asset_compromised': {
      const compromised = state.compromised.includes(event.asset_id)
        ? state.compromised
        : [...state.compromised, event.asset_id]
      const hops = { ...state.hops, [event.asset_id]: event.hop }
      let parents = state.parents
      if (event.parent_id !== null) {
        const attempt = event.attempt_id === null ? undefined : state.attempts[event.attempt_id]
        parents = {
          ...state.parents,
          [event.asset_id]: {
            parent_id: event.parent_id,
            attempt_id: event.attempt_id,
            link_id: attempt?.link_id ?? null,
            capability_id: attempt?.capability_id ?? null,
            hop: event.hop,
          },
        }
      }
      return deepFreeze({ ...state, cursor, compromised, hops, parents })
    }

    case 'run_completed':
      return deepFreeze({ ...state, cursor, terminal: 'completed' })

    case 'run_aborted':
      return deepFreeze({ ...state, cursor, terminal: 'aborted' })

    // run_started and propagation_skipped advance the cursor without changing
    // discovery or compromise state.
    case 'run_started':
    case 'propagation_skipped':
      return deepFreeze({ ...state, cursor })
  }
}

/** State after the first `cursor` events, clamped to [0, events.length]. */
export function seekReplay(events: readonly SimulationEvent[], cursor: number): ReplayState {
  const target = Math.max(0, Math.min(cursor, events.length))
  let state = initialReplayState()
  for (let index = 0; index < target; index += 1) {
    state = applyEvent(state, events[index]!)
  }
  return state
}

/** Advances one event; a no-op at the end of the stream. */
export function stepReplay(events: readonly SimulationEvent[], state: ReplayState): ReplayState {
  return state.cursor < events.length ? applyEvent(state, events[state.cursor]!) : state
}

/** Retreats one event by re-folding; a no-op at the start of the stream. */
export function stepBackReplay(events: readonly SimulationEvent[], state: ReplayState): ReplayState {
  return seekReplay(events, state.cursor - 1)
}

/** The state after applying the whole stream. */
export function replayFinalState(events: readonly SimulationEvent[]): ReplayState {
  return seekReplay(events, events.length)
}
