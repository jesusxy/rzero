// Strict RFC 8259 JSON parser. Unlike JSON.parse it rejects duplicate keys,
// non-finite numbers and unpaired surrogates, bounds nesting depth and reports
// the field path and source position of the first problem.

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

class JsonParseFailure extends Error {
  readonly diagnostic: Diagnostic

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message)
    this.diagnostic = diagnostic
  }
}

export function locate(text: string, offset: number): SourceLocation {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y

export function parseJson(text: string): Result<JsonValue> {
  let position = 0
  const path: PathSegment[] = []

  const raise = (code: DiagnosticCode, message: string, at = position): never => {
    throw new JsonParseFailure(
      error(code, path, message, { location: locate(text, at) }),
    )
  }

  const skipWhitespace = () => {
    while (position < text.length) {
      const unit = text.charCodeAt(position)
      if (unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d) {
        position += 1
      } else {
        break
      }
    }
  }

  const describe = (at: number) =>
    at >= text.length ? 'end of input' : `'${text[at]}'`

  const expect = (char: string) => {
    if (text[position] !== char) {
      raise('JSON_SYNTAX', `Expected '${char}' but found ${describe(position)}.`)
    }
    position += 1
  }

  const parseString = (): string => {
    const start = position
    expect('"')
    let out = ''
    let runStart = position
    for (;;) {
      if (position >= text.length) {
        raise('JSON_SYNTAX', 'Unterminated string.', start)
      }
      const unit = text.charCodeAt(position)
      if (unit === 0x22) {
        out += text.slice(runStart, position)
        position += 1
        break
      }
      if (unit < 0x20) {
        raise('JSON_SYNTAX', 'Unescaped control character in string.')
      }
      if (unit === 0x5c) {
        out += text.slice(runStart, position)
        const escape = text[position + 1]
        switch (escape) {
          case '"': out += '"'; break
          case '\\': out += '\\'; break
          case '/': out += '/'; break
          case 'b': out += '\b'; break
          case 'f': out += '\f'; break
          case 'n': out += '\n'; break
          case 'r': out += '\r'; break
          case 't': out += '\t'; break
          case 'u': {
            const hex = text.slice(position + 2, position + 6)
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              raise('JSON_SYNTAX', 'Invalid \\u escape in string.')
            }
            out += String.fromCharCode(parseInt(hex, 16))
            position += 4
            break
          }
          default:
            raise('JSON_SYNTAX', 'Invalid escape sequence in string.')
        }
        position += 2
        runStart = position
        continue
      }
      position += 1
    }
    if (!isWellFormed(out)) {
      raise('INVALID_STRING', 'String contains an unpaired UTF-16 surrogate.', start)
    }
    return out
  }

  const parseValue = (depth: number): JsonValue => {
    if (depth > ADMISSION_LIMITS.maxNestingDepth) {
      raise(
        'NESTING_TOO_DEEP',
        `Nesting exceeds ${ADMISSION_LIMITS.maxNestingDepth} levels.`,
      )
    }
    skipWhitespace()
    const char = text[position]
    switch (char) {
      case '{':
        return parseObject(depth)
      case '[':
        return parseArray(depth)
      case '"':
        return parseString()
      case 't':
        return parseLiteral('true', true)
      case 'f':
        return parseLiteral('false', false)
      case 'n':
        return parseLiteral('null', null)
      default:
        if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
          return parseNumber()
        }
        return raise('JSON_SYNTAX', `Unexpected ${describe(position)}.`)
    }
  }

  const parseLiteral = <T extends JsonValue>(word: string, value: T): T => {
    if (text.startsWith(word, position)) {
      position += word.length
      return value
    }
    return raise('JSON_SYNTAX', `Unexpected ${describe(position)}.`)
  }

  const parseNumber = (): number => {
    numberPattern.lastIndex = position
    const match = numberPattern.exec(text)
    if (match === null) {
      return raise('JSON_SYNTAX', 'Invalid number.')
    }
    const start = position
    position += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) {
      raise('NONFINITE_NUMBER', `Number ${match[0]} is not finite.`, start)
    }
    return value
  }

  const parseArray = (depth: number): JsonValue[] => {
    expect('[')
    const items: JsonValue[] = []
    skipWhitespace()
    if (text[position] === ']') {
      position += 1
      return items
    }
    for (;;) {
      path.push(items.length)
      items.push(parseValue(depth + 1))
      path.pop()
      skipWhitespace()
      if (text[position] === ',') {
        position += 1
        continue
      }
      expect(']')
      return items
    }
  }

  const parseObject = (depth: number): Record<string, JsonValue> => {
    expect('{')
    const object: Record<string, JsonValue> = {}
    skipWhitespace()
    if (text[position] === '}') {
      position += 1
      return object
    }
    for (;;) {
      skipWhitespace()
      const keyStart = position
      if (text[position] !== '"') {
        raise('JSON_SYNTAX', `Expected a string key but found ${describe(position)}.`)
      }
      const key = parseString()
      path.push(key)
      if (hasOwn(object, key)) {
        raise('DUPLICATE_KEY', `Duplicate key "${key}".`, keyStart)
      }
      skipWhitespace()
      expect(':')
      defineEntry(object, key, parseValue(depth + 1))
      path.pop()
      skipWhitespace()
      if (text[position] === ',') {
        position += 1
        continue
      }
      expect('}')
      return object
    }
  }

  try {
    const value = parseValue(1)
    skipWhitespace()
    if (position < text.length) {
      raise('JSON_SYNTAX', `Unexpected ${describe(position)} after the document.`)
    }
    return ok(value)
  } catch (failure) {
    if (failure instanceof JsonParseFailure) {
      return fail([failure.diagnostic])
    }
    throw failure
  }
}
