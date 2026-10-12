// Deterministic propagation engine (docs/simulation-engine.md).
//
// Breadth-first traversal over the compiled effective scenario. The seed is
// compromised at hop 0; each dequeued source tries its outgoing links in a
// fixed order; a transition whose every check passes compromises the target,
// records its first parent, and enqueues it. Compromise is marked at enqueue,
// so converging paths never duplicate a compromise and cycles always stop.
// The engine owns run state only; the effective network stays untouched.

import type { Asset } from '../domain/network'
import { ADMISSION_LIMITS } from '../domain/limits'
import type { CompiledScenario } from '../domain/scenario'
import { compareCodeUnits } from '../io/canonical-json'
import { deepFreeze } from '../scenario/freeze'
import { evaluateCapability, type EvaluationContext } from './checks'
import {
  attemptId as formatAttemptId,
  eventId,
  type AbortCode,
  type SimulationEvent,
} from './events'
import {
  buildAdjacency,
  buildAssetIndex,
  buildCapabilitiesByService,
  buildCredentialIndex,
  buildInterventionFieldMap,
} from './indexes'

export const ENGINE_VERSION = 'rzero-engine/1'

export type RunStatus = 'completed' | 'aborted'

/** First-compromise causal record for a non-seed asset. */
export type ParentRecord = {
  readonly asset_id: string
  readonly parent_id: string
  readonly link_id: string
  readonly capability_id: string
  readonly attempt_id: string
  /** parent hop + 1. */
  readonly hop: number
}

export type FinalRunState = {
  readonly seed_id: string
  /** Compromise order, seed first. */
  readonly compromised: readonly string[]
  /** Discovery order. */
  readonly discovered: readonly string[]
  /** Processing order. */
  readonly processed: readonly string[]
  /** Non-seed first-compromise records, sorted by asset ID. */
  readonly parents: readonly ParentRecord[]
  /** Logical hop depth per compromised asset, including the seed at 0. */
  readonly hops: Readonly<Record<string, number>>
}

export type RunResult = {
  readonly status: RunStatus
  readonly engine_version: string
  readonly model_version: string
  readonly input_digest: string
  readonly events: readonly SimulationEvent[]
  readonly state: FinalRunState
  /** Present only when `status` is `aborted`. */
  readonly abort?: { readonly code: AbortCode; readonly last_processed_seq: number }
}

export type RunOptions = {
  /** Overrides the default engine version string (tests only). */
  readonly engineVersion?: string
  /** Hard event cap. Defaults to the V1 admission limit; lower it in tests. */
  readonly maxEvents?: number
  /**
   * Checked between sources and between links. Returning true emits
   * `run_aborted` and stops without splitting an in-flight attempt group.
   */
  readonly shouldCancel?: () => boolean
}

/** Thrown internally to unwind the traversal to the terminal event. */
type RunAborted = { readonly runAborted: true; readonly code: AbortCode }

function abortSignal(code: AbortCode): RunAborted {
  return { runAborted: true, code }
}

function isRunAborted(value: unknown): value is RunAborted {
  return typeof value === 'object' && value !== null && (value as RunAborted).runAborted === true
}

/** Event fields a caller supplies; the engine adds `event_id` and `seq`. */
type EventInput = SimulationEvent extends infer E
  ? E extends SimulationEvent
    ? Omit<E, 'event_id' | 'seq'>
    : never
  : never

/** Runs the deterministic engine over a compiled scenario. */
export function runScenario(compiled: CompiledScenario, options: RunOptions = {}): RunResult {
  const engineVersion = options.engineVersion ?? ENGINE_VERSION
  const maxEvents = options.maxEvents ?? ADMISSION_LIMITS.maxEventsPerRun
  const shouldCancel = options.shouldCancel

  const { network, profile, initial_asset_id: seedId } = compiled.effective
  const assets = buildAssetIndex(network)
  const adjacency = buildAdjacency(network)
  const capabilitiesByService = buildCapabilitiesByService(profile)
  const context: EvaluationContext = {
    assets,
    credentials: buildCredentialIndex(network),
    interventionFields: buildInterventionFieldMap(compiled.manifest),
  }

  const events: SimulationEvent[] = []
  let seq = 0
  let attemptCounter = 0

  const compromised = new Set<string>()
  const discovered = new Set<string>()
  const processed = new Set<string>()
  const compromisedOrder: string[] = []
  const discoveredOrder: string[] = []
  const processedOrder: string[] = []
  const hops = new Map<string, number>()
  const parents = new Map<string, ParentRecord>()
  const queue: string[] = []
  let queueHead = 0

  // One slot is always reserved so the terminal event (completed or aborted)
  // can be emitted no matter when the budget runs out.
  const requireCapacity = (count: number): void => {
    if (seq + count > maxEvents - 1) throw abortSignal('EVENT_LIMIT')
  }
  const checkCancel = (): void => {
    if (shouldCancel?.()) throw abortSignal('CANCELLED')
  }
  const emit = (event: EventInput): void => {
    events.push({ event_id: eventId(seq), seq, ...event } as SimulationEvent)
    seq += 1
  }

  const seed = assets.get(seedId)
  if (seed === undefined) {
    // Compilation guarantees the seed exists; guard defensively regardless.
    throw new Error(`Effective scenario is missing its initial asset "${seedId}".`)
  }

  try {
    requireCapacity(1)
    emit({
      type: 'run_started',
      hop: 0,
      input_digest: compiled.input_digest,
      engine_version: engineVersion,
      model_version: compiled.model_version,
      profile_id: profile.id,
      profile_version: profile.version,
      initial_asset_id: seedId,
    })

    requireCapacity(1)
    markCompromised(seed, 0, null)
    emit({ type: 'asset_compromised', hop: 0, asset_id: seedId, parent_id: null, attempt_id: null })

    while (queueHead < queue.length) {
      checkCancel()
      const sourceId = queue[queueHead]!
      queueHead += 1
      const source = assets.get(sourceId)!
      const sourceHop = hops.get(sourceId)!
      const targetHop = sourceHop + 1

      for (const link of adjacency.get(sourceId) ?? []) {
        checkCancel()
        const target = assets.get(link.target_id)!

        if (compromised.has(target.id)) {
          requireCapacity(1)
          emit({
            type: 'propagation_skipped',
            hop: targetHop,
            source_id: sourceId,
            target_id: target.id,
            link_id: link.id,
            reason: 'TARGET_ALREADY_COMPROMISED',
          })
          continue
        }

        const capabilities = capabilitiesByService.get(link.service_id) ?? []
        if (capabilities.length === 0) continue // no evaluator: no attempt, no discovery

        if (!discovered.has(target.id)) {
          requireCapacity(1)
          discovered.add(target.id)
          discoveredOrder.push(target.id)
          emit({
            type: 'asset_discovered',
            hop: targetHop,
            asset_id: target.id,
            source_id: sourceId,
            link_id: link.id,
          })
        }

        for (const capability of capabilities) {
          // Reserve the whole group: attempted, resolved and a possible compromise.
          requireCapacity(3)
          attemptCounter += 1
          const attempt = formatAttemptId(attemptCounter)
          emit({
            type: 'propagation_attempted',
            hop: targetHop,
            attempt_id: attempt,
            source_id: sourceId,
            target_id: target.id,
            link_id: link.id,
            capability_id: capability.id,
          })

          const { outcome, checks } = evaluateCapability(source, target, link, capability, context)
          emit({
            type: 'propagation_resolved',
            hop: targetHop,
            attempt_id: attempt,
            source_id: sourceId,
            target_id: target.id,
            link_id: link.id,
            capability_id: capability.id,
            outcome,
            checks,
            evidence_ids: capability.evidence_ids,
          })

          if (outcome === 'succeeded') {
            markCompromised(target, targetHop, {
              asset_id: target.id,
              parent_id: sourceId,
              link_id: link.id,
              capability_id: capability.id,
              attempt_id: attempt,
              hop: targetHop,
            })
            emit({
              type: 'asset_compromised',
              hop: targetHop,
              asset_id: target.id,
              parent_id: sourceId,
              attempt_id: attempt,
            })
            break // first success wins; later alternatives are not attempted
          }
        }
      }

      processed.add(sourceId)
      processedOrder.push(sourceId)
    }

    const maxHop = compromisedOrder.reduce((max, id) => Math.max(max, hops.get(id)!), 0)
    emit({
      type: 'run_completed',
      hop: maxHop,
      compromised_ids: sorted(compromisedOrder),
      discovered_ids: sorted(discoveredOrder),
      processed_ids: sorted(processedOrder),
    })
    return finalize('completed')
  } catch (failure) {
    if (isRunAborted(failure)) {
      const lastProcessedSeq = seq - 1
      const abortHop = queueHead > 0 ? (hops.get(queue[queueHead - 1]!) ?? 0) : 0
      emit({
        type: 'run_aborted',
        hop: abortHop,
        error_code: failure.code,
        last_processed_seq: lastProcessedSeq,
      })
      return finalize('aborted', { code: failure.code, last_processed_seq: lastProcessedSeq })
    }
    throw failure
  }

  function markCompromised(asset: Asset, hop: number, parent: ParentRecord | null): void {
    compromised.add(asset.id)
    compromisedOrder.push(asset.id)
    hops.set(asset.id, hop)
    if (parent !== null) parents.set(asset.id, parent)
    queue.push(asset.id)
  }

  function finalize(status: RunStatus, abort?: RunResult['abort']): RunResult {
    const hopRecord: Record<string, number> = {}
    for (const id of sorted(compromisedOrder)) hopRecord[id] = hops.get(id)!
    const state: FinalRunState = {
      seed_id: seedId,
      compromised: [...compromisedOrder],
      discovered: [...discoveredOrder],
      processed: [...processedOrder],
      parents: [...parents.values()].sort((a, b) => compareCodeUnits(a.asset_id, b.asset_id)),
      hops: hopRecord,
    }
    return deepFreeze({
      status,
      engine_version: engineVersion,
      model_version: compiled.model_version,
      input_digest: compiled.input_digest,
      events,
      state,
      ...(abort === undefined ? {} : { abort }),
    })
  }
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort(compareCodeUnits)
}
