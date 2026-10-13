import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'bun:test'

const coreDir = join(import.meta.dir, '..', '..', 'src', 'core')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('domain core boundary', () => {
  test('core modules import only each other, their schemas and the yaml parser', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(coreDir)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1]!
        const insideCore = specifier.startsWith('.') && join(file, '..', specifier).startsWith(coreDir)
        if (specifier !== 'yaml' && !insideCore) offenders.push(`${relative(coreDir, file)} → ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('core type-checks against ECMAScript plus only the Encoding primitives', () => {
    const root = join(import.meta.dir, '..', '..')
    const config = readFileSync(join(root, 'tsconfig.core.json'), 'utf8') // JSONC: has comments
    expect(config).toContain('"lib": ["ES2023"]')
    expect(config).toContain('"types": []')
    // The one sanctioned non-ECMAScript addition: the host-neutral WHATWG
    // Encoding primitives, declared on their own and included only by the core.
    expect(config).toContain('types/platform-encoding.d.ts')
    const decl = readFileSync(join(root, 'types', 'platform-encoding.d.ts'), 'utf8')
    const code = decl
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).toMatch(/declare class TextEncoder/)
    expect(code).toMatch(/declare class TextDecoder/)
    // Only the two Encoding primitives are declared — no DOM, Node or Bun host globals.
    expect(code.match(/declare\s+(?:class|var|function|namespace)\s+(\w+)/g)).toEqual([
      'declare class TextEncoder',
      'declare class TextDecoder',
    ])
    expect(code).not.toMatch(/\b(window|document|localStorage|process|Buffer|Bun|globalThis|require)\b/)

    const tsc = Bun.spawnSync([process.execPath, join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.core.json'], { cwd: root })
    expect(tsc.stdout.toString() + tsc.stderr.toString()).toBe('')
    expect(tsc.exitCode).toBe(0)
  }, 60_000)
})
