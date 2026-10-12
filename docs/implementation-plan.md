# Implementation plan and Codex handoff

## Intended workflow

These documents give Codex a coherent design to implement. The owner can guide the product and review assumptions while an agent handles substantial implementation work. The useful review questions are what makes movement eligible, how unknowns are handled, what causes a compromise and what the output does not prove.

This package is a proposed specification, not production code or a claim that tests have already passed. Start with the architecture and canonical scenarios, then implement one verified layer at a time. V1 remains the complete product slice defined in `architecture.md`; the early small fixtures are correctness checkpoints rather than the final product scope.

## Build sequence

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| 1. Native contracts | Types, JSON Schemas, parser/semantic validation, canonical snapshots | JSON/YAML equivalence and invalid inputs checked |
| 2. Deterministic core | Adjacency indexes, fixed evaluators, queue, event stream | Scenarios 001 and 003–009 pass exact expectations |
| 3. Analysis and replay | Counts, witness paths, intervention compiler, comparison, reducer | 002 and 010 pass; final replay equals engine state |
| 4. Reference-based UI | Isometric SVG map, inventory, inspector, playback, responsive list alternative | End-to-end five-node replay and comparison are explainable |
| 5. Curated demonstrations | Two evidence-reviewed real profiles and small environments | Capability-by-capability provenance review; limitations visible |
| 6. Release polish | Import/export, errors, cancellation, performance and accessibility | Full canonical suite and measured UI acceptance checks |

Status: milestones 1 (native contracts), 2 (deterministic core) and 3 (analysis, comparison and replay) are implemented and reviewable (`bun run test`, `bun run build`). See `core-integration.md` for the boundary, the engine/analysis/replay entry points, the remaining frontend assumptions and the decisions taken within the contract.

Do not couple engine progress to animation. Implement the causal inspector before adding elaborate visual effects. A beautiful map with fabricated decisions does not satisfy milestone 4.

## Deliverables by subsystem

Network: static types and validation, no run state. Profile: reviewed capability records and evidence validation. Scenario: effective snapshots, intervention manifests and digests. Engine: deterministic events and final state. Analysis: results and comparisons. Replay: pure reducer and cursor seeking. UI: presentation and interaction only. Fixtures: all canonical cases and independent expected outcomes.

The real-profile milestone must not block verifying the engine with synthetic fixtures. Candidate names can include well-documented self-propagating malware, but selection requires verifying the available primary research and modeled limitations. Avoid padding the library with families that do not autonomously propagate under these mechanisms.

## Agent instructions

Use this prompt with the extracted package:

> Read README.md, docs/architecture.md and docs/validation-scenarios.md, then the remaining subsystem contracts. Implement milestone 1 only. Use the proposed TypeScript core unless the existing repository provides a justified constraint. Before coding, give a concise explanation of the module boundaries and any conflict in the specification. Resolve routine choices within the contract. Do not invent malware capabilities, map STIX labels directly to executable rules, add probabilities, generate fake timing metrics or make the UI decide compromise. Keep examples explicitly synthetic until their research evidence is reviewed. Report what changed, checks run and remaining model limitations. Stop at the milestone boundary with a concrete reviewable result.

For subsequent milestones, replace the milestone number and name. Reuse the same native contract; update the design docs and canonical expectations if a real change is needed. Never label unrun checks as passing.

## Design review checkpoints

After milestone 2, explain the queue in scenario 001 and why C does not stay permanently blocked. After milestone 3, explain relative reduction versus percentage points and why indeterminate targets are not a full worst-case estimate. After milestone 4, demonstrate that playback speed, pause and camera movement leave the result unchanged.

These are short architecture discussions, not requirements that the owner personally reimplement every module. They make the project intelligible and defendable while using AI for implementation.

## Deferred roadmap

Next: richer evidence adapters, native STIX-to-draft conversion, optional hash enrichment, identity/credential acquisition, dynamic containment, separately evaluated alternate paths and candidate-control experiments. Each extension needs a new contract and fixtures before implementation. Optimization comes only when measured repeated simulations justify it.

## Remaining choices

This draft proposes TypeScript, a browser worker, SVG projection, a dark initial theme and the scale limits. They are concrete defaults that permit implementation, not claims of prior approval. Real malware profile selection and exact glyph/palette design remain implementation tasks with reviewable outputs. None prevents starting the native model and canonical core.
