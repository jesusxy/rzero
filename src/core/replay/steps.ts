// Replay steps: a walkthrough grouping of the engine event stream.
//
// A step is a contiguous range of events [start, end) and nothing more. It has
// no state of its own: showing a step means `seekReplay(events, step.end)`, so a
// step can never disagree with the engine or the reducer. Steps partition the
// stream exactly — no gaps, no overlaps, the first starts at 0 and the last
// ends at `events.length` — and are ordered by `start`.
//
// Grouping rules (docs/event-model.md vocabulary):
// - seed:    `run_started` plus the seed's `asset_compromised`.
// - attempt: one per attempt group — the `asset_discovered` immediately before
//            it (if any), `propagation_attempted`, `propagation_resolved`, and
//            the `asset_compromised` that immediately follows a success. An
//            attempt on an already-discovered target has no discovery; with
//            several capabilities on one link, each attempt is its own step and
//            the discovery belongs to the first.
// - summary: `run_completed`.  aborted: `run_aborted`.
// `propagation_skipped` events fold into the next step (usually the summary)
// and are listed in its `skipped_link_ids`.
//
// Ranges are array indices, which equal `seq` for an engine stream.

import type { Outcome, SimulationEvent } from '../engine'

export type StepKind = 'seed' | 'attempt' | 'summary' | 'aborted'

export type Step = {
  /** Position in the step list, from 0. */
  readonly index: number
  /** First event in the step. */
  readonly start: number
  /** One past the last event in the step. */
  readonly end: number
  readonly kind: StepKind
  /** Attempt steps only. */
  readonly attempt_id?: string
  readonly source_id?: string
  readonly target_id?: string
  /** Attempt steps only; absent if the stream ends before the attempt resolves. */
  readonly outcome?: Outcome
  /** Links of the `propagation_skipped` events folded into this step, in order. */
  readonly skipped_link_ids: readonly string[]
}

type AttemptFields = Pick<Step, 'attempt_id' | 'source_id' | 'target_id' | 'outcome'>

/** Groups an event stream into walkthrough steps that partition it exactly. */
export function groupSteps(events: readonly SimulationEvent[]): readonly Step[] {
  const steps: Step[] = []
  let start = 0
  let skipped: string[] = []

  const close = (end: number, kind: StepKind, fields: AttemptFields = {}): void => {
    steps.push(
      Object.freeze({ index: steps.length, start, end, kind, ...fields, skipped_link_ids: Object.freeze(skipped) }),
    )
    start = end
    skipped = []
  }

  let i = 0
  if (events[0]?.type === 'run_started') {
    i = 1
    const seed = events[1]
    // An extreme event cap can abort before the seed compromise fits.
    if (seed?.type === 'asset_compromised' && seed.parent_id === null) i = 2
    close(i, 'seed')
  }

  while (i < events.length) {
    const event = events[i]!
    i += 1
    switch (event.type) {
      case 'propagation_skipped':
        skipped.push(event.link_id)
        break
      case 'propagation_attempted': {
        const fields: { -readonly [K in keyof AttemptFields]: AttemptFields[K] } = {
          attempt_id: event.attempt_id,
          source_id: event.source_id,
          target_id: event.target_id,
        }
        const resolved = events[i]
        if (resolved?.type === 'propagation_resolved' && resolved.attempt_id === event.attempt_id) {
          fields.outcome = resolved.outcome
          i += 1
          const compromise = events[i]
          if (
            resolved.outcome === 'succeeded' &&
            compromise?.type === 'asset_compromised' &&
            compromise.attempt_id === event.attempt_id
          ) {
            i += 1
          }
        }
        close(i, 'attempt', fields)
        break
      }
      case 'run_completed':
        close(i, 'summary')
        break
      case 'run_aborted':
        close(i, 'aborted')
        break
      default:
        // `asset_discovered` (and anything unexpected) belongs to the next step.
        break
    }
  }

  // A stream with no terminal event (a truncated prefix) still partitions:
  // trailing events join the last step, or form one partial step.
  if (start < events.length) {
    const last = steps.pop()
    if (last === undefined) {
      close(events.length, 'aborted')
    } else {
      steps.push(
        Object.freeze({
          ...last,
          end: events.length,
          skipped_link_ids: Object.freeze([...last.skipped_link_ids, ...skipped]),
        }),
      )
    }
  }

  return Object.freeze(steps)
}
