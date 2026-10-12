# Event model

## Purpose

Events form an append-only explanation of the engine's decisions. They support inspection, deterministic replay and result verification. A moving particle is a presentation of an event, not evidence that malware packets or processes were actually executed.

## Envelope and ordering

Every event includes `event_id`, `seq`, `type` and `hop`. Sequence numbers are contiguous integers starting at zero. Event IDs are stable within an exported stream, for example `e000001`; their identity does not depend on wall time. `hop` is a logical propagation depth, not seconds.

An optional export wrapper contains run ID and wall-clock creation time. Those wrapper values do not affect engine determinism. Events reference assets, links, capabilities, attempts and interventions by exact IDs.

## Vocabulary

| Type | Required payload | Interpretation |
| --- | --- | --- |
| `run_started` | Input digest, engine/model/profile versions, initial asset ID | Validated run begins; hop 0 |
| `asset_compromised` | Asset ID, parent asset ID or null, attempt ID or null | Single transition to compromised; seed has null parent/attempt |
| `asset_discovered` | Asset ID, source asset ID, link ID | First consideration as a candidate target |
| `propagation_attempted` | Attempt ID, source/target/link/capability IDs | Evaluation starts for a matching service capability |
| `propagation_resolved` | Same attempt references, outcome, checks, evidence IDs | Evaluation ends exactly once |
| `propagation_skipped` | Source/target/link IDs, reason code | Target already compromised; excluded from attempt counts |
| `run_completed` | Compromised IDs, discovered IDs, processed source IDs | Queue exhausted; final snapshot |
| `run_aborted` | Error code, last processed seq | Resource limit/cancellation/fault; result is partial |

The discovery event means considered by this model. V1 does not implement scanning behavior or attacker knowledge. The full modeled topology is visible from the beginning.

## Attempt checks

A check contains `code`, `status`, `expected`, `observed`, `entity_refs` and optional `intervention_ids`. Status is `pass`, `fail` or `unknown`. Values must be bounded JSON facts, never credentials. An optional derived message makes the result readable; the code and facts are authoritative.

Fixed check order is `SOURCE_NOT_ISOLATED`, `TARGET_NOT_ISOLATED`, `TARGET_PLATFORM`, `NETWORK_ACCESS`, `SERVICE_ENABLED`, followed by `VULNERABILITY_PRESENT` or `CREDENTIAL_AUTHORIZED`. All applicable checks are emitted even if an earlier one fails; the UI can then distinguish two simultaneous barriers.

```json
{
  "event_id": "e000009", "seq": 9, "type": "propagation_resolved", "hop": 1,
  "attempt_id": "a000002", "source_id": "A", "target_id": "C",
  "link_id": "ac-smb", "capability_id": "smb-exploit",
  "outcome": "blocked",
  "checks": [{
    "code": "NETWORK_ACCESS", "status": "fail",
    "expected": "allow", "observed": "deny",
    "entity_refs": ["ac-smb"], "intervention_ids": ["deny-lab-boundary"]
  }],
  "evidence_ids": ["lab-definition"]
}
```

This is a shortened example; real resolved events include all applicable checks in the fixed order.

## Outcome rules

`blocked` means at least one check failed, even when other checks are unknown. `indeterminate` means no failures and at least one unknown. `succeeded` means every check passed and the engine will immediately emit a corresponding compromise event before processing any other attempt.

For display, the primary reason is the first failed check in fixed order, or the first unknown if none failed. Keep all additional reasons. Profile evidence supports the capability; environmental check facts explain the outcome. These are different parts of the inspector.

No generic `blocked` asset transition exists. A host may receive failed attempts and later become compromised through another source or mechanism. No dynamic `contained` transition exists in V1; host isolation is static input and a gate.

## Causality and invariants

Attempt IDs increment in encounter order. Each attempted event has exactly one later resolved event unless the run aborts during evaluation; incomplete attempts must be marked incomplete in partial replay. Each non-seed compromise references a successful resolved attempt and its already-compromised source. First-compromise hop is source hop plus one.

A successful resolution is followed immediately by compromise. Discovery precedes the first attempt for that target, even when its link is denied. A skipped link does not emit another discovery for an already-compromised target. A link with no matching profile capability emits no attempt; the inspector can explain that through the static model, not fabricate an engine event.

Completion occurs only after all compromised sources have been processed. A completed stream has one start and one terminal completion; an aborted stream ends with an abort instead. There are no events after the terminal event.

## Replay responsibilities

The replay reducer changes only discovery and compromise state from their respective events. Attempt events populate an attempt ledger and temporary animation state. A blocked attempt cannot remove a compromise or set a permanent safe flag. The reducer must rebuild identical final asset state from a completed stream.

Checkpoints may accelerate seeking but are derived caches. Export the source events and invalidate checkpoints when the event digest changes. Future contract changes require explicit versions rather than inference from missing fields.
