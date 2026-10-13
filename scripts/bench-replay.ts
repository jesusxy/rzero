// Small, reproducible replay benchmark (not a test — no timing assertions).
//
//   bun scripts/bench-replay.ts [chainNodes] [sinkNodes] [links]
//
// Builds a valid dense scenario at the V1 admission limits (<=250 assets,
// <=2000 links, 4 capabilities), runs the engine, then times full replay, a
// mid-stream seek and a backward step. Reports event counts, timings and
// heap deltas. Memory numbers are indicative only (shared heap, GC timing).

import {
  compileScenario,
  replayFinalState,
  runScenario,
  seekReplay,
  stepBackReplay,
  stepReplay,
  type CompiledScenario,
} from '../src/core'

const CHAIN = Number(process.argv[2] ?? 125) // compromisable chain nodes (incl. seed)
const SINKS = Number(process.argv[3] ?? 125) // never-compromised targets (absent vuln)
const MAX_LINKS = Number(process.argv[4] ?? 2000)

function buildDenseScenario(): CompiledScenario {
  const assets: unknown[] = []
  for (let i = 0; i < CHAIN; i += 1) {
    assets.push(labAsset(`C${i}`, 'present'))
  }
  for (let i = 0; i < SINKS; i += 1) {
    assets.push(labAsset(`S${i}`, 'absent'))
  }

  const links: unknown[] = []
  // Chain C0 -> C1 -> ... so every chain node is compromised and processes links.
  for (let i = 0; i < CHAIN - 1; i += 1) {
    links.push(link(`chain-${i}`, `C${i}`, `C${i + 1}`))
  }
  // Fill the remaining budget with chain -> sink links. Each fires a 4-capability
  // attempt (all fail on the absent vulnerability) and is never skipped.
  let added = links.length
  outer: for (let c = 0; c < CHAIN; c += 1) {
    for (let s = 0; s < SINKS; s += 1) {
      if (added >= MAX_LINKS) break outer
      links.push(link(`fan-${c}-${s}`, `C${c}`, `S${s}`))
      added += 1
    }
  }

  const document = {
    model_version: 'rzero/1',
    id: 'bench-dense',
    name: 'Dense replay benchmark',
    network: { segments: [{ id: 'lab', label: 'Lab' }], assets, links, credentials: [] },
    profile: {
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
    },
    initial_asset_id: 'C0',
    interventions: [],
  }

  const compiled = compileScenario(document)
  if (!compiled.ok) {
    console.error(JSON.stringify(compiled.diagnostics, null, 2))
    throw new Error('bench scenario failed to compile')
  }
  return compiled.value
}

function labAsset(id: string, vuln: 'present' | 'absent') {
  return {
    id,
    label: id,
    kind: 'workstation',
    platform: 'windows',
    segment_id: 'lab',
    critical: false,
    isolated: false,
    services: [{ id: 'smb', transport: 'tcp', port: 445, status: 'enabled' }],
    vulnerabilities: [{ id: 'LAB-SMB-1', status: vuln }],
    credential_ids: [],
  }
}

function link(id: string, source: string, target: string) {
  return { id, source_id: source, target_id: target, service_id: 'smb', access: 'allow' }
}

function time(label: string, fn: () => void): number {
  const start = performance.now()
  fn()
  const ms = performance.now() - start
  console.log(`  ${label.padEnd(22)} ${ms.toFixed(1)} ms`)
  return ms
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

const compiled = buildDenseScenario()
console.log(`scenario: ${compiled.effective.network.assets.length} assets, ${compiled.effective.network.links.length} links, ${compiled.effective.profile.capabilities.length} capabilities`)

const engineStart = performance.now()
const run = runScenario(compiled)
const engineMs = performance.now() - engineStart
console.log(`  engine                 ${engineMs.toFixed(1)} ms  (status ${run.status})`)
console.log(`  events                 ${run.events.length}`)

const mid = Math.floor(run.events.length / 2)
const before = process.memoryUsage().heapUsed
time('full replay', () => void replayFinalState(run.events))
const afterReplay = process.memoryUsage().heapUsed
time('seek to middle', () => void seekReplay(run.events, mid))
const midState = seekReplay(run.events, mid)
time('backward step', () => void stepBackReplay(run.events, midState))
time('forward step', () => void stepReplay(run.events, midState))
console.log(`  heap delta (replay)    ${mib(afterReplay - before)} (indicative only)`)
