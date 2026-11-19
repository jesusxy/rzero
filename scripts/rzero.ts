// Small command-line runner sharing the domain core with the UI and tests.
//
//   bun run rzero validate <scenario.json|scenario.yaml> [--json]
//   bun run rzero run      <scenario.json|scenario.yaml> [--json] [--max-events N]
//   bun run rzero story    <scenario.json|scenario.yaml> [--json] [--max-events N]
//
// `validate` compiles and reports diagnostics; `run` also executes the
// deterministic engine and prints the ordered event stream and final state;
// `story` runs it and narrates the stream as walkthrough steps in plain English.
// Exits 0 on success, 1 when the scenario is rejected, 2 on usage errors.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  groupSteps,
  importScenario,
  runScenario,
  type CompiledScenario,
  type Diagnostic,
  type RunResult,
  type SimulationEvent,
} from '../src/core'
import { narrate } from '../src/app/narration'

const [command, file, ...flags] = process.argv.slice(2)

if ((command !== 'validate' && command !== 'run' && command !== 'story') || file === undefined) {
  console.error('usage: bun run rzero <validate|run|story> <scenario.json|scenario.yaml> [--json] [--max-events N]')
  process.exit(2)
}

const asJson = flags.includes('--json')
const maxEventsFlag = flags.indexOf('--max-events')
const maxEvents = maxEventsFlag === -1 ? undefined : Number(flags[maxEventsFlag + 1])

const result = importScenario(readFileSync(file), { fileName: basename(file) })

if (command === 'validate') {
  reportCompile()
  process.exit(result.ok ? 0 : 1)
}

// command === 'run' | 'story'
if (!result.ok) {
  reportCompile()
  process.exit(1)
}
const run = runScenario(result.value, maxEvents === undefined ? {} : { maxEvents })
if (command === 'story') {
  reportStory(result.value, run)
  process.exit(0)
}
if (asJson) {
  console.log(JSON.stringify(run, null, 2))
  process.exit(0)
}
reportRun(run)
process.exit(0)

function reportCompile(): void {
  if (asJson) {
    console.log(
      JSON.stringify(result.ok ? { ok: true, diagnostics: result.diagnostics, scenario: result.value } : result, null, 2),
    )
    return
  }
  for (const diagnostic of result.diagnostics) console.log(describe(diagnostic))
  if (!result.ok) {
    console.log(`\nrejected: ${file}`)
    return
  }
  const scenario = result.value
  const { network, profile } = scenario.effective
  console.log(`compiled: ${scenario.id} (${scenario.name})`)
  console.log(`  model         ${scenario.model_version}`)
  console.log(`  input digest  ${scenario.input_digest}`)
  console.log(`  profile       ${profile.id}@${profile.version} (${profile.scope}, ${profile.review_status})`)
  console.log(`  network       ${network.assets.length} assets, ${network.links.length} links, ${network.segments.length} segments`)
  console.log(`  seed          ${scenario.effective.initial_asset_id}`)
  for (const record of scenario.manifest) {
    const changes = record.changes
      .map((change) => `${change.field_ref}: ${String(change.original)} → ${String(change.effective)}${change.noop ? ' (no-op)' : ''}`)
      .join('; ')
    console.log(`  intervention  ${record.intervention_id} (${record.type}) ${changes}`)
  }
}

function reportRun(run: RunResult): void {
  console.log(`run: ${run.status} (engine ${run.engine_version}, digest ${run.input_digest.slice(0, 12)}…)`)
  for (const event of run.events) console.log(`  ${event.seq.toString().padStart(3)}  ${line(event)}`)
  console.log(`\ncompromised (${run.state.compromised.length}): ${[...run.state.compromised].sort().join(', ')}`)
  if (run.abort) console.log(`aborted: ${run.abort.code} after seq ${run.abort.last_processed_seq}`)
}

function reportStory(scenario: CompiledScenario, run: RunResult): void {
  const steps = groupSteps(run.events)
  const narrated = steps.map((step) => ({ step, narration: narrate(step, run.events, scenario) }))
  if (asJson) {
    console.log(JSON.stringify(narrated.map(({ step, narration }) => ({ ...step, ...narration })), null, 2))
    return
  }
  console.log(`story: ${scenario.name} (${scenario.id}), ${steps.length} steps`)
  for (const { step, narration } of narrated) {
    const range = step.end - step.start === 1 ? `seq ${step.start}` : `seq ${step.start}–${step.end - 1}`
    console.log(`\nStep ${step.index + 1} of ${steps.length}: ${narration.title}  [${range}]`)
    for (const text of wrap(narration.body, '  ')) console.log(text)
    if (narration.why !== undefined) for (const text of wrap(`Why: ${narration.why}`, '  ', '       ')) console.log(text)
  }
}

/** Word-wraps text to 80 columns with a first-line and continuation indent. */
function wrap(text: string, indent: string, hanging = indent): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const prefix = lines.length === 0 ? indent : hanging
    if (current !== '' && prefix.length + current.length + 1 + word.length > 80) {
      lines.push(prefix + current)
      current = word
    } else {
      current = current === '' ? word : `${current} ${word}`
    }
  }
  lines.push((lines.length === 0 ? indent : hanging) + current)
  return lines
}

function line(event: SimulationEvent): string {
  switch (event.type) {
    case 'run_started':
      return `run_started  seed=${event.initial_asset_id}`
    case 'asset_compromised':
      return `compromised  ${event.asset_id}${event.parent_id ? ` ← ${event.parent_id}` : ' (seed)'}  hop=${event.hop}`
    case 'asset_discovered':
      return `discovered   ${event.asset_id}  via ${event.source_id}/${event.link_id}`
    case 'propagation_attempted':
      return `attempt      ${event.source_id} → ${event.target_id}  ${event.capability_id}`
    case 'propagation_resolved': {
      const reason =
        event.checks.find((check) => check.status === 'fail')?.code ??
        event.checks.find((check) => check.status === 'unknown')?.code
      return `resolved     ${event.source_id} → ${event.target_id}  ${event.outcome}${reason ? ` (${reason})` : ''}`
    }
    case 'propagation_skipped':
      return `skipped      ${event.source_id} → ${event.target_id}  ${event.reason}`
    case 'run_completed':
      return `run_completed  compromised={${event.compromised_ids.join(',')}}`
    case 'run_aborted':
      return `run_aborted  ${event.error_code}`
  }
}

function describe(diagnostic: Diagnostic): string {
  const where = diagnostic.path === '' ? '(document)' : diagnostic.path
  const location = diagnostic.location ? ` [line ${diagnostic.location.line}:${diagnostic.location.column}]` : ''
  return `${diagnostic.severity.padEnd(7)} ${diagnostic.code} at ${where}${location}\n        ${diagnostic.message}`
}
