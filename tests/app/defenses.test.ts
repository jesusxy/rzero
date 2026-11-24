import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { groupSteps, importScenario, runScenario, type PropagationResolvedEvent, type RunResult } from '../../src/core'
import {
  bestAlternative,
  defenseChanges,
  defenseMarks,
  originalAttempt,
  parseDefenses,
  runDefense,
  type DefenseOption,
} from '../../src/app/defenses'
import { narrate, originalRunNote, resultsText } from '../../src/app/narration'
import { expectCompiled, fixtureText } from '../core/helpers'
import { primaryReason } from '../core/engine-helpers'

const SCENARIOS_DIR = join(import.meta.dir, '../../fixtures/scenarios')
const compile = (file: string) => expectCompiled(importScenario(fixtureText(file), { fileName: file }))

const base = compile('wannacry-small-office.json')
const baseRun = runScenario(base)
const options = parseDefenses(fixtureText('wannacry-small-office.defenses.json')).options
const option = (id: string) => options.find((entry) => entry.id === id)!

function defend(id: string) {
  const result = runDefense(base, baseRun, option(id))
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.value
}

const resolved = (run: RunResult) =>
  new Map(
    run.events
      .filter((event): event is PropagationResolvedEvent => event.type === 'propagation_resolved')
      .map((event) => [`${event.source_id}-${event.target_id}`, event]),
  )
const attemptedTargets = (run: RunResult) =>
  new Set(run.events.flatMap((event) => (event.type === 'propagation_attempted' ? [event.target_id] : [])))
const radius = (value: number) => Number((value * 100).toFixed(1))

describe('defenses files', () => {
  const files = readdirSync(SCENARIOS_DIR).filter((file) => file.endsWith('.defenses.json'))

  test('there is at least one, and each sits next to its scenario', () => {
    expect(files).toContain('wannacry-small-office.defenses.json')
    for (const file of files) expect(readdirSync(SCENARIOS_DIR)).toContain(file.replace('.defenses.json', '.json'))
  })

  test.each(files)('%s: well formed, and every option compiles with its scenario and changes something', (file) => {
    const parsed = parseDefenses(fixtureText(file))
    expect(parsed.problems).toEqual([])
    expect(parsed.options.length).toBeGreaterThan(0)
    const scenario = compile(file.replace('.defenses.json', '.json'))
    const scenarioRun = runScenario(scenario)
    for (const entry of parsed.options) {
      const result = runDefense(scenario, scenarioRun, entry)
      if (!result.ok) throw new Error(`${entry.id}: ${JSON.stringify(result.diagnostics)}`)
      for (const intervention of entry.interventions) {
        const record = result.value.compiled.manifest.find((r) => r.intervention_id === intervention.id)
        expect(record?.noop).toBe(false)
      }
    }
  })

  test('the WannaCry office offers the three curated options', () => {
    expect(options.map((entry) => [entry.label, entry.kind])).toEqual([
      ['Block SMB from Office to Servers', 'segmentation'],
      ['Patch FS-01', 'patch'],
      ['Patch WS-02', 'patch'],
    ])
  })

  test('malformed entries are reported, not applied', () => {
    const parsed = parseDefenses(
      JSON.stringify([
        { id: 'a', label: 'A', description: 'd', kind: 'wall', interventions: [] },
        { id: 'a', label: 'A', description: 'd', kind: 'patch', interventions: [{ type: 'x', id: 'y' }], extra: 1 },
      ]),
    )
    expect(parsed.options).toEqual([])
    expect(parsed.problems).toEqual([
      '[0].kind: expected segmentation, patch or link',
      '[0].interventions: expected a non-empty array',
      '[1]: unexpected field extra',
      '[1].id: "a" is used twice',
    ])
    expect(parseDefenses('{').problems.length).toBe(1)
  })
})

describe('WannaCry office: each defense against the original run', () => {
  test('Block SMB from Office to Servers', () => {
    const result = defend('block-office-servers-smb')
    expect([...result.run.state.compromised].sort()).toEqual(['ws01', 'ws02'])
    const outcomes = resolved(result.run)
    for (const link of ['ws02-fs01', 'ws02-dc01']) {
      expect(outcomes.get(link)!.outcome).toBe('blocked')
      expect(primaryReason(outcomes.get(link)!)).toBe('NETWORK_ACCESS')
    }
    expect(defenseChanges(baseRun, result).saved).toEqual(['fs01'])
    expect(radius(result.metrics.baseline_blast_radius)).toBe(42.9)
    expect(radius(result.metrics.modified_blast_radius)).toBe(28.6)
  })

  test('Patch FS-01', () => {
    const result = defend('patch-fs01')
    expect([...result.run.state.compromised].sort()).toEqual(['ws01', 'ws02'])
    const fs01 = resolved(result.run).get('ws02-fs01')!
    expect([fs01.outcome, primaryReason(fs01)]).toEqual(['blocked', 'VULNERABILITY_PRESENT'])
    expect(defenseChanges(baseRun, result).saved).toEqual(['fs01'])
    expect(radius(result.metrics.baseline_blast_radius)).toBe(42.9)
    expect(radius(result.metrics.modified_blast_radius)).toBe(28.6)
  })

  test('Patch WS-02', () => {
    const result = defend('patch-ws02')
    expect([...result.run.state.compromised]).toEqual(['ws01'])
    const ws02 = resolved(result.run).get('ws01-ws02')!
    expect([ws02.outcome, primaryReason(ws02)]).toEqual(['blocked', 'VULNERABILITY_PRESENT'])
    for (const host of ['fs01', 'dc01', 'nas01']) expect(attemptedTargets(result.run).has(host)).toBe(false)
    expect([...defenseChanges(baseRun, result).saved].sort()).toEqual(['fs01', 'ws02'])
    expect(radius(result.metrics.baseline_blast_radius)).toBe(42.9)
    expect(radius(result.metrics.modified_blast_radius)).toBe(14.3)
  })
})

describe('narrating a defended run', () => {
  const labels = (entry: DefenseOption) => new Map(entry.interventions.map((i) => [i.id, entry.label]))
  const narrated = (id: string) => {
    const result = defend(id)
    const steps = groupSteps(result.run.events)
    return { result, steps, narrations: steps.map((s) => narrate(s, result.run.events, result.compiled, { defenseLabels: labels(option(id)) })) }
  }

  test('step 6 with the segmentation defense: ws02 → fs01, with the "in the original run" box', () => {
    const { result, steps } = narrated('block-office-servers-smb')
    const step = steps[5]!
    const event = result.run.events.find(
      (e): e is PropagationResolvedEvent => e.type === 'propagation_resolved' && e.attempt_id === step.attempt_id,
    )!
    expect([event.source_id, event.target_id]).toEqual(['ws02', 'fs01'])
    const original = originalAttempt(baseRun, event)
    expect(original?.outcome).toBe('succeeded')
    expect(originalRunNote(result.compiled, event, event.outcome, original)).toBe(
      'This is where FS-01, a critical host, was compromised. Your defense changed this step.',
    )
  })

  test('steps that ended the same way in the original run get no box', () => {
    const { result, steps } = narrated('block-office-servers-smb')
    const notes = steps.flatMap((step) => {
      const event = result.run.events.find(
        (e): e is PropagationResolvedEvent => e.type === 'propagation_resolved' && e.attempt_id === step.attempt_id,
      )
      if (event === undefined) return []
      return [[`${event.source_id}-${event.target_id}`, originalRunNote(result.compiled, event, event.outcome, originalAttempt(baseRun, event))]]
    })
    expect(notes.filter(([, note]) => note !== null).map(([link]) => link)).toEqual(['ws02-fs01'])
  })

  test('a check that fails because of the defense names the defense by its label', () => {
    for (const [id, target, label] of [
      ['block-office-servers-smb', 'FS-01', 'Block SMB from Office to Servers'],
      ['patch-fs01', 'FS-01', 'Patch FS-01'],
    ] as const) {
      const { narrations } = narrated(id)
      const step = narrations.find((n) => n.title === `Blocked by your defense at ${target}`)!
      expect(step.subtitle).toBe('Stopped by your defense')
      expect(step.parts!.stop!.sentences).toContain(`Blocked by your defense: ${label}.`)
      expect(step.body).not.toContain(option(id).interventions[0]!.id)
    }
    const plain = narrate(groupSteps(defend('patch-fs01').run.events)[4]!, defend('patch-fs01').run.events, defend('patch-fs01').compiled)
    expect(plain.body).not.toContain('your defense')
  })
})

describe('the results step with a defense', () => {
  test('what changed, for each option', () => {
    const rows = (id: string) => {
      const result = defend(id)
      const text = resultsText(result, defenseChanges(baseRun, result), bestAlternative(base, baseRun, options, id))
      return { ...text, rows: Object.fromEntries(text.rows.map((row) => [row.label, row.value])) }
    }
    expect(rows('block-office-servers-smb')).toEqual({
      title: 'Your defense saved FS-01',
      body: 'Compared with the original run, 2 of 7 hosts are compromised instead of 3, and no critical host is reached.',
      rows: {
        Saved: 'FS-01 (critical)',
        'Stopped by your defense': 'WS-02 → DC-01, WS-02 → FS-01',
        'Still lost': 'WS-01, WS-02',
        Unchanged: 'WS-03 not vulnerable; WS-04 (XP) unknown',
      },
      suggestion: 'Patch WS-02 would save WS-02 and FS-01. Try it from the defense card.',
    })
    expect(rows('patch-fs01').rows).toEqual({
      Saved: 'FS-01 (critical)',
      'Stopped by your defense': 'WS-02 → FS-01',
      'Still lost': 'WS-01, WS-02',
      Unchanged: 'DC-01 not vulnerable; WS-03 not vulnerable; WS-04 (XP) unknown',
    })
    expect(rows('patch-ws02')).toMatchObject({
      title: 'Your defense saved WS-02 and FS-01',
      body: 'Compared with the original run, 1 of 7 hosts is compromised instead of 3, and no critical host is reached.',
      rows: { Saved: 'WS-02, FS-01 (critical)', 'Stopped by your defense': 'WS-01 → WS-02', 'Still lost': 'WS-01' },
    })
  })

  test('map marks: the protected district for segmentation, the patched host for a patch', () => {
    const segmentation = defenseMarks(defend('block-office-servers-smb'))
    expect([...segmentation.protectedSegments]).toEqual(['servers'])
    expect(segmentation.patchedHosts.size + segmentation.lockedLinks.size).toBe(0)
    expect([...defenseMarks(defend('patch-fs01')).patchedHosts]).toEqual(['fs01'])
  })
})
