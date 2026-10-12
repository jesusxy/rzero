# Scenario model

## Purpose

A scenario assembles network facts, one reviewed profile, an initial compromise and static interventions. Compilation produces a self-contained immutable effective snapshot. Both the engine and analysis receive that snapshot; neither depends on mutable UI forms or files fetched during execution.

## Native envelope

```json
{
  "model_version": "rzero/1",
  "id": "canonical-001",
  "name": "Five-node lab",
  "network": {
    "segments": [], "assets": [], "links": [], "credentials": []
  },
  "profile": {},
  "initial_asset_id": "A",
  "interventions": [],
  "metadata": {"notes": "This outline omits the actual network and profile."}
}
```

This excerpt illustrates the envelope and is not a runnable scenario. Complete input requires populated, valid network/profile objects and an existing seed. V1 embeds the profile and network in exported scenarios. The UI may select built-in objects, but exports resolve those selections into full snapshots.

Required fields are all shown except `metadata`. Exactly one initial asset is supported. No random seed is required because the engine has no random behavior.

## Compile pipeline

1. Check file size, decode UTF-8 and parse with duplicate-key rejection.
2. Validate shape, supported model version, enum values and limits.
3. Validate all references and profile review/evidence rules.
4. Validate intervention targets and reject conflicting writes.
5. Apply interventions to a copied network, preserving an intervention manifest.
6. Canonicalize semantic input and compute its SHA-256 digest.
7. Hand the immutable effective snapshot and manifest to the engine.

The implementation should encode the native shapes as JSON Schema plus semantic validation. Schemas must reject unrecognized executable fields and permit arbitrary JSON only inside explicit `metadata` objects. This document specifies the contract; schema files are an implementation deliverable.

## Intervention vocabulary

| Type | Required selector | Value/change |
| --- | --- | --- |
| `set_boundary_access` | `id`, `from_segment_id`, `to_segment_id`, `service_id` | `access`: `allow`, `deny` or `unknown` on existing matching links |
| `set_vulnerability_status` | `id`, `asset_id`, `vulnerability_id` | `status`: `present`, `absent` or `unknown`; upsert the exact fact |
| `set_service_status` | `id`, `asset_id`, `service_id` | `status`: `enabled`, `disabled` or `unknown`; service must already exist |
| `set_asset_isolation` | `id`, `asset_id` | `isolated`: boolean |
| `set_grant_status` | `id`, `credential_id`, `target_id`, `service_id` | `status`: `valid`, `invalid` or `unknown`; grant must already exist |

Each intervention must affect a valid target. A boundary selector matching zero links is an error, not a successful empty action. Two interventions writing the same effective field are rejected even if their values agree. Asset isolation is a separate gate and may coexist with a boundary access change.

An intervention setting an already equal value is allowed but reported as a no-op. The manifest records selector, affected entity IDs, original/effective values and no-op status. There is no priority-based policy language in V1.

## JSON, YAML and STIX boundaries

JSON and YAML represent the same native contract. YAML must be limited to JSON-compatible mappings, sequences, strings, finite numbers, booleans and null. Reject duplicate keys, custom tags, anchors/aliases, cyclic structures and multiple documents; disable implicit date/object construction. IDs and versions should be quoted when needed to remain strings. Validate parsed values identically.

STIX 2.1 JSON is a different schema, not another spelling of a Rzero scenario. V1 import detects it and explains that reviewed profile conversion is required. The later adapter described in `malware-profile.md` owns conversion.

## Canonicalization and version identity

Sort entity arrays by ID, services/vulnerabilities by their IDs and grants by target/service. Sort semantic sets such as target platforms, credential references and evidence references. Preserve order only where the contract declares it meaningful; V1 has no user-configurable capability order. Object keys use a consistent canonical order with UTF-8 encoding and no nonfinite numbers.

The effective digest includes model version, network, profile and seed after intervention application; excludes labels, layout and free-form metadata. Profile revision and evidence identifiers remain included. Retain the full snapshot alongside the digest: the digest is an identity check, not the only archival record.

Engine version is retained separately. Labels and explanations may change byte-for-byte exports; semantic reproducibility compares normalized events using IDs, check codes, statuses and facts rather than localized display text. Export dates and run IDs are not part of that comparison.

## Comparison rules

A V1 comparison takes an already compiled baseline, applies exactly one new intervention to a copy and executes both effective snapshots. The baseline may contain its own preexisting intervention manifest. The added intervention must not overlap an existing write; edit the baseline first if it does.

Keep asset universe, seed, profile revision, engine and model versions identical. Otherwise show runs separately and reject the controlled comparison. Every comparison displays the actual changed fields so a user can verify the experiment. Never edit a recorded baseline in place.

## Errors

Return an ordered diagnostic list with `code`, `path`, `message` and optional `entity_id`. For example: `UNKNOWN_ASSET` at `network.links[2].target_id`. An invalid scenario cannot start. Unknown environmental facts are valid model values and must not be mistaken for import errors.
