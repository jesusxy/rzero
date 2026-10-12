// Small command-line runner sharing the domain core with the UI and tests.
//
//   bun run rzero validate <scenario.json|scenario.yaml> [--json]
//
// Exits 0 when the scenario compiles, 1 when it is rejected, 2 on usage errors.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { importScenario, type Diagnostic } from '../src/core'

const [command, file, ...flags] = process.argv.slice(2)

if (command !== 'validate' || file === undefined) {
  console.error('usage: bun run rzero validate <scenario.json|scenario.yaml> [--json]')
  process.exit(2)
}

const result = importScenario(readFileSync(file), { fileName: basename(file) })

if (flags.includes('--json')) {
  console.log(JSON.stringify(result.ok ? { ok: true, diagnostics: result.diagnostics, scenario: result.value } : result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

const describe = (diagnostic: Diagnostic) => {
  const where = diagnostic.path === '' ? '(document)' : diagnostic.path
  const line = diagnostic.location ? ` [line ${diagnostic.location.line}:${diagnostic.location.column}]` : ''
  return `${diagnostic.severity.padEnd(7)} ${diagnostic.code} at ${where}${line}\n        ${diagnostic.message}`
}

for (const diagnostic of result.diagnostics) console.log(describe(diagnostic))

if (!result.ok) {
  console.log(`\nrejected: ${file}`)
  process.exit(1)
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
