// Deterministic engine subsystem. Consumes a CompiledScenario and produces an
// ordered event stream plus final run state. No analysis, replay or UI here.

export { ENGINE_VERSION, runScenario } from './run'
export type { FinalRunState, ParentRecord, RunOptions, RunResult, RunStatus } from './run'
export type {
  AbortCode,
  Check,
  CheckCode,
  CheckStatus,
  EventType,
  Outcome,
  SimulationEvent,
  SkipReason,
  AssetCompromisedEvent,
  AssetDiscoveredEvent,
  PropagationAttemptedEvent,
  PropagationResolvedEvent,
  PropagationSkippedEvent,
  RunAbortedEvent,
  RunCompletedEvent,
  RunStartedEvent,
} from './events'
export { attemptId, eventId } from './events'
export { evaluateCapability, outcomeOf, type Evaluation, type EvaluationContext } from './checks'
