# Core integration notes

Status: milestones 1 (native contracts), 2 (deterministic engine) and 3 (analysis, comparison, replay) are implemented. Revision 0.3, 12 October 2026.

## The integration boundary

The frontend, the CLI (`scripts/rzero.ts`), a future simulation worker and the tests all import from **`src/core/index.ts`** and nothing deeper. The core is plain ECMAScript with one runtime dependency (`yaml`). It has no DOM, Node, Bun or Solid imports: `tsconfig.core.json` type-checks it against `ES2023` plus one sanctioned addition, and `tests/core/boundary.test.ts` enforces both rules.

**Platform restrictions.** The core may use exactly one set of globals beyond ECMAScript: the host-neutral WHATWG Encoding primitives `TextEncoder`/`TextDecoder`, which are synchronous and present in browsers, Web Workers, Node and Bun. They are declared on their own in `types/platform-encoding.d.ts`, included only by the core project (the app gets them from its DOM lib), so the core's type environment still excludes the DOM, Node and Bun libraries. UTF-8 handling (`io/utf8.ts`) uses these. Two other primitives stay deliberately custom: the SHA-256 for the canonical digest (`scenario/sha256.ts`) — because the only universal platform digest, WebCrypto, is asynchronous and the digest is computed on the synchronous compile path; and the JSON Schema validator (`schema/validator.ts`) — because it is the single source of the stable `DiagnosticCode`/path error contract and a general validator (Ajv) would add a browser dependency that defaults to `eval`-based codegen and an error-mapping layer. Ajv is kept as a dev-only oracle in the schema tests.

| Call | Use |
| --- | --- |
| `importScenario(bytes \| text, { fileName?, format? })` | File import (JSON or restricted YAML) → `Result<CompiledScenario>` |
| `compileScenario(value)` | Scenario assembled in memory, e.g. by the UI from built-in network and profile selections |
| `validateNetwork(value)` / `validateProfile(value, { requireReviewed? })` | Standalone library objects; drafts validate but cannot run |
| `parseDocument(...)` | Parse only (size, UTF-8, duplicate keys) |
| `NATIVE_SCHEMAS` | The published JSON Schemas, e.g. for editor integration |
| `runScenario(compiled, { maxEvents?, shouldCancel?, engineVersion? })` | Run the engine → deep-frozen `RunResult` |
| `evaluateCapability`, `outcomeOf` | The mechanism evaluators, exposed for the inspector |
| `analyzeRun(compiled, run)` | Summarize a run → `RunAnalysis` (counts, sets, paths' parent records) |
| `firstCompromisePath(run, assetId)` | One seed-first witness path, with checks and evidence |
| `compareScenarios(baseline, intervention, options?)` | One-change comparison → `Result<ScenarioComparison>` |
| `diffAnalyses(baseline, modified)` | Comparison metrics with compatibility enforcement |
| `seekReplay` / `stepReplay` / `stepBackReplay` / `replayFinalState` / `initialReplayState` | Pure replay reducer over the event stream |
| `fieldRefs`, `semanticProjection`, `canonicalJson` | Shared helpers for the inspector and export |

A `Result` is `{ ok: true, value, diagnostics }` (warnings only) or `{ ok: false, diagnostics }`. The UI should show each diagnostic's `code`, `path`, `message` and, when present, `location` and `entity_id`. The engine accepts only `CompiledScenario`, reading its deep-frozen `effective` input; the UI must never read mutable form state during a run.

## The engine (milestone 2)

`runScenario(compiled)` performs the deterministic breadth-first traversal in `docs/simulation-engine.md` and returns a deep-frozen `RunResult`:

- `status`: `completed` or `aborted`.
- `events`: the ordered `SimulationEvent[]` (the exportable, replayable artifact). Each has `event_id`, `seq`, `type`, `hop`; see `docs/event-model.md`.
- `state`: `FinalRunState` for analysis and replay — `seed_id`, `compromised`/`discovered`/`processed` in engine order, `parents` (first-compromise records sorted by asset ID, each with link, capability, attempt and hop) and a `hops` map including the seed at 0.
- `engine_version`, `model_version`, `input_digest`: carried through for export identity.
- `abort`: `{ code, last_processed_seq }` when aborted (`EVENT_LIMIT` or `CANCELLED`).

The engine owns run state only; it never mutates the effective network. It is renderer-agnostic and takes no animation input: a UI reduces `events` to reconstruct state at a replay cursor. Determinism comes from fixed orderings — links by `(target_id, service_id, id)`, capabilities by ID, credential witnesses by ID — so the same compiled scenario always yields the same events. Compromise is marked at enqueue, so converging paths compromise once and cycles terminate.

## Analysis, comparison and replay (milestone 3)

Three rendering-free modules consume the engine's output; none re-runs or reinterprets propagation.

- **Analysis** (`src/core/analysis/analyze.ts`). `analyzeRun(compiled, run)` recomputes counts and sets from the recorded events and parent records: compromised/unaffected (a partition of the asset universe), indeterminate targets (a subset of unaffected), critical reached, attempt counts by outcome, mechanism contributions (summing to compromised − 1), blast radius, and primary blocking reasons. It marks `status: aborted` for a partial run and never publishes it as complete. `firstCompromisePath(run, assetId)` walks parent pointers to the seed and reverses, attaching each step's link, capability, attempt, resolved check facts and evidence.
- **Comparison** (`src/core/analysis/compare.ts`). `compareScenarios(baseline, intervention, options?)` is the one-change experiment: it appends one intervention to the baseline's canonical `source` and recompiles through `compileScenario`, so the baseline is never mutated and an overlapping or invalid intervention is rejected by the compiler. It runs both snapshots on the same engine and returns both analyses, the metrics, the added intervention's manifest record and both runs. `diffAnalyses` computes absolute/relative reduction and percentage-point change (negative values shown as an increase, never clamped) and enforces the compatibility rules, refusing a comparison that involves an aborted run or a mismatched universe/seed/profile/version.
- **Replay** (`src/core/replay/reducer.ts`). A pure reducer; see the cursor semantics in `docs/event-model.md`. A UI uses it to scrub without re-running the engine.

## How imported data becomes a validated scenario

1. **Intake.** The document must be at most 5 MiB and valid UTF-8. JSON is parsed strictly, and YAML is restricted to its JSON-compatible subset. Duplicate keys, anchors, aliases, tags, multiple documents, non-finite numbers and nesting deeper than 64 levels are rejected with a path and line/column.
2. **Gatekeeping.** STIX content is refused with an explanation, because intelligence is not an executable profile. `model_version` must be `rzero/1`. Admission limits (250 assets, 2,000 links, 4 capabilities) are checked before any further work.
3. **Shape.** The JSON Schemas run with closed objects, so unknown executable fields are rejected and free-form data is allowed only in `metadata`.
4. **Semantics.** The core checks unique IDs, references, self and duplicate links, duplicate grants, the TCP-only rule for SMB/WinRM, the initial asset, profile evidence resolution, non-synthetic evidence for real profiles, calendar dates and `review_status: reviewed`.
5. **Interventions.** Every target must exist and every boundary selector must match at least one link. Overlapping writes are rejected. The interventions are applied to a canonical copy, and a manifest records each original and effective value, with no-ops reported.
6. **Identity.** Entities are sorted canonically. The semantic projection (facts, not labels, prose or metadata) is serialized as canonical JSON and hashed with SHA-256 to give `input_digest`.
7. **Snapshot.** `{ source, effective, manifest, input_digest, profile_content_digest }` is deep-frozen and returned. Unknown facts survive unchanged: a missing vulnerability entry stays missing, and a warning points it out.

## Decisions taken within the contract

These choices fill gaps in the documents; the subsystem documents now record them.

- Diagnostics gained `severity` and an optional parse `location`. The root path is `""`. Stages short-circuit, so semantic checks never run on malformed shapes.
- `metadata` is allowed on the scenario, the network and every entity with an `id`, but not on services, vulnerability facts or grants.
- `sha256` is rejected on non-sample profiles. A profile needs at least one capability and one limitation, and each capability needs at least one assumption.
- Real-profile evidence rules apply to drafts too. A draft is valid standalone but cannot compile into a scenario.
- Intervention IDs are excluded from `input_digest`, as the document's definition says: the digest identifies the effective input, and the manifest explains it. A vulnerability upsert on a missing fact records `original: null` and is not a no-op.
- `profile_content_digest` was added so a later library can flag a changed profile that kept its version.
- Link `service_id` may name any inventoried service; only capabilities and grants are restricted to `smb`/`winrm`.

## Frontend assumptions that need attention later

The existing UI is an illustrative prototype. Its mock types in `src/domain/` and its data in `src/data/` were left untouched and conflict with the specification as follows:

| Prototype assumption | Specification |
| --- | --- |
| `AssetNode.infectionState` (`clean`/`infected`/`spreading`/`contained`) is stored in the topology | Run state belongs to the engine and replay reducer. Asset states are `modeled`/`discovered`/`compromised`, and V1 has no `contained` |
| `AssetType` includes `endpoint`, `database`, `router`, `firewall`, `mail-server`, `domain-controller` | `kind` is `workstation`/`server`/`controller`/`appliance`/`other`. Silhouettes need a mapping |
| `os` and `patchLevel` free text | `platform` is an enum. Vulnerability is never inferred from versions; an OS string belongs in `metadata` |
| `privilegeTier` per asset, `edr: boolean` | Privilege lives on credential grants. An EDR label cannot block anything and is at most metadata |
| `NetworkEdge.allowedProtocols` (SMTP, LDAP, …), `guardedBy` | Links are directed, carry one service and have `access`. Controls are explicit interventions |
| `instanceCount` folds many hosts into one node | Each asset is one machine. Folding hosts would distort blast-radius counts |
| `position` and `route` on the domain node | Presentation only. Use `metadata.layout`, or derive a stable layout per segment sorted by ID |
| `MalwareProfile.spreadWeightsByAssetType`, `typicalDwellTimeMinutes`, C2, persistence, initial-access vector | Probabilities and timing are forbidden. Profiles are reviewed capability records with evidence |
| `SimulationEvent.time` and kill-chain event types | Events use `seq`/`hop`, with the vocabulary in `event-model.md` |
| "Phishing Infostealer" (no lateral movement) placeholder | Avoid non-propagating families. Built-ins should start with the synthetic lab profile |
| Story panel promises the "kill chain" will unfold | Only modeled propagation is simulated. Copy should describe blast radius and blocked routes |
| Paper/light palette | The spec asks for the dark reference as the initial theme with a paper variant later. The current visual direction is preserved here pending an owner decision |
| Edge layer commented out in `MapStage` | Routes, including denied ones, must be drawn. `routePoints` is temporarily exported only to keep the build green |
| Asset labels such as "mail", "hr" | Use real host labels and keep IDs available on selection |
| Top bar has one "Reset" button | The spec separates reset-camera, restart-replay and new-run |

Missing inputs: `AGENTS.md`, the `references/` screenshots and `docs/sources.md` (cited by `malware-profile.md`) are not in the repository. The visual direction was taken from the existing UI and `frontend-visualization.md`.

## Commands

```bash
bun install
bun run test                       # unit tests (bun test)
bun run typecheck                  # tsc -b: app, core (ES-only), tests, vite config
bun run build                      # typecheck + Vite production build
bun run rzero validate fixtures/scenarios/001-five-node-baseline.yaml
bun run rzero run      fixtures/scenarios/001-five-node-baseline.json   # print the event stream
```
