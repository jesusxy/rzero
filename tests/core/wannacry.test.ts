import { describe, expect, test } from 'bun:test'
import {
  analyzeRun,
  compareScenarios,
  importScenario,
  runScenario,
  validateProfile,
  type PropagationResolvedEvent,
  type RunResult,
} from '../../src/core'
import { expectCompiled, fixtureText } from './helpers'
import { assertEngineInvariants, primaryReason, resolvedEvents } from './engine-helpers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Hand-authored expectations for the WannaCry small-office scenarios. The
// profile is fixtures/profiles/wannacry.profile.json; each scenario embeds it.

const profileFile = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'fixtures', 'profiles', 'wannacry.profile.json'), 'utf8'),
)
const BASE = 'wannacry-small-office.json'
const SEGMENTED = 'wannacry-small-office-segmented.json'
const compile = (name: string) => expectCompiled(importScenario(fixtureText(name)))
const compromised = (run: RunResult) => [...run.state.compromised].sort()
const resolved = (run: RunResult, linkId: string): PropagationResolvedEvent | undefined =>
  resolvedEvents(run).find((event) => event.link_id === linkId)
const attempted = (run: RunResult, linkId: string) =>
  run.events.some((event) => event.type === 'propagation_attempted' && event.link_id === linkId)

describe('WannaCry profile fixture', () => {
  test('is a valid, reviewed family profile', () => {
    expect(profileFile.review_status).toBe('reviewed')
    expect(profileFile.scope).toBe('family')
    expect(validateProfile(profileFile).ok).toBe(true)
  })

  test.each([BASE, SEGMENTED])('%s embeds the profile file exactly', (name) => {
    expect(JSON.parse(fixtureText(name)).profile).toEqual(profileFile)
  })
})

describe('WannaCry in a small office', () => {
  const scenario = compile(BASE)
  const run = runScenario(scenario)
  const analysis = analyzeRun(scenario, run)

  test('compromises exactly ws01, ws02 and fs01: 3 of 7, reaching critical fs01', () => {
    expect(run.status).toBe('completed')
    expect(compromised(run)).toEqual(['fs01', 'ws01', 'ws02'])
    expect(analysis.blast_radius).toBeCloseTo(3 / 7, 10)
    expect(analysis.critical_compromised).toEqual(['fs01'])
    assertEngineInvariants(run)
  })

  test('each attempt resolves for its documented reason', () => {
    expect(resolved(run, 'ws01-ws02')?.outcome).toBe('succeeded')
    expect(resolved(run, 'ws02-fs01')?.outcome).toBe('succeeded')
    expect(resolved(run, 'ws01-ws03')?.outcome).toBe('blocked') // patched
    expect(primaryReason(resolved(run, 'ws01-ws03')!)).toBe('VULNERABILITY_PRESENT')
    expect(resolved(run, 'ws01-ws04')?.outcome).toBe('indeterminate') // XP: MS17-010 unknown
    expect(primaryReason(resolved(run, 'ws01-ws04')!)).toBe('VULNERABILITY_PRESENT')
    expect(resolved(run, 'ws02-dc01')?.outcome).toBe('blocked') // patched critical server
    expect(primaryReason(resolved(run, 'ws02-dc01')!)).toBe('VULNERABILITY_PRESENT')
    expect(resolved(run, 'fs01-nas01')?.outcome).toBe('blocked') // Linux
    expect(primaryReason(resolved(run, 'fs01-nas01')!)).toBe('TARGET_PLATFORM')
    expect(analysis.indeterminate_targets).toEqual(['ws04'])
  })

  test('ws03 → fs01 is never attempted, because ws03 is never compromised', () => {
    expect(attempted(run, 'ws03-fs01')).toBe(false)
  })
})

describe('WannaCry in a small office, servers segmented', () => {
  const scenario = compile(SEGMENTED)
  const run = runScenario(scenario)
  const analysis = analyzeRun(scenario, run)

  test('compromises exactly ws01 and ws02, and no critical asset', () => {
    expect(compromised(run)).toEqual(['ws01', 'ws02'])
    expect(analysis.critical_compromised).toEqual([])
    assertEngineInvariants(run)
  })

  test.each(['ws02-fs01', 'ws02-dc01'])('%s is blocked by the network, naming the intervention', (linkId) => {
    const event = resolved(run, linkId)!
    expect(event.outcome).toBe('blocked')
    expect(primaryReason(event)).toBe('NETWORK_ACCESS')
    expect(event.checks.find((check) => check.code === 'NETWORK_ACCESS')?.intervention_ids).toEqual(['deny-office-servers-smb'])
  })

  test('fs01 → nas01 is never attempted', () => {
    expect(attempted(run, 'fs01-nas01')).toBe(false)
  })
})

describe('comparison: segmenting the servers', () => {
  const baseline = compile(BASE)
  const segmented = compile(SEGMENTED)
  const intervention = segmented.source.interventions[0]!
  const comparison = compareScenarios(baseline, intervention)

  test('the segmented fixture is the base plus exactly that intervention', () => {
    expect(segmented.source.interventions).toHaveLength(1)
    expect(comparison.ok).toBe(true)
    if (comparison.ok) expect(comparison.value.modified_scenario.input_digest).toBe(segmented.input_digest)
  })

  test('fs01 is no longer compromised; blast radius 42.9% → 28.6% (−14.3 points)', () => {
    if (!comparison.ok) throw new Error('comparison failed')
    const m = comparison.value.metrics
    expect(m.no_longer_compromised).toEqual(['fs01'])
    expect(m.newly_compromised).toEqual([])
    expect(m.baseline_count).toBe(3)
    expect(m.modified_count).toBe(2)
    expect(Number((m.baseline_blast_radius * 100).toFixed(1))).toBe(42.9)
    expect(Number((m.modified_blast_radius * 100).toFixed(1))).toBe(28.6)
    expect(Number(m.percentage_point_change.toFixed(1))).toBe(14.3)
  })
})
