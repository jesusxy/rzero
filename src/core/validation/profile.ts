// Semantic profile rules (docs/malware-profile.md#evidence-and-approval).

import { error, type Diagnostic, type Path } from '../domain/diagnostics'
import type { MalwareProfile, SourceKind } from '../domain/profile'
import { collectIds } from './ids'

export type ProfileCheckOptions = {
  /** Scenarios require `review_status: reviewed`; a standalone draft may be validated. */
  readonly requireReviewed: boolean
}

export function checkProfileSemantics(
  profile: MalwareProfile,
  base: Path,
  options: ProfileCheckOptions,
): Diagnostic[] {
  const out: Diagnostic[] = []

  if (options.requireReviewed && profile.review_status !== 'reviewed') {
    out.push(
      error(
        'PROFILE_NOT_REVIEWED',
        [...base, 'review_status'],
        `Profile "${profile.id}" version "${profile.version}" is a draft. Only reviewed profiles execute.`,
        { entityId: profile.id },
      ),
    )
  }

  collectIds(profile.sources, [...base, 'sources'], 'source', out)
  const kinds = new Map<string, SourceKind>()
  profile.sources.forEach((source, index) => {
    if (!kinds.has(source.id)) kinds.set(source.id, source.kind)
    for (const field of ['accessed_on', 'publication_date'] as const) {
      const value = source[field]
      if (value !== undefined && !isCalendarDate(value)) {
        out.push(
          error('INVALID_DATE', [...base, 'sources', index, field], `"${value}" is not a real calendar date.`, {
            entityId: source.id,
          }),
        )
      }
    }
  })

  collectIds(profile.capabilities, [...base, 'capabilities'], 'capability', out)
  const isRealProfile = profile.scope !== 'synthetic'

  profile.capabilities.forEach((capability, capabilityIndex) => {
    const capabilityPath = [...base, 'capabilities', capabilityIndex]
    let resolvedNonSynthetic = false
    capability.evidence_ids.forEach((evidenceId, index) => {
      const kind = kinds.get(evidenceId)
      if (kind === undefined) {
        out.push(
          error(
            'UNKNOWN_EVIDENCE',
            [...capabilityPath, 'evidence_ids', index],
            `Evidence "${evidenceId}" does not match a source record in this profile.`,
            { entityId: capability.id },
          ),
        )
      } else if (kind !== 'synthetic') {
        resolvedNonSynthetic = true
      }
    })

    if (isRealProfile && !resolvedNonSynthetic) {
      out.push(
        error(
          'MISSING_NONSYNTHETIC_EVIDENCE',
          [...capabilityPath, 'evidence_ids'],
          `Capability "${capability.id}" in a ${profile.scope} profile needs at least one non-synthetic source; ` +
            'a family name or synthetic rule alone cannot support a real capability.',
          { entityId: capability.id },
        ),
      )
    }
  })

  return out
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  return day <= days
}
