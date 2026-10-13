import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { ADMISSION_LIMITS, canonicalJson, parseDocument } from '../../src/core'
import { parseJson } from '../../src/core/io/json'
import { decodeUtf8, encodeUtf8, utf8ByteLength } from '../../src/core/io/utf8'
import { parseRestrictedYaml } from '../../src/core/io/yaml'
import { sha256Hex } from '../../src/core/scenario/sha256'
import { errorsOf } from './helpers'

describe('UTF-8 codec', () => {
  test('decodes valid UTF-8 and strictly rejects malformed sequences', () => {
    const valid = new Uint8Array([0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80])
    const decoded = decodeUtf8(valid)
    expect(decoded.ok && decoded.text).toBe('Aé€😀')
    const malformed = [
      [0xc0, 0xaf], // overlong '/'
      [0xe0, 0x80, 0xaf], // overlong
      [0xed, 0xa0, 0x80], // UTF-16 surrogate
      [0xf4, 0x90, 0x80, 0x80], // > U+10FFFF
      [0xe2, 0x82], // truncated
      [0xff],
    ]
    for (const bytes of malformed) {
      expect(decodeUtf8(new Uint8Array(bytes)).ok).toBe(false)
    }
  })

  test('round-trips text and measures byte length', () => {
    const text = 'Lab ✓ 漢字 😀'
    const bytes = encodeUtf8(text)
    expect(bytes).toEqual(new TextEncoder().encode(text))
    expect(utf8ByteLength(text)).toBe(bytes.length)
    const decoded = decodeUtf8(bytes)
    expect(decoded.ok && decoded.text).toBe(text)
  })

  test('strips a single leading byte-order mark', () => {
    const decoded = decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))
    expect(decoded.ok && decoded.text).toBe('{}')
  })
})

describe('SHA-256', () => {
  test('matches FIPS 180-4 test vectors', () => {
    expect(sha256Hex(encodeUtf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(encodeUtf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(encodeUtf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  test('matches node:crypto across block boundaries', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
      const data = new Uint8Array(length).map((_, index) => (index * 31 + length) & 0xff)
      expect(sha256Hex(data)).toBe(createHash('sha256').update(data).digest('hex'))
    }
  })
})

describe('canonical JSON', () => {
  test('sorts keys by code unit, removes whitespace and keeps array order', () => {
    expect(canonicalJson({ b: [3, 1, 2], a: { z: null, 'A': true }, '_': 'é\n' })).toBe(
      '{"_":"é\\n","a":{"A":true,"z":null},"b":[3,1,2]}',
    )
    expect(canonicalJson({ n: 1e21, m: 0.1, k: -0 })).toBe('{"k":0,"m":0.1,"n":1e+21}')
  })
})

describe('strict JSON parser', () => {
  test('accepts what JSON.parse accepts for ordinary documents', () => {
    const text = '{"a":[1,-2.5e3,true,false,null,"x\\u00e9\\n"],"b":{}}'
    const result = parseJson(text)
    expect(result.ok && result.value).toEqual(JSON.parse(text))
  })

  test('rejects duplicate keys with the path and position of the repeat', () => {
    const result = parseJson('{\n  "network": {\n    "assets": [{"id": "A", "id": "B"}]\n  }\n}')
    expect(errorsOf(result)).toEqual([['DUPLICATE_KEY', 'network.assets[0].id']])
    expect(result.diagnostics[0]!.location).toEqual({ line: 3, column: 28 })
  })

  test('keeps __proto__ as an ordinary own key without touching prototypes', () => {
    const result = parseJson('{"__proto__": {"polluted": true}}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value as object)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
  })

  test.each([
    ['{"a": 1,}', 'JSON_SYNTAX'],
    ['{"a": 01}', 'JSON_SYNTAX'],
    ["{'a': 1}", 'JSON_SYNTAX'],
    ['{"a": NaN}', 'JSON_SYNTAX'],
    ['{"a": 1e400}', 'NONFINITE_NUMBER'],
    ['{"a": "\\ud800"}', 'INVALID_STRING'],
    ['{"a": "tab\there"}', 'JSON_SYNTAX'],
    ['{"a": 1} {}', 'JSON_SYNTAX'],
    ['', 'JSON_SYNTAX'],
  ])('rejects %p with %s', (text, code) => {
    const result = parseJson(text)
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]!.code).toBe(code as never)
  })

  test('bounds nesting depth', () => {
    const deep = '['.repeat(ADMISSION_LIMITS.maxNestingDepth + 1) + ']'.repeat(ADMISSION_LIMITS.maxNestingDepth + 1)
    expect(parseJson(deep).diagnostics[0]!.code).toBe('NESTING_TOO_DEEP')
  })
})

describe('restricted YAML', () => {
  test('parses the JSON-compatible subset with YAML 1.2 core typing', () => {
    const result = parseRestrictedYaml(
      'a: 2026-10-12\nb: yes\nc: ~\nd: "1"\ne: 1\nf: [x, {g: false}]\nh: |\n  line\n',
    )
    expect(result.ok && result.value).toEqual({
      a: '2026-10-12',
      b: 'yes',
      c: null,
      d: '1',
      e: 1,
      f: ['x', { g: false }],
      h: 'line\n',
    })
  })

  test.each([
    ['a: 1\na: 2\n', 'DUPLICATE_KEY', 'a'],
    ['outer:\n  inner: 1\n  inner: 2\n', 'DUPLICATE_KEY', 'outer.inner'],
    ['a: &anchor {k: 1}\n', 'YAML_ANCHOR', 'a'],
    ['a: 1\nb: *x\n', 'YAML_ALIAS', 'b'],
    ['base: &b {x: 1}\nc: *b\n', 'YAML_ANCHOR', 'base'],
    ['a: !!str 5\n', 'YAML_TAG', 'a'],
    ['a: !custom z\n', 'YAML_TAG', 'a'],
    ['when: !!timestamp 2026-10-12\n', 'YAML_TAG', 'when'],
    ['a: 1\n---\nb: 2\n', 'YAML_MULTIPLE_DOCUMENTS', ''],
    ['%YAML 1.1\n---\na: yes\n', 'YAML_DIRECTIVE', ''],
    ['1: a\n', 'YAML_NON_STRING_KEY', ''],
    ['list:\n  - true: x\n', 'YAML_NON_STRING_KEY', 'list[0]'],
    ['? [x]\n: b\n', 'YAML_NON_STRING_KEY', ''],
    ['a: .inf\n', 'NONFINITE_NUMBER', 'a'],
    ['a: .nan\n', 'NONFINITE_NUMBER', 'a'],
    ['a: [1, 2\n', 'YAML_SYNTAX', ''],
    ['', 'YAML_EMPTY', ''],
    ['# only a comment\n', 'YAML_EMPTY', ''],
  ])('rejects %p with %s at %p', (text, code, path) => {
    const result = parseRestrictedYaml(text)
    expect(errorsOf(result)).toEqual([[code, path]])
  })

  test('alias rejection is reported even when the anchor is elsewhere', () => {
    // The anchor is rejected first because it precedes the alias in document order.
    const result = parseRestrictedYaml('a: &x 1\nb: *x\n')
    expect(errorsOf(result)).toEqual([['YAML_ANCHOR', 'a']])
  })

  test('reports source locations (the tagged value for tag errors)', () => {
    const result = parseRestrictedYaml('ok: 1\nnested:\n  value: !!binary aGk=\n')
    expect(result.diagnostics[0]!.location).toEqual({ line: 3, column: 19 })
  })
})

describe('document intake', () => {
  test('rejects documents over 5 MiB before decoding', () => {
    const bytes = new Uint8Array(ADMISSION_LIMITS.maxDocumentBytes + 1).fill(0x20)
    expect(errorsOf(parseDocument(bytes))).toEqual([['DOCUMENT_TOO_LARGE', '']])
  })

  test('rejects invalid UTF-8', () => {
    expect(errorsOf(parseDocument(new Uint8Array([0x7b, 0xff, 0x7d])))).toEqual([['INVALID_UTF8', '']])
  })

  test('selects the format from the file name, then from content', () => {
    expect(parseDocument('{"a": 1}').ok).toBe(true)
    expect(parseDocument('a: 1').ok).toBe(true)
    // JSON content forced through the YAML reader still parses (flow mapping) …
    expect(parseDocument('{"a": 1}', { fileName: 'x.yaml' }).ok).toBe(true)
    // … but YAML content is never accepted by the JSON reader.
    expect(errorsOf(parseDocument('a: 1', { fileName: 'x.json' }))).toEqual([['JSON_SYNTAX', '']])
  })
})
