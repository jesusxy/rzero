// Native malware profile contract (docs/malware-profile.md).
// Profiles are reviewed, bounded capability records. They are not STIX objects:
// STIX/ATT&CK/MBC identifiers appear only as provenance on source records and
// as navigation references on capabilities, and never drive evaluation.

import type { Metadata } from './json'
import type { ExecutableServiceId, Privilege, TargetPlatform } from './network'

export type ProfileScope = 'synthetic' | 'family' | 'sample'

export type ReviewStatus = 'draft' | 'reviewed'

export type SourceKind = 'research' | 'attack' | 'mbc' | 'sandbox' | 'synthetic'

export type Mechanism = 'remote_exploit' | 'remote_execution'

/** Claim confidence only. Never a success probability. */
export type Confidence = 'low' | 'medium' | 'high'

export type SourceRecord = {
  readonly id: string
  readonly kind: SourceKind
  readonly title: string
  /** At least one of `url` or `local_reference` is present. */
  readonly url?: string
  readonly local_reference?: string
  /** Calendar date, YYYY-MM-DD. */
  readonly accessed_on: string
  readonly claim_summary: string
  /** Provenance only, for example a STIX object ID. Never resolved remotely. */
  readonly external_object_id?: string
  readonly external_version?: string
  readonly publication_date?: string
  readonly locator?: string
  readonly license_note?: string
  readonly metadata?: Metadata
}

type CapabilityBase = {
  readonly id: string
  readonly label: string
  readonly service_id: ExecutableServiceId
  readonly target_platforms: readonly TargetPlatform[]
  readonly evidence_ids: readonly string[]
  readonly confidence: Confidence
  readonly assumptions: readonly string[]
  /** ATT&CK technique IDs, for navigation only. */
  readonly technique_refs?: readonly string[]
  /** MBC behavior IDs, for navigation only. */
  readonly behavior_refs?: readonly string[]
  readonly metadata?: Metadata
}

export type RemoteExploitCapability = CapabilityBase & {
  readonly mechanism: 'remote_exploit'
  readonly vulnerability_id: string
}

export type RemoteExecutionCapability = CapabilityBase & {
  readonly mechanism: 'remote_execution'
  readonly minimum_privilege: Privilege
}

export type Capability = RemoteExploitCapability | RemoteExecutionCapability

export type MalwareProfile = {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly scope: ProfileScope
  /** Lowercase SHA-256 of the sample. Required for, and only allowed on, `sample` scope. */
  readonly sha256?: string
  readonly review_status: ReviewStatus
  readonly sources: readonly SourceRecord[]
  /** Alternatives. All requirements within one capability must pass. */
  readonly capabilities: readonly Capability[]
  readonly limitations: readonly string[]
  readonly metadata?: Metadata
}
