# Simulation engine

## Conceptual algorithm

Use a FIFO queue of compromised assets waiting to try their outgoing modeled links. The seed starts in that queue. A newly compromised target is added once. When the queue is empty, no more movement can occur under the static rules.

This is breadth-first traversal with requirements on each candidate transition. It yields deterministic first-compromise paths of minimum hop count in the eligible static graph. It does not calculate the fastest real attack or enumerate every possible successful route.

## Inputs, state and outputs

Input: a validated effective scenario and an engine version. Output: an ordered event stream and final run state. The engine accepts neither rendering instructions nor live threat-intelligence responses.

Run state contains a FIFO queue, compromised set, discovered set, processed source set, parent records, attempt counter and event counter. Each parent record stores source, link, capability, attempt ID and hop. State is local to the run; no global mutable caches may affect later runs.

The seed is compromised with hop 0 and has no parent. Its vulnerability and inbound defenses are irrelevant to that supplied initial condition. Its isolation still blocks outward movement.

## Deterministic processing

```text
emit run_started
emit seed asset_compromised
enqueue seed

while queue is not empty:
    source = dequeue
    for link in source's outgoing links sorted by (target_id, service_id, id):
        if target is already compromised:
            emit propagation_skipped
            continue
        capabilities = matching-service capabilities sorted by id
        if capabilities is empty:
            continue
        if target has not been discovered:
            emit asset_discovered
            mark discovered
        for capability in capabilities:
            emit propagation_attempted
            evaluate all fixed checks against effective input
            emit propagation_resolved
            if all checks pass:
                mark target compromised
                record its first parent and source hop + 1
                emit asset_compromised
                enqueue target
                break
    mark source processed
emit run_completed
```

Mark compromise when enqueuing, not when dequeuing, to prevent duplicate parents and duplicate work through converging paths. Failed or indeterminate targets can be reconsidered from other sources/links. The same source/link/capability is never retried in a static run.

Matching-service capabilities are alternatives: if one fails, try the next; stop after the first success. The chosen cause is deterministic ID order, not a claim that this is malware's actual preference. Paths are one canonical witness, not all attack paths.

## Check semantics

Source/target isolation is boolean. Target platform passes if in the capability's supported list; `unknown` yields unknown. Access passes on `allow`, fails on `deny`, is unknown on `unknown`. Service passes on `enabled`, fails on `disabled` or an absent service, and is unknown on explicit unknown status.

Exploit vulnerability passes on `present`, fails on `absent`, and is unknown on an unknown or missing entry. Unknown is never a probability.

Credential authorization considers only credentials in the source's availability list and their exact target/service grants. At least one valid grant with enough privilege passes. Otherwise, at least one unknown grant with enough privilege produces unknown. All remaining cases fail, including missing grants, invalid grants and insufficient privilege. Choose the qualifying credential deterministically by ID for the recorded witness. Never export a secret.

All checks are evaluated. Any fail yields blocked; otherwise any unknown yields indeterminate; otherwise success. This permits a denied boundary to be decisive even if vulnerability status is unknown.

## Time and scheduling

Events at a candidate target use `source.hop + 1`. Run completion uses the maximum compromise hop, or zero if only the seed is compromised. Skip events use source hop plus one. Event sequence is the authoritative replay order; hop is a contextual depth and may not increase on every event.

V1 animation uses a separate playback clock. A UI setting of 1× or 2× changes how quickly events are displayed, not what the engine computes. Do not display fabricated compromise seconds or time-to-domain-controller metrics. Weighted latency and a priority queue are a later model change requiring measured or explicit modeled delays.

## Termination, complexity and cancellation

Every compromised asset is processed once. Every outgoing link is visited at most once, and each matching capability is evaluated at most once per link. With V assets, E links and K capabilities, traversal is O(V + E×K) after indexing, plus credential-check work. Pre-index grants to avoid scanning the whole credential inventory per attempt. Event storage grows with evaluated attempts.

Build adjacency and grant indexes once per run. Cycles cannot create infinite propagation because compromise is marked before enqueue. A worker can check cancellation between links; cancellation emits `run_aborted` and a partial result. Pause in the interface pauses replay, not engine state.

Admission limits come from `architecture.md`. Reserve capacity for an entire attempt group (attempted, resolved and possible compromise) plus a terminal abort before starting it. Commit a successful resolution, compromise state and compromise event together; cancellation cannot split that group. Check remaining capacity before other normal events as well. A limit violation must end explicitly as aborted. Never silently drop explanation events or call truncation a completed run.

## Acceptance invariants

The seed remains compromised. Compromised state is monotonic. Each non-seed compromise has exactly one successful parent attempt. Every parent is already compromised and has smaller hop. No successful resolution occurs with a failed or unknown check. Final compromise IDs match the event reducer. Input arrays, graph layout, animation frame rate and prior runs cannot change semantic results.

Dynamic credentials, control changes during propagation and retries after state changes are intentionally deferred: they require more than adding another field to this traversal.
