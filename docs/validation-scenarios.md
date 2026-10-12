# Validation and canonical scenarios

## Purpose

These are independent behavioral expectations for implementation. They are design-level ground truth under explicit synthetic rules, not empirical malware behavior validation. The UI looking plausible is insufficient; exact state, reasons and determinism must agree.

Unless overridden, assets are Windows, unisolated, noncritical, in segment `lab`, with enabled SMB, vulnerability `LAB-SMB-1: present` and no available credentials. Links use service `smb` with access `allow`. The reviewed synthetic profile in `malware-profile.md` has the single `smb-exploit` capability. Each test starts from A. All listed edges are directed; no other edges exist.

## 001 — Five-node baseline

Links: A → B (`ab`), A → C (`ac`, deny), B → D (`bd`), D → E (`de`). E has `LAB-SMB-1: absent`.

| Attempt | Outcome | Decisive fact |
| --- | --- | --- |
| A → B | succeeded | All requirements pass |
| A → C | blocked | `NETWORK_ACCESS` fails |
| B → D | succeeded | All requirements pass |
| D → E | blocked | `VULNERABILITY_PRESENT` fails |

Expected compromised set `{A,B,D}`; unaffected `{C,E}`; successful attempts 2; blocked attempts 2; indeterminate attempts 0; skipped links 0. Blast radius 3/5 = 60%. Paths: B is A → B, D is A → B → D. Hops: A=0, B=1, D=2. Uncompromised E is not enqueued.

Queue progression: initialize `[A]`; after A → B, `[B]`; after A → C, `[B]`; after dequeuing B and B → D, `[D]`; after dequeuing D and D → E, `[]`. Only one source is dequeued at a time.

Semantic event order is exact:

1. run_started
2. asset_compromised A (seed)
3. asset_discovered B
4. propagation_attempted A → B
5. propagation_resolved A → B succeeded
6. asset_compromised B
7. asset_discovered C
8. propagation_attempted A → C
9. propagation_resolved A → C blocked
10. asset_discovered D
11. propagation_attempted B → D
12. propagation_resolved B → D succeeded
13. asset_compromised D
14. asset_discovered E
15. propagation_attempted D → E
16. propagation_resolved D → E blocked
17. run_completed

Sequences are 0–16. First-compromise parent references must point to the relevant successful attempts, not discovery events.

## 002 — Counterfactual segmentation

Use 001, place A/B/C in `workstations` and D/E in `servers` (update baseline membership before comparison), then add `set_boundary_access` workstations → servers SMB deny. It changes only `bd`.

Expected modified compromised `{A,B}`, unaffected `{C,D,E}`, success 1, blocked 2 (A → C and B → D), indeterminate 0. D is discovered but not compromised; E is never considered. Blast radius 40%. No longer compromised `{D}`. Absolute reduction 1, relative reduction 33.3%, percentage-point decrease 20. Baseline remains `{A,B,D}` after modified execution.

## 003 — Cycle termination

Links A → B, B → C, C → A. Expected `{A,B,C}`, success 2, blocked 0 and one skipped C → A link. Each source processes once; no extra compromise of A; hop depths 0,1,2. A repeated run produces identical semantic events.

## 004 — Alternate route after a block

Links A → B, A → C (deny), B → C (allow). Expected `{A,B,C}`. A → C is blocked, then B → C succeeds. C is discovered once and compromised once. Successful attempts 2, blocked 1. No asset-wide blocked state may prevent C's later compromise.

## 005 — Unknown vulnerability

A → B allowed. B has `LAB-SMB-1: unknown` (repeat with vulnerability entry omitted). Expected compromised `{A}`, indeterminate attempts 1, blocked 0, indeterminate targets `{B}`. B is not enqueued. In a second variant, deny A → B: blocked attempts 1, indeterminate attempts 0, and the emitted checks retain unknown vulnerability alongside failed access.

## 006 — Credentials and minimum privilege

Use a reviewed synthetic `remote_execution` WinRM capability requiring Windows and admin. A → B WinRM is allowed; B has enabled WinRM. A has credential `cred-a` with a B/WinRM grant.

Variants: valid admin → success, compromised `{A,B}`; valid user → blocked `CREDENTIAL_AUTHORIZED`; invalid admin → blocked; unknown admin → indeterminate; missing grant → blocked. Grant availability on an unrelated source does not help A. No vulnerability check appears for this mechanism.

## 007 — Multiple mechanisms

Links A → B SMB and A → B WinRM. Profile has SMB exploit and admin WinRM execution. Sort services lexically, so SMB is evaluated first. B's synthetic vulnerability is absent; A has valid admin WinRM authorization to B; both services enabled.

Expected SMB blocked then WinRM success; compromised `{A,B}`; successes 1, blocks 1; B's parent mechanism is `remote_execution`. For a same-service alternative variant, add a second SMB exploit capability with a different present weakness and a lexically later ID. The first fails and second succeeds; no later capability is attempted after success.

## 008 — Converging routes

Links A → B, A → C, B → D, C → D. Expected all four compromised; B processed before C; D's parent B; D compromised once. Three successes and one skipped C → D. Do not count two successful paths to D from this event stream.

## 009 — Isolation and service absence

A → B allowed. Isolated B: blocked `TARGET_NOT_ISOLATED`. In a separate variant isolate A: seed stays compromised, attempt blocked `SOURCE_NOT_ISOLATED`. In another remove B's SMB service: blocked `SERVICE_ENABLED`. None of these variants compromises B.

## 010 — Input and replay invariants

Reverse input array order in 001: semantic events, parent paths and effective digest remain equal. Change layout or playback speed: equal simulation output. Run twice: equal semantic output, fresh run-local state. Replay all events: exactly `{A,B,D}` compromised. Seek backward then forward: same reducer state. Camera reset never changes replay cursor.

## 011 — Invalid and bounded input

Reject duplicate asset IDs, dangling endpoints, duplicate source/target/service links, invalid sample hashes, draft profiles, missing capability evidence, self-links, unsupported model versions, executable unknown fields, conflicting interventions and zero-match boundary selectors. Reject duplicate YAML/JSON keys and YAML aliases/tags. Reject an admission-limit violation before traversal.

Cancellation or an event cap produces an aborted stream and partial status, never completed comparison. Exercise cap handling with a lowered test cap so the test remains small.

## Test strategy

Implement fixtures first with full explicit values. Assert exact sets, counts, check codes and causal witnesses; do not snapshot only English messages or SVG output. Property tests should establish no duplicate compromise, acyclic parents, partitioned result sets, permutation invariance and clean termination for cyclic graphs.

Test parser/schema validation, engine, analysis and replay reducer separately, then run one integrated five-node comparison through the UI. Independent expectations above should remain hand-authored; do not calculate test expectations by invoking the same evaluator under test.
