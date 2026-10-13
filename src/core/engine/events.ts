// Engine event vocabulary (docs/event-model.md). Events are an append-only,
// serializable explanation of the engine's decisions. They carry no DOM or
// animation state; a UI presents them, it does not add to them.

export type EventType =
  | 'run_started'
  | 'asset_compromised'
  | 'asset_discovered'
  | 'propagation_attempted'
  | 'propagation_resolved'
  | 'propagation_skipped'
  | 'run_completed'
  | 'run_aborted'

/** Fixed check order (docs/event-model.md#attempt-checks). */
export type CheckCode =
  | 'SOURCE_NOT_ISOLATED'
  | 'TARGET_NOT_ISOLATED'
  | 'TARGET_PLATFORM'
  | 'NETWORK_ACCESS'
  | 'SERVICE_ENABLED'
  | 'VULNERABILITY_PRESENT'
  | 'CREDENTIAL_AUTHORIZED'

export type CheckStatus = 'pass' | 'fail' | 'unknown'

export type Outcome = 'succeeded' | 'blocked' | 'indeterminate'

export type SkipReason = 'TARGET_ALREADY_COMPROMISED'

export type AbortCode = 'EVENT_LIMIT' | 'CANCELLED'

/**
 * One evaluated requirement. `code` and the bounded `expected`/`observed`
 * facts are authoritative; a UI may derive a message from them. Values are
 * never credentials or secrets.
 */
export type Check = {
  readonly code: CheckCode
  readonly status: CheckStatus
  readonly expected: string
  readonly observed: string
  /** Entity IDs the fact lives on (asset, link or credential). */
  readonly entity_refs: readonly string[]
  /** Interventions that wrote the observed fact, if any. */
  readonly intervention_ids?: readonly string[]
}

type Envelope<T extends EventType> = {
  /** Stable within a stream, e.g. `e000009`. Independent of wall time. */
  readonly event_id: string
  /** Contiguous from 0. The authoritative replay order. */
  readonly seq: number
  readonly type: T
  /** Logical propagation depth, never seconds. */
  readonly hop: number
}

export type RunStartedEvent = Envelope<'run_started'> & {
  readonly input_digest: string
  readonly engine_version: string
  readonly model_version: string
  readonly profile_id: string
  readonly profile_version: string
  readonly initial_asset_id: string
}

export type AssetCompromisedEvent = Envelope<'asset_compromised'> & {
  readonly asset_id: string
  /** Null for the seed. */
  readonly parent_id: string | null
  /** Null for the seed; otherwise the successful attempt. */
  readonly attempt_id: string | null
}

export type AssetDiscoveredEvent = Envelope<'asset_discovered'> & {
  readonly asset_id: string
  readonly source_id: string
  readonly link_id: string
}

export type PropagationAttemptedEvent = Envelope<'propagation_attempted'> & {
  readonly attempt_id: string
  readonly source_id: string
  readonly target_id: string
  readonly link_id: string
  readonly capability_id: string
}

export type PropagationResolvedEvent = Envelope<'propagation_resolved'> & {
  readonly attempt_id: string
  readonly source_id: string
  readonly target_id: string
  readonly link_id: string
  readonly capability_id: string
  readonly outcome: Outcome
  /** Every applicable check in fixed order. */
  readonly checks: readonly Check[]
  /** The capability's supporting evidence record IDs. */
  readonly evidence_ids: readonly string[]
}

export type PropagationSkippedEvent = Envelope<'propagation_skipped'> & {
  readonly source_id: string
  readonly target_id: string
  readonly link_id: string
  readonly reason: SkipReason
}

export type RunCompletedEvent = Envelope<'run_completed'> & {
  /** Sorted by ID. */
  readonly compromised_ids: readonly string[]
  readonly discovered_ids: readonly string[]
  readonly processed_ids: readonly string[]
}

export type RunAbortedEvent = Envelope<'run_aborted'> & {
  readonly error_code: AbortCode
  /** Seq of the last event emitted before the abort, or -1 if none. */
  readonly last_processed_seq: number
}

export type SimulationEvent =
  | RunStartedEvent
  | AssetCompromisedEvent
  | AssetDiscoveredEvent
  | PropagationAttemptedEvent
  | PropagationResolvedEvent
  | PropagationSkippedEvent
  | RunCompletedEvent
  | RunAbortedEvent

/** Formats an event ID from a sequence number, e.g. 9 → `e000009`. */
export function eventId(seq: number): string {
  return `e${seq.toString().padStart(6, '0')}`
}

/** Formats an attempt ID from a 1-based counter, e.g. 2 → `a000002`. */
export function attemptId(counter: number): string {
  return `a${counter.toString().padStart(6, '0')}`
}
