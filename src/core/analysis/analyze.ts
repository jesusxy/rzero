// Result analysis (docs/analysis-results.md). Summarizes a completed or aborted
// engine run without reinterpreting propagation: it recomputes counts and sets
// from the recorded events and parent records, and reconstructs one reproducible
// first-compromise path per compromised asset. It never turns a blocked attempt
// into a compromise or invents routes the engine did not evaluate.

import type { Mechanism } from '../domain/profile'
import type { CompiledScenario } from '../domain/scenario'
import type {
  AbortCode,
  Check,
  CheckCode,
  Outcome,
  ParentRecord,
  PropagationResolvedEvent,
  RunResult,
} from '../engine'
import { compareCodeUnits } from '../io/canonical-json'
import { deepFreeze } from '../scenario/freeze'

export type AttemptCounts = {
  readonly succeeded: number
  readonly blocked: number
  readonly indeterminate: number
  /** Skipped links; excluded from attempt outcomes (docs/event-model.md). */
  readonly skipped: number
}

/** Non-seed first compromises attributed to each mechanism. Sums to compromised − 1. */
export type MechanismContributions = Readonly<Record<Mechanism, number>>

export type RunAnalysis = {
  readonly status: 'completed' | 'aborted'
  readonly input_digest: string
  readonly model_version: string
  readonly engine_version: string
  readonly profile_id: string
  readonly profile_version: string
  readonly seed_id: string
  readonly total_assets: number
  /** Sorted. Includes the seed. */
  readonly compromised: readonly string[]
  /** Sorted. All asset IDs minus compromised; never implies real-world safety. */
  readonly unaffected: readonly string[]
  /** Sorted. A subset of `unaffected`. */
  readonly indeterminate_targets: readonly string[]
  /** Sorted. Compromised assets flagged `critical`. */
  readonly critical_compromised: readonly string[]
  readonly attempt_counts: AttemptCounts
  readonly mechanism_contributions: MechanismContributions
  /** Blocked attempts tallied by their first failed check (the primary reason). */
  readonly primary_blocking_reasons: Readonly<Partial<Record<CheckCode, number>>>
  /** Compromised / total, in [0, 1]. Partial for aborted runs. */
  readonly blast_radius: number
  /** First-compromise records, sorted by asset ID. */
  readonly parents: readonly ParentRecord[]
  readonly abort?: { readonly code: AbortCode; readonly last_processed_seq: number }
}

/** One step of a first-compromise path. The seed step has no `via`. */
export type PathStep = {
  readonly asset_id: string
  readonly hop: number
  readonly via?: {
    readonly source_id: string
    readonly link_id: string
    readonly capability_id: string
    readonly attempt_id: string
    readonly outcome: Extract<Outcome, 'succeeded'>
    readonly checks: readonly Check[]
    readonly evidence_ids: readonly string[]
  }
}

const EMPTY_MECHANISMS: MechanismContributions = { remote_exploit: 0, remote_execution: 0 }

/** Summarizes one engine run against the scenario it ran on. */
export function analyzeRun(compiled: CompiledScenario, run: RunResult): RunAnalysis {
  if (run.input_digest !== compiled.input_digest) {
    throw new Error('analyzeRun: the run does not belong to this compiled scenario (input digest mismatch).')
  }

  const assets = compiled.effective.network.assets
  const compromisedSet = new Set(run.state.compromised)
  const compromised = [...run.state.compromised].sort(compareCodeUnits)
  const unaffected = assets
    .map((asset) => asset.id)
    .filter((id) => !compromisedSet.has(id))
    .sort(compareCodeUnits)
  const criticalCompromised = assets
    .filter((asset) => asset.critical && compromisedSet.has(asset.id))
    .map((asset) => asset.id)
    .sort(compareCodeUnits)

  const counts = { succeeded: 0, blocked: 0, indeterminate: 0, skipped: 0 }
  const indeterminate = new Set<string>()
  const primaryBlocking: Partial<Record<CheckCode, number>> = {}
  for (const event of run.events) {
    if (event.type === 'propagation_resolved') {
      counts[event.outcome] += 1
      if (event.outcome === 'indeterminate' && !compromisedSet.has(event.target_id)) {
        indeterminate.add(event.target_id)
      }
      if (event.outcome === 'blocked') {
        const reason = event.checks.find((check) => check.status === 'fail')?.code
        if (reason !== undefined) primaryBlocking[reason] = (primaryBlocking[reason] ?? 0) + 1
      }
    } else if (event.type === 'propagation_skipped') {
      counts.skipped += 1
    }
  }

  const mechanismByCapability = new Map<string, Mechanism>(
    compiled.effective.profile.capabilities.map((capability) => [capability.id, capability.mechanism]),
  )
  const mechanisms: Record<Mechanism, number> = { ...EMPTY_MECHANISMS }
  for (const parent of run.state.parents) {
    const mechanism = mechanismByCapability.get(parent.capability_id)
    if (mechanism !== undefined) mechanisms[mechanism] += 1
  }

  return deepFreeze({
    status: run.status,
    input_digest: run.input_digest,
    model_version: run.model_version,
    engine_version: run.engine_version,
    profile_id: compiled.effective.profile.id,
    profile_version: compiled.effective.profile.version,
    seed_id: run.state.seed_id,
    total_assets: assets.length,
    compromised,
    unaffected,
    indeterminate_targets: [...indeterminate].sort(compareCodeUnits),
    critical_compromised: criticalCompromised,
    attempt_counts: counts,
    mechanism_contributions: mechanisms,
    primary_blocking_reasons: primaryBlocking,
    blast_radius: assets.length === 0 ? 0 : compromised.length / assets.length,
    parents: run.state.parents,
    ...(run.abort === undefined ? {} : { abort: run.abort }),
  })
}

/**
 * Reconstructs the single reproducible first-compromise path for `assetId` by
 * following parent pointers back to the seed, then reversing to seed-first.
 * Returns undefined for an uncompromised asset. This is one canonical witness,
 * not an enumeration of every successful route.
 */
export function firstCompromisePath(run: RunResult, assetId: string): PathStep[] | undefined {
  if (!run.state.compromised.includes(assetId)) return undefined

  const parentByAsset = new Map(run.state.parents.map((parent) => [parent.asset_id, parent]))
  const resolvedByAttempt = new Map<string, PropagationResolvedEvent>()
  for (const event of run.events) {
    if (event.type === 'propagation_resolved' && event.outcome === 'succeeded') {
      resolvedByAttempt.set(event.attempt_id, event)
    }
  }

  const steps: PathStep[] = []
  const visited = new Set<string>()
  let current: string | undefined = assetId
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    const parent = parentByAsset.get(current)
    if (parent === undefined) {
      // The seed: no parent, no `via`.
      steps.push({ asset_id: current, hop: run.state.hops[current] ?? 0 })
      break
    }
    const resolved = resolvedByAttempt.get(parent.attempt_id)
    steps.push({
      asset_id: current,
      hop: parent.hop,
      via: {
        source_id: parent.parent_id,
        link_id: parent.link_id,
        capability_id: parent.capability_id,
        attempt_id: parent.attempt_id,
        outcome: 'succeeded',
        checks: resolved?.checks ?? [],
        evidence_ids: resolved?.evidence_ids ?? [],
      },
    })
    current = parent.parent_id
  }

  return steps.reverse()
}
