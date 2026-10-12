// Native network contract (docs/network-model.md). Static facts only:
// no compromise state, discovery state, layout or animation.

import type { Metadata } from './json'

export type AssetKind = 'workstation' | 'server' | 'controller' | 'appliance' | 'other'

export type Platform = 'windows' | 'linux' | 'macos' | 'unknown'

/** Platforms a capability may target. `unknown` is a fact value, never a requirement. */
export type TargetPlatform = Exclude<Platform, 'unknown'>

export type Transport = 'tcp' | 'udp'

export type ServiceStatus = 'enabled' | 'disabled' | 'unknown'

/** `absent` includes explicitly patched. A missing entry means unknown. */
export type VulnerabilityStatus = 'present' | 'absent' | 'unknown'

export type LinkAccess = 'allow' | 'deny' | 'unknown'

export type Privilege = 'user' | 'admin'

export type GrantStatus = 'valid' | 'invalid' | 'unknown'

/** Services with a V1 evaluator. Other service IDs may be inventoried but never execute. */
export type ExecutableServiceId = 'smb' | 'winrm'

export const EXECUTABLE_SERVICE_IDS: readonly ExecutableServiceId[] = ['smb', 'winrm']

export type Segment = {
  readonly id: string
  readonly label: string
  readonly metadata?: Metadata
}

export type Service = {
  readonly id: string
  readonly transport: Transport
  readonly port: number
  readonly status: ServiceStatus
}

export type VulnerabilityFact = {
  readonly id: string
  readonly status: VulnerabilityStatus
}

export type Asset = {
  readonly id: string
  readonly label: string
  readonly kind: AssetKind
  readonly platform: Platform
  readonly segment_id: string
  readonly critical: boolean
  readonly isolated: boolean
  /** Declared complete for the scenario: a missing service is not exposed. */
  readonly services: readonly Service[]
  /** Not complete: a missing vulnerability entry is unknown, not absent. */
  readonly vulnerabilities: readonly VulnerabilityFact[]
  /** Credentials the modeled threat can use once this asset is compromised. */
  readonly credential_ids: readonly string[]
  readonly metadata?: Metadata
}

/** Directed, service-specific candidate movement. A missing link means no attempt. */
export type Link = {
  readonly id: string
  readonly source_id: string
  readonly target_id: string
  readonly service_id: string
  readonly access: LinkAccess
  readonly metadata?: Metadata
}

export type Grant = {
  readonly target_id: string
  readonly service_id: ExecutableServiceId
  readonly privilege: Privilege
  readonly status: GrantStatus
}

/** Symbolic access only; never a password, hash or token. */
export type Credential = {
  readonly id: string
  readonly label: string
  readonly grants: readonly Grant[]
  readonly metadata?: Metadata
}

export type Network = {
  readonly segments: readonly Segment[]
  readonly assets: readonly Asset[]
  readonly links: readonly Link[]
  readonly credentials: readonly Credential[]
  readonly metadata?: Metadata
}
