// Restricted YAML: a JSON-compatible subset of YAML 1.2 (docs/scenario-model.md).
// Accepts block/flow mappings with string keys, sequences, strings, finite
// numbers, booleans and null. Rejects duplicate keys, anchors, aliases, explicit
// tags, non-1.2 directives and multiple documents. The core schema is forced,
// so `2026-10-12` stays a string and `yes`/`no` are strings, not booleans.

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  type Node as YamlNode,
} from 'yaml'
import {
  error,
  fail,
  ok,
  type Diagnostic,
  type DiagnosticCode,
  type PathSegment,
  type Result,
  type SourceLocation,
} from '../domain/diagnostics'
import { defineEntry, hasOwn, type JsonValue } from '../domain/json'
import { ADMISSION_LIMITS } from '../domain/limits'
import { isWellFormed } from './utf8'

class YamlRejection extends Error {
  readonly diagnostic: Diagnostic

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message)
    this.diagnostic = diagnostic
  }
}

export function parseRestrictedYaml(text: string): Result<JsonValue> {
  const lineCounter = new LineCounter()
  const documents = parseAllDocuments(text, {
    version: '1.2',
    schema: 'core',
    merge: false,
    uniqueKeys: false, // Detected below so the diagnostic carries a field path.
    strict: true,
    prettyErrors: false,
    lineCounter,
  })

  const locate = (offset: number | undefined): SourceLocation | undefined => {
    if (offset === undefined) return undefined
    const position = lineCounter.linePos(offset)
    return { line: position.line, column: position.col }
  }

  const reject = (
    code: DiagnosticCode,
    path: readonly PathSegment[],
    message: string,
    offset?: number,
  ): never => {
    const location = locate(offset)
    throw new YamlRejection(
      error(code, path, message, location === undefined ? {} : { location }),
    )
  }

  try {
    if (documents.length === 0) {
      reject('YAML_EMPTY', [], 'The YAML document is empty.')
    }

    for (const document of documents) {
      const syntaxError = document.errors[0]
      if (syntaxError !== undefined) {
        reject('YAML_SYNTAX', [], syntaxError.message, syntaxError.pos[0])
      }
    }

    if (documents.length > 1) {
      reject(
        'YAML_MULTIPLE_DOCUMENTS',
        [],
        'Only one YAML document is allowed per file.',
        documents[1]!.range[0],
      )
    }

    const document = documents[0]!
    const directive = document.directives?.yaml
    if (directive?.explicit && directive.version !== '1.2') {
      reject(
        'YAML_DIRECTIVE',
        [],
        `Only YAML 1.2 is supported; found %YAML ${directive.version}.`,
        0,
      )
    }

    if (document.contents === null) {
      reject('YAML_EMPTY', [], 'The YAML document is empty.')
    }

    const convert = (
      node: YamlNode | null,
      path: PathSegment[],
      depth: number,
    ): JsonValue => {
      if (node === null) return null
      const offset = node.range?.[0]
      if (depth > ADMISSION_LIMITS.maxNestingDepth) {
        reject(
          'NESTING_TOO_DEEP',
          path,
          `Nesting exceeds ${ADMISSION_LIMITS.maxNestingDepth} levels.`,
          offset,
        )
      }
      if (isAlias(node)) {
        reject('YAML_ALIAS', path, `YAML aliases (*${node.source}) are not allowed.`, offset)
      }
      if (node.anchor) {
        reject('YAML_ANCHOR', path, `YAML anchors (&${node.anchor}) are not allowed.`, offset)
      }
      if (node.tag) {
        reject('YAML_TAG', path, `Explicit YAML tags (${node.tag}) are not allowed.`, offset)
      }

      if (isMap(node)) {
        const object: Record<string, JsonValue> = {}
        for (const pair of node.items) {
          const key = pair.key as YamlNode | null
          if (
            !isScalar(key) ||
            typeof key.value !== 'string' ||
            key.anchor ||
            key.tag
          ) {
            reject(
              'YAML_NON_STRING_KEY',
              path,
              'Mapping keys must be plain strings; quote numeric or boolean-looking keys.',
              key?.range?.[0] ?? offset,
            )
          }
          const name = (key as { value: string }).value
          path.push(name)
          if (hasOwn(object, name)) {
            reject('DUPLICATE_KEY', path, `Duplicate key "${name}".`, key!.range?.[0])
          }
          if (!isWellFormed(name)) {
            reject('INVALID_STRING', path, 'Key contains an unpaired UTF-16 surrogate.', key!.range?.[0])
          }
          defineEntry(object, name, convert(pair.value as YamlNode | null, path, depth + 1))
          path.pop()
        }
        return object
      }

      if (isSeq(node)) {
        const items: JsonValue[] = []
        node.items.forEach((item, index) => {
          path.push(index)
          items.push(convert(item as YamlNode | null, path, depth + 1))
          path.pop()
        })
        return items
      }

      if (isScalar(node)) {
        const value: unknown = node.value
        if (value === null || typeof value === 'boolean') return value
        if (typeof value === 'string') {
          if (!isWellFormed(value)) {
            reject('INVALID_STRING', path, 'String contains an unpaired UTF-16 surrogate.', offset)
          }
          return value
        }
        if (typeof value === 'number') {
          if (!Number.isFinite(value)) {
            reject('NONFINITE_NUMBER', path, 'Numbers must be finite (.inf and .nan are not allowed).', offset)
          }
          return value
        }
      }

      return reject('NOT_JSON_VALUE', path, 'Value is not JSON-compatible.', offset)
    }

    const value = convert(document.contents as YamlNode, [], 1)

    const leftover = document.warnings[0]
    if (leftover !== undefined) {
      reject('YAML_SYNTAX', [], leftover.message, leftover.pos[0])
    }

    return ok(value)
  } catch (failure) {
    if (failure instanceof YamlRejection) {
      return fail([failure.diagnostic])
    }
    throw failure
  }
}
