import type { Diagnostic, Path } from '../domain/diagnostics'
import type { JsonValue } from '../domain/json'
import commonSchema from './common.schema.json'
import networkSchema from './network.schema.json'
import profileSchema from './profile.schema.json'
import scenarioSchema from './scenario.schema.json'
import { SchemaSet, type SchemaObject } from './validator'

/** The published rzero/1 JSON Schemas, keyed by file name. */
export const NATIVE_SCHEMAS: Readonly<Record<string, SchemaObject>> = Object.freeze({
  'common.schema.json': commonSchema as SchemaObject,
  'network.schema.json': networkSchema as SchemaObject,
  'profile.schema.json': profileSchema as SchemaObject,
  'scenario.schema.json': scenarioSchema as SchemaObject,
})

export type SchemaName = 'network' | 'profile' | 'scenario'

let schemaSet: SchemaSet | undefined

/** Shape validation only. Returns diagnostics in document order. */
export function validateShape(value: JsonValue, schema: SchemaName, basePath: Path = []): Diagnostic[] {
  schemaSet ??= new SchemaSet(Object.values(NATIVE_SCHEMAS))
  return schemaSet.validate(value, `${schema}.schema.json`, basePath)
}
