// Host-neutral WHATWG Encoding primitives. TextEncoder and TextDecoder are
// global in every environment the domain core targets — browsers, Web Workers,
// Node and Bun — and are synchronous. The core is permitted to use these two
// primitives and nothing else outside ECMAScript. They are declared minimally
// here, and this file is included only by tsconfig.core.json, so the core's
// type environment still excludes the DOM, Node and Bun libraries. The app
// project gets these types from its own DOM lib, so this file is not shared
// with it (that would be a duplicate declaration).

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

interface TextDecoderConstructorOptions {
  fatal?: boolean
  ignoreBOM?: boolean
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderConstructorOptions)
  decode(input?: ArrayBufferView | ArrayBuffer): string
}
