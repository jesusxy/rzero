import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'bun:test'
import type { CompiledScenario, Diagnostic, Result } from '../../src/core'

export const fixturesDir = join(import.meta.dir, '..', '..', 'fixtures', 'scenarios')

export function fixtureBytes(name: string): Uint8Array {
  return readFileSync(join(fixturesDir, name))
}

export function fixtureText(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

/** A fresh, mutable copy of the scenario 001 document. */
export function scenario001(): any {
  return JSON.parse(fixtureText('001-five-node-baseline.json'))
}

export function scenario002(): any {
  return JSON.parse(fixtureText('002-counterfactual-segmentation.json'))
}

/** `[code, path]` pairs of error diagnostics, in order. */
export function errorsOf(result: Result<unknown>): [string, string][] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => [diagnostic.code, diagnostic.path])
}

export function warningsOf(result: Result<unknown>): Diagnostic[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')
}

export function expectCompiled(result: Result<CompiledScenario>): CompiledScenario {
  if (!result.ok) {
    throw new Error(`Expected success, got ${JSON.stringify(result.diagnostics, null, 2)}`)
  }
  return result.value
}

export function expectRejected(result: Result<unknown>, code: string, path: string) {
  expect(result.ok).toBe(false)
  expect(errorsOf(result)).toContainEqual([code, path])
}

export function asset(document: any, id: string): any {
  return document.network.assets.find((entry: { id: string }) => entry.id === id)
}

/** A reviewed synthetic WinRM remote-execution profile (scenario 006 shape). */
export function winrmProfile() {
  return {
    id: 'lab-winrm',
    version: '1',
    name: 'Lab WinRM executor',
    scope: 'synthetic',
    review_status: 'reviewed',
    sources: [
      {
        id: 'lab-winrm-definition',
        kind: 'synthetic',
        title: 'Canonical WinRM lab rule',
        local_reference: 'docs/validation-scenarios.md',
        accessed_on: '2026-10-12',
        claim_summary: 'A valid admin WinRM grant permits modeled remote execution.',
      },
    ],
    capabilities: [
      {
        id: 'winrm-exec',
        label: 'Synthetic WinRM execution',
        mechanism: 'remote_execution',
        service_id: 'winrm',
        target_platforms: ['windows'],
        minimum_privilege: 'admin',
        evidence_ids: ['lab-winrm-definition'],
        confidence: 'high',
        assumptions: ['A valid grant launches the modeled profile; no real command runs.'],
      },
    ],
    limitations: ['Synthetic teaching rule; not a real malware family.'],
  }
}
