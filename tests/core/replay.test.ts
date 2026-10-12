import { describe, expect, test } from 'bun:test'
import {
  importScenario,
  initialReplayState,
  replayFinalState,
  runScenario,
  seekReplay,
  stepBackReplay,
  stepReplay,
  type RunResult,
  type SimulationEvent,
} from '../../src/core'
import { expectCompiled, fixtureText } from './helpers'
import { compileLab } from './engine-helpers'

function fiveNodeRun(): RunResult {
  return runScenario(expectCompiled(importScenario(fixtureText('001-five-node-baseline.json'))))
}

/** Index after the first resolved event matching the predicate. */
function cursorAfter(events: readonly SimulationEvent[], match: (event: SimulationEvent) => boolean): number {
  return events.findIndex(match) + 1
}

describe('replay reducer — reconstructing final state', () => {
  const run = fiveNodeRun()

  test('replaying the whole stream reproduces the engine final state', () => {
    const final = replayFinalState(run.events)
    expect(final.cursor).toBe(run.events.length)
    expect(final.terminal).toBe('completed')
    expect([...final.compromised].sort()).toEqual([...run.state.compromised].sort())
    expect([...final.discovered].sort()).toEqual([...run.state.discovered].sort())
    expect(final.hops).toEqual(run.state.hops)
  })

  test('replayed parents match the engine parent records', () => {
    const final = replayFinalState(run.events)
    for (const parent of run.state.parents) {
      expect(final.parents[parent.asset_id]).toMatchObject({
        parent_id: parent.parent_id,
        link_id: parent.link_id,
        capability_id: parent.capability_id,
        attempt_id: parent.attempt_id,
        hop: parent.hop,
      })
    }
  })
})

describe('replay reducer — cursor semantics', () => {
  const run = fiveNodeRun()

  test('cursor 0 is the empty pre-run state; events.length is final', () => {
    const start = seekReplay(run.events, 0)
    expect(start).toEqual(initialReplayState())
    expect(seekReplay(run.events, run.events.length).compromised).toEqual(['A', 'B', 'D'])
  })

  test('cursor clamps outside [0, length]', () => {
    expect(seekReplay(run.events, -5).cursor).toBe(0)
    expect(seekReplay(run.events, 999).cursor).toBe(run.events.length)
  })

  test('stepping forward N times equals seeking to N', () => {
    let state = initialReplayState()
    for (let n = 0; n <= run.events.length; n += 1) {
      expect(state).toEqual(seekReplay(run.events, n))
      state = stepReplay(run.events, state)
    }
    // stepping past the end is a no-op
    expect(stepReplay(run.events, state)).toBe(state)
  })

  test('seek is a pure fold: it does not mutate the event array', () => {
    const snapshot = JSON.stringify(run.events)
    seekReplay(run.events, 10)
    expect(JSON.stringify(run.events)).toBe(snapshot)
  })
})

describe('replay reducer — backward and forward reach the same state (010)', () => {
  const run = fiveNodeRun()

  test('seek to end, step back to the middle, step forward to end → identical', () => {
    const end = replayFinalState(run.events)
    let middle = end
    for (let i = 0; i < 6; i += 1) middle = stepBackReplay(run.events, middle)
    expect(middle).toEqual(seekReplay(run.events, run.events.length - 6))
    let forward = middle
    while (forward.cursor < run.events.length) forward = stepReplay(run.events, forward)
    expect(forward).toEqual(end)
  })

  test('stepping all the way back reaches the initial state; stepping past the start is a no-op', () => {
    let state = replayFinalState(run.events)
    while (state.cursor > 0) state = stepBackReplay(run.events, state)
    expect(state).toEqual(initialReplayState())
    expect(stepBackReplay(run.events, state)).toEqual(initialReplayState())
  })
})

describe('replay reducer — blocked attempts never create a permanent blocked host', () => {
  // Scenario 004: A→B, A→C (deny), B→C (allow). C is blocked from A, then compromised from B.
  const run = runScenario(
    compileLab({
      assets: { A: {}, B: {}, C: {} },
      links: [
        { id: 'ab', source: 'A', target: 'B' },
        { id: 'ac', source: 'A', target: 'C', access: 'deny' },
        { id: 'bc', source: 'B', target: 'C' },
      ],
    }),
  )

  test('C is discovered but not compromised at the block, yet compromised at the end', () => {
    const afterBlock = seekReplay(
      run.events,
      cursorAfter(run.events, (e) => e.type === 'propagation_resolved' && e.target_id === 'C' && e.outcome === 'blocked'),
    )
    expect(afterBlock.discovered).toContain('C')
    expect(afterBlock.compromised).not.toContain('C')
    // the blocked attempt is recorded in the ledger, not as a host flag
    const blockedAttempt = Object.values(afterBlock.attempts).find((a) => a.target_id === 'C' && a.status === 'blocked')
    expect(blockedAttempt).toBeDefined()

    expect(replayFinalState(run.events).compromised).toContain('C')
  })

  test('the compromised set is monotonic across every forward step', () => {
    let state = initialReplayState()
    let previous = 0
    while (state.cursor < run.events.length) {
      state = stepReplay(run.events, state)
      expect(state.compromised.length).toBeGreaterThanOrEqual(previous)
      previous = state.compromised.length
    }
  })
})

describe('replay reducer — attempt ledger and inert events', () => {
  const run = fiveNodeRun()

  test('an attempt is pending between its attempted and resolved events', () => {
    const attemptedIndex = run.events.findIndex((e) => e.type === 'propagation_attempted')
    const afterAttempted = seekReplay(run.events, attemptedIndex + 1)
    const attemptId = 'a000001'
    expect(afterAttempted.attempts[attemptId]!.status).toBe('pending')
    const afterResolved = seekReplay(run.events, attemptedIndex + 2)
    expect(afterResolved.attempts[attemptId]!.status).toBe('succeeded')
    expect(afterResolved.attempts[attemptId]!.checks.length).toBeGreaterThan(0)
  })

  test('run_started and a skipped link do not change discovery or compromise', () => {
    // Scenario 008 has a skipped C→D link.
    const skipRun = runScenario(
      compileLab({
        assets: { A: {}, B: {}, C: {}, D: {} },
        links: [
          { id: 'ab', source: 'A', target: 'B' },
          { id: 'ac', source: 'A', target: 'C' },
          { id: 'bd', source: 'B', target: 'D' },
          { id: 'cd', source: 'C', target: 'D' },
        ],
      }),
    )
    const skipIndex = skipRun.events.findIndex((e) => e.type === 'propagation_skipped')
    expect(skipIndex).toBeGreaterThan(-1)
    const before = seekReplay(skipRun.events, skipIndex)
    const after = seekReplay(skipRun.events, skipIndex + 1)
    expect(after.compromised).toEqual(before.compromised)
    expect(after.discovered).toEqual(before.discovered)
    expect(after.cursor).toBe(before.cursor + 1)
  })

  test('applying the same events twice yields equal states (deterministic, pure)', () => {
    expect(replayFinalState(run.events)).toEqual(replayFinalState(run.events))
  })
})

describe('replay reducer — aborted streams', () => {
  test('replaying an aborted stream rebuilds its partial state and marks terminal aborted', () => {
    const compiled = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
    const run = runScenario(compiled, { maxEvents: 8 })
    const final = replayFinalState(run.events)
    expect(final.terminal).toBe('aborted')
    expect([...final.compromised].sort()).toEqual([...run.state.compromised].sort())
  })
})
