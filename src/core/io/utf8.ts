// Strict UTF-8 codec. Implemented here so the core needs nothing beyond
// ECMAScript (no TextDecoder/TextEncoder globals, no DOM, no Node).

export type Utf8DecodeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly offset: number }

const chunkSize = 8192

/** Decodes UTF-8, rejecting overlong forms, surrogates and truncation. Strips one leading BOM. */
export function decodeUtf8(bytes: Uint8Array): Utf8DecodeResult {
  const length = bytes.length
  let index = 0
  if (length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    index = 3
  }

  const chunks: string[] = []
  let units: number[] = []

  while (index < length) {
    const lead = bytes[index]!
    if (lead < 0x80) {
      units.push(lead)
      index += 1
    } else {
      let needed: number
      let codePoint: number
      let lower = 0x80
      let upper = 0xbf
      if (lead >= 0xc2 && lead <= 0xdf) {
        needed = 1
        codePoint = lead & 0x1f
      } else if (lead >= 0xe0 && lead <= 0xef) {
        needed = 2
        codePoint = lead & 0x0f
        if (lead === 0xe0) lower = 0xa0
        if (lead === 0xed) upper = 0x9f
      } else if (lead >= 0xf0 && lead <= 0xf4) {
        needed = 3
        codePoint = lead & 0x07
        if (lead === 0xf0) lower = 0x90
        if (lead === 0xf4) upper = 0x8f
      } else {
        return { ok: false, offset: index }
      }

      for (let k = 1; k <= needed; k += 1) {
        const next = bytes[index + k]
        const min = k === 1 ? lower : 0x80
        const max = k === 1 ? upper : 0xbf
        if (next === undefined || next < min || next > max) {
          return { ok: false, offset: index }
        }
        codePoint = (codePoint << 6) | (next & 0x3f)
      }

      if (codePoint > 0xffff) {
        const offset = codePoint - 0x10000
        units.push(0xd800 | (offset >> 10), 0xdc00 | (offset & 0x3ff))
      } else {
        units.push(codePoint)
      }
      index += needed + 1
    }

    if (units.length >= chunkSize) {
      chunks.push(String.fromCharCode(...units))
      units = []
    }
  }

  chunks.push(String.fromCharCode(...units))
  return { ok: true, text: chunks.join('') }
}

/** Encodes well-formed text as UTF-8. Lone surrogates become U+FFFD. */
export function encodeUtf8(text: string): Uint8Array {
  const out = new Uint8Array(utf8ByteLength(text))
  let position = 0
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00)
        index += 1
      } else {
        codePoint = 0xfffd
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd
    }

    if (codePoint < 0x80) {
      out[position++] = codePoint
    } else if (codePoint < 0x800) {
      out[position++] = 0xc0 | (codePoint >> 6)
      out[position++] = 0x80 | (codePoint & 0x3f)
    } else if (codePoint < 0x10000) {
      out[position++] = 0xe0 | (codePoint >> 12)
      out[position++] = 0x80 | ((codePoint >> 6) & 0x3f)
      out[position++] = 0x80 | (codePoint & 0x3f)
    } else {
      out[position++] = 0xf0 | (codePoint >> 18)
      out[position++] = 0x80 | ((codePoint >> 12) & 0x3f)
      out[position++] = 0x80 | ((codePoint >> 6) & 0x3f)
      out[position++] = 0x80 | (codePoint & 0x3f)
    }
  }
  return out
}

export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
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
