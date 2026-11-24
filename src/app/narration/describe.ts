// Short display names derived from scenario facts, shared by narration and
// the walkthrough UI. Prose lives in ./templates.

import type { Capability, Check, MalwareProfile } from '../../core'
import {
  BLOCK_TAGS,
  CHECK_NAMES,
  MECHANISM_TEXT,
  PLATFORM_NAMES,
  PROFILE_TEXT,
  SERVICE_NAMES,
} from './templates'

export function serviceName(id: string): string {
  return SERVICE_NAMES[id] ?? id
}

export function platformName(id: string): string {
  return PLATFORM_NAMES[id] ?? id
}

/** "SMB exploit", "WinRM execution". */
export function capabilityChip(capability: Capability): string {
  return `${serviceName(capability.service_id)} ${MECHANISM_TEXT[capability.mechanism].chip}`
}

/** "remote exploit", "remote execution". */
export function mechanismWords(capability: Capability): string {
  return MECHANISM_TEXT[capability.mechanism].words
}

/** "Network path denied", "Weakness present", … */
export function checkName(check: Pick<Check, 'code' | 'status'>): string {
  return CHECK_NAMES[check.code][check.status]
}

/** The few words shown at a blocked route's barrier, e.g. "link denied". */
export function blockTag(check: Pick<Check, 'code'>): string {
  return BLOCK_TAGS[check.code]
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[], conjunction = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`
}

export type ProfileDescription = {
  readonly name: string
  readonly summary: string
  /** Services, platforms, then scope: ["SMB", "Windows", "Synthetic"]. */
  readonly chips: readonly string[]
}

/** A one-paragraph, plain-English summary of a malware profile: its own `summary` when it has one, else one built from its capabilities. */
export function describeProfile(profile: MalwareProfile): ProfileDescription {
  const unique = (items: string[]) => [...new Set(items)]
  const platforms = (capability: Capability) => joinList(capability.target_platforms.map(platformName), 'or')
  const clauses = profile.capabilities.map((capability) =>
    capability.mechanism === 'remote_exploit'
      ? PROFILE_TEXT.exploitClause
          .replace('{service}', serviceName(capability.service_id))
          .replace('{vulnerability}', capability.vulnerability_id)
          .replace('{platforms}', platforms(capability))
      : PROFILE_TEXT.executionClause
          .replace('{service}', serviceName(capability.service_id))
          .replace('{privilege}', capability.minimum_privilege)
          .replace('{platforms}', platforms(capability)),
  )
  const services = unique(profile.capabilities.map((capability) => serviceName(capability.service_id)))
  const summary = PROFILE_TEXT.summary
    .replace('{clauses}', joinList(unique(clauses), 'or'))
    .replace('{services}', joinList(services, 'or'))
  const platformChips = unique(profile.capabilities.flatMap((capability) => capability.target_platforms.map(platformName)))
  return {
    name: profile.name,
    summary: profile.summary ?? summary,
    chips: [...services, ...platformChips, PROFILE_TEXT.scope[profile.scope]],
  }
}
