// JSON value model shared by the parsers, validators and compiler.
// The core only ever handles values that could round-trip through JSON.

export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonArray | JsonObject

export type JsonArray = readonly JsonValue[]

export type JsonObject = { readonly [key: string]: JsonValue }

/** Free-form, never-interpreted data. Excluded from the semantic digest. */
export type Metadata = JsonObject

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/** Assigns an own enumerable property without invoking `__proto__` setters. */
export function defineEntry(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/** Deep-copies a JSON value (used to detach snapshots from caller-owned input). */
export function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item as JsonValue)) as unknown as T
  }
  if (isJsonObject(value)) {
    const copy: Record<string, JsonValue> = {}
    for (const key of Object.keys(value)) {
      defineEntry(copy, key, cloneJson(value[key] as JsonValue))
    }
    return copy as T
  }
  return value
}
