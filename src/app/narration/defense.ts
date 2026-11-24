// Prose for a run with a defense applied, compared with the original run.
// Facts come from src/app/defenses.ts; this file only words them.

import type { CompiledScenario, Outcome, PropagationResolvedEvent } from '../../core'
import type { Alternative, DefenseChanges, DefenseRun } from '../defenses'
import { blockTag, joinList } from './describe'
import { fill, primaryCheck } from './narrate'
import { DEFENSE_TEXT } from './templates'

export type ResultRow = { readonly key: 'saved' | 'newlyLost' | 'stopped' | 'stillLost' | 'unchanged'; readonly label: string; readonly value: string }

export type ResultsText = {
  readonly title: string
  readonly body: string
  readonly rows: readonly ResultRow[]
  readonly suggestion?: string
}

const labelOf = (scenario: CompiledScenario) => (id: string) =>
  scenario.effective.network.assets.find((asset) => asset.id === id)?.label || id

/**
 * The "In the original run" note for a step whose attempt (same source, target
 * and capability) ended differently without the defense, or null when it did not.
 */
export function originalRunNote(
  scenario: CompiledScenario,
  attempt: { readonly source_id: string; readonly target_id: string },
  now: Outcome,
  original: PropagationResolvedEvent | undefined,
): string | null {
  const outcome = original?.outcome ?? 'never'
  if (outcome === now) return null
  const label = labelOf(scenario)
  const critical = scenario.effective.network.assets.find((asset) => asset.id === attempt.target_id)?.critical === true
  const vars = {
    source: label(attempt.source_id),
    target: label(attempt.target_id),
    critical: critical ? DEFENSE_TEXT.original.critical : '',
  }
  if (outcome === 'blocked') {
    const reason = original === undefined ? undefined : primaryCheck(original.checks)
    return fill(DEFENSE_TEXT.original.blocked, { ...vars, reason: reason === undefined ? '' : blockTag(reason) })
  }
  return fill(DEFENSE_TEXT.original[outcome], vars)
}

/** Title, comparison sentence, "what changed" rows and a suggestion for the results step. */
export function resultsText(result: DefenseRun, changes: DefenseChanges, alternative: Alternative | null): ResultsText {
  const text = DEFENSE_TEXT.results
  const label = labelOf(result.compiled)
  const critical = new Set(result.compiled.effective.network.assets.filter((asset) => asset.critical).map((asset) => asset.id))
  const host = (id: string) => (critical.has(id) ? fill(text.criticalMark, { host: label(id) }) : label(id))
  const hosts = (ids: readonly string[]) => ids.map(label)

  const title = changes.saved.length > 0 ? fill(text.titleSaved, { hosts: joinList(hosts(changes.saved)) }) : text.titleNone
  const { baseline_count: before, modified_count: after, total_assets: total } = result.metrics
  const counts = { before: String(before), after: String(after), total: String(total), are: after === 1 ? 'is' : 'are' }
  const reached = result.defended.critical_compromised
  const criticalClause =
    critical.size === 0
      ? text.plain
      : reached.length === 0
        ? text.criticalNone
        : fill(text.criticalSome, { hosts: joinList(hosts(reached)), are: reached.length === 1 ? 'is' : 'are' })
  const body = fill(before === after ? text.comparedSame : text.compared, counts) + criticalClause

  const rows: ResultRow[] = [
    { key: 'saved', label: text.saved, value: changes.saved.length > 0 ? changes.saved.map(host).join(', ') : text.none },
  ]
  if (changes.newlyLost.length > 0) rows.push({ key: 'newlyLost', label: text.newlyLost, value: changes.newlyLost.map(host).join(', ') })
  if (changes.stopped.length > 0) {
    rows.push({
      key: 'stopped',
      label: text.stopped,
      value: changes.stopped.map((entry) => `${label(entry.source)} → ${label(entry.target)}`).join(', '),
    })
  }
  rows.push({ key: 'stillLost', label: text.stillLost, value: changes.stillLost.length > 0 ? hosts(changes.stillLost).join(', ') : text.none })
  if (changes.unchanged.length > 0) {
    rows.push({
      key: 'unchanged',
      label: text.unchanged,
      value: changes.unchanged
        .map((entry) => `${label(entry.id)} ${entry.status === 'unknown' || entry.check === undefined ? text.unknown : blockTag(entry.check)}`)
        .join('; '),
    })
  }

  let suggestion: string | undefined
  if (alternative !== null) {
    suggestion =
      alternative.saved.length > 0
        ? fill(text.suggestion, { option: alternative.option.label, hosts: joinList(hosts(alternative.saved)) })
        : text.suggestionNone
  }
  return { title, body, rows, ...(suggestion === undefined ? {} : { suggestion }) }
}
