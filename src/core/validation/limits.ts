// Admission limits are checked before schema and semantic work so oversize
// input is rejected cheaply and explicitly.

import { error, type Diagnostic, type Path } from '../domain/diagnostics'
import { isJsonObject, type JsonValue } from '../domain/json'
import { ADMISSION_LIMITS } from '../domain/limits'

function checkArray(
  value: JsonValue | undefined,
  limit: number,
  noun: string,
  path: Path,
  out: Diagnostic[],
) {
  if (Array.isArray(value) && value.length > limit) {
    out.push(
      error('LIMIT_EXCEEDED', path, `${value.length} ${noun} exceed the V1 admission limit of ${limit}.`),
    )
  }
}

export function checkNetworkLimits(network: JsonValue | undefined, base: Path): Diagnostic[] {
  const out: Diagnostic[] = []
  if (!isJsonObject(network)) return out
  checkArray(network.assets, ADMISSION_LIMITS.maxAssets, 'assets', [...base, 'assets'], out)
  checkArray(network.links, ADMISSION_LIMITS.maxLinks, 'links', [...base, 'links'], out)
  return out
}

export function checkProfileLimits(profile: JsonValue | undefined, base: Path): Diagnostic[] {
  const out: Diagnostic[] = []
  if (!isJsonObject(profile)) return out
  checkArray(
    profile.capabilities,
    ADMISSION_LIMITS.maxCapabilitiesPerProfile,
    'capabilities',
    [...base, 'capabilities'],
    out,
  )
  return out
}
