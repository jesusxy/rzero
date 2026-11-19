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
import { narrate, type Narration } from '../../src/app/narration'
import { fill, reasonTemplate } from '../../src/app/narration/narrate'
import { REASONS, REASON_VARIANTS } from '../../src/app/narration/templates'
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
      capability: 'Cap',
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
      'LAB-WS-A starts compromised',
      'LAB-WS-B compromised',
      'Blocked at LAB-WS-C',
      'LAB-SRV-D compromised',
      'Blocked at LAB-SRV-E',
      '3 of 5 hosts compromised',
    ])
    expect(ac!.body).toContain("network doesn't allow smb traffic from LAB-WS-A to LAB-WS-C") // NETWORK_ACCESS
    expect(de!.body).toContain("LAB-SRV-E doesn't have the LAB-SMB-1 weakness") // VULNERABILITY_PRESENT
    expect(ab!.body).toContain('Synthetic SMB exploit') // capability label
    for (const n of [ab, ac, bd, de]) expect(n!.why).toBe('Enabled SMB plus LAB-SMB-1 permits modeled compromise.')
    expect(seed!.why).toBeUndefined()
    expect(summary!.why).toBeUndefined()
    expect(summary!.body).toContain('3 of 5 hosts are compromised, a 60% blast radius')
    expect(summary!.body).toContain('LAB-WS-C and LAB-SRV-E were never compromised')
  })

  test('the primary reason is the first failure, kept alongside an unknown', () => {
    const blocked = lab('005 denied', lab005DeniedUnknown).narrations[1]!
    expect(blocked.title).toBe('Blocked at LAB-B')
    const network = blocked.body.indexOf("network doesn't allow")
    const vulnerability = blocked.body.indexOf("we don't know whether LAB-B has the LAB-SMB-1 weakness")
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
    expect(n.body).toContain('protects LAB-B from every route')
    expect(n.body).not.toContain('another route could still reach it')
  })

  test('alternatives and earlier blocks are explained (004, 007)', () => {
    expect(lab('004', ALL_LABS['004 alternate route']!).narrations[3]!.body).toMatch(/^An earlier attempt on LAB-C didn't get through/)
    const multi = lab('007', ALL_LABS['007 multiple mechanisms']!).narrations
    expect(multi[2]!.body).toMatch(/^That didn't work, so LAB-A tries its next option on LAB-B: the Synthetic WinRM execution/)
    expect(multi[2]!.body).toContain("LAB-A's credential cred-a gives admin access")
  })
})

describe('narrate — interventions', () => {
  test('002 modified run names the segmentation rule on the attempt it decided', () => {
    const s = story('002', fixture('002-counterfactual-segmentation.json'))
    const byPair = (source: string, target: string) => s.narrations[s.steps.findIndex((st) => st.source_id === source && st.target_id === target)]!
    expect(byPair('B', 'D').title).toBe('Blocked at LAB-SRV-D')
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
    expect(seed!.preview).toBe('LAB-WS-A starts compromised')
    expect(summary!.preview).toBe('Results')
  })

  test('no narration mentions seconds or time', () => {
    for (const s of everything) {
      for (const n of s.narrations) expect(n.body).not.toMatch(/\bseconds?\b|\bminutes?\b|\bhours?\b|\btime\b|\bms\b/i)
    }
  })

  test('summary: critical hosts reached, spared, and indeterminate targets', () => {
    const reached = lab('critical reached', { assets: { A: {}, B: { critical: true } }, links: [{ id: 'ab', source: 'A', target: 'B' }] })
    expect(reached.narrations.at(-1)!.body).toContain('Critical hosts reached: LAB-B.')
    const spared = lab('critical spared', {
      assets: { A: {}, B: { critical: true } },
      links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }],
    })
    expect(spared.narrations.at(-1)!.body).toContain('None of the critical hosts (LAB-B) was reached.')
    expect(lab('005', lab005UnknownVulnerability).narrations.at(-1)!.body).toContain(
      "We couldn't tell what would happen at LAB-B: count it as unknown, not as safe.",
    )
  })

  test('an aborted run is narrated as partial, with its reason', () => {
    const capped = everything.find((s) => s.name === '001 capped at 8')!
    const last = capped.narrations.at(-1)!
    expect(capped.steps.at(-1)!.kind).toBe('aborted')
    expect(last.title).toBe('The run stopped early')
    expect(last.body).toContain('hit the limit on how many events one run may record')
    expect(last.body).toContain('It had just picked LAB-WS-C as a target')
    expect(last.body).toContain('2 of 5 hosts were compromised before it stopped')
  })
})
