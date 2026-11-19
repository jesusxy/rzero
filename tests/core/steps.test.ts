import { describe, expect, test } from 'bun:test'
import {
  groupSteps,
  importScenario,
  replayFinalState,
  runScenario,
  seekReplay,
  type SimulationEvent,
  type Step,
} from '../../src/core'
import { expectCompiled, fixtureText } from './helpers'
import { runLab } from './engine-helpers'
import {
  ALL_LABS,
  lab003Cycle,
  lab004AlternateRoute,
  lab007MultipleMechanisms,
  lab007SameService,
  lab008Converging,
} from './canonical-labs'

// Expected steps are hand-authored from docs/validation-scenarios.md: ranges are
// [start, end) over the documented semantic event order, never derived by
// calling groupSteps.

const seed = (index: number, end: number, skipped: string[] = []): Step => ({
  index,
  start: 0,
  end,
  kind: 'seed',
  skipped_link_ids: skipped,
})

const attempt = (
  index: number,
  [start, end]: [number, number],
  attempt_id: string,
  source_id: string,
  target_id: string,
  outcome: Step['outcome'],
  skipped: string[] = [],
): Step => ({ index, start, end, kind: 'attempt', attempt_id, source_id, target_id, outcome, skipped_link_ids: skipped })

const terminal = (index: number, kind: 'summary' | 'aborted', [start, end]: [number, number], skipped: string[] = []): Step => ({
  index,
  start,
  end,
  kind,
  skipped_link_ids: skipped,
})

const fixtureEvents = (name: string) => runScenario(expectCompiled(importScenario(fixtureText(name)))).events

/**
 * The partition invariant, checked against the raw events rather than against
 * groupSteps' own logic: contiguous, gap-free, non-empty, ordered ranges from 0
 * to events.length, and each step's events match its kind.
 */
function assertPartition(steps: readonly Step[], events: readonly SimulationEvent[]): void {
  expect(steps.length).toBeGreaterThan(0)
  expect(steps[0]!.start).toBe(0)
  expect(steps.at(-1)!.end).toBe(events.length)
  steps.forEach((step, k) => {
    expect(step.index).toBe(k)
    expect(step.end).toBeGreaterThan(step.start)
    if (k > 0) expect(step.start).toBe(steps[k - 1]!.end)

    const slice = events.slice(step.start, step.end)
    const attempted = slice.filter((event) => event.type === 'propagation_attempted')
    expect(slice.filter((event) => event.type === 'propagation_skipped').map((event) => event.type === 'propagation_skipped' && event.link_id)).toEqual(
      [...step.skipped_link_ids],
    )
    if (step.kind === 'attempt') {
      expect(attempted).toHaveLength(1)
      expect(attempted[0]).toMatchObject({ attempt_id: step.attempt_id, source_id: step.source_id, target_id: step.target_id })
      const resolved = slice.find((event) => event.type === 'propagation_resolved')
      expect(resolved).toMatchObject({ attempt_id: step.attempt_id, outcome: step.outcome })
      // A success carries its compromise in the same step.
      if (step.outcome === 'succeeded') {
        expect(slice.at(-1)).toMatchObject({ type: 'asset_compromised', asset_id: step.target_id, attempt_id: step.attempt_id })
      }
    } else {
      expect(attempted).toHaveLength(0)
    }
    if (step.kind === 'seed') expect(slice[0]!.type).toBe('run_started')
    if (step.kind === 'summary') expect(slice.at(-1)!.type).toBe('run_completed')
    if (step.kind === 'aborted') expect(slice.at(-1)!.type).toBe('run_aborted')
  })
}

describe('groupSteps — canonical scenarios', () => {
  test('001 five-node baseline: seed, four attempts, summary', () => {
    const events = fixtureEvents('001-five-node-baseline.json')
    expect(groupSteps(events)).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      attempt(2, [6, 9], 'a000002', 'A', 'C', 'blocked'),
      attempt(3, [9, 13], 'a000003', 'B', 'D', 'succeeded'),
      attempt(4, [13, 16], 'a000004', 'D', 'E', 'blocked'),
      terminal(5, 'summary', [16, 17]),
    ])
  })

  test('001 YAML fixture groups identically to the JSON fixture', () => {
    expect(groupSteps(fixtureEvents('001-five-node-baseline.yaml'))).toEqual(
      groupSteps(fixtureEvents('001-five-node-baseline.json')),
    )
  })

  test('002 modified run: B → D is blocked and E is never considered', () => {
    expect(groupSteps(fixtureEvents('002-counterfactual-segmentation.json'))).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      attempt(2, [6, 9], 'a000002', 'A', 'C', 'blocked'),
      attempt(3, [9, 12], 'a000003', 'B', 'D', 'blocked'),
      terminal(4, 'summary', [12, 13]),
    ])
  })

  test('003 cycle: the skipped C → A link folds into the summary', () => {
    expect(groupSteps(runLab(lab003Cycle).events)).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      attempt(2, [6, 10], 'a000002', 'B', 'C', 'succeeded'),
      terminal(3, 'summary', [10, 12], ['ca']),
    ])
  })

  test('004 alternate route: B → C has no discovery (C was discovered by A → C)', () => {
    expect(groupSteps(runLab(lab004AlternateRoute).events)).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      attempt(2, [6, 9], 'a000002', 'A', 'C', 'blocked'),
      attempt(3, [9, 12], 'a000003', 'B', 'C', 'succeeded'),
      terminal(4, 'summary', [12, 13]),
    ])
  })

  test('007 multiple mechanisms: each attempt is its own step; the discovery belongs to the first', () => {
    const expected = [
      seed(0, 2),
      attempt(1, [2, 5], 'a000001', 'A', 'B', 'blocked'),
      attempt(2, [5, 8], 'a000002', 'A', 'B', 'succeeded'),
      terminal(3, 'summary', [8, 9]),
    ]
    expect(groupSteps(runLab(lab007MultipleMechanisms).events)).toEqual(expected)
    // Same-service alternatives on one link group the same way.
    expect(groupSteps(runLab(lab007SameService).events)).toEqual(expected)
  })

  test('008 converging routes: the skipped C → D link folds into the summary', () => {
    expect(groupSteps(runLab(lab008Converging).events)).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      attempt(2, [6, 10], 'a000002', 'A', 'C', 'succeeded'),
      attempt(3, [10, 14], 'a000003', 'B', 'D', 'succeeded'),
      terminal(4, 'summary', [14, 16], ['cd']),
    ])
  })
})

describe('groupSteps — aborted runs', () => {
  const fiveNode = () => expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))

  test('an event cap of 8: discovery of C is emitted, then the A → C group cannot fit', () => {
    // 0 run_started, 1 seed, 2–5 A→B group, 6 discovered C, 7 run_aborted.
    expect(groupSteps(runScenario(fiveNode(), { maxEvents: 8 }).events)).toEqual([
      seed(0, 2),
      attempt(1, [2, 6], 'a000001', 'A', 'B', 'succeeded'),
      terminal(2, 'aborted', [6, 8]),
    ])
  })

  test('cancellation before any movement: seed then aborted', () => {
    expect(groupSteps(runScenario(fiveNode(), { shouldCancel: () => true }).events)).toEqual([
      seed(0, 2),
      terminal(1, 'aborted', [2, 3]),
    ])
  })

  test('a cap too small for the seed compromise still partitions', () => {
    expect(groupSteps(runScenario(fiveNode(), { maxEvents: 2 }).events)).toEqual([seed(0, 1), terminal(1, 'aborted', [1, 2])])
  })
})

describe('groupSteps — invariants', () => {
  const streams: [string, readonly SimulationEvent[]][] = [
    ['001 JSON', fixtureEvents('001-five-node-baseline.json')],
    ['001 YAML', fixtureEvents('001-five-node-baseline.yaml')],
    ['002', fixtureEvents('002-counterfactual-segmentation.json')],
    ...Object.entries(ALL_LABS).map(([name, spec]): [string, readonly SimulationEvent[]] => [name, runLab(spec).events]),
    ...[2, 3, 5, 6, 8, 12, 16].map((maxEvents): [string, readonly SimulationEvent[]] => [
      `001 capped at ${maxEvents}`,
      runScenario(expectCompiled(importScenario(fixtureText('001-five-node-baseline.json'))), { maxEvents }).events,
    ]),
  ]

  test.each(streams)('%s: steps partition the event list exactly', (_name, events) => {
    assertPartition(groupSteps(events), events)
  })

  test.each(streams)('%s: seeking to the last step end equals the final replay state', (_name, events) => {
    const steps = groupSteps(events)
    expect(seekReplay(events, steps.at(-1)!.end)).toEqual(replayFinalState(events))
  })

  test.each(streams)('%s: an attempt step shows its own resolution and nothing earlier does', (_name, events) => {
    for (const step of groupSteps(events)) {
      if (step.kind !== 'attempt') continue
      expect(seekReplay(events, step.start).attempts[step.attempt_id!]).toBeUndefined()
      expect(seekReplay(events, step.end).attempts[step.attempt_id!]?.status).toBe(step.outcome!)
    }
  })

  test('steps are frozen values', () => {
    const steps = groupSteps(fixtureEvents('001-five-node-baseline.json'))
    expect(Object.isFrozen(steps)).toBe(true)
    expect(Object.isFrozen(steps[0])).toBe(true)
    expect(Object.isFrozen(steps[0]!.skipped_link_ids)).toBe(true)
  })

  test('an empty stream has no steps', () => {
    expect(groupSteps([])).toEqual([])
  })

  test('a truncated prefix (no terminal event) still partitions', () => {
    const events = fixtureEvents('001-five-node-baseline.json')
    for (let length = 1; length <= events.length; length += 1) {
      const prefix = events.slice(0, length)
      const steps = groupSteps(prefix)
      expect(steps[0]!.start).toBe(0)
      expect(steps.at(-1)!.end).toBe(length)
      steps.forEach((step, k) => k > 0 && expect(step.start).toBe(steps[k - 1]!.end))
    }
  })
})
