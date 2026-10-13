// Analysis subsystem: result summaries, causal paths and controlled comparison.
// Reads completed engine output; it never re-runs or reinterprets propagation.

export { analyzeRun, firstCompromisePath } from './analyze'
export type { AttemptCounts, MechanismContributions, PathStep, RunAnalysis } from './analyze'
export { compareScenarios, diffAnalyses } from './compare'
export type { ComparisonMetrics, ScenarioComparison } from './compare'
