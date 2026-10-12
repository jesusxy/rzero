import { expect } from 'bun:test'
import {
  compileScenario,
  runScenario,
  type CompiledScenario,
  type PropagationResolvedEvent,
  type RunOptions,
  type RunResult,
} from '../../src/core'
import { expectCompiled } from './helpers'

// Minimal lab defaults: a Windows workstation in segment `lab` with enabled
// SMB and a present LAB-SMB-1, matching docs/validation-scenarios.md.
export type AssetOverride = Partial<{
  kind: string
  platform: string
  segment_id: string
  critical: boolean
  isolated: boolean
  services: unknown[]
  vulnerabilities: unknown[]
  credential_ids: string[]
}>

export type LinkSpec = {
  id: string
  source: string
  target: string
  service?: string
  access?: 'allow' | 'deny' | 'unknown'
}

export type LabSpec = {
  assets: Record<string, AssetOverride>
  links: LinkSpec[]
  profile?: unknown
  credentials?: unknown[]
  interventions?: unknown[]
  seed?: string
  segments?: unknown[]
}

const smbService = () => [{ id: 'smb', transport: 'tcp', port: 445, status: 'enabled' }]
const smbPresent = () => [{ id: 'LAB-SMB-1', status: 'present' }]

function defaultAsset(id: string): Record<string, unknown> {
  return {
    id,
    label: `LAB-${id}`,
    kind: 'workstation',
    platform: 'windows',
    segment_id: 'lab',
    critical: false,
    isolated: false,
    services: smbService(),
    vulnerabilities: smbPresent(),
    credential_ids: [],
  }
}

export const SMB_EXPLOIT_PROFILE = {
  id: 'lab-worm',
  version: '1',
  name: 'Lab SMB Worm',
  scope: 'synthetic',
  review_status: 'reviewed',
  sources: [
    {
      id: 'lab-definition',
      kind: 'synthetic',
      title: 'Canonical lab rule',
      local_reference: 'docs/validation-scenarios.md',
      accessed_on: '2026-10-12',
      claim_summary: 'Enabled SMB plus LAB-SMB-1 permits modeled compromise.',
    },
  ],
  capabilities: [
    {
      id: 'smb-exploit',
      label: 'Synthetic SMB exploit',
      mechanism: 'remote_exploit',
      service_id: 'smb',
      target_platforms: ['windows'],
      vulnerability_id: 'LAB-SMB-1',
      evidence_ids: ['lab-definition'],
      confidence: 'high',
      assumptions: ['A passing exploit yields execution; no real exploit is performed.'],
    },
  ],
  limitations: ['Synthetic teaching rule; not a real malware family.'],
}

/** Builds, compiles and returns a lab scenario. */
export function compileLab(spec: LabSpec): CompiledScenario {
  const assets = Object.entries(spec.assets).map(([id, override]) => ({
    ...defaultAsset(id),
    ...override,
  }))
  const links = spec.links.map((link) => ({
    id: link.id,
    source_id: link.source,
    target_id: link.target,
    service_id: link.service ?? 'smb',
    access: link.access ?? 'allow',
  }))
  const document = {
    model_version: 'rzero/1',
    id: 'engine-test',
    name: 'Engine test scenario',
    network: {
      segments: spec.segments ?? [{ id: 'lab', label: 'Lab' }],
      assets,
      links,
      credentials: spec.credentials ?? [],
    },
    profile: spec.profile ?? SMB_EXPLOIT_PROFILE,
    initial_asset_id: spec.seed ?? 'A',
    interventions: spec.interventions ?? [],
  }
  return expectCompiled(compileScenario(document))
}

export function runLab(spec: LabSpec, options?: RunOptions): RunResult {
  return runScenario(compileLab(spec), options)
}

/** Compact one-line description of each event, for exact-order assertions. */
export function trace(run: RunResult): string[] {
  return run.events.map((event) => {
    switch (event.type) {
      case 'run_started':
        return 'run_started'
      case 'asset_compromised':
        return `compromised:${event.asset_id}`
      case 'asset_discovered':
        return `discovered:${event.asset_id}`
      case 'propagation_attempted':
        return `attempted:${event.source_id}->${event.target_id}:${event.capability_id}`
      case 'propagation_resolved':
        return `resolved:${event.source_id}->${event.target_id}:${event.outcome}`
      case 'propagation_skipped':
        return `skipped:${event.source_id}->${event.target_id}`
      case 'run_completed':
        return 'run_completed'
      case 'run_aborted':
        return `run_aborted:${event.error_code}`
    }
  })
}

export type OutcomeCounts = {
  succeeded: number
  blocked: number
  indeterminate: number
  skipped: number
}

export function counts(run: RunResult): OutcomeCounts {
  const out: OutcomeCounts = { succeeded: 0, blocked: 0, indeterminate: 0, skipped: 0 }
  for (const event of run.events) {
    if (event.type === 'propagation_resolved') out[event.outcome] += 1
    else if (event.type === 'propagation_skipped') out.skipped += 1
  }
  return out
}

export function resolvedEvents(run: RunResult): PropagationResolvedEvent[] {
  return run.events.filter((event): event is PropagationResolvedEvent => event.type === 'propagation_resolved')
}

/** Targets with an indeterminate attempt that remain uncompromised at the end. */
export function indeterminateTargets(run: RunResult): string[] {
  const compromised = new Set(run.state.compromised)
  const targets = new Set<string>()
  for (const event of resolvedEvents(run)) {
    if (event.outcome === 'indeterminate' && !compromised.has(event.target_id)) targets.add(event.target_id)
  }
  return [...targets].sort()
}

export function checkStatus(event: PropagationResolvedEvent, code: string): string | undefined {
  return event.checks.find((check) => check.code === code)?.status
}

/** The first failed check code, else the first unknown, else undefined. */
export function primaryReason(event: PropagationResolvedEvent): string | undefined {
  return (
    event.checks.find((check) => check.status === 'fail')?.code ??
    event.checks.find((check) => check.status === 'unknown')?.code
  )
}

/**
 * Asserts the structural invariants from docs/simulation-engine.md and
 * docs/event-model.md on a run, independently of any single scenario.
 */
export function assertEngineInvariants(run: RunResult): void {
  const events = run.events

  // Exactly one terminal event, and it is last.
  const terminals = events.filter((event) => event.type === 'run_completed' || event.type === 'run_aborted')
  expect(terminals.length).toBe(1)
  expect(events.at(-1)).toBe(terminals[0])

  // Contiguous sequence numbers and matching event IDs from 0.
  events.forEach((event, index) => {
    expect(event.seq).toBe(index)
    expect(event.event_id).toBe(`e${index.toString().padStart(6, '0')}`)
  })

  // The stream starts with run_started then the seed compromise at hop 0 —
  // unless an extreme event cap aborted before the seed compromise could fit
  // (the terminal slot is always reserved), in which case only those two events exist.
  expect(events[0]?.type).toBe('run_started')
  const seed = events[1]
  if (seed?.type === 'run_aborted') {
    expect(events.length).toBe(2)
  } else {
    expect(seed?.type).toBe('asset_compromised')
    if (seed?.type === 'asset_compromised') {
      expect(seed.asset_id).toBe(run.state.seed_id)
      expect(seed.parent_id).toBeNull()
      expect(seed.attempt_id).toBeNull()
      expect(seed.hop).toBe(0)
    }
  }

  // Attempt IDs increment in encounter order with no gaps, and every attempt
  // resolves exactly once with the same references.
  const attempted = events.filter((event) => event.type === 'propagation_attempted')
  const resolved = resolvedEvents(run)
  attempted.forEach((event, index) => {
    if (event.type !== 'propagation_attempted') return
    expect(event.attempt_id).toBe(`a${(index + 1).toString().padStart(6, '0')}`)
    const match = resolved.filter((r) => r.attempt_id === event.attempt_id)
    expect(match.length).toBe(1)
    expect(match[0]!.seq).toBeGreaterThan(event.seq)
    expect([match[0]!.source_id, match[0]!.target_id, match[0]!.link_id, match[0]!.capability_id]).toEqual([
      event.source_id,
      event.target_id,
      event.link_id,
      event.capability_id,
    ])
  })
  // No dangling attempt even on aborted streams.
  expect(resolved.length).toBe(attempted.length)

  // Every successful resolution is immediately followed by a compromise, and
  // no successful resolution carries a failed or unknown check.
  for (const event of resolved) {
    if (event.outcome !== 'succeeded') continue
    expect(event.checks.every((check) => check.status === 'pass')).toBe(true)
    const next = events[event.seq + 1]
    expect(next?.type).toBe('asset_compromised')
    if (next?.type === 'asset_compromised') expect(next.asset_id).toBe(event.target_id)
  }

  // The reducer's compromise set equals the final state, with acyclic parents
  // of strictly smaller hop, each already compromised when its child appears.
  const compromisedByEvents = events
    .filter((event) => event.type === 'asset_compromised')
    .map((event) => (event.type === 'asset_compromised' ? event.asset_id : ''))
  expect([...compromisedByEvents].sort()).toEqual([...run.state.compromised].sort())
  expect(compromisedByEvents.length).toBe(new Set(compromisedByEvents).size) // compromised at most once

  const seen = new Set<string>([run.state.seed_id])
  for (const parent of run.state.parents) {
    expect(seen.has(parent.parent_id)).toBe(true) // parent already compromised
    expect(run.state.hops[parent.parent_id]!).toBeLessThan(parent.hop)
    expect(parent.hop).toBe(run.state.hops[parent.parent_id]! + 1)
    seen.add(parent.asset_id)
  }

  // A skipped target was compromised by the time it was skipped.
  for (const event of events) {
    if (event.type === 'propagation_skipped') expect(run.state.compromised).toContain(event.target_id)
  }
}
