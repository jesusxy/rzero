// Scenario envelope, interventions and the compiled (effective) snapshot
// (docs/scenario-model.md).

import type { Metadata } from './json'
import type {
  GrantStatus,
  LinkAccess,
  Network,
  ServiceStatus,
  VulnerabilityStatus,
} from './network'
import type { MalwareProfile } from './profile'

export const MODEL_VERSION = 'rzero/1'

export type ModelVersion = typeof MODEL_VERSION

export type SetBoundaryAccess = {
  readonly type: 'set_boundary_access'
  readonly id: string
  readonly from_segment_id: string
  readonly to_segment_id: string
  readonly service_id: string
  readonly access: LinkAccess
  readonly metadata?: Metadata
}

export type SetVulnerabilityStatus = {
  readonly type: 'set_vulnerability_status'
  readonly id: string
  readonly asset_id: string
  readonly vulnerability_id: string
  readonly status: VulnerabilityStatus
  readonly metadata?: Metadata
}

export type SetServiceStatus = {
  readonly type: 'set_service_status'
  readonly id: string
  readonly asset_id: string
  readonly service_id: string
  readonly status: ServiceStatus
  readonly metadata?: Metadata
}

export type SetAssetIsolation = {
  readonly type: 'set_asset_isolation'
  readonly id: string
  readonly asset_id: string
  readonly isolated: boolean
  readonly metadata?: Metadata
}

export type SetGrantStatus = {
  readonly type: 'set_grant_status'
  readonly id: string
  readonly credential_id: string
  readonly target_id: string
  readonly service_id: string
  readonly status: GrantStatus
  readonly metadata?: Metadata
}

export type Intervention =
  | SetBoundaryAccess
  | SetVulnerabilityStatus
  | SetServiceStatus
  | SetAssetIsolation
  | SetGrantStatus

export type InterventionType = Intervention['type']

/** The authored, importable scenario document. */
export type ScenarioDocument = {
  readonly model_version: ModelVersion
  readonly id: string
  readonly name: string
  readonly network: Network
  readonly profile: MalwareProfile
  readonly initial_asset_id: string
  readonly interventions: readonly Intervention[]
  readonly metadata?: Metadata
}

export type ManifestEntityKind = 'link' | 'asset' | 'service' | 'vulnerability' | 'grant'

/** A single effective field written by an intervention. */
export type FieldChange = {
  /**
   * Stable reference to the written field, for example `link:bd/access`,
   * `asset:D/vulnerability:LAB-SMB-1/status`, `asset:D/service:smb/status`,
   * `asset:D/isolated` or `credential:cred-a/grant:B:winrm/status`.
   * IDs cannot contain `:` or `/`, so references are unambiguous.
   */
  readonly field_ref: string
  readonly entity_kind: ManifestEntityKind
  /** Link, asset or credential ID that owns the field. */
  readonly entity_id: string
  /** `null` when the fact did not exist before (vulnerability upsert). */
  readonly original: string | boolean | null
  readonly effective: string | boolean
  readonly noop: boolean
}

export type InterventionRecord = {
  readonly intervention_id: string
  readonly type: InterventionType
  /** The selector exactly as authored (all fields other than `type`, `id`, the value and metadata). */
  readonly selector: Readonly<Record<string, string>>
  /** The value written, as authored. */
  readonly value: Readonly<Record<string, string | boolean>>
  readonly affected_entity_ids: readonly string[]
  /** Sorted by `field_ref`. */
  readonly changes: readonly FieldChange[]
  /** True when every change is a no-op. */
  readonly noop: boolean
}

/** Sorted by `intervention_id`. */
export type InterventionManifest = readonly InterventionRecord[]

/** What the engine evaluates. Interventions are already applied. */
export type EffectiveInput = {
  readonly network: Network
  readonly profile: MalwareProfile
  readonly initial_asset_id: string
}

/**
 * Immutable, self-contained compilation result. Deep-frozen at runtime.
 * All entity arrays use canonical ordering (see docs/scenario-model.md).
 */
export type CompiledScenario = {
  readonly model_version: ModelVersion
  readonly id: string
  readonly name: string
  readonly metadata?: Metadata
  /** The authored document in canonical order, before interventions. Re-importable. */
  readonly source: ScenarioDocument
  /** Network after interventions, profile and seed. */
  readonly effective: EffectiveInput
  readonly manifest: InterventionManifest
  /** Lowercase hex SHA-256 of the canonical semantic projection of `effective`. */
  readonly input_digest: string
  /**
   * Lowercase hex SHA-256 of the canonical profile including its text and
   * evidence records (metadata excluded). Lets a profile library detect a
   * changed profile that kept the same `id` and `version`.
   */
  readonly profile_content_digest: string
}
