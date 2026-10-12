import { describe, expect, test } from 'bun:test'
import {
  analyzeRun,
  compareScenarios,
  compileScenario,
  diffAnalyses,
  firstCompromisePath,
  importScenario,
  runScenario,
  type Intervention,
  type RunAnalysis,
} from '../../src/core'
import { errorsOf, expectCompiled, fixtureText, scenario002, winrmProfile } from './helpers'
import { compileLab, type LabSpec } from './engine-helpers'

const boundaryDeny: Intervention = {
  type: 'set_boundary_access',
  id: 'deny-ws-srv-smb',
  from_segment_id: 'workstations',
  to_segment_id: 'servers',
  service_id: 'smb',
  access: 'deny',
}

function analyzeLab(spec: LabSpec): RunAnalysis {
  const compiled = compileLab(spec)
  return analyzeRun(compiled, runScenario(compiled))
}

function analyzeFixture(name: string): { analysis: RunAnalysis; run: ReturnType<typeof runScenario> } {
  const compiled = expectCompiled(importScenario(fixtureText(name)))
  const run = runScenario(compiled)
  return { analysis: analyzeRun(compiled, run), run }
}

describe('analyzeRun — five-node baseline (001)', () => {
  const { analysis, run } = analyzeFixture('001-five-node-baseline.json')

  test('summarizes the completed result per docs/analysis-results.md', () => {
    expect(analysis).toMatchObject({
      status: 'completed',
      seed_id: 'A',
      total_assets: 5,
      compromised: ['A', 'B', 'D'],
      unaffected: ['C', 'E'],
      indeterminate_targets: [],
      critical_compromised: [],
      attempt_counts: { succeeded: 2, blocked: 2, indeterminate: 0, skipped: 0 },
      mechanism_contributions: { remote_exploit: 2, remote_execution: 0 },
      blast_radius: 0.6,
    })
    expect(analysis.primary_blocking_reasons).toEqual({ NETWORK_ACCESS: 1, VULNERABILITY_PRESENT: 1 })
  })

  test('compromised and unaffected partition the asset universe', () => {
    const universe = [...analysis.compromised, ...analysis.unaffected].sort()
    expect(universe).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(analysis.compromised.some((id) => analysis.unaffected.includes(id))).toBe(false)
  })

  test('mechanism contributions sum to compromised − 1', () => {
    const total = analysis.mechanism_contributions.remote_exploit + analysis.mechanism_contributions.remote_execution
    expect(total).toBe(analysis.compromised.length - 1)
  })

  test('first-compromise path for D is seed-first A → B → D with evidence and passing checks', () => {
    const path = firstCompromisePath(run, 'D')!
    expect(path.map((step) => step.asset_id)).toEqual(['A', 'B', 'D'])
    expect(path[0]).toEqual({ asset_id: 'A', hop: 0 }) // seed has no via
    expect(path[2]).toMatchObject({
      asset_id: 'D',
      hop: 2,
      via: { source_id: 'B', link_id: 'bd', capability_id: 'smb-exploit', attempt_id: 'a000003', outcome: 'succeeded' },
    })
    expect(path[2]!.via!.evidence_ids).toEqual(['lab-definition'])
    expect(path[2]!.via!.checks.every((check) => check.status === 'pass')).toBe(true)
  })

  test('an uncompromised asset has no path but failed attempts remain inspectable', () => {
    expect(firstCompromisePath(run, 'C')).toBeUndefined()
    expect(firstCompromisePath(run, 'E')).toBeUndefined()
  })

  test('counts recomputed independently from events agree', () => {
    const recomputed = { succeeded: 0, blocked: 0, indeterminate: 0, skipped: 0 }
    for (const event of run.events) {
      if (event.type === 'propagation_resolved') recomputed[event.outcome] += 1
      else if (event.type === 'propagation_skipped') recomputed.skipped += 1
    }
    expect(recomputed).toEqual(analysis.attempt_counts)
  })
})

describe('analyzeRun — fact-specific and mechanism cases', () => {
  test('indeterminate targets are a subset of unaffected (unknown vulnerability)', () => {
    const analysis = analyzeLab({
      assets: { A: {}, B: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'unknown' }] } },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
    })
    expect(analysis.compromised).toEqual(['A'])
    expect(analysis.indeterminate_targets).toEqual(['B'])
    expect(analysis.indeterminate_targets.every((id) => analysis.unaffected.includes(id))).toBe(true)
    expect(analysis.attempt_counts).toMatchObject({ indeterminate: 1, blocked: 0 })
  })

  test('counts stay consistent when a host has a failed attempt before a later compromise (004)', () => {
    const compiled = compileLab({
      assets: { A: {}, B: {}, C: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B' },
        { id: 'ac', source: 'A', target: 'C', access: 'deny' },
        { id: 'bc', source: 'B', target: 'C' },
      ],
    })
    const run = runScenario(compiled)
    const analysis = analyzeRun(compiled, run)
    expect(analysis.compromised).toEqual(['A', 'B', 'C'])
    expect(analysis.attempt_counts).toEqual({ succeeded: 2, blocked: 1, indeterminate: 0, skipped: 0 })
    expect(analysis.primary_blocking_reasons).toEqual({ NETWORK_ACCESS: 1 })
    // C is compromised despite its earlier blocked attempt; its path uses the later route.
    expect(firstCompromisePath(run, 'C')!.map((s) => s.asset_id)).toEqual(['A', 'B', 'C'])
    expect(firstCompromisePath(run, 'C')!.at(-1)!.via!.link_id).toBe('bc')
  })

  test('critical compromised lists only reached critical assets', () => {
    const analysis = analyzeLab({
      assets: { A: {}, B: { critical: true }, C: { critical: true } },
      links: [{ id: 'ab', source: 'A', target: 'B' }], // C unreachable
    })
    expect(analysis.compromised).toEqual(['A', 'B'])
    expect(analysis.critical_compromised).toEqual(['B'])
  })

  test('a credential-based compromise is attributed to remote_execution', () => {
    const analysis = analyzeLab({
      assets: {
        A: { credential_ids: ['cred-a'] },
        B: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
      },
      links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
      profile: winrmProfile(),
      credentials: [
        { id: 'cred-a', label: 'Admin', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
      ],
    })
    expect(analysis.compromised).toEqual(['A', 'B'])
    expect(analysis.mechanism_contributions).toEqual({ remote_exploit: 0, remote_execution: 1 })
  })

  test('an aborted run is analyzed as partial', () => {
    const compiled = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
    const analysis = analyzeRun(compiled, runScenario(compiled, { maxEvents: 8 }))
    expect(analysis.status).toBe('aborted')
    expect(analysis.abort).toEqual({ code: 'EVENT_LIMIT', last_processed_seq: 6 })
    expect(analysis.compromised).toEqual(['A', 'B']) // observed so far
  })

  test('analyzeRun rejects a run from a different scenario', () => {
    const one = compileLab({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B' }] })
    const other = compileLab({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }] })
    expect(() => analyzeRun(one, runScenario(other))).toThrow('input digest mismatch')
  })
})

describe('compareScenarios — the documented segmentation experiment', () => {
  const baseline = () => {
    const document = scenario002()
    document.interventions = [] // start from the segmented baseline, no boundary rule
    return expectCompiled(compileScenario(document))
  }

  test('baseline {A,B,D} vs modified {A,B}: 60% → 40%, −1 asset, 33.3%, 20pp', () => {
    const baselineCompiled = baseline()
    const result = compareScenarios(baselineCompiled, boundaryDeny)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { baseline: b, modified: m, metrics, added_intervention } = result.value

    expect(b.compromised).toEqual(['A', 'B', 'D'])
    expect(m.compromised).toEqual(['A', 'B'])
    expect(metrics.absolute_reduction).toBe(1)
    expect(metrics.relative_reduction).toBeCloseTo(33.333, 2)
    expect(metrics.percentage_point_change).toBeCloseTo(20, 6)
    expect(metrics.baseline_blast_radius).toBeCloseTo(0.6, 6)
    expect(metrics.modified_blast_radius).toBeCloseTo(0.4, 6)
    expect(metrics.no_longer_compromised).toEqual(['D'])
    expect(metrics.newly_compromised).toEqual([])

    // The manifest explains exactly what changed.
    expect(added_intervention.intervention_id).toBe('deny-ws-srv-smb')
    expect(added_intervention.changes.map((change) => change.field_ref)).toEqual(['link:bd/access'])
  })

  test('the baseline is never mutated', () => {
    const baselineCompiled = baseline()
    expect(baselineCompiled.source.interventions).toEqual([])
    compareScenarios(baselineCompiled, boundaryDeny)
    expect(baselineCompiled.source.interventions).toEqual([]) // unchanged
    expect(analyzeRun(baselineCompiled, runScenario(baselineCompiled)).compromised).toEqual(['A', 'B', 'D'])
  })

  test('the modified scenario and both runs are returned for replay', () => {
    const result = compareScenarios(baseline(), boundaryDeny)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.modified_scenario.manifest.map((record) => record.intervention_id)).toEqual(['deny-ws-srv-smb'])
    expect(result.value.baseline_run.status).toBe('completed')
    expect(result.value.modified_run.status).toBe('completed')
  })
})

describe('compareScenarios — rejections', () => {
  test('an overlapping intervention is rejected by the compiler', () => {
    // scenario002 already denies the workstation→server boundary (writes link:bd/access).
    const withExisting = expectCompiled(importScenario(fixtureText('002-counterfactual-segmentation.json')))
    const result = compareScenarios(withExisting, { ...boundaryDeny, id: 'deny-again' })
    expect(errorsOf(result)).toContainEqual(['CONFLICTING_INTERVENTIONS', 'interventions[1]'])
  })

  test('an invalid intervention target is rejected by the compiler', () => {
    const baseline = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
    const result = compareScenarios(baseline, { type: 'set_asset_isolation', id: 'iso', asset_id: 'Z', isolated: true })
    expect(errorsOf(result)).toContainEqual(['UNKNOWN_ASSET', 'interventions[0].asset_id'])
  })
})

describe('diffAnalyses — metrics and compatibility', () => {
  const completed = (spec: LabSpec) => analyzeLab(spec)

  test('negative reduction is reported as an increase, never clamped', () => {
    const fewer = completed({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }] })
    const more = completed({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B' }] })
    expect(fewer.compromised).toEqual(['A'])
    expect(more.compromised).toEqual(['A', 'B'])
    const result = diffAnalyses(fewer, more)
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.absolute_reduction).toBe(-1)
    expect(result.value.relative_reduction).toBe(-100)
    expect(result.value.newly_compromised).toEqual(['B'])
    expect(result.value.no_longer_compromised).toEqual([])
  })

  test('a comparison involving an aborted run is rejected', () => {
    const compiled = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
    const completedAnalysis = analyzeRun(compiled, runScenario(compiled))
    const abortedAnalysis = analyzeRun(compiled, runScenario(compiled, { maxEvents: 8 }))
    expect(errorsOf(diffAnalyses(completedAnalysis, abortedAnalysis))).toContainEqual(['COMPARISON_ABORTED_RUN', ''])
  })

  test('a comparison between different seeds is rejected as incompatible', () => {
    const seededA = completed({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B' }] })
    const seededB = completed({ assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B' }], seed: 'B' })
    expect(errorsOf(diffAnalyses(seededA, seededB))).toContainEqual(['COMPARISON_INCOMPATIBLE', ''])
  })
})
