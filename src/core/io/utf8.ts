// UTF-8 helpers built on the WHATWG Encoding primitives (TextEncoder and
// TextDecoder). They are host-neutral globals present in browsers, Web Workers,
// Node and Bun, synchronous, and need no dependency, so the core relies on them
// rather than a hand-rolled codec (see types/platform-encoding.d.ts). The core
// still uses no DOM, Node or Bun APIs, and the digest stays synchronous — unlike
// WebCrypto's async digest, which is why SHA-256 remains a custom sync routine.

export type Utf8DecodeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false }

// A single fatal decoder rejects invalid UTF-8 — overlong forms, lone
// surrogates, truncation and out-of-range code points — and strips one leading
// BOM. Non-streaming decode() calls are independent, so one instance is reused.
const fatalDecoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

/** Strictly decodes UTF-8; `{ ok: false }` on any malformed input. */
export function decodeUtf8(bytes: Uint8Array): Utf8DecodeResult {
  try {
    return { ok: true, text: fatalDecoder.decode(bytes) }
  } catch {
    return { ok: false }
  }
}

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text)
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

/** True when the string contains no unpaired UTF-16 surrogates. */
export function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}
