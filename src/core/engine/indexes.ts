// Run indexes, built once per run (docs/simulation-engine.md#termination).
// They turn the static effective network and profile into the lookups the
// traversal needs, without scanning the whole inventory per attempt.

import type { Asset, Credential, Grant, Link, Network } from '../domain/network'
import type { Capability, MalwareProfile } from '../domain/profile'
import type { InterventionManifest } from '../domain/scenario'
import { compareCodeUnits } from '../io/canonical-json'

const SEP = '\u0000'

export function grantKey(targetId: string, serviceId: string): string {
  return `${targetId}${SEP}${serviceId}`
}

/** Outgoing links per source, each list sorted by (target_id, service_id, id). */
export function buildAdjacency(network: Network): ReadonlyMap<string, readonly Link[]> {
  const adjacency = new Map<string, Link[]>()
  for (const link of network.links) {
    const bucket = adjacency.get(link.source_id)
    if (bucket === undefined) adjacency.set(link.source_id, [link])
    else bucket.push(link)
  }
  for (const bucket of adjacency.values()) {
    bucket.sort(
      (a, b) =>
        compareCodeUnits(a.target_id, b.target_id) ||
        compareCodeUnits(a.service_id, b.service_id) ||
        compareCodeUnits(a.id, b.id),
    )
  }
  return adjacency
}

/** Capabilities per service ID, each list sorted by capability ID (alternatives). */
export function buildCapabilitiesByService(
  profile: MalwareProfile,
): ReadonlyMap<string, readonly Capability[]> {
  const byService = new Map<string, Capability[]>()
  for (const capability of profile.capabilities) {
    const bucket = byService.get(capability.service_id)
    if (bucket === undefined) byService.set(capability.service_id, [capability])
    else bucket.push(capability)
  }
  for (const bucket of byService.values()) {
    bucket.sort((a, b) => compareCodeUnits(a.id, b.id))
  }
  return byService
}

export type CredentialIndex = {
  /** Resolve a credential available on a source by ID. */
  readonly byId: ReadonlyMap<string, Credential>
  /** Resolve a grant by `grantKey(target, service)` within one credential. */
  readonly grants: ReadonlyMap<string, ReadonlyMap<string, Grant>>
}

export function buildCredentialIndex(network: Network): CredentialIndex {
  const byId = new Map<string, Credential>()
  const grants = new Map<string, Map<string, Grant>>()
  for (const credential of network.credentials) {
    byId.set(credential.id, credential)
    const perTarget = new Map<string, Grant>()
    for (const grant of credential.grants) {
      perTarget.set(grantKey(grant.target_id, grant.service_id), grant)
    }
    grants.set(credential.id, perTarget)
  }
  return { byId, grants }
}

export function buildAssetIndex(network: Network): ReadonlyMap<string, Asset> {
  return new Map(network.assets.map((asset) => [asset.id, asset]))
}

/**
 * Maps a field reference (`link:bd/access`, …) to the intervention IDs that
 * wrote it, so a check can name the interventions behind its observed fact.
 * At most one intervention per field (overlaps are rejected at compile).
 */
export function buildInterventionFieldMap(
  manifest: InterventionManifest,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>()
  for (const record of manifest) {
    for (const change of record.changes) {
      const existing = map.get(change.field_ref)
      if (existing === undefined) map.set(change.field_ref, [record.intervention_id])
      else existing.push(record.intervention_id)
    }
  }
  return map
}
