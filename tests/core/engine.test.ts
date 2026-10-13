import { describe, expect, test } from 'bun:test'
import { compileScenario, importScenario, runScenario, type RunResult } from '../../src/core'
import { expectCompiled, fixtureText, scenario002, winrmProfile } from './helpers'
import {
  assertEngineInvariants,
  checkStatus,
  compileLab,
  counts,
  indeterminateTargets,
  primaryReason,
  resolvedEvents,
  runLab,
  SMB_EXPLOIT_PROFILE,
  trace,
  type LabSpec,
} from './engine-helpers'

const compromised = (run: RunResult) => [...run.state.compromised].sort()

// A combined profile with both mechanisms (scenario 007).
const combinedProfile = () => ({
  ...SMB_EXPLOIT_PROFILE,
  id: 'lab-combined',
  name: 'Lab combined',
  capabilities: [
    SMB_EXPLOIT_PROFILE.capabilities[0],
    {
      id: 'winrm-exec',
      label: 'Synthetic WinRM execution',
      mechanism: 'remote_execution',
      service_id: 'winrm',
      target_platforms: ['windows'],
      minimum_privilege: 'admin',
      evidence_ids: ['lab-definition'],
      confidence: 'high',
      assumptions: ['A valid grant launches the modeled profile; no real command runs.'],
    },
  ],
})

describe('001 — five-node baseline', () => {
  const run = () => runScenario(expectCompiled(importScenario(fixtureText('001-five-node-baseline.json'))))

  test('produces the exact documented semantic event order (seq 0–16)', () => {
    expect(trace(run())).toEqual([
      'run_started',
      'compromised:A',
      'discovered:B',
      'attempted:A->B:smb-exploit',
      'resolved:A->B:succeeded',
      'compromised:B',
      'discovered:C',
      'attempted:A->C:smb-exploit',
      'resolved:A->C:blocked',
      'discovered:D',
      'attempted:B->D:smb-exploit',
      'resolved:B->D:succeeded',
      'compromised:D',
      'discovered:E',
      'attempted:D->E:smb-exploit',
      'resolved:D->E:blocked',
      'run_completed',
    ])
  })

  test('compromise set, counts, hops, parents and the completed snapshot', () => {
    const result = run()
    expect(result.status).toBe('completed')
    expect(compromised(result)).toEqual(['A', 'B', 'D'])
    expect(counts(result)).toEqual({ succeeded: 2, blocked: 2, indeterminate: 0, skipped: 0 })
    expect(result.state.hops).toEqual({ A: 0, B: 1, D: 2 })
    expect(result.state.parents).toEqual([
      { asset_id: 'B', parent_id: 'A', link_id: 'ab', capability_id: 'smb-exploit', attempt_id: 'a000001', hop: 1 },
      { asset_id: 'D', parent_id: 'B', link_id: 'bd', capability_id: 'smb-exploit', attempt_id: 'a000003', hop: 2 },
    ])
    const completed = result.events.at(-1)
    expect(completed).toMatchObject({
      type: 'run_completed',
      hop: 2,
      compromised_ids: ['A', 'B', 'D'],
      discovered_ids: ['B', 'C', 'D', 'E'],
      processed_ids: ['A', 'B', 'D'],
    })
  })

  test('A→C is blocked by NETWORK_ACCESS and D→E by VULNERABILITY_PRESENT', () => {
    const resolved = resolvedEvents(run())
    const ac = resolved.find((event) => event.target_id === 'C')!
    expect(ac.outcome).toBe('blocked')
    expect(primaryReason(ac)).toBe('NETWORK_ACCESS')
    expect(ac.checks.find((check) => check.code === 'NETWORK_ACCESS')).toMatchObject({
      status: 'fail',
      expected: 'allow',
      observed: 'deny',
      entity_refs: ['ac'],
    })
    const de = resolved.find((event) => event.target_id === 'E')!
    expect(de.outcome).toBe('blocked')
    expect(primaryReason(de)).toBe('VULNERABILITY_PRESENT')
    expect(de.checks.find((check) => check.code === 'VULNERABILITY_PRESENT')).toMatchObject({
      status: 'fail',
      observed: 'absent',
    })
    // Resolved events carry the capability's evidence.
    expect(ac.evidence_ids).toEqual(['lab-definition'])
  })

  test('the queue dequeues one source at a time; uncompromised E is never enqueued', () => {
    const result = run()
    expect(result.state.processed).toEqual(['A', 'B', 'D'])
    expect(result.state.compromised).toEqual(['A', 'B', 'D']) // enqueue order
    assertEngineInvariants(result)
  })

  test('run_started names the engine, model, profile and seed', () => {
    const started = run().events[0]
    expect(started).toMatchObject({
      type: 'run_started',
      engine_version: 'rzero-engine/1',
      model_version: 'rzero/1',
      profile_id: 'lab-worm',
      profile_version: '1',
      initial_asset_id: 'A',
    })
  })
})

describe('002 — counterfactual segmentation (engine outputs that feed comparison)', () => {
  test('the baseline snapshot compromises {A,B,D}', () => {
    const baseline = scenario002()
    baseline.interventions = []
    const result = runScenario(expectCompiled(compileScenario(baseline)))
    expect(compromised(result)).toEqual(['A', 'B', 'D'])
  })

  test('denying the workstation→server boundary stops at {A,B}; D is discovered, E never considered', () => {
    const result = runScenario(expectCompiled(importScenario(fixtureText('002-counterfactual-segmentation.json'))))
    expect(compromised(result)).toEqual(['A', 'B'])
    expect(counts(result)).toEqual({ succeeded: 1, blocked: 2, indeterminate: 0, skipped: 0 })
    expect(result.state.discovered).toContain('D')
    expect(result.state.discovered).not.toContain('E')
    // The decisive B→D block names the intervention behind the denied boundary.
    const bd = resolvedEvents(result).find((event) => event.target_id === 'D')!
    expect(bd.outcome).toBe('blocked')
    expect(bd.checks.find((check) => check.code === 'NETWORK_ACCESS')).toMatchObject({
      status: 'fail',
      intervention_ids: ['deny-ws-srv-smb'],
    })
    assertEngineInvariants(result)
  })
})

describe('003 — cycle termination', () => {
  const spec: LabSpec = {
    assets: { A: {}, B: {}, C: {} },
    links: [
      { id: 'ab', source: 'A', target: 'B' },
      { id: 'bc', source: 'B', target: 'C' },
      { id: 'ca', source: 'C', target: 'A' },
    ],
  }

  test('each source processes once; C→A is skipped; hops 0,1,2', () => {
    const result = runLab(spec)
    expect(compromised(result)).toEqual(['A', 'B', 'C'])
    expect(counts(result)).toEqual({ succeeded: 2, blocked: 0, indeterminate: 0, skipped: 1 })
    expect(result.state.hops).toEqual({ A: 0, B: 1, C: 2 })
    expect(trace(result).filter((line) => line.startsWith('skipped'))).toEqual(['skipped:C->A'])
    assertEngineInvariants(result)
  })

  test('a repeated run produces identical semantic events', () => {
    expect(trace(runLab(spec))).toEqual(trace(runLab(spec)))
  })
})

describe('004 — alternate route after a block', () => {
  test('A→C is blocked, then B→C succeeds; C is discovered once and compromised once', () => {
    const result = runLab({
      assets: { A: {}, B: {}, C: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B' },
        { id: 'ac', source: 'A', target: 'C', access: 'deny' },
        { id: 'bc', source: 'B', target: 'C' },
      ],
    })
    expect(compromised(result)).toEqual(['A', 'B', 'C'])
    expect(counts(result)).toEqual({ succeeded: 2, blocked: 1, indeterminate: 0, skipped: 0 })
    expect(trace(result).filter((line) => line === 'discovered:C')).toHaveLength(1)
    expect(trace(result).filter((line) => line === 'compromised:C')).toHaveLength(1)
    // A blocked route never sets a permanent safe flag.
    expect(result.state.parents.find((parent) => parent.asset_id === 'C')).toMatchObject({ parent_id: 'B', link_id: 'bc' })
    assertEngineInvariants(result)
  })
})

describe('005 — unknown vulnerability', () => {
  const unknownVuln: LabSpec = {
    assets: { A: {}, B: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'unknown' }] } },
    links: [{ id: 'ab', source: 'A', target: 'B' }],
  }
  const missingVuln: LabSpec = {
    assets: { A: {}, B: { vulnerabilities: [] } },
    links: [{ id: 'ab', source: 'A', target: 'B' }],
  }

  test('explicit unknown: B is indeterminate, not compromised, not enqueued', () => {
    const result = runLab(unknownVuln)
    expect(compromised(result)).toEqual(['A'])
    expect(counts(result)).toEqual({ succeeded: 0, blocked: 0, indeterminate: 1, skipped: 0 })
    expect(indeterminateTargets(result)).toEqual(['B'])
    expect(result.state.processed).toEqual(['A']) // B never processed
    expect(result.events.at(-1)).toMatchObject({ type: 'run_completed', hop: 0 })
  })

  test('a missing vulnerability entry behaves identically to explicit unknown', () => {
    expect(counts(runLab(missingVuln))).toEqual(counts(runLab(unknownVuln)))
    const resolved = resolvedEvents(runLab(missingVuln))[0]!
    expect(checkStatus(resolved, 'VULNERABILITY_PRESENT')).toBe('unknown')
    expect(resolved.checks.find((c) => c.code === 'VULNERABILITY_PRESENT')?.observed).toBe('missing')
  })

  test('denying the link makes it blocked while the vulnerability check stays unknown', () => {
    const result = runLab({
      assets: { A: {}, B: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'unknown' }] } },
      links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }],
    })
    expect(counts(result)).toMatchObject({ blocked: 1, indeterminate: 0 })
    const resolved = resolvedEvents(result)[0]!
    expect(resolved.outcome).toBe('blocked')
    expect(checkStatus(resolved, 'NETWORK_ACCESS')).toBe('fail')
    expect(checkStatus(resolved, 'VULNERABILITY_PRESENT')).toBe('unknown')
    expect(primaryReason(resolved)).toBe('NETWORK_ACCESS') // first failed in fixed order
  })
})

describe('006 — credentials and minimum privilege', () => {
  const winrmLab = (privilege: string, status: string, overrides: Partial<LabSpec> = {}): LabSpec => ({
    assets: {
      A: { credential_ids: ['cred-a'] },
      B: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
    },
    links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
    profile: winrmProfile(),
    credentials: [
      { id: 'cred-a', label: 'Lab credential', grants: [{ target_id: 'B', service_id: 'winrm', privilege, status }] },
    ],
    ...overrides,
  })

  test('valid admin grant compromises B with no vulnerability check', () => {
    const result = runLab(winrmLab('admin', 'valid'))
    expect(compromised(result)).toEqual(['A', 'B'])
    const resolved = resolvedEvents(result)[0]!
    expect(resolved.outcome).toBe('succeeded')
    expect(resolved.checks.some((check) => check.code === 'VULNERABILITY_PRESENT')).toBe(false)
    expect(resolved.checks.find((check) => check.code === 'CREDENTIAL_AUTHORIZED')).toMatchObject({
      status: 'pass',
      entity_refs: ['cred-a'],
    })
  })

  test.each([
    ['valid', 'user', 'blocked', 'fail'], // insufficient privilege
    ['invalid', 'admin', 'blocked', 'fail'],
    ['unknown', 'admin', 'indeterminate', 'unknown'],
  ])('a %s %s grant resolves %s', (status, privilege, outcome, checkState) => {
    const result = runLab(winrmLab(privilege, status))
    expect(resolvedEvents(result)[0]!.outcome as string).toBe(outcome)
    expect(checkStatus(resolvedEvents(result)[0]!, 'CREDENTIAL_AUTHORIZED')).toBe(checkState)
    expect(compromised(result)).toEqual(outcome === 'succeeded' ? ['A', 'B'] : ['A'])
  })

  test('a missing grant on A blocks even if an unrelated source holds one', () => {
    const result = runLab({
      assets: {
        A: { credential_ids: [] },
        B: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
        C: { credential_ids: ['cred-c'] },
      },
      links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
      profile: winrmProfile(),
      credentials: [
        { id: 'cred-c', label: 'Other', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
      ],
    })
    expect(resolvedEvents(result)[0]!.outcome).toBe('blocked')
    expect(checkStatus(resolvedEvents(result)[0]!, 'CREDENTIAL_AUTHORIZED')).toBe('fail')
    expect(compromised(result)).toEqual(['A'])
  })
})

describe('007 — multiple mechanisms', () => {
  test('SMB (lexically first) is tried then blocked; WinRM then succeeds via remote_execution', () => {
    const result = runLab({
      assets: {
        A: { credential_ids: ['cred-a'] },
        B: {
          services: [
            { id: 'smb', transport: 'tcp', port: 445, status: 'enabled' },
            { id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' },
          ],
          vulnerabilities: [{ id: 'LAB-SMB-1', status: 'absent' }],
        },
      },
      links: [
        { id: 'ab-smb', source: 'A', target: 'B', service: 'smb' },
        { id: 'ab-winrm', source: 'A', target: 'B', service: 'winrm' },
      ],
      profile: combinedProfile(),
      credentials: [
        { id: 'cred-a', label: 'Admin', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
      ],
    })
    expect(trace(result)).toEqual([
      'run_started',
      'compromised:A',
      'discovered:B',
      'attempted:A->B:smb-exploit',
      'resolved:A->B:blocked',
      'attempted:A->B:winrm-exec',
      'resolved:A->B:succeeded',
      'compromised:B',
      'run_completed',
    ])
    expect(compromised(result)).toEqual(['A', 'B'])
    expect(result.state.parents.find((parent) => parent.asset_id === 'B')!.capability_id).toBe('winrm-exec')
  })

  test('same-service alternatives: the first weakness fails, the later one succeeds, then it stops', () => {
    const twoExploits = {
      ...SMB_EXPLOIT_PROFILE,
      id: 'lab-two-exploits',
      capabilities: [
        { ...SMB_EXPLOIT_PROFILE.capabilities[0], id: 'smb-exploit-a', vulnerability_id: 'WEAK-1' },
        { ...SMB_EXPLOIT_PROFILE.capabilities[0], id: 'smb-exploit-b', vulnerability_id: 'WEAK-2' },
      ],
    }
    const result = runLab({
      assets: {
        A: {},
        B: {
          vulnerabilities: [
            { id: 'WEAK-1', status: 'absent' },
            { id: 'WEAK-2', status: 'present' },
          ],
        },
      },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
      profile: twoExploits,
    })
    expect(trace(result)).toEqual([
      'run_started',
      'compromised:A',
      'discovered:B',
      'attempted:A->B:smb-exploit-a',
      'resolved:A->B:blocked',
      'attempted:A->B:smb-exploit-b',
      'resolved:A->B:succeeded',
      'compromised:B',
      'run_completed',
    ])
    expect(counts(result)).toEqual({ succeeded: 1, blocked: 1, indeterminate: 0, skipped: 0 })
  })
})

describe('008 — converging routes', () => {
  test('B is processed before C; D has one parent (B) and one compromise; C→D is skipped', () => {
    const result = runLab({
      assets: { A: {}, B: {}, C: {}, D: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B' },
        { id: 'ac', source: 'A', target: 'C' },
        { id: 'bd', source: 'B', target: 'D' },
        { id: 'cd', source: 'C', target: 'D' },
      ],
    })
    expect(compromised(result)).toEqual(['A', 'B', 'C', 'D'])
    expect(result.state.processed).toEqual(['A', 'B', 'C', 'D']) // B before C
    expect(counts(result)).toEqual({ succeeded: 3, blocked: 0, indeterminate: 0, skipped: 1 })
    expect(result.state.parents.find((parent) => parent.asset_id === 'D')).toMatchObject({ parent_id: 'B' })
    expect(trace(result).filter((line) => line === 'compromised:D')).toHaveLength(1)
    expect(trace(result).filter((line) => line.startsWith('skipped'))).toEqual(['skipped:C->D'])
    assertEngineInvariants(result)
  })
})

describe('009 — isolation and service absence', () => {
  test('an isolated target blocks with TARGET_NOT_ISOLATED', () => {
    const result = runLab({
      assets: { A: {}, B: { isolated: true } },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
    })
    expect(compromised(result)).toEqual(['A'])
    expect(primaryReason(resolvedEvents(result)[0]!)).toBe('TARGET_NOT_ISOLATED')
  })

  test('an isolated seed stays compromised but blocks outward with SOURCE_NOT_ISOLATED', () => {
    const result = runLab({
      assets: { A: { isolated: true }, B: {} },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
    })
    expect(compromised(result)).toEqual(['A'])
    expect(primaryReason(resolvedEvents(result)[0]!)).toBe('SOURCE_NOT_ISOLATED')
  })

  test('an absent target service blocks with SERVICE_ENABLED', () => {
    const result = runLab({
      assets: { A: {}, B: { services: [] } },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
    })
    expect(compromised(result)).toEqual(['A'])
    const resolved = resolvedEvents(result)[0]!
    expect(primaryReason(resolved)).toBe('SERVICE_ENABLED')
    expect(resolved.checks.find((check) => check.code === 'SERVICE_ENABLED')?.observed).toBe('absent')
  })
})

describe('010 — input and run invariants', () => {
  const spec: LabSpec = {
    assets: { A: {}, B: {}, C: {}, D: {}, E: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'absent' }] } },
    links: [
      { id: 'ab', source: 'A', target: 'B' },
      { id: 'ac', source: 'A', target: 'C', access: 'deny' },
      { id: 'bd', source: 'B', target: 'D' },
      { id: 'de', source: 'D', target: 'E' },
    ],
  }

  test('reversing input array order leaves the semantic events, parents and digest unchanged', () => {
    const forward = runLab(spec)
    const reversedSpec: LabSpec = {
      ...spec,
      assets: Object.fromEntries(Object.entries(spec.assets).reverse()),
      links: [...spec.links].reverse(),
    }
    const compiledForward = compileLab(spec)
    const compiledReversed = compileLab(reversedSpec)
    const reversed = runScenario(compiledReversed)
    expect(trace(reversed)).toEqual(trace(forward))
    expect(reversed.state.parents).toEqual(forward.state.parents)
    expect(compiledReversed.input_digest).toBe(compiledForward.input_digest)
  })

  test('running the same compiled scenario twice yields identical events and fresh state', () => {
    const compiled = compileLab(spec)
    const first = runScenario(compiled)
    const second = runScenario(compiled)
    expect(trace(second)).toEqual(trace(first))
    expect(second.state).toEqual(first.state)
    expect(first.state).not.toBe(second.state) // run-local, not shared
  })
})

describe('011 — bounded input: event cap and cancellation', () => {
  const fiveNode = () => expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))

  test('a lowered event cap aborts with a partial stream and a reserved terminal', () => {
    const result = runScenario(fiveNode(), { maxEvents: 8 })
    expect(result.status).toBe('aborted')
    expect(result.events.length).toBeLessThanOrEqual(8)
    const terminal = result.events.at(-1)!
    expect(terminal).toMatchObject({ type: 'run_aborted', error_code: 'EVENT_LIMIT' })
    expect(terminal.type === 'run_aborted' && terminal.last_processed_seq).toBe(result.events.length - 2)
    expect(result.abort).toEqual({ code: 'EVENT_LIMIT', last_processed_seq: result.events.length - 2 })
    // No attempt group is split, and the seed still counts as compromised.
    assertEngineInvariants(result)
    expect(result.state.compromised).toContain('A')
  })

  test('the event cap never emits a run_completed', () => {
    for (const maxEvents of [2, 3, 5, 6, 8, 12, 16]) {
      const result = runScenario(fiveNode(), { maxEvents })
      const type = result.events.at(-1)!.type
      expect(type).toBe(result.events.length >= 17 ? 'run_completed' : 'run_aborted')
      expect(result.events.length).toBeLessThanOrEqual(Math.max(maxEvents, 17))
      assertEngineInvariants(result)
    }
  })

  test('cancellation before any movement aborts with only the seed compromised', () => {
    const result = runScenario(fiveNode(), { shouldCancel: () => true })
    expect(result.status).toBe('aborted')
    expect(result.abort?.code).toBe('CANCELLED')
    expect(compromised(result)).toEqual(['A'])
    expect(result.events.map((event) => event.type)).toEqual(['run_started', 'asset_compromised', 'run_aborted'])
  })

  test('cancellation partway leaves a consistent partial stream', () => {
    let checks = 0
    const result = runScenario(fiveNode(), { shouldCancel: () => ++checks > 3 })
    expect(result.status).toBe('aborted')
    expect(result.abort?.code).toBe('CANCELLED')
    assertEngineInvariants(result)
    // Some progress was made before the cancel fired.
    expect(result.state.compromised.length).toBeGreaterThanOrEqual(1)
  })
})

describe('credential attribution — a blocked attempt keeps its evidence', () => {
  // A→B over WinRM; B exposes WinRM; the WinRM execution profile requires admin.
  const winrmLab = (
    credentials: unknown[],
    credentialIds: string[],
    interventions: unknown[] = [],
  ): LabSpec => ({
    assets: {
      A: { credential_ids: credentialIds },
      B: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
    },
    links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
    profile: winrmProfile(),
    credentials,
    interventions,
  })

  test('a grant revoked by an intervention blocks, naming the credential and intervention', () => {
    const result = runLab(
      winrmLab(
        [{ id: 'cred-a', label: 'Admin', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] }],
        ['cred-a'],
        [{ type: 'set_grant_status', id: 'revoke-a', credential_id: 'cred-a', target_id: 'B', service_id: 'winrm', status: 'invalid' }],
      ),
    )
    expect(compromised(result)).toEqual(['A'])
    const check = resolvedEvents(result)[0]!.checks.find((c) => c.code === 'CREDENTIAL_AUTHORIZED')!
    expect(check.status).toBe('fail')
    expect(check.observed).toBe('invalid:admin') // the revoked grant, not "none"
    expect(check.entity_refs).toEqual(['cred-a'])
    expect(check.intervention_ids).toEqual(['revoke-a'])
  })

  test('an absent grant is distinguished from a matching invalid grant', () => {
    // A grant for B over a different service does not match the WinRM lookup.
    const result = runLab(
      winrmLab(
        [{ id: 'cred-a', label: 'Admin', grants: [{ target_id: 'B', service_id: 'smb', privilege: 'admin', status: 'valid' }] }],
        ['cred-a'],
      ),
    )
    const check = resolvedEvents(result)[0]!.checks.find((c) => c.code === 'CREDENTIAL_AUTHORIZED')!
    expect(check.status).toBe('fail')
    expect(check.observed).toBe('none') // no grant for B/winrm at all
    expect(check.entity_refs).toEqual([])
    expect(check.intervention_ids).toBeUndefined()
  })

  test('an underprivileged valid grant fails but is still reported, not "none"', () => {
    const result = runLab(
      winrmLab(
        [{ id: 'cred-a', label: 'User', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'user', status: 'valid' }] }],
        ['cred-a'],
      ),
    )
    const check = resolvedEvents(result)[0]!.checks.find((c) => c.code === 'CREDENTIAL_AUTHORIZED')!
    expect(check.status).toBe('fail')
    expect(check.observed).toBe('valid:user') // valid but below the required admin
    expect(check.entity_refs).toEqual(['cred-a'])
  })

  test('a second valid credential still authorizes even when the first is revoked', () => {
    const result = runLab(
      winrmLab(
        [
          { id: 'cred-a', label: 'Revoked', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
          { id: 'cred-b', label: 'Still valid', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
        ],
        ['cred-a', 'cred-b'],
        [{ type: 'set_grant_status', id: 'revoke-a', credential_id: 'cred-a', target_id: 'B', service_id: 'winrm', status: 'invalid' }],
      ),
    )
    expect(compromised(result)).toEqual(['A', 'B'])
    const check = resolvedEvents(result)[0]!.checks.find((c) => c.code === 'CREDENTIAL_AUTHORIZED')!
    expect(check.status).toBe('pass')
    expect(check.observed).toBe('valid:admin')
    expect(check.entity_refs).toEqual(['cred-b']) // the authorizing credential, not the revoked one
    expect(check.intervention_ids).toBeUndefined() // the revocation is not blamed for a success
  })

  test('the pass/fail/unknown outcome rules are unchanged', () => {
    const outcome = (status: string, privilege: string) =>
      resolvedEvents(
        runLab(
          winrmLab(
            [{ id: 'cred-a', label: 'c', grants: [{ target_id: 'B', service_id: 'winrm', privilege, status }] }],
            ['cred-a'],
          ),
        ),
      )[0]!.checks.find((c) => c.code === 'CREDENTIAL_AUTHORIZED')!.status
    expect(outcome('valid', 'admin')).toBe('pass')
    expect(outcome('unknown', 'admin')).toBe('unknown')
    expect(outcome('invalid', 'admin')).toBe('fail')
    expect(outcome('valid', 'user')).toBe('fail') // insufficient privilege
  })
})
