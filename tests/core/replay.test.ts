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
import { compileLab, type AssetOverride, type LinkSpec } from './engine-helpers'

/**
 * A run whose stream exceeds the 1000-event checkpoint interval, so seeks start
 * from a non-zero checkpoint. Chain nodes C0→C1→… are compromised (present
 * vulnerability); each also fans out to sinks with an absent vulnerability, so
 * every fan link is a full four-capability blocked attempt that is never
 * skipped. ~1250 events with chain=5, sinks=30.
 */
function denseCompiled(chain = 5, sinks = 30) {
  const fourCapProfile = {
    id: 'lab-four',
    version: '1',
    name: 'Four-capability lab worm',
    scope: 'synthetic',
    review_status: 'reviewed',
    sources: [
      {
        id: 'lab-def',
        kind: 'synthetic',
        title: 'Canonical lab rule',
        local_reference: 'docs/validation-scenarios.md',
        accessed_on: '2026-10-12',
        claim_summary: 'Synthetic.',
      },
    ],
    capabilities: [1, 2, 3, 4].map((n) => ({
      id: `cap-${n}`,
      label: `Synthetic SMB exploit ${n}`,
      mechanism: 'remote_exploit',
      service_id: 'smb',
      target_platforms: ['windows'],
      vulnerability_id: 'LAB-SMB-1',
      evidence_ids: ['lab-def'],
      confidence: 'high',
      assumptions: ['Synthetic.'],
    })),
    limitations: ['Synthetic benchmark profile.'],
  }
  const assets: Record<string, AssetOverride> = {}
  for (let i = 0; i < chain; i += 1) assets[`C${i}`] = {}
  for (let i = 0; i < sinks; i += 1) assets[`S${i}`] = { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'absent' }] }
  const links: LinkSpec[] = []
  for (let i = 0; i < chain - 1; i += 1) links.push({ id: `ch-${i}`, source: `C${i}`, target: `C${i + 1}` })
  for (let c = 0; c < chain; c += 1) {
    for (let s = 0; s < sinks; s += 1) links.push({ id: `fan-${c}-${s}`, source: `C${c}`, target: `S${s}` })
  }
  return compileLab({ assets, links, profile: fourCapProfile, seed: 'C0' })
}

function denseRun(chain = 5, sinks = 30): RunResult {
  return runScenario(denseCompiled(chain, sinks))
}

/** Independent reference fold from event 0 via single steps (no checkpoint cache). */
function foldTo(events: readonly SimulationEvent[], n: number) {
  let state = initialReplayState()
  for (let i = 0; i < n; i += 1) state = stepReplay(events, state)
  return state
}

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

describe('replay reducer — checkpointed seeking over a long stream (>1000 events)', () => {
  const run = denseRun()

  test('the stream crosses the checkpoint interval and only the chain is compromised', () => {
    expect(run.events.length).toBeGreaterThan(1000)
    expect(run.status).toBe('completed')
    // Sinks have an absent vulnerability: many blocked attempts, never compromised.
    expect(run.state.compromised).toEqual(['C0', 'C1', 'C2', 'C3', 'C4'])
    const blocked = run.events.filter((e) => e.type === 'propagation_resolved' && e.outcome === 'blocked')
    expect(blocked.length).toBeGreaterThan(100)
  })

  test('forward step, seek, backward step and final replay all agree with a from-zero fold', () => {
    const cursors = [0, 1, 500, 999, 1000, 1001, 1200, run.events.length - 1, run.events.length]
    for (const n of cursors) {
      const reference = foldTo(run.events, n) // independent, no checkpoints
      expect(seekReplay(run.events, n)).toEqual(reference)
    }
    // final replay matches the engine's recorded final state
    const final = replayFinalState(run.events)
    expect([...final.compromised].sort()).toEqual([...run.state.compromised].sort())
    expect(final.hops).toEqual(run.state.hops)
    // a backward step from a cursor past the checkpoint equals the from-zero fold
    const past = seekReplay(run.events, 1200)
    expect(stepBackReplay(run.events, past)).toEqual(foldTo(run.events, 1199))
  })

  test('blocked attempts are recorded in the ledger but never compromise their target', () => {
    const final = replayFinalState(run.events)
    const blockedEntry = Object.values(final.attempts).find((a) => a.status === 'blocked')
    expect(blockedEntry).toBeDefined()
    expect(final.compromised).not.toContain(blockedEntry!.target_id)
  })

  test('an earlier returned state does not change when replay advances', () => {
    const early = seekReplay(run.events, 300)
    const fingerprint = JSON.stringify(early)
    expect(Object.isFrozen(early)).toBe(true)
    expect(Object.isFrozen(early.attempts)).toBe(true)
    // advance replay elsewhere
    seekReplay(run.events, 1200)
    stepReplay(run.events, early)
    replayFinalState(run.events)
    stepBackReplay(run.events, early)
    expect(JSON.stringify(early)).toBe(fingerprint)
  })

  test('an aborted long run replays to its partial state via checkpoints', () => {
    // Re-run the same dense scenario with a tight cap to force an abort mid-stream.
    const capped = runScenario(denseCompiled(), { maxEvents: 1200 })
    expect(capped.status).toBe('aborted')
    const final = replayFinalState(capped.events)
    expect(final.terminal).toBe('aborted')
    expect(final).toEqual(foldTo(capped.events, capped.events.length))
  })
})

describe('replay reducer — ownership of copied (mutable) event streams', () => {
  // JSON round-trip yields a fully mutable stream, like a worker/structured-clone
  // or reload boundary. The engine's own output is deep-frozen; these exercise
  // the non-frozen path.
  const copiedFiveNode = (): SimulationEvent[] => JSON.parse(JSON.stringify(fiveNodeRun().events))

  test('mutating an input check (and its nested arrays) after replay never changes a returned snapshot', () => {
    const copied = copiedFiveNode()
    const snapshot = replayFinalState(copied)
    const resolved = copied.find(
      (e): e is Extract<SimulationEvent, { type: 'propagation_resolved' }> =>
        e.type === 'propagation_resolved' && e.checks.some((c) => c.entity_refs.length > 0),
    )!
    const attempt = Object.values(snapshot.attempts).find((a) => a.attempt_id === resolved.attempt_id)!
    const fingerprint = JSON.stringify(attempt.checks)

    // Tamper with the caller-owned input: a check field and a nested reference array.
    ;(resolved.checks[0] as { observed: string }).observed = 'TAMPERED'
    ;(resolved.checks[0]!.entity_refs as string[]).push('TAMPERED')
    ;(resolved.checks as unknown as unknown[]).push({
      code: 'NETWORK_ACCESS',
      status: 'fail',
      expected: 'x',
      observed: 'y',
      entity_refs: ['z'],
    })

    const after = Object.values(replayFinalState(copied).attempts).find((a) => a.attempt_id === resolved.attempt_id)!
    expect(JSON.stringify(attempt.checks)).toBe(fingerprint) // earlier snapshot unchanged
    expect(JSON.stringify(after.checks)).toBe(fingerprint) // reducer took ownership before the mutation
  })

  test('the reducer does not mutate the caller-owned array or its events', () => {
    const copied = copiedFiveNode()
    expect(Object.isFrozen(copied)).toBe(false)
    replayFinalState(copied)
    seekReplay(copied, 3)
    expect(Object.isFrozen(copied)).toBe(false) // still the caller's mutable array
    expect(Object.isFrozen(copied[0])).toBe(false)
  })

  test('copied events still reproduce the engine final state', () => {
    const run = fiveNodeRun()
    const copied: SimulationEvent[] = JSON.parse(JSON.stringify(run.events))
    expect([...replayFinalState(copied).compromised].sort()).toEqual([...run.state.compromised].sort())
  })

  test('on a >1000-event copied stream, mutating an early event after caching never desyncs seek from stepping', () => {
    const copied: SimulationEvent[] = JSON.parse(JSON.stringify(denseRun().events))
    expect(copied.length).toBeGreaterThan(1000)

    // First touch builds the owned view and the checkpoint index (incl. cursor 1000).
    seekReplay(copied, copied.length)

    // Mutate an early (<900) resolved event, which the cursor-1000 checkpoint already folded.
    const earlyIndex = copied.findIndex(
      (e, i) => i < 900 && e.type === 'propagation_resolved' && e.outcome === 'blocked',
    )
    expect(earlyIndex).toBeGreaterThan(-1)
    ;(copied[earlyIndex] as { outcome: string }).outcome = 'succeeded'

    // Seeking (checkpoint-based) and fresh stepping both read the owned view, so they agree
    // with each other and with the pre-mutation result.
    for (const n of [earlyIndex + 1, 1000, 1200, copied.length]) {
      expect(seekReplay(copied, n)).toEqual(foldTo(copied, n))
    }
  })
})
