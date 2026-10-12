// Controlled one-change comparison (docs/analysis-results.md#baseline-comparison,
// docs/scenario-model.md#comparison-rules). The modified scenario is built from
// the baseline's own canonical source document plus exactly one added
// intervention, recompiled through the existing compiler — the baseline is never
// mutated. Both snapshots run on the same engine; a comparison is published only
// when both runs completed and the two runs are compatible.

import { error, fail, ok, type Diagnostic, type Result } from '../domain/diagnostics'
import type { CompiledScenario, Intervention, InterventionRecord } from '../domain/scenario'
import { runScenario, type RunOptions, type RunResult } from '../engine'
import { compareCodeUnits } from '../io/canonical-json'
import { compileScenario } from '../scenario/compile'
import { deepFreeze } from '../scenario/freeze'
import { analyzeRun, type RunAnalysis } from './analyze'

export type ComparisonMetrics = {
  readonly total_assets: number
  /** B: baseline compromised count (≥ 1; the seed is supplied compromised). */
  readonly baseline_count: number
  /** M: modified compromised count. */
  readonly modified_count: number
  /** B − M. Negative means the change increased exposure; never clamped. */
  readonly absolute_reduction: number
  /** (B − M) / B × 100, guarded at B = 0. Not percentage points. */
  readonly relative_reduction: number
  /** (B − M) / N × 100. */
  readonly percentage_point_change: number
  readonly baseline_blast_radius: number
  readonly modified_blast_radius: number
  /** Baseline IDs absent from the modified run (sorted). */
  readonly no_longer_compromised: readonly string[]
  /** Modified IDs absent from the baseline run (sorted). */
  readonly newly_compromised: readonly string[]
}

export type ScenarioComparison = {
  readonly baseline: RunAnalysis
  readonly modified: RunAnalysis
  readonly metrics: ComparisonMetrics
  /** The manifest record for the one added intervention. */
  readonly added_intervention: InterventionRecord
  /** The compiled modified scenario, for replay and inspection. */
  readonly modified_scenario: CompiledScenario
  readonly baseline_run: RunResult
  readonly modified_run: RunResult
}

/**
 * Builds the modified scenario (baseline source + one intervention), runs and
 * analyzes both, and returns the comparison. Rejects a compile failure of the
 * modified scenario (e.g. an overlapping or invalid intervention) and any
 * comparison whose runs are incompatible or not both completed.
 */
export function compareScenarios(
  baseline: CompiledScenario,
  intervention: Intervention,
  options: RunOptions = {},
): Result<ScenarioComparison> {
  const modifiedDocument = {
    ...baseline.source,
    interventions: [...baseline.source.interventions, intervention],
  }
  const compiledModified = compileScenario(modifiedDocument)
  if (!compiledModified.ok) return compiledModified

  const baselineRun = runScenario(baseline, options)
  const modifiedRun = runScenario(compiledModified.value, options)
  const baselineAnalysis = analyzeRun(baseline, baselineRun)
  const modifiedAnalysis = analyzeRun(compiledModified.value, modifiedRun)

  const metrics = diffAnalyses(baselineAnalysis, modifiedAnalysis)
  if (!metrics.ok) return metrics

  const addedIntervention = compiledModified.value.manifest.find(
    (record) => record.intervention_id === intervention.id,
  )
  if (addedIntervention === undefined) {
    // Unreachable: a compiled intervention always yields a manifest record.
    return fail([error('COMPARISON_INCOMPATIBLE', [], `Intervention "${intervention.id}" produced no manifest record.`)])
  }

  return ok(
    deepFreeze({
      baseline: baselineAnalysis,
      modified: modifiedAnalysis,
      metrics: metrics.value,
      added_intervention: addedIntervention,
      modified_scenario: compiledModified.value,
      baseline_run: baselineRun,
      modified_run: modifiedRun,
    }),
  )
}

/**
 * Computes comparison metrics for two analyses, enforcing the documented
 * compatibility requirements: both completed, identical asset universe, seed,
 * profile revision, and model/engine versions.
 */
export function diffAnalyses(
  baseline: RunAnalysis,
  modified: RunAnalysis,
): Result<ComparisonMetrics> {
  const problems: Diagnostic[] = []

  if (baseline.status !== 'completed' || modified.status !== 'completed') {
    problems.push(
      error(
        'COMPARISON_ABORTED_RUN',
        [],
        'A controlled comparison requires two completed runs; an aborted run cannot publish a blast-radius comparison.',
      ),
    )
  }

  const incompatibilities: string[] = []
  const universe = (analysis: RunAnalysis) => [...analysis.compromised, ...analysis.unaffected].sort(compareCodeUnits)
  if (!arraysEqual(universe(baseline), universe(modified))) incompatibilities.push('asset universe')
  if (baseline.seed_id !== modified.seed_id) incompatibilities.push('initial asset')
  if (baseline.profile_id !== modified.profile_id || baseline.profile_version !== modified.profile_version) {
    incompatibilities.push('profile revision')
  }
  if (baseline.model_version !== modified.model_version) incompatibilities.push('model version')
  if (baseline.engine_version !== modified.engine_version) incompatibilities.push('engine version')
  if (incompatibilities.length > 0) {
    problems.push(
      error(
        'COMPARISON_INCOMPATIBLE',
        [],
        `Baseline and modified runs differ in: ${incompatibilities.join(', ')}. Show them separately instead.`,
      ),
    )
  }

  if (problems.length > 0) return fail(problems)

  const total = baseline.total_assets
  const baselineCount = baseline.compromised.length
  const modifiedCount = modified.compromised.length
  const baselineSet = new Set(baseline.compromised)
  const modifiedSet = new Set(modified.compromised)

  return ok(
    deepFreeze({
      total_assets: total,
      baseline_count: baselineCount,
      modified_count: modifiedCount,
      absolute_reduction: baselineCount - modifiedCount,
      relative_reduction: baselineCount === 0 ? 0 : ((baselineCount - modifiedCount) / baselineCount) * 100,
      percentage_point_change: total === 0 ? 0 : ((baselineCount - modifiedCount) / total) * 100,
      baseline_blast_radius: baseline.blast_radius,
      modified_blast_radius: modified.blast_radius,
      no_longer_compromised: baseline.compromised.filter((id) => !modifiedSet.has(id)).sort(compareCodeUnits),
      newly_compromised: modified.compromised.filter((id) => !baselineSet.has(id)).sort(compareCodeUnits),
    }),
  )
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
