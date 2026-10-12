// Canonical JSON serialization compatible with RFC 8785 (JCS) for the values
// the core produces: object keys sorted by UTF-16 code units, no whitespace,
// ECMAScript string escaping and number formatting, finite numbers only.
// Array order is preserved; semantic sorting happens before serialization.

import type { JsonValue } from '../domain/json'

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('Canonical JSON cannot represent non-finite numbers.')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item as JsonValue)).join(',')}]`
  }
  const object = value as { readonly [key: string]: JsonValue }
  const keys = Object.keys(object).sort(compareCodeUnits)
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`).join(',')}}`
}

/** Ordinal comparison by UTF-16 code units. Never locale-sensitive. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
