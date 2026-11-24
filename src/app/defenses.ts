import {
  analyzeRun,
  compileScenario,
  diffAnalyses,
  runScenario,
  seekReplay,
  type Check,
  type CompiledScenario,
  type ComparisonMetrics,
  type Diagnostic,
  type Intervention,
  type PropagationResolvedEvent,
  type Result,
  type RunAnalysis,
  type RunResult,
} from '../core'
import { primaryCheck } from './narration'
import { hostStatus } from './view'

export type DefenseKind = 'segmentation' | 'patch' | 'link'

export const DEFENSE_KINDS: readonly DefenseKind[] = ['segmentation', 'patch', 'link']

export type DefenseOption = {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly kind: DefenseKind
  readonly interventions: readonly Intervention[]
}

export type ParsedDefenses = {
  readonly options: readonly DefenseOption[]
  readonly problems: readonly string[]
}

export type DefenseRun = {
  readonly option: DefenseOption
  readonly compiled: CompiledScenario
  readonly run: RunResult
  readonly baseline: RunAnalysis
  readonly defended: RunAnalysis
  readonly metrics: ComparisonMetrics
}

export type StoppedAttempt = { readonly source: string; readonly target: string; readonly linkId: string }

export type UnchangedHost = { readonly id: string; readonly status: 'blocked' | 'unknown'; readonly check?: Check }

export type DefenseChanges = {
  readonly saved: readonly string[]
  readonly newlyLost: readonly string[]
  readonly stillLost: readonly string[]
  readonly stopped: readonly StoppedAttempt[]
  readonly unchanged: readonly UnchangedHost[]
}

export type DefenseMarks = {
  readonly protectedSegments: ReadonlySet<string>
  readonly patchedHosts: ReadonlySet<string>
  readonly lockedLinks: ReadonlySet<string>
}

export type Alternative = { readonly option: DefenseOption; readonly saved: readonly string[] }

const FIELDS = ['id', 'label', 'description', 'kind', 'interventions']

export function parseDefenses(text: string): ParsedDefenses {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { options: [], problems: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!Array.isArray(value)) return { options: [], problems: ['expected an array of defense options'] }
  const options: DefenseOption[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  value.forEach((entry: unknown, i) => {
    const at = `[${i}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at}: expected an object`)
      return
    }
    const record = entry as Record<string, unknown>
    const found: string[] = []
    for (const key of ['id', 'label', 'description']) {
      const field = record[key]
      if (typeof field !== 'string' || field.trim() === '') found.push(`${at}.${key}: expected a non-empty string`)
    }
    if (!DEFENSE_KINDS.includes(record.kind as DefenseKind)) found.push(`${at}.kind: expected segmentation, patch or link`)
    const interventions = record.interventions
    if (!Array.isArray(interventions) || interventions.length === 0) {
      found.push(`${at}.interventions: expected a non-empty array`)
    } else {
      interventions.forEach((item: unknown, j) => {
        const shape = item as Record<string, unknown> | null
        if (shape === null || typeof shape !== 'object' || typeof shape.type !== 'string' || typeof shape.id !== 'string') {
          found.push(`${at}.interventions[${j}]: expected an intervention with a type and an id`)
        }
      })
    }
    const extra = Object.keys(record).filter((key) => !FIELDS.includes(key))
    if (extra.length > 0) found.push(`${at}: unexpected field ${extra.join(', ')}`)
    if (typeof record.id === 'string') {
      if (seen.has(record.id)) found.push(`${at}.id: "${record.id}" is used twice`)
      seen.add(record.id)
    }
    problems.push(...found)
    if (found.length === 0) options.push(record as unknown as DefenseOption)
  })
  return { options, problems }
}

export function applyDefense(base: CompiledScenario, option: DefenseOption): Result<CompiledScenario> {
  return compileScenario({ ...base.source, interventions: [...base.source.interventions, ...option.interventions] })
}

const failed = (diagnostics: readonly Diagnostic[]): Result<never> => ({ ok: false, diagnostics })

export function runDefense(base: CompiledScenario, baseRun: RunResult, option: DefenseOption): Result<DefenseRun> {
  const compiled = applyDefense(base, option)
  if (!compiled.ok) return failed(compiled.diagnostics)
  const run = runScenario(compiled.value)
  const baseline = analyzeRun(base, baseRun)
  const defended = analyzeRun(compiled.value, run)
  const metrics = diffAnalyses(baseline, defended)
  if (!metrics.ok) return failed(metrics.diagnostics)
  return { ok: true, value: { option, compiled: compiled.value, run, baseline, defended, metrics: metrics.value }, diagnostics: [] }
}

export function interventionIds(option: DefenseOption): ReadonlySet<string> {
  return new Set(option.interventions.map((intervention) => intervention.id))
}

export function decidedByDefense(check: Check | undefined, ids: ReadonlySet<string>): boolean {
  return check?.status !== 'pass' && (check?.intervention_ids ?? []).some((id) => ids.has(id))
}

export function originalAttempt(
  baseRun: RunResult,
  attempt: { readonly source_id: string; readonly target_id: string; readonly capability_id: string; readonly link_id: string },
): PropagationResolvedEvent | undefined {
  const resolved = baseRun.events.filter(
    (event): event is PropagationResolvedEvent =>
      event.type === 'propagation_resolved' &&
      event.source_id === attempt.source_id &&
      event.target_id === attempt.target_id &&
      event.capability_id === attempt.capability_id,
  )
  return resolved.find((event) => event.link_id === attempt.link_id) ?? resolved[0]
}

function compromiseOrder(run: RunResult): string[] {
  return run.events.flatMap((event) => (event.type === 'asset_compromised' ? [event.asset_id] : []))
}

export function savedHosts(baseRun: RunResult, result: DefenseRun): string[] {
  const saved = new Set(result.metrics.no_longer_compromised)
  return compromiseOrder(baseRun).filter((id) => saved.has(id))
}

export function defenseChanges(baseRun: RunResult, result: DefenseRun): DefenseChanges {
  const ids = interventionIds(result.option)
  const before = new Set(baseRun.state.compromised)
  const after = new Set(result.run.state.compromised)
  const newly = new Set(result.metrics.newly_compromised)
  const stopped = result.run.events
    .filter((event): event is PropagationResolvedEvent => event.type === 'propagation_resolved' && event.outcome !== 'succeeded')
    .filter((event) => decidedByDefense(primaryCheck(event.checks), ids))
    .map((event) => ({ source: event.source_id, target: event.target_id, linkId: event.link_id }))
  const stoppedTargets = new Set(stopped.map((entry) => entry.target))
  const finalBefore = seekReplay(baseRun.events, baseRun.events.length)
  const finalAfter = seekReplay(result.run.events, result.run.events.length)
  const unchanged = result.compiled.effective.network.assets.flatMap((asset): UnchangedHost[] => {
    if (before.has(asset.id) || after.has(asset.id) || stoppedTargets.has(asset.id)) return []
    const status = hostStatus(finalAfter, asset.id)
    if (status === null || status === 'compromised' || status !== hostStatus(finalBefore, asset.id)) return []
    const latest = Object.values(finalAfter.attempts)
      .filter((attempt) => attempt.target_id === asset.id)
      .sort((a, b) => (a.attempt_id < b.attempt_id ? 1 : -1))[0]
    const check = latest === undefined ? undefined : primaryCheck(latest.checks)
    return [{ id: asset.id, status, ...(check ? { check } : {}) }]
  })
  return {
    saved: savedHosts(baseRun, result),
    newlyLost: compromiseOrder(result.run).filter((id) => newly.has(id)),
    stillLost: compromiseOrder(result.run).filter((id) => before.has(id)),
    stopped,
    unchanged,
  }
}

export function defenseMarks(result: DefenseRun): DefenseMarks {
  const protectedSegments = new Set<string>()
  const patchedHosts = new Set<string>()
  const lockedLinks = new Set<string>()
  for (const intervention of result.option.interventions) {
    if (intervention.type === 'set_boundary_access') {
      if (result.option.kind !== 'link') {
        protectedSegments.add(intervention.to_segment_id)
        continue
      }
      const record = result.compiled.manifest.find((entry) => entry.intervention_id === intervention.id)
      for (const change of record?.changes ?? []) if (change.entity_kind === 'link' && !change.noop) lockedLinks.add(change.entity_id)
    } else if (intervention.type !== 'set_grant_status') {
      patchedHosts.add(intervention.asset_id)
    }
  }
  return { protectedSegments, patchedHosts, lockedLinks }
}

export function bestAlternative(
  base: CompiledScenario,
  baseRun: RunResult,
  options: readonly DefenseOption[],
  currentId: string,
): Alternative | null {
  let best: Alternative | null = null
  for (const option of options) {
    if (option.id === currentId) continue
    const result = runDefense(base, baseRun, option)
    if (!result.ok) continue
    const saved = savedHosts(baseRun, result.value)
    if (best === null || saved.length > best.saved.length) best = { option, saved }
  }
  return best
}
