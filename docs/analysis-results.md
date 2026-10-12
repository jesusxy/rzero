# Analysis and results model

## Purpose

Analysis summarizes completed engine output without reinterpreting propagation. It provides counts, causal witnesses and controlled comparison. Replaying at a different speed cannot change a result.

## Completed result contract

Retain `input_digest`, model/engine/profile versions, `status: completed`, total assets, sorted compromised IDs, sorted unaffected IDs, sorted indeterminate target IDs, attempt counts by outcome, critical compromised IDs, mechanism counts and first-parent records.

A partial run uses `status: aborted`, retains the abort reason and may expose observations so far. It must not publish a completed blast-radius comparison or rank defensive impact.

| Metric | Definition |
| --- | --- |
| Compromised assets | Unique compromised IDs, including the seed |
| Unaffected in this run | All asset IDs minus compromised IDs; does not imply safe in reality |
| Modeled blast radius | Compromised assets / total modeled assets |
| Successful / blocked / indeterminate attempts | Counts of resolved events with each outcome |
| Critical assets reached | Compromised assets with `critical: true` |
| Mechanism contribution | Non-seed first compromises attributed to each selected mechanism |
| Indeterminate targets | Unique targets with an indeterminate attempt that remain uncompromised at completion |
| First-compromise depth | Hop recorded in a parent record; never presented as seconds |

Indeterminate targets are a subset of unaffected assets. Blocked attempts are not assets and may refer to hosts subsequently compromised. Do not sum overlapping categories into a total. Mechanism contributions must sum to compromised count minus one.

## Causal paths

For a selected compromised target, follow first-parent pointers backward to the seed, then reverse the list. Each step carries link, capability, attempt ID, check facts and capability evidence. The seed's path contains only itself. An uncompromised asset has no compromise path, though its failed/indeterminate attempts remain inspectable.

V1 returns one reproducible first-compromise path. It does not claim to enumerate alternate successful paths. The engine deliberately skips already-compromised targets, so counting all paths from the event stream would be incorrect. A later attack-path subsystem needs a separately evaluated eligible-transition graph or an extended event policy.

## Baseline comparison

Validate matching asset IDs, seed, profile revision, model and engine versions. Include the intervention manifest beside the result. Let B be the baseline compromised count and M the modified count:

- Absolute reduction = B − M.
- Relative reduction = (B − M) / B × 100.
- Percentage-point change = (B / N − M / N) × 100.
- No longer compromised = baseline IDs minus modified IDs.
- Newly compromised = modified IDs minus baseline IDs.

B is at least one because the seed is supplied compromised. Retain a general zero-denominator guard for future formats. Negative reduction is displayed as an increase, never clamped to zero. Do not relabel relative reduction as percentage points.

For the five-node baseline in `validation-scenarios.md`, B=3. Denying B → D yields M=2. Absolute reduction is 1, relative reduction is 33.3%, and blast radius changes from 60% to 40%, a 20 percentage-point decrease.

Use “no longer compromised in this scenario” in detailed output. A shorter headline may say “assets protected by this modeled change,” accompanied by the assumption context. A result is not a universal effectiveness score for a security product.

## Reason summaries and unknowns

Aggregate blocked reasons using the primary failed check if a mutually exclusive bar chart is needed. Label that chart “primary blocking reason.” For an all-reasons chart, count all failed checks and state that one attempt may contribute to several bars.

Display indeterminate attempt count and unresolved target IDs prominently. A completed engine run with unknown facts is still a completed deterministic evaluation; its exposure estimate is incomplete. Do not derive a worst-case count by simply adding indeterminate targets because their possible onward propagation was never evaluated. Later pessimistic/optimistic runs must explicitly change unknown fact assumptions and rerun.

## Export and validation

JSON exports include full input snapshots, result, event stream and comparison manifest when applicable. Include labels and evidence so an exported result can be inspected without a remote service. The text report names profile scope and limitations, the initial asset and effective intervention, then shows results and selected witness paths.

Acceptance checks independently recompute counts from events, verify partition equality between compromised/unaffected sets, verify mechanism totals, verify acyclic parent paths and compare exact asset-set differences. The analysis module cannot convert a blocked attempt into a compromise or infer unobserved route counts.
