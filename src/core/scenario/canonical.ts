// Canonical ordering and the semantic projection hashed into the input digest
// (docs/scenario-model.md#canonicalization-and-version-identity).
//
// Canonical copies are rebuilt field by field from schema-valid input, so they
// never share structure with caller-owned objects.

import { cloneJson, defineEntry, type JsonObject, type JsonValue, type Metadata } from '../domain/json'
import type { Asset, Credential, Link, Network, Segment } from '../domain/network'
import type { Capability, MalwareProfile, SourceRecord } from '../domain/profile'
import type { EffectiveInput, Intervention, ModelVersion } from '../domain/scenario'
import { canonicalJson, compareCodeUnits } from '../io/canonical-json'
import { encodeUtf8 } from '../io/utf8'
import { sha256Hex } from './sha256'

const byId = <T extends { readonly id: string }>(a: T, b: T) => compareCodeUnits(a.id, b.id)

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareCodeUnits)
}

function withMetadata<T extends object>(target: T, metadata: Metadata | undefined): T {
  return metadata === undefined ? target : { ...target, metadata: cloneJson(metadata) }
}

export function canonicalNetwork(network: Network): Network {
  const segments = [...network.segments].sort(byId).map(
    (segment): Segment => withMetadata({ id: segment.id, label: segment.label }, segment.metadata),
  )
  const assets = [...network.assets].sort(byId).map(canonicalAsset)
  const links = [...network.links].sort(byId).map(
    (link): Link =>
      withMetadata(
        {
          id: link.id,
          source_id: link.source_id,
          target_id: link.target_id,
          service_id: link.service_id,
          access: link.access,
        },
        link.metadata,
      ),
  )
  const credentials = [...network.credentials].sort(byId).map(
    (credential): Credential =>
      withMetadata(
        {
          id: credential.id,
          label: credential.label,
          grants: [...credential.grants]
            .sort(
              (a, b) =>
                compareCodeUnits(a.target_id, b.target_id) ||
                compareCodeUnits(a.service_id, b.service_id),
            )
            .map((grant) => ({
              target_id: grant.target_id,
              service_id: grant.service_id,
              privilege: grant.privilege,
              status: grant.status,
            })),
        },
        credential.metadata,
      ),
  )
  return withMetadata({ segments, assets, links, credentials }, network.metadata)
}

export function canonicalAsset(asset: Asset): Asset {
  return withMetadata(
    {
      id: asset.id,
      label: asset.label,
      kind: asset.kind,
      platform: asset.platform,
      segment_id: asset.segment_id,
      critical: asset.critical,
      isolated: asset.isolated,
      services: [...asset.services].sort(byId).map((service) => ({
        id: service.id,
        transport: service.transport,
        port: service.port,
        status: service.status,
      })),
      vulnerabilities: [...asset.vulnerabilities]
        .sort(byId)
        .map((fact) => ({ id: fact.id, status: fact.status })),
      credential_ids: sortedStrings(asset.credential_ids),
    },
    asset.metadata,
  )
}

export function canonicalProfile(profile: MalwareProfile): MalwareProfile {
  const sources = [...profile.sources].sort(byId).map((source): SourceRecord => {
    const copy: Record<string, unknown> = {
      id: source.id,
      kind: source.kind,
      title: source.title,
    }
    for (const field of [
      'url',
      'local_reference',
      'accessed_on',
      'claim_summary',
      'external_object_id',
      'external_version',
      'publication_date',
      'locator',
      'license_note',
    ] as const) {
      if (source[field] !== undefined) copy[field] = source[field]
    }
    return withMetadata(copy as SourceRecord, source.metadata)
  })

  const capabilities = [...profile.capabilities].sort(byId).map((capability): Capability => {
    const shared = {
      id: capability.id,
      label: capability.label,
      service_id: capability.service_id,
      target_platforms: sortedStrings(capability.target_platforms) as Capability['target_platforms'],
      evidence_ids: sortedStrings(capability.evidence_ids),
      confidence: capability.confidence,
      assumptions: [...capability.assumptions],
      ...(capability.technique_refs === undefined
        ? {}
        : { technique_refs: sortedStrings(capability.technique_refs) }),
      ...(capability.behavior_refs === undefined
        ? {}
        : { behavior_refs: sortedStrings(capability.behavior_refs) }),
    }
    const specific: Capability =
      capability.mechanism === 'remote_exploit'
        ? { ...shared, mechanism: 'remote_exploit', vulnerability_id: capability.vulnerability_id }
        : { ...shared, mechanism: 'remote_execution', minimum_privilege: capability.minimum_privilege }
    return withMetadata(specific, capability.metadata)
  })

  return withMetadata(
    {
      id: profile.id,
      version: profile.version,
      name: profile.name,
      scope: profile.scope,
      ...(profile.sha256 === undefined ? {} : { sha256: profile.sha256 }),
      review_status: profile.review_status,
      sources,
      capabilities,
      limitations: [...profile.limitations],
    },
    profile.metadata,
  )
}

export function canonicalInterventions(interventions: readonly Intervention[]): Intervention[] {
  return [...interventions]
    .sort(byId)
    .map((intervention) => cloneJson(intervention as unknown as JsonObject) as unknown as Intervention)
}

/**
 * The facts that determine simulation behavior. Excludes labels, names, titles,
 * free text, navigation references, scenario identity, intervention IDs and all
 * metadata (including layout). Keeps profile revision, scope, review status,
 * capability claims and evidence identifiers.
 */
export function semanticProjection(modelVersion: ModelVersion, input: EffectiveInput): JsonValue {
  const { network, profile } = input
  return {
    model_version: modelVersion,
    initial_asset_id: input.initial_asset_id,
    network: {
      segments: network.segments.map((segment) => ({ id: segment.id })),
      assets: network.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        platform: asset.platform,
        segment_id: asset.segment_id,
        critical: asset.critical,
        isolated: asset.isolated,
        services: asset.services.map((service) => ({ ...service })),
        vulnerabilities: asset.vulnerabilities.map((fact) => ({ ...fact })),
        credential_ids: [...asset.credential_ids],
      })),
      links: network.links.map((link) => ({
        id: link.id,
        source_id: link.source_id,
        target_id: link.target_id,
        service_id: link.service_id,
        access: link.access,
      })),
      credentials: network.credentials.map((credential) => ({
        id: credential.id,
        grants: credential.grants.map((grant) => ({ ...grant })),
      })),
    },
    profile: {
      id: profile.id,
      version: profile.version,
      scope: profile.scope,
      ...(profile.sha256 === undefined ? {} : { sha256: profile.sha256 }),
      review_status: profile.review_status,
      sources: profile.sources.map((source) => ({ id: source.id, kind: source.kind })),
      capabilities: profile.capabilities.map((capability) => ({
        id: capability.id,
        mechanism: capability.mechanism,
        service_id: capability.service_id,
        target_platforms: [...capability.target_platforms],
        ...(capability.mechanism === 'remote_exploit'
          ? { vulnerability_id: capability.vulnerability_id }
          : { minimum_privilege: capability.minimum_privilege }),
        evidence_ids: [...capability.evidence_ids],
        confidence: capability.confidence,
      })),
    },
  }
}

/** The full profile, text and evidence included, with every metadata object removed. */
export function profileContentProjection(profile: MalwareProfile): JsonValue {
  const strip = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map((item) => strip(item as JsonValue))
    if (value !== null && typeof value === 'object') {
      const out: Record<string, JsonValue> = {}
      for (const [key, entry] of Object.entries(value)) {
        if (key !== 'metadata') defineEntry(out, key, strip(entry as JsonValue))
      }
      return out
    }
    return value
  }
  return strip(profile as unknown as JsonValue)
}

export function digestOf(value: JsonValue): string {
  return sha256Hex(encodeUtf8(canonicalJson(value)))
}
