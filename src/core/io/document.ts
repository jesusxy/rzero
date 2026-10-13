// Document intake: size check, UTF-8 decoding, format selection and parsing.
// Also guards in-memory values supplied by the UI or tests.

import {
  error,
  fail,
  ok,
  type Diagnostic,
  type PathSegment,
  type Result,
} from '../domain/diagnostics'
import { defineEntry, isJsonObject, type JsonValue } from '../domain/json'
import { ADMISSION_LIMITS } from '../domain/limits'
import { parseJson } from './json'
import { decodeUtf8, isWellFormed, utf8ByteLength } from './utf8'
import { parseRestrictedYaml } from './yaml'

export type DocumentFormat = 'json' | 'yaml'

export type ParseOptions = {
  /** Explicit format. Otherwise inferred from `fileName`, then from content. */
  readonly format?: DocumentFormat
  readonly fileName?: string
}

export function detectFormat(text: string, fileName?: string): DocumentFormat {
  const lower = fileName?.toLowerCase()
  if (lower?.endsWith('.json')) return 'json'
  if (lower?.endsWith('.yaml') || lower?.endsWith('.yml')) return 'yaml'
  const first = text.replace(/^﻿/, '').trimStart()[0]
  return first === '{' || first === '[' ? 'json' : 'yaml'
}

/** Parses one native document into a JSON value. Never interprets it. */
export function parseDocument(
  input: string | Uint8Array,
  options: ParseOptions = {},
): Result<JsonValue> {
  const limit = ADMISSION_LIMITS.maxDocumentBytes
  const byteLength = typeof input === 'string' ? utf8ByteLength(input) : input.length
  if (byteLength > limit) {
    return fail([
      error(
        'DOCUMENT_TOO_LARGE',
        [],
        `Document is ${byteLength} bytes; the limit is ${limit} bytes (5 MiB).`,
      ),
    ])
  }

  let text: string
  if (typeof input === 'string') {
    if (!isWellFormed(input)) {
      return fail([error('INVALID_STRING', [], 'Document text contains unpaired UTF-16 surrogates.')])
    }
    text = input.replace(/^﻿/, '')
  } else {
    const decoded = decodeUtf8(input)
    if (!decoded.ok) {
      return fail([error('INVALID_UTF8', [], 'Document is not valid UTF-8.')])
    }
    text = decoded.text
  }

  const format = options.format ?? detectFormat(text, options.fileName)
  return format === 'json' ? parseJson(text) : parseRestrictedYaml(text)
}

/**
 * Copies an in-memory value into a plain JSON value, rejecting anything JSON
 * cannot represent: undefined, functions, symbols, bigints, non-finite numbers,
 * class instances (Date, Map, ...), unpaired surrogates and cycles (via the
 * nesting bound).
 */
export function toJsonValue(value: unknown): Result<JsonValue> {
  const problems: Diagnostic[] = []
  const path: PathSegment[] = []

  const visit = (current: unknown, depth: number): JsonValue => {
    if (depth > ADMISSION_LIMITS.maxNestingDepth) {
      problems.push(
        error('NESTING_TOO_DEEP', path, `Nesting exceeds ${ADMISSION_LIMITS.maxNestingDepth} levels (or the value is cyclic).`),
      )
      return null
    }
    if (current === null || typeof current === 'boolean') return current
    if (typeof current === 'string') {
      if (!isWellFormed(current)) {
        problems.push(error('INVALID_STRING', path, 'String contains an unpaired UTF-16 surrogate.'))
      }
      return current
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        problems.push(error('NONFINITE_NUMBER', path, 'Numbers must be finite.'))
      }
      return current
    }
    if (Array.isArray(current)) {
      return current.map((item, index) => {
        path.push(index)
        const copy = visit(item, depth + 1)
        path.pop()
        return copy
      })
    }
    if (typeof current === 'object') {
      const prototype = Object.getPrototypeOf(current)
      if (prototype === Object.prototype || prototype === null) {
        const copy: Record<string, JsonValue> = {}
        for (const key of Object.keys(current)) {
          path.push(key)
          const entry = (current as Record<string, unknown>)[key]
          if (entry !== undefined) {
            defineEntry(copy, key, visit(entry, depth + 1))
          } else {
            problems.push(error('NOT_JSON_VALUE', path, 'Value is undefined; omit the field instead.'))
          }
          path.pop()
        }
        return copy
      }
    }
    problems.push(error('NOT_JSON_VALUE', path, `Value of type ${describeType(current)} is not JSON-compatible.`))
    return null
  }

  const copy = visit(value, 1)
  return problems.length > 0 ? fail(problems) : ok(copy)
}

function describeType(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return value.constructor?.name ?? 'object'
  }
  return typeof value
}

const stixIdentifier = /^[a-z][a-z0-9-]*--[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Detects STIX 2.x content (a bundle or a single STIX object). STIX is threat
 * intelligence, not a Rzero profile; it must be curated into a reviewed native
 * profile before it can execute.
 */
export function looksLikeStix(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false
  const { type, id } = value
  if (typeof type !== 'string' || typeof id !== 'string') return false
  if (!stixIdentifier.test(id) || !id.startsWith(`${type}--`)) return false
  return type === 'bundle' || typeof value.spec_version === 'string'
}

export const STIX_MESSAGE =
  'This is STIX intelligence, not a native Rzero document. STIX objects inform ' +
  'profile authoring but never execute directly: curate the documented ' +
  'capabilities into a reviewed native profile (docs/malware-profile.md) and ' +
  'embed it in a scenario.'
