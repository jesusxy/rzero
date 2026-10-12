// Rzero domain core — the only module the frontend (and CLI, workers, tests)
// should import from. Pure ECMAScript: no DOM, no Node, no UI framework.
// Later milestones add the engine, analysis and replay behind this boundary.

export type { JsonArray, JsonObject, JsonPrimitive, JsonValue, Metadata } from './domain/json'
export type {
  Asset,
  AssetKind,
  Credential,
  ExecutableServiceId,
  Grant,
  GrantStatus,
  Link,
  LinkAccess,
  Network,
  Platform,
  Privilege,
  Segment,
  Service,
  ServiceStatus,
  TargetPlatform,
  Transport,
  VulnerabilityFact,
  VulnerabilityStatus,
} from './domain/network'
export { EXECUTABLE_SERVICE_IDS } from './domain/network'
export type {
  Capability,
  Confidence,
  MalwareProfile,
  Mechanism,
  ProfileScope,
  RemoteExecutionCapability,
  RemoteExploitCapability,
  ReviewStatus,
  SourceKind,
  SourceRecord,
} from './domain/profile'
export type {
  CompiledScenario,
  EffectiveInput,
  FieldChange,
  Intervention,
  InterventionManifest,
  InterventionRecord,
  InterventionType,
  ManifestEntityKind,
  ModelVersion,
  ScenarioDocument,
  SetAssetIsolation,
  SetBoundaryAccess,
  SetGrantStatus,
  SetServiceStatus,
  SetVulnerabilityStatus,
} from './domain/scenario'
export { MODEL_VERSION } from './domain/scenario'
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
  Result,
  SourceLocation,
} from './domain/diagnostics'
export { formatPath, hasErrors } from './domain/diagnostics'
export { ADMISSION_LIMITS } from './domain/limits'

export { detectFormat, parseDocument, type DocumentFormat, type ParseOptions } from './io/document'
export { canonicalJson } from './io/canonical-json'
export { NATIVE_SCHEMAS } from './schema'

export {
  compileScenario,
  importScenario,
  validateNetwork,
  validateProfile,
  type ProfileValidationOptions,
} from './scenario/compile'
export { fieldRefs } from './scenario/interventions'
export { semanticProjection } from './scenario/canonical'

export { ENGINE_VERSION, runScenario, evaluateCapability, outcomeOf } from './engine'
export type {
  AbortCode,
  AssetCompromisedEvent,
  AssetDiscoveredEvent,
  Check,
  CheckCode,
  CheckStatus,
  Evaluation,
  EvaluationContext,
  EventType,
  FinalRunState,
  Outcome,
  ParentRecord,
  PropagationAttemptedEvent,
  PropagationResolvedEvent,
  PropagationSkippedEvent,
  RunAbortedEvent,
  RunCompletedEvent,
  RunOptions,
  RunResult,
  RunStartedEvent,
  RunStatus,
  SimulationEvent,
  SkipReason,
} from './engine'

export { analyzeRun, firstCompromisePath, compareScenarios, diffAnalyses } from './analysis'
export type {
  AttemptCounts,
  ComparisonMetrics,
  MechanismContributions,
  PathStep,
  RunAnalysis,
  ScenarioComparison,
} from './analysis'

export {
  applyEvent,
  initialReplayState,
  replayFinalState,
  seekReplay,
  stepBackReplay,
  stepReplay,
} from './replay'
export type { AttemptStatus, AttemptView, ReplayParent, ReplayState } from './replay'
