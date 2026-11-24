import { describe, expect, test } from 'bun:test'
import {
  groupSteps,
  importScenario,
  runScenario,
  type Check,
  type CheckCode,
  type CompiledScenario,
  type RunResult,
  type Step,
} from '../../src/core'
import { blockTag, checkName, describeProfile, narrate, type Narration } from '../../src/app/narration'
import { fill, reasonTemplate } from '../../src/app/narration/narrate'
import { REASONS, REASON_VARIANTS, SERVICE_NAMES, STEP_TEXT } from '../../src/app/narration/templates'
import { expectCompiled, fixtureText } from '../core/helpers'
import { compileLab, type LabSpec } from '../core/engine-helpers'
import {
  ALL_LABS,
  lab005DeniedUnknown,
  lab005MissingVulnerability,
  lab005UnknownVulnerability,
  lab006Credential,
  lab006MissingGrant,
  lab009IsolatedSeed,
  lab009IsolatedTarget,
  lab009ServiceAbsent,
} from '../core/canonical-labs'

type Story = { name: string; scenario: CompiledScenario; run: RunResult; steps: readonly Step[]; narrations: Narration[] }

function story(name: string, scenario: CompiledScenario, run: RunResult = runScenario(scenario)): Story {
  const steps = groupSteps(run.events)
  return { name, scenario, run, steps, narrations: steps.map((step) => narrate(step, run.events, scenario)) }
}
const fixture = (name: string) => expectCompiled(importScenario(fixtureText(name)))
const lab = (name: string, spec: LabSpec) => story(name, compileLab(spec))

// Hand-listed in the fixed check order from docs/event-model.md.
const CHECK_CODES: CheckCode[] = [
  'SOURCE_NOT_ISOLATED',
  'TARGET_NOT_ISOLATED',
  'TARGET_PLATFORM',
  'NETWORK_ACCESS',
  'SERVICE_ENABLED',
  'VULNERABILITY_PRESENT',
  'CREDENTIAL_AUTHORIZED',
]

// Labs that reach the remaining reason templates end to end.
const extraLabs: Record<string, LabSpec> = {
  'platform mismatch': { assets: { A: {}, B: { platform: 'linux' } }, links: [{ id: 'ab', source: 'A', target: 'B' }] },
  'platform unknown': { assets: { A: {}, B: { platform: 'unknown' } }, links: [{ id: 'ab', source: 'A', target: 'B' }] },
  'access unknown': { assets: { A: {}, B: {} }, links: [{ id: 'ab', source: 'A', target: 'B', access: 'unknown' }] },
  'service disabled': {
    assets: { A: {}, B: { services: [{ id: 'smb', transport: 'tcp', port: 445, status: 'disabled' }] } },
    links: [{ id: 'ab', source: 'A', target: 'B' }],
  },
  'service unknown': {
    assets: { A: {}, B: { services: [{ id: 'smb', transport: 'tcp', port: 445, status: 'unknown' }] } },
    links: [{ id: 'ab', source: 'A', target: 'B' }],
  },
}

/** The four scenarios the spec names, every variant. */
const required: Story[] = [
  story('001', fixture('001-five-node-baseline.json')),
  lab('005 unknown', lab005UnknownVulnerability),
  lab('005 missing', lab005MissingVulnerability),
  lab('005 denied', lab005DeniedUnknown),
  lab('006 valid admin', lab006Credential('admin', 'valid')),
  lab('006 valid user', lab006Credential('user', 'valid')),
  lab('006 invalid admin', lab006Credential('admin', 'invalid')),
  lab('006 unknown admin', lab006Credential('admin', 'unknown')),
  lab('006 missing grant', lab006MissingGrant),
  lab('009 isolated target', lab009IsolatedTarget),
  lab('009 isolated seed', lab009IsolatedSeed),
  lab('009 service absent', lab009ServiceAbsent),
]

const everything: Story[] = [
  ...required,
  story('002', fixture('002-counterfactual-segmentation.json')),
  story('wannacry', fixture('wannacry-small-office.json')),
  story('wannacry segmented', fixture('wannacry-small-office-segmented.json')),
  ...Object.entries(ALL_LABS).map(([name, spec]) => lab(name, spec)),
  ...Object.entries(extraLabs).map(([name, spec]) => lab(name, spec)),
  story('001 capped at 8', fixture('001-five-node-baseline.json'), runScenario(fixture('001-five-node-baseline.json'), { maxEvents: 8 })),
  story('001 cancelled', fixture('001-five-node-baseline.json'), runScenario(fixture('001-five-node-baseline.json'), { shouldCancel: () => true })),
]

const LEFTOVER = /\{\w+\}|undefined|null|NaN|\[object/
const texts = (n: Narration) => [n.title, n.preview, n.body, ...(n.why === undefined ? [] : [n.why])]

describe('templates', () => {
  test('there is one reason template per (check code, fail|unknown), for every CheckCode', () => {
    expect(Object.keys(REASONS).sort()).toEqual([...CHECK_CODES].sort())
    for (const code of CHECK_CODES) {
      for (const status of ['fail', 'unknown'] as const) {
        expect(REASONS[code][status].because.length).toBeGreaterThan(0)
        expect(REASONS[code][status].also.length).toBeGreaterThan(0)
      }
    }
  })

  test('every reason template and variant fills completely from a check', () => {
    const vars = {
      source: 'SRC',
      target: 'TGT',
      noun: 'exploit',
      service: 'svc',
      vulnerability: 'VULN-1',
      privilege: 'admin',
      platforms: 'windows',
    }
    const observedFor: Record<string, string> = {
      absent: 'absent',
      missing: 'missing',
      invalid: 'invalid:admin',
      underprivileged: 'valid:user',
    }
    const cases: Check[] = []
    for (const code of CHECK_CODES) {
      for (const status of ['fail', 'unknown'] as const) {
        const observed = code === 'CREDENTIAL_AUTHORIZED' ? (status === 'fail' ? 'none' : 'unknown:admin') : 'x'
        cases.push({ code, status, expected: 'y', observed, entity_refs: ['cred-a'] })
      }
    }
    for (const key of Object.keys(REASON_VARIANTS)) {
      const [code, status, variant] = key.split('/') as [CheckCode, 'fail' | 'unknown', string]
      cases.push({ code, status, expected: 'y', observed: observedFor[variant]!, entity_refs: ['cred-a'] })
    }
    for (const check of cases) {
      const template = reasonTemplate(check)
      const filled = [template.because, template.also].map((text) =>
        fill(text, {
          ...vars,
          observed: check.observed,
          credential: check.entity_refs[0],
          granted: check.observed.split(':')[1],
        }),
      )
      for (const text of filled) expect(text).not.toMatch(LEFTOVER)
    }
  })

  test('each variant is reached by its observed fact', () => {
    const variant = (code: CheckCode, status: 'fail' | 'unknown', observed: string) =>
      reasonTemplate({ code, status, expected: 'y', observed, entity_refs: ['cred-a'] }).because
    expect(variant('SERVICE_ENABLED', 'fail', 'absent')).toBe(REASON_VARIANTS['SERVICE_ENABLED/fail/absent']!.because!)
    expect(variant('SERVICE_ENABLED', 'fail', 'disabled')).toBe(REASONS.SERVICE_ENABLED.fail.because)
    expect(variant('VULNERABILITY_PRESENT', 'unknown', 'missing')).toBe(
      REASON_VARIANTS['VULNERABILITY_PRESENT/unknown/missing']!.because!,
    )
    expect(variant('CREDENTIAL_AUTHORIZED', 'fail', 'none')).toBe(REASONS.CREDENTIAL_AUTHORIZED.fail.because)
    expect(variant('CREDENTIAL_AUTHORIZED', 'fail', 'invalid:admin')).toBe(
      REASON_VARIANTS['CREDENTIAL_AUTHORIZED/fail/invalid']!.because!,
    )
    expect(variant('CREDENTIAL_AUTHORIZED', 'fail', 'valid:user')).toBe(
      REASON_VARIANTS['CREDENTIAL_AUTHORIZED/fail/underprivileged']!.because!,
    )
  })
})

describe('narrate — rendering', () => {
  test.each(everything.map((s): [string, Story] => [s.name, s]))('%s: no placeholders or missing facts', (_name, s) => {
    for (const narration of s.narrations) {
      for (const text of texts(narration)) {
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toMatch(LEFTOVER)
      }
      expect(narration.title.startsWith('Step')).toBe(false) // the CLI/UI number steps themselves
    }
  })

  test('001: titles, decisive facts and evidence', () => {
    const [seed, ab, ac, bd, de, summary] = required[0]!.narrations
    expect([seed, ab, ac, bd, de, summary].map((n) => n!.title)).toEqual([
      'WS-01 starts compromised',
      'WS-02 compromised',
      'Blocked at WS-03',
      'SRV-01 compromised',
      'Blocked at SRV-02',
      '3 of 5 hosts compromised',
    ])
    expect(ac!.body).toContain("network doesn't allow SMB traffic from WS-01 to WS-03") // NETWORK_ACCESS
    expect(de!.body).toContain("SRV-02 doesn't have the LAB-SMB-1 weakness the exploit needs") // VULNERABILITY_PRESENT
    expect(summary!.body).toContain('3 of 5 hosts are compromised, a 60% blast radius: WS-01, WS-02 and SRV-01')
    expect(summary!.body).toContain('WS-03 and SRV-02 were never compromised')
  })

  test('the primary reason is the first failure, kept alongside an unknown', () => {
    const blocked = lab('005 denied', lab005DeniedUnknown).narrations[1]!
    expect(blocked.title).toBe('Blocked at WS-02')
    const network = blocked.body.indexOf("network doesn't allow")
    const vulnerability = blocked.body.indexOf("we don't know whether WS-02 has the LAB-SMB-1 weakness")
    expect(network).toBeGreaterThan(-1)
    expect(vulnerability).toBeGreaterThan(network) // listed as an additional issue
  })

  test('unknown reads as "we don\'t know", never as safe or vulnerable', () => {
    const indeterminate = everything.flatMap((s) => s.steps.flatMap((step, i) => (step.outcome === 'indeterminate' ? [s.narrations[i]!] : [])))
    expect(indeterminate.length).toBeGreaterThanOrEqual(6)
    for (const n of indeterminate) {
      expect(n.title).toMatch(/^Inconclusive at /)
      expect(n.body).toMatch(/don't know|doesn't say/)
      expect(n.body).not.toMatch(/\bis (safe|vulnerable)\b|vulnerable/)
      expect(n.body).toContain('not counted as compromised, and not as safe either')
    }
  })

  test('an isolated target is not promised another route', () => {
    const n = lab('009 isolated target', lab009IsolatedTarget).narrations[1]!
    expect(n.body).toContain('Being cut off protects WS-02 from every route in this model.')
    expect(n.body).not.toMatch(/nothing else will try|can still be reached/)
  })

  test('alternatives and earlier blocks are explained (004, 007)', () => {
    expect(lab('004', ALL_LABS['004 alternate route']!).narrations[3]!.body).toMatch(/^An earlier attempt on WS-03 didn't get through/)
    const multi = lab('007', ALL_LABS['007 multiple mechanisms']!).narrations
    expect(multi[2]!.body).toMatch(/^That didn't work, so WS-01 tries its next option on WS-02: the Synthetic WinRM execution/)
    expect(multi[2]!.body).toContain("WS-01's credential cred-a gives admin access")
  })
})

describe('narrate — interventions', () => {
  test('002 modified run names the segmentation rule on the attempt it decided', () => {
    const s = story('002', fixture('002-counterfactual-segmentation.json'))
    const byPair = (source: string, target: string) => s.narrations[s.steps.findIndex((st) => st.source_id === source && st.target_id === target)]!
    expect(byPair('B', 'D').title).toBe('Blocked at SRV-01')
    expect(byPair('B', 'D').body).toContain('blocked by the segmentation rule deny-ws-srv-smb')
    // A → C was denied by the authored network, not by an intervention.
    expect(byPair('A', 'C').body).not.toContain('deny-ws-srv-smb')
  })

  test('patches and credential revocations are named by kind', () => {
    const patched = lab('patch', {
      assets: { A: {}, B: {} },
      links: [{ id: 'ab', source: 'A', target: 'B' }],
      interventions: [
        { type: 'set_vulnerability_status', id: 'patch-b', asset_id: 'B', vulnerability_id: 'LAB-SMB-1', status: 'absent' },
      ],
    })
    expect(patched.narrations[1]!.body).toContain('blocked by the patch patch-b')

    const revoked = lab('revocation', {
      ...lab006Credential('admin', 'valid'),
      interventions: [
        { type: 'set_grant_status', id: 'revoke-a', credential_id: 'cred-a', target_id: 'B', service_id: 'winrm', status: 'invalid' },
      ],
    })
    expect(revoked.narrations[1]!.body).toContain('blocked by the credential revocation revoke-a')
  })
})

describe('narrate — previews and summaries', () => {
  test('no attempt preview reveals an outcome', () => {
    for (const s of everything) {
      s.steps.forEach((step, i) => {
        if (step.kind !== 'attempt') return
        expect(s.narrations[i]!.preview).toMatch(/ tries /)
        expect(s.narrations[i]!.preview).not.toMatch(/compromis|block|unknown|inconclusive|succe|fail/i)
      })
    }
  })

  test('seed and terminal previews', () => {
    const [seed, , , , , summary] = required[0]!.narrations
    expect(seed!.preview).toBe('WS-01 starts compromised')
    expect(summary!.preview).toBe('Results')
  })

  test('no narration mentions seconds or time', () => {
    for (const s of everything) {
      for (const n of s.narrations) expect(n.body).not.toMatch(/\bseconds?\b|\bminutes?\b|\bhours?\b|\btime\b|\bms\b/i)
    }
  })

  test('summary: critical hosts reached, spared, and indeterminate targets', () => {
    const reached = lab('critical reached', { assets: { A: {}, B: { critical: true } }, links: [{ id: 'ab', source: 'A', target: 'B' }] })
    expect(reached.narrations.at(-1)!.body).toContain('Critical hosts reached: WS-02.')
    const spared = lab('critical spared', {
      assets: { A: {}, B: { critical: true } },
      links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }],
    })
    expect(spared.narrations.at(-1)!.body).toContain('None of the critical hosts (WS-02) was reached.')
    expect(lab('005', lab005UnknownVulnerability).narrations.at(-1)!.body).toContain(
      "We couldn't tell what would happen at WS-02: count it as unknown, not as safe.",
    )
  })

  test('an aborted run is narrated as partial, with its reason', () => {
    const capped = everything.find((s) => s.name === '001 capped at 8')!
    const last = capped.narrations.at(-1)!
    expect(capped.steps.at(-1)!.kind).toBe('aborted')
    expect(last.title).toBe('The run stopped early')
    expect(last.body).toContain('hit the limit on how many events one run may record')
    expect(last.body).toContain('It had just picked WS-03 as a target')
    expect(last.body).toContain('2 of 5 hosts were compromised before it stopped')
  })
})

describe('wording rules', () => {
  const twoExploitProfile = {
    id: 'lab-two-exploits',
    version: '1',
    name: 'Two exploits',
    scope: 'synthetic',
    review_status: 'reviewed',
    sources: [
      {
        id: 'lab-definition',
        kind: 'synthetic',
        title: 'Canonical lab rule',
        local_reference: 'docs/validation-scenarios.md',
        accessed_on: '2026-10-12',
        claim_summary: 'Synthetic.',
      },
    ],
    capabilities: ['A', 'B'].map((letter, i) => ({
      id: `smb-exploit-${letter.toLowerCase()}`,
      label: `Exploit ${letter}`,
      mechanism: 'remote_exploit',
      service_id: 'smb',
      target_platforms: ['windows'],
      vulnerability_id: `WEAK-${i + 1}`,
      evidence_ids: ['lab-definition'],
      confidence: 'high',
      assumptions: ['Synthetic.'],
    })),
    limitations: ['Synthetic.'],
  }

  test('1. the asset label is the only display name (fixtures use WS-01 … SRV-02)', () => {
    const s = story('001', fixture('001-five-node-baseline.json'))
    const labels = s.scenario.effective.network.assets.map((asset) => [asset.id, asset.label])
    expect(labels).toEqual([
      ['A', 'WS-01'],
      ['B', 'WS-02'],
      ['C', 'WS-03'],
      ['D', 'SRV-01'],
      ['E', 'SRV-02'],
    ])
    for (const n of s.narrations) expect(n.body).not.toMatch(/LAB-(WS|SRV)/)
  })

  test('2. services are shown by display name, never by raw ID', () => {
    expect(SERVICE_NAMES).toEqual({ smb: 'SMB', winrm: 'WinRM' })
    const [, ab] = required[0]!.narrations
    expect(ab!.body).toContain('WS-01 tries WS-02 over SMB')
    expect(lab('006', lab006Credential('admin', 'valid')).narrations[1]!.body).toContain('over WinRM')
    // A raw service ID as a standalone word (IDs such as deny-ws-srv-smb are shown verbatim).
    for (const s of everything) for (const n of s.narrations) expect(n.body).not.toMatch(/(?<![-\w])(smb|winrm)(?![-\w])/)
  })

  test('3. "Why" appears only on the first step that uses a capability', () => {
    const whys = (s: Story) => s.narrations.map((n) => n.why ?? null)
    const claim = 'Enabled SMB plus LAB-SMB-1 permits modeled compromise.'
    // 001: seed, A→B, A→C, B→D, D→E, summary — one capability, first used at A→B.
    expect(whys(required[0]!)).toEqual([null, claim, null, null, null, null])
    // 007: SMB exploit then WinRM execution — each capability's first use carries it.
    expect(whys(lab('007', ALL_LABS['007 multiple mechanisms']!))).toEqual([null, claim, claim, null])
  })

  test('4. after a block, say what else can still try the target (static network)', () => {
    const [, , ac, , de] = required[0]!.narrations
    expect(ac!.body).toContain('No other host has a link to WS-03, so nothing else will try.')
    expect(de!.body).toContain('No other host has a link to SRV-02, so nothing else will try.')
    // 004: B → C also targets C, and B is already compromised with that link untried.
    expect(lab('004', ALL_LABS['004 alternate route']!).narrations[2]!.body).toContain(
      'WS-02 will still try WS-03 over another link.',
    )
    // 007: the WinRM link from the same (compromised) source is still untried.
    expect(lab('007', ALL_LABS['007 multiple mechanisms']!).narrations[1]!.body).toContain(
      'WS-01 will still try WS-02 over another link.',
    )
    // Another link only matters if its source gets compromised.
    const waiting = lab('waiting source', {
      assets: { A: {}, B: {}, C: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B', access: 'deny' },
        { id: 'ac', source: 'A', target: 'C' },
        { id: 'cb', source: 'C', target: 'B' },
      ],
    })
    expect(waiting.narrations[1]!.parts!.note).toBe('WS-02 could still be reached if WS-03 is compromised.')
    const twoWaiting = lab('two waiting', {
      assets: { A: {}, B: {}, C: {}, D: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B', access: 'deny' },
        { id: 'ac', source: 'A', target: 'C' },
        { id: 'ad', source: 'A', target: 'D' },
        { id: 'cb', source: 'C', target: 'B' },
        { id: 'db', source: 'D', target: 'B' },
      ],
    })
    expect(twoWaiting.narrations[1]!.parts!.note).toBe('WS-02 could still be reached if WS-03 or SRV-01 are compromised.')
    // A denied link is not a way through, even once its source is compromised.
    const deniedOther = lab('denied other link', {
      assets: { A: {}, B: {}, C: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B', access: 'deny' },
        { id: 'ac', source: 'A', target: 'C' },
        { id: 'cb', source: 'C', target: 'B', access: 'deny' },
      ],
    })
    expect(deniedOther.narrations[1]!.parts!.note).toBe("The network doesn't allow SMB traffic to WS-02 from WS-03 either.")
    // WannaCry segmented: the boundary rule also denies WS-03 → FS-01.
    const fs01 = story('wannacry segmented', fixture('wannacry-small-office-segmented.json')).narrations.find(
      (n) => n.title === 'Blocked at FS-01',
    )
    expect(fs01!.parts!.note).toBe("The network doesn't allow SMB traffic to FS-01 from WS-03 either.")
    // 007 same service: a later capability on this very link will try next.
    const same = lab('007 same', ALL_LABS['007 same service']!).narrations[1]!.body
    expect(same).toContain('WS-01 still has another way to try WS-02 over SMB.')
    expect(same).not.toContain('nothing else will try')
    // A link whose service no profile capability uses does not count.
    const unusable = lab('unusable link', {
      assets: {
        A: {},
        B: {
          services: [
            { id: 'smb', transport: 'tcp', port: 445, status: 'enabled' },
            { id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' },
          ],
        },
        C: {},
      },
      links: [
        { id: 'ab', source: 'A', target: 'B', access: 'deny' },
        { id: 'cb', source: 'C', target: 'B', service: 'winrm' },
      ],
    })
    expect(unusable.narrations[1]!.body).toContain('No other host has a link to WS-02, so nothing else will try.')
    // The old, unfounded wording is gone everywhere.
    for (const s of everything) for (const n of s.narrations) expect(n.body).not.toContain('another route could still reach it')
  })

  test('5. the capability is named in full once, then "with the same exploit"', () => {
    const bodies = required[0]!.narrations.map((n) => n.body)
    expect(bodies.join(' ').split('Synthetic SMB exploit')).toHaveLength(2) // exactly one full mention
    expect(bodies[1]).toContain('WS-01 tries WS-02 over SMB, using the Synthetic SMB exploit.')
    expect(bodies[2]).toContain('WS-01 tries WS-03 over SMB with the same exploit.')
    expect(bodies[3]).toContain('WS-02 tries SRV-01 over SMB with the same exploit.')
    expect(bodies[4]).toContain('SRV-01 tries SRV-02 over SMB with the same exploit.')
  })

  test('5. remote execution has its own short noun', () => {
    const twoTargets = lab('winrm twice', {
      assets: {
        A: { credential_ids: ['cred-a'] },
        B: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
        C: { services: [{ id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }], vulnerabilities: [] },
      },
      links: [
        { id: 'ab', source: 'A', target: 'B', service: 'winrm' },
        { id: 'ac', source: 'A', target: 'C', service: 'winrm' },
      ],
      profile: lab006Credential('admin', 'valid').profile,
      credentials: [
        {
          id: 'cred-a',
          label: 'Lab credential',
          grants: ['B', 'C'].map((target_id) => ({ target_id, service_id: 'winrm', privilege: 'admin', status: 'valid' })),
        },
      ],
    })
    expect(twoTargets.narrations[1]!.body).toContain('using the Synthetic WinRM execution')
    expect(twoTargets.narrations[2]!.body).toContain('WS-01 tries WS-03 over WinRM with the same remote execution.')
  })

  test('5. "the same" is used only when unambiguous; otherwise the label is repeated', () => {
    // A→B uses Exploit A; A→C tries Exploit A again (unambiguous) then falls back to
    // Exploit B (first use); B→D then uses Exploit A while two exploits have appeared.
    const s = lab('two exploits', {
      assets: {
        A: {},
        B: { vulnerabilities: [{ id: 'WEAK-1', status: 'present' }] },
        C: {
          vulnerabilities: [
            { id: 'WEAK-1', status: 'absent' },
            { id: 'WEAK-2', status: 'present' },
          ],
        },
        D: { vulnerabilities: [{ id: 'WEAK-1', status: 'present' }] },
      },
      links: [
        { id: 'ab', source: 'A', target: 'B' },
        { id: 'ac', source: 'A', target: 'C' },
        { id: 'bd', source: 'B', target: 'D' },
      ],
      profile: twoExploitProfile,
    })
    const attempts = s.steps.flatMap((step, i) => (step.kind === 'attempt' ? [s.narrations[i]!.body] : []))
    expect(attempts).toHaveLength(4)
    expect(attempts[0]).toContain('WS-01 tries WS-02 over SMB, using the Exploit A.')
    expect(attempts[1]).toContain('WS-01 tries WS-03 over SMB with the same exploit.')
    expect(attempts[2]).toContain("That didn't work, so WS-01 tries its next option on WS-03: the Exploit B over SMB.")
    expect(attempts[3]).toContain('WS-02 tries SRV-01 over SMB, using the Exploit A.')
  })

  test('every step template fills completely from the tokens narrate supplies', () => {
    const supplied = {
      seed: 'S',
      source: 'S',
      target: 'T',
      capability: 'Cap',
      noun: 'exploit',
      service: 'SMB',
      vulnerability: 'V',
      privilege: 'admin',
      platforms: 'windows',
      credential: 'cred-a',
      granted: 'admin',
      intervention: 'the patch p',
      issues: 'x',
      sources: 'WS-02',
      count: '1',
      total: '2',
      percent: '50%',
      hosts: 'WS-01',
      are: 'is',
      were: 'was',
      them: 'it',
      they: 'it',
      reason: 'it was cancelled',
      is: 'is',
      chip: 'SMB exploit',
      traffic: 'SMB traffic',
    }
    const strings = (value: unknown): string[] =>
      typeof value === 'string' ? [value] : Object.values(value as Record<string, unknown>).flatMap(strings)
    for (const text of strings(STEP_TEXT)) expect(fill(text, supplied)).not.toMatch(LEFTOVER)
  })
})

describe('UI-facing fields', () => {
  test('an attempt body is exactly its parts, in order', () => {
    for (const s of everything) {
      s.steps.forEach((step, i) => {
        const n = s.narrations[i]!
        if (step.kind !== 'attempt') {
          expect(n.parts).toBeUndefined()
          return
        }
        const p = n.parts!
        expect([p.lead, ...p.result, ...(p.stop?.sentences ?? []), ...(p.note ? [p.note] : [])].join(' ')).toBe(n.body)
        if (step.outcome === 'blocked' || step.outcome === 'indeterminate') {
          expect(p.stop).toBeDefined()
          expect(p.note!.length).toBeGreaterThan(0)
          expect(p.result).toEqual([])
        }
        if (step.outcome === 'succeeded') expect(p.stop).toBeUndefined()
      })
    }
  })

  test('001: the deciding check is carried with the stop sentences', () => {
    const [, , ac] = required[0]!.narrations
    expect(ac!.parts!.stop!.check).toMatchObject({ code: 'NETWORK_ACCESS', status: 'fail', expected: 'allow', observed: 'deny' })
    expect(ac!.parts!.lead).toBe('WS-01 tries WS-03 over SMB with the same exploit.')
    expect(ac!.parts!.note).toBe('No other host has a link to WS-03, so nothing else will try.')
  })

  test('subtitles for reached steps', () => {
    expect(required[0]!.narrations.map((n) => n.subtitle)).toEqual([
      'Initial host',
      'SMB exploit from WS-01',
      'Network path denied',
      'SMB exploit from WS-02',
      'Weakness absent',
      'Blast radius and what held',
    ])
    expect(lab('005', lab005UnknownVulnerability).narrations[1]!.subtitle).toBe('Weakness unknown')
    expect(lab('006', lab006Credential('admin', 'valid')).narrations[1]!.subtitle).toBe('WinRM execution from WS-01')
  })

  test('every check has a plain-English name per status, and every code a block tag', () => {
    for (const code of CHECK_CODES) {
      for (const status of ['pass', 'fail', 'unknown'] as const) expect(checkName({ code, status }).length).toBeGreaterThan(0)
      expect(blockTag({ code }).length).toBeGreaterThan(0)
    }
    expect(checkName({ code: 'NETWORK_ACCESS', status: 'fail' })).toBe('Network path denied')
    expect(blockTag({ code: 'NETWORK_ACCESS' })).toBe('link denied')
  })

  test('profile description (001 matches the layout mockup)', () => {
    expect(describeProfile(required[0]!.scenario.effective.profile)).toEqual({
      name: 'Lab SMB Worm',
      summary: 'Spreads host to host over SMB by exploiting LAB-SMB-1 on Windows machines. Needs an allowed network path and SMB turned on.',
      chips: ['SMB', 'Windows', 'Synthetic'],
    })
  })

  test("a profile's own summary is used when it has one", () => {
    const wannacry = story('wannacry', fixture('wannacry-small-office.json')).scenario.effective.profile
    expect(describeProfile(wannacry).summary).toBe(
      'WannaCry breaks into Windows machines missing the March 2017 MS17-010 patch, using a leaked exploit (EternalBlue) against file sharing (SMBv1).',
    )
  })
})
