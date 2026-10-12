// Interpreter for the JSON Schema 2020-12 subset used by the native schemas.
// The .schema.json files are the single source of truth for shape: this module
// executes them directly and maps each failing keyword to a stable diagnostic
// code with a precise field path. Unsupported keywords fail loudly at startup
// instead of being silently ignored.

import {
  error,
  type Diagnostic,
  type Path,
  type PathSegment,
} from '../domain/diagnostics'
import { hasOwn, isJsonObject, type JsonValue } from '../domain/json'
import { canonicalJson } from '../io/canonical-json'

export type SchemaObject = { readonly [keyword: string]: unknown }

type SchemaNode = boolean | SchemaObject

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description',
  'type', 'const', 'enum',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'properties', 'required', 'additionalProperties',
  'allOf', 'anyOf', 'if', 'then', 'else',
])

type Cursor = { readonly document: string; readonly node: SchemaNode }

export class SchemaSet {
  private readonly documents = new Map<string, SchemaObject>()
  private readonly patterns = new Map<string, RegExp>()

  constructor(schemas: readonly SchemaObject[]) {
    for (const schema of schemas) {
      const id = schema.$id
      if (typeof id !== 'string') throw new Error('Every schema needs an $id.')
      const name = fileName(id)
      this.documents.set(name, schema)
      this.checkKeywords(schema, `${name}#`)
    }
  }

  /** Validates `value` against a whole schema document, e.g. `scenario.schema.json`. */
  validate(value: JsonValue, document: string, basePath: Path = []): Diagnostic[] {
    const out: Diagnostic[] = []
    this.visit(value, this.resolve(document, document), [...basePath], out, '')
    return out
  }

  private checkKeywords(node: unknown, where: string) {
    if (typeof node === 'boolean') return
    if (!isJsonObject(node as JsonValue)) {
      throw new Error(`Schema node at ${where} must be an object or boolean.`)
    }
    const schema = node as SchemaObject
    for (const keyword of Object.keys(schema)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) {
        throw new Error(`Unsupported schema keyword "${keyword}" at ${where}.`)
      }
    }
    for (const container of ['$defs', 'properties'] as const) {
      const children = schema[container] as Record<string, unknown> | undefined
      for (const [key, child] of Object.entries(children ?? {})) {
        this.checkKeywords(child, `${where}/${container}/${key}`)
      }
    }
    for (const single of ['items', 'additionalProperties', 'if', 'then', 'else'] as const) {
      if (schema[single] !== undefined) this.checkKeywords(schema[single], `${where}/${single}`)
    }
    for (const list of ['allOf', 'anyOf'] as const) {
      ;(schema[list] as unknown[] | undefined)?.forEach((child, index) =>
        this.checkKeywords(child, `${where}/${list}/${index}`),
      )
    }
    if (typeof schema.pattern === 'string') this.regex(schema.pattern)
  }

  private resolve(reference: string, currentDocument: string): Cursor {
    const hash = reference.indexOf('#')
    const file = hash === -1 ? reference : reference.slice(0, hash)
    const fragment = hash === -1 ? '' : reference.slice(hash + 1)
    const document = file === '' ? currentDocument : fileName(file)
    const root = this.documents.get(document)
    if (root === undefined) throw new Error(`Unknown schema document "${document}".`)

    let node: unknown = root
    for (const token of fragment.split('/').slice(1)) {
      const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
      node = (node as Record<string, unknown> | undefined)?.[key]
    }
    if (node === undefined) throw new Error(`Unresolvable schema reference "${reference}".`)
    return { document, node: node as SchemaNode }
  }

  private regex(pattern: string): RegExp {
    let compiled = this.patterns.get(pattern)
    if (compiled === undefined) {
      compiled = new RegExp(pattern, 'u')
      this.patterns.set(pattern, compiled)
    }
    return compiled
  }

  private visit(
    value: JsonValue,
    cursor: Cursor,
    path: PathSegment[],
    out: Diagnostic[],
    context: string,
  ): void {
    const { node, document } = cursor
    if (node === true) return
    if (node === false) {
      const field = path[path.length - 1]
      out.push(error('FIELD_NOT_ALLOWED', path, `Field "${String(field)}" is not allowed${context}.`))
      return
    }

    if (typeof node.$ref === 'string') {
      this.visit(value, this.resolve(node.$ref, document), path, out, context)
    }

    const at = (child: SchemaNode): Cursor => ({ document, node: child })

    if (node.type !== undefined && !matchesType(value, node.type as string)) {
      out.push(error('INVALID_TYPE', path, `Expected ${String(node.type)} but found ${jsonType(value)}.`))
      return
    }

    if (hasOwn(node, 'const') && canonicalJson(value) !== canonicalJson(node.const as JsonValue)) {
      out.push(error('INVALID_VALUE', path, `Must be ${JSON.stringify(node.const)}.`))
    }

    if (Array.isArray(node.enum) && !node.enum.some((option) => canonicalJson(option) === canonicalJson(value))) {
      const options = node.enum.map((option) => JSON.stringify(option)).join(', ')
      out.push(error('INVALID_ENUM', path, `Must be one of ${options}; found ${JSON.stringify(value)}.`))
    }

    if (typeof value === 'string') {
      const length = [...value].length
      if (typeof node.minLength === 'number' && length < node.minLength) {
        out.push(error('INVALID_VALUE', path, node.minLength === 1 ? 'Must not be empty.' : `Must be at least ${node.minLength} characters.`))
      }
      if (typeof node.maxLength === 'number' && length > node.maxLength) {
        out.push(error('INVALID_VALUE', path, `Must be at most ${node.maxLength} characters.`))
      }
      if (typeof node.pattern === 'string' && !this.regex(node.pattern).test(value)) {
        const what = typeof node.description === 'string' ? `${node.description} ` : 'a value '
        out.push(error('INVALID_FORMAT', path, `Must be ${what}matching ${node.pattern}; found ${JSON.stringify(value)}.`))
      }
    }

    if (typeof value === 'number') {
      if (typeof node.minimum === 'number' && value < node.minimum) {
        out.push(error('INVALID_VALUE', path, `Must be at least ${node.minimum}.`))
      }
      if (typeof node.maximum === 'number' && value > node.maximum) {
        out.push(error('INVALID_VALUE', path, `Must be at most ${node.maximum}.`))
      }
    }

    if (Array.isArray(value)) {
      if (typeof node.minItems === 'number' && value.length < node.minItems) {
        out.push(error('TOO_FEW_ITEMS', path, `Must contain at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}.`))
      }
      if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
        out.push(error('TOO_MANY_ITEMS', path, `Must contain at most ${node.maxItems} items.`))
      }
      if (node.items !== undefined) {
        value.forEach((item, index) => {
          path.push(index)
          this.visit(item as JsonValue, at(node.items as SchemaNode), path, out, '')
          path.pop()
        })
      }
      if (node.uniqueItems === true) {
        const seen = new Set<string>()
        value.forEach((item, index) => {
          const key = canonicalJson(item as JsonValue)
          if (seen.has(key)) {
            path.push(index)
            out.push(error('DUPLICATE_ITEM', path, `Duplicate entry ${JSON.stringify(item)}.`))
            path.pop()
          }
          seen.add(key)
        })
      }
    }

    if (isJsonObject(value)) {
      const properties = (node.properties ?? {}) as Record<string, SchemaNode>
      for (const field of (node.required ?? []) as string[]) {
        if (!hasOwn(value, field)) {
          path.push(field)
          out.push(error('MISSING_FIELD', path, `Required field "${field}" is missing${context}.`))
          path.pop()
        }
      }
      for (const field of Object.keys(value)) {
        path.push(field)
        if (hasOwn(properties, field)) {
          this.visit(value[field]!, at(properties[field]!), path, out, context)
        } else if (node.additionalProperties === false) {
          out.push(
            error(
              'UNKNOWN_FIELD',
              path,
              `Unknown field "${field}"${context}. Executable fields are closed; put free-form data in "metadata".`,
            ),
          )
        } else if (node.additionalProperties !== undefined) {
          this.visit(value[field]!, at(node.additionalProperties as SchemaNode), path, out, context)
        }
        path.pop()
      }
    }

    for (const child of (node.allOf ?? []) as SchemaNode[]) {
      this.visit(value, at(child), path, out, context)
    }

    if (Array.isArray(node.anyOf)) {
      const branches = node.anyOf as SchemaNode[]
      const matches = branches.some((branch) => {
        const probe: Diagnostic[] = []
        this.visit(value, at(branch), [...path], probe, '')
        return probe.length === 0
      })
      if (!matches) {
        const requiredOnly = branches.every(
          (branch) => typeof branch === 'object' && Object.keys(branch).join() === 'required',
        )
        if (requiredOnly) {
          const fields = branches.flatMap((branch) => (branch as SchemaObject).required as string[])
          out.push(error('MISSING_FIELD', path, `At least one of ${fields.map((f) => `"${f}"`).join(', ')} is required.`))
        } else {
          out.push(error('INVALID_VALUE', path, 'Does not match any allowed alternative.'))
        }
      }
    }

    if (node.if !== undefined) {
      const probe: Diagnostic[] = []
      this.visit(value, at(node.if as SchemaNode), [...path], probe, '')
      const condition = describeCondition(node.if as SchemaNode)
      if (probe.length === 0) {
        if (node.then !== undefined) {
          this.visit(value, at(node.then as SchemaNode), path, out, condition ? ` when ${condition}` : context)
        }
      } else if (node.else !== undefined) {
        this.visit(value, at(node.else as SchemaNode), path, out, condition ? ` unless ${condition}` : context)
      }
    }
  }
}

function fileName(reference: string): string {
  const slash = reference.lastIndexOf('/')
  return slash === -1 ? reference : reference.slice(slash + 1)
}

function matchesType(value: JsonValue, type: string): boolean {
  switch (type) {
    case 'object': return isJsonObject(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    default: throw new Error(`Unsupported schema type "${type}".`)
  }
}

function jsonType(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Renders `{properties: {scope: {const: "sample"}}}` as `scope is "sample"` for messages. */
function describeCondition(condition: SchemaNode): string {
  if (typeof condition !== 'object') return ''
  const properties = condition.properties as Record<string, SchemaObject> | undefined
  const parts = Object.entries(properties ?? {})
    .filter(([, rule]) => hasOwn(rule, 'const'))
    .map(([field, rule]) => `${field} is ${JSON.stringify(rule.const)}`)
  return parts.join(' and ')
}
