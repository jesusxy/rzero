// Static interventions (docs/scenario-model.md#intervention-vocabulary).
// Each intervention writes exact facts on a copy of the canonical network.
// Writes never overlap, so application order cannot matter; the manifest is
// sorted by intervention ID.

import { error, warning, type Diagnostic, type Path } from '../domain/diagnostics'
import type { Asset, Credential, Link, Network, VulnerabilityFact } from '../domain/network'
import type {
  FieldChange,
  Intervention,
  InterventionRecord,
  ManifestEntityKind,
} from '../domain/scenario'
import { compareCodeUnits } from '../io/canonical-json'
import { collectIds } from '../validation/ids'

/** Builders for `FieldChange.field_ref`, shared with later engine/inspector code. */
export const fieldRefs = {
  linkAccess: (linkId: string) => `link:${linkId}/access`,
  assetIsolation: (assetId: string) => `asset:${assetId}/isolated`,
  serviceStatus: (assetId: string, serviceId: string) => `asset:${assetId}/service:${serviceId}/status`,
  vulnerabilityStatus: (assetId: string, vulnerabilityId: string) =>
    `asset:${assetId}/vulnerability:${vulnerabilityId}/status`,
  grantStatus: (credentialId: string, targetId: string, serviceId: string) =>
    `credential:${credentialId}/grant:${targetId}:${serviceId}/status`,
} as const

export type InterventionOutcome =
  | {
      readonly ok: true
      readonly network: Network
      readonly manifest: InterventionRecord[]
      readonly warnings: Diagnostic[]
    }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] }

type PendingChange = Omit<FieldChange, 'noop'>

type Planned = {
  readonly intervention: Intervention
  readonly index: number
  readonly changes: PendingChange[]
}

/**
 * Validates intervention targets, rejects overlapping writes and applies the
 * interventions to `network`, which must already be canonical.
 */
export function applyInterventions(
  network: Network,
  interventions: readonly Intervention[],
  base: Path,
): InterventionOutcome {
  const diagnostics: Diagnostic[] = []
  collectIds(interventions, base, 'intervention', diagnostics)

  const segments = new Set(network.segments.map((segment) => segment.id))
  const assets = new Map(network.assets.map((asset) => [asset.id, asset]))
  const credentials = new Map(network.credentials.map((credential) => [credential.id, credential]))

  const linksBySelector = new Map<string, Link[]>()
  for (const link of network.links) {
    const source = assets.get(link.source_id)
    const target = assets.get(link.target_id)
    if (source === undefined || target === undefined) continue
    const key = selectorKey(source.segment_id, target.segment_id, link.service_id)
    const bucket = linksBySelector.get(key) ?? []
    bucket.push(link)
    linksBySelector.set(key, bucket)
  }

  const planned: Planned[] = []
  interventions.forEach((intervention, index) => {
    const path = [...base, index]
    const changes = planChanges(intervention, path, {
      segments,
      assets,
      credentials,
      linksBySelector,
    }, diagnostics)
    if (changes !== undefined) planned.push({ intervention, index, changes })
  })

  const owners = new Map<string, Planned>()
  const reportedPairs = new Set<string>()
  for (const plan of planned) {
    for (const change of plan.changes) {
      const owner = owners.get(change.field_ref)
      if (owner === undefined) {
        owners.set(change.field_ref, plan)
        continue
      }
      const pair = `${owner.index}:${plan.index}`
      if (reportedPairs.has(pair)) continue
      reportedPairs.add(pair)
      diagnostics.push(
        error(
          'CONFLICTING_INTERVENTIONS',
          [...base, plan.index],
          `Intervention "${plan.intervention.id}" writes ${change.field_ref}, which intervention ` +
            `"${owner.intervention.id}" already writes. Overlapping writes are rejected even when values agree.`,
          { entityId: plan.intervention.id },
        ),
      )
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const writes = new Map<string, string | boolean>()
  for (const plan of planned) {
    for (const change of plan.changes) writes.set(change.field_ref, change.effective)
  }

  const warnings: Diagnostic[] = []
  const manifest = planned
    .map((plan): InterventionRecord => {
      const changes = plan.changes
        .map((change): FieldChange => ({ ...change, noop: change.original === change.effective }))
        .sort((a, b) => compareCodeUnits(a.field_ref, b.field_ref))
      const noop = changes.every((change) => change.noop)
      if (noop) {
        warnings.push(
          warning(
            'INTERVENTION_NOOP',
            [...base, plan.index],
            `Intervention "${plan.intervention.id}" sets values that are already in effect.`,
            { entityId: plan.intervention.id },
          ),
        )
      }
      return {
        intervention_id: plan.intervention.id,
        type: plan.intervention.type,
        selector: selectorOf(plan.intervention),
        value: valueOf(plan.intervention),
        affected_entity_ids: [...new Set(changes.map((change) => change.entity_id))].sort(compareCodeUnits),
        changes,
        noop,
      }
    })
    .sort((a, b) => compareCodeUnits(a.intervention_id, b.intervention_id))

  return { ok: true, network: applyWrites(network, writes), manifest, warnings }
}

type Indexes = {
  readonly segments: ReadonlySet<string>
  readonly assets: ReadonlyMap<string, Asset>
  readonly credentials: ReadonlyMap<string, Credential>
  readonly linksBySelector: ReadonlyMap<string, readonly Link[]>
}

function planChanges(
  intervention: Intervention,
  path: Path,
  indexes: Indexes,
  out: Diagnostic[],
): PendingChange[] | undefined {
  const entityId = intervention.id
  const missing = (code: Diagnostic['code'], field: string, message: string) => {
    out.push(error(code, [...path, field], message, { entityId }))
    return undefined
  }

  const change = (
    field_ref: string,
    entity_kind: ManifestEntityKind,
    owner: string,
    original: string | boolean | null,
    effective: string | boolean,
  ): PendingChange => ({ field_ref, entity_kind, entity_id: owner, original, effective })

  switch (intervention.type) {
    case 'set_boundary_access': {
      let valid = true
      for (const field of ['from_segment_id', 'to_segment_id'] as const) {
        if (!indexes.segments.has(intervention[field])) {
          missing('UNKNOWN_SEGMENT', field, `Segment "${intervention[field]}" does not exist.`)
          valid = false
        }
      }
      if (!valid) return undefined
      const matches = indexes.linksBySelector.get(
        selectorKey(intervention.from_segment_id, intervention.to_segment_id, intervention.service_id),
      )
      if (matches === undefined || matches.length === 0) {
        out.push(
          error(
            'INTERVENTION_NO_MATCH',
            path,
            `No ${intervention.service_id} link runs from segment "${intervention.from_segment_id}" to ` +
              `"${intervention.to_segment_id}". A selector that matches nothing is an error, not an empty success; ` +
              'boundary interventions never create links.',
            { entityId },
          ),
        )
        return undefined
      }
      return matches.map((link) =>
        change(fieldRefs.linkAccess(link.id), 'link', link.id, link.access, intervention.access),
      )
    }

    case 'set_vulnerability_status': {
      const asset = indexes.assets.get(intervention.asset_id)
      if (asset === undefined) {
        return missing('UNKNOWN_ASSET', 'asset_id', `Asset "${intervention.asset_id}" does not exist.`)
      }
      const fact = asset.vulnerabilities.find((entry) => entry.id === intervention.vulnerability_id)
      return [
        change(
          fieldRefs.vulnerabilityStatus(asset.id, intervention.vulnerability_id),
          'vulnerability',
          asset.id,
          fact?.status ?? null,
          intervention.status,
        ),
      ]
    }

    case 'set_service_status': {
      const asset = indexes.assets.get(intervention.asset_id)
      if (asset === undefined) {
        return missing('UNKNOWN_ASSET', 'asset_id', `Asset "${intervention.asset_id}" does not exist.`)
      }
      const service = asset.services.find((entry) => entry.id === intervention.service_id)
      if (service === undefined) {
        return missing(
          'UNKNOWN_SERVICE',
          'service_id',
          `Asset "${asset.id}" has no "${intervention.service_id}" service; set_service_status cannot create services.`,
        )
      }
      return [
        change(fieldRefs.serviceStatus(asset.id, service.id), 'service', asset.id, service.status, intervention.status),
      ]
    }

    case 'set_asset_isolation': {
      const asset = indexes.assets.get(intervention.asset_id)
      if (asset === undefined) {
        return missing('UNKNOWN_ASSET', 'asset_id', `Asset "${intervention.asset_id}" does not exist.`)
      }
      return [change(fieldRefs.assetIsolation(asset.id), 'asset', asset.id, asset.isolated, intervention.isolated)]
    }

    case 'set_grant_status': {
      const credential = indexes.credentials.get(intervention.credential_id)
      if (credential === undefined) {
        return missing(
          'UNKNOWN_CREDENTIAL',
          'credential_id',
          `Credential "${intervention.credential_id}" does not exist.`,
        )
      }
      const grant = credential.grants.find(
        (entry) => entry.target_id === intervention.target_id && entry.service_id === intervention.service_id,
      )
      if (grant === undefined) {
        out.push(
          error(
            'UNKNOWN_GRANT',
            path,
            `Credential "${credential.id}" has no ${intervention.target_id}/${intervention.service_id} grant; ` +
              'set_grant_status cannot create grants.',
            { entityId },
          ),
        )
        return undefined
      }
      return [
        change(
          fieldRefs.grantStatus(credential.id, grant.target_id, grant.service_id),
          'grant',
          credential.id,
          grant.status,
          intervention.status,
        ),
      ]
    }
  }
}

function applyWrites(network: Network, writes: ReadonlyMap<string, string | boolean>): Network {
  const read = <T>(ref: string, fallback: T): T => (writes.has(ref) ? (writes.get(ref) as T) : fallback)

  const assets = network.assets.map((asset): Asset => {
    const vulnerabilities: VulnerabilityFact[] = asset.vulnerabilities.map((fact) => ({
      id: fact.id,
      status: read(fieldRefs.vulnerabilityStatus(asset.id, fact.id), fact.status),
    }))
    const prefix = `asset:${asset.id}/vulnerability:`
    for (const [ref, status] of writes) {
      if (!ref.startsWith(prefix)) continue
      const id = ref.slice(prefix.length, ref.length - '/status'.length)
      if (!vulnerabilities.some((fact) => fact.id === id)) {
        vulnerabilities.push({ id, status: status as VulnerabilityFact['status'] })
      }
    }
    vulnerabilities.sort((a, b) => compareCodeUnits(a.id, b.id))

    return {
      ...asset,
      isolated: read(fieldRefs.assetIsolation(asset.id), asset.isolated),
      services: asset.services.map((service) => ({
        ...service,
        status: read(fieldRefs.serviceStatus(asset.id, service.id), service.status),
      })),
      vulnerabilities,
    }
  })

  const links = network.links.map((link): Link => ({
    ...link,
    access: read(fieldRefs.linkAccess(link.id), link.access),
  }))

  const credentials = network.credentials.map((credential): Credential => ({
    ...credential,
    grants: credential.grants.map((grant) => ({
      ...grant,
      status: read(fieldRefs.grantStatus(credential.id, grant.target_id, grant.service_id), grant.status),
    })),
  }))

  return { ...network, assets, links, credentials }
}

function selectorKey(fromSegment: string, toSegment: string, serviceId: string): string {
  return `${fromSegment}\u0000${toSegment}\u0000${serviceId}`
}

const valueFields = new Set(['access', 'status', 'isolated'])
const nonSelectorFields = new Set(['type', 'id', 'metadata'])

function selectorOf(intervention: Intervention): Record<string, string> {
  const selector: Record<string, string> = {}
  for (const [key, value] of Object.entries(intervention)) {
    if (!nonSelectorFields.has(key) && !valueFields.has(key)) selector[key] = value as string
  }
  return selector
}

function valueOf(intervention: Intervention): Record<string, string | boolean> {
  const value: Record<string, string | boolean> = {}
  for (const [key, entry] of Object.entries(intervention)) {
    if (valueFields.has(key)) value[key] = entry as string | boolean
  }
  return value
}
