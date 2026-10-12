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

Implemented in milestone 1: the JSON Schema 2020-12 files live in `src/core/schema/` (`common`, `network`, `profile`, `scenario`) and are executed directly by the core, so the published schemas and the enforced shape cannot drift. Each stage runs only when the previous one produced no errors: parse → STIX detection and `model_version` → admission limits → schema → references/profile rules → interventions. Semantic checks therefore never see malformed shapes, and every error within a stage is reported together.

`metadata` is accepted on the scenario, the network, and every entity with its own `id` (segment, asset, link, credential, profile, source, capability, intervention). It is not accepted on the executable sub-facts (service, vulnerability, grant). Metadata must still be JSON: finite numbers, well-formed strings and no cycles.

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

Manifest shape (`InterventionRecord`, sorted by `intervention_id`): `intervention_id`, `type`, `selector` (the authored selector fields), `value` (the authored `access`/`status`/`isolated`), sorted `affected_entity_ids`, `changes` and `noop`. Each change has a `field_ref`, `entity_kind`, `entity_id`, `original`, `effective` and `noop`. Field references are stable strings shared with the later engine and inspector: `link:<id>/access`, `asset:<id>/isolated`, `asset:<id>/service:<id>/status`, `asset:<id>/vulnerability:<id>/status` and `credential:<id>/grant:<target>:<service>/status`. IDs cannot contain `:` or `/`, so references are unambiguous. Conflicts are detected by `field_ref`, which is why two identical boundary selectors conflict even when their values agree.

A vulnerability upsert on a missing fact records `original: null` and is never a no-op, even when it writes `unknown`: it changes the snapshot from an implicit unknown (no entry) to an explicit fact. Interventions write only facts that already exist, apart from that upsert. Service and grant targets must exist, and a boundary selector must match at least one link. Intervention order in the input has no effect. A no-op also emits an `INTERVENTION_NOOP` warning.

## JSON, YAML and STIX boundaries

JSON and YAML represent the same native contract. YAML must be limited to JSON-compatible mappings, sequences, strings, finite numbers, booleans and null. Reject duplicate keys, custom tags, anchors/aliases, cyclic structures and multiple documents; disable implicit date/object construction. IDs and versions should be quoted when needed to remain strings. Validate parsed values identically.

Implementation (milestone 1): YAML is parsed with the YAML 1.2 core schema forced, so `2026-10-12`, `yes` and `no` are strings. Explicit tags of any kind, including `!!str`, are rejected, as are `%YAML` directives other than 1.2, non-string mapping keys and `.inf`/`.nan`. JSON is parsed by a strict parser that rejects duplicate keys, non-finite numbers and unpaired surrogates. Both parsers bound nesting at 64 levels and report the field path plus line/column of the first problem. The format comes from the file extension (`.json`, `.yaml`, `.yml`). Otherwise, content starting with `{` or `[` is read as JSON and anything else as YAML. A leading UTF-8 BOM is ignored.

A STIX bundle or STIX object at the document root, or in a scenario's `profile` field, is rejected with `STIX_NOT_NATIVE`. A STIX object is recognized by a `type--uuid` `id` plus `spec_version`, or by `type: bundle`. STIX identifiers remain valid as provenance in a source record's `external_object_id`/`external_version`.

STIX 2.1 JSON is a different schema, not another spelling of a Rzero scenario. V1 import detects it and explains that reviewed profile conversion is required. The later adapter described in `malware-profile.md` owns conversion.

## Canonicalization and version identity

Sort entity arrays by ID, services/vulnerabilities by their IDs and grants by target/service. Sort semantic sets such as target platforms, credential references and evidence references. Preserve order only where the contract declares it meaningful; V1 has no user-configurable capability order. Object keys use a consistent canonical order with UTF-8 encoding and no nonfinite numbers.

The effective digest includes model version, network, profile and seed after intervention application; excludes labels, layout and free-form metadata. Profile revision and evidence identifiers remain included. Retain the full snapshot alongside the digest: the digest is an identity check, not the only archival record.

Exact rzero/1 definition: `input_digest` is the lowercase hex SHA-256 of the UTF-8, RFC 8785-compatible canonical JSON (keys sorted by UTF-16 code unit, no whitespace) of this projection of the effective input:

- `model_version` and `initial_asset_id`. "Seed" in this document means the initial asset; there is no random seed.
- network: segment IDs; per asset, every fact except `label` and `metadata` (`id`, `kind`, `platform`, `segment_id`, `critical`, `isolated`, services, vulnerability facts, `credential_ids`); per link, every field except `metadata`; per credential, `id` and grants.
- profile: `id`, `version`, `scope`, `sha256` when present, `review_status`, source `id` and `kind`, and per capability `id`, `mechanism`, `service_id`, `target_platforms`, `vulnerability_id` or `minimum_privilege`, `evidence_ids` and `confidence`.

Excluded: scenario `id`/`name`, every label/name/title, prose (`claim_summary`, assumptions, limitations), URLs, ATT&CK/MBC navigation references, intervention IDs and all metadata. Because the digest identifies the effective input, a scenario that denies `bd` through an intervention has the same digest as one that authors `bd` as denied. The intervention manifest that explains the difference is kept beside the digest.

A missing vulnerability entry and an explicit `unknown` entry produce different digests. They evaluate identically, but the snapshot preserves what was actually stated.

The compiled snapshot also carries `profile_content_digest`: the SHA-256 of the canonical profile with its text and evidence records but without metadata. It lets a profile library detect a profile whose content changed while its `id` and `version` did not.

Engine version is retained separately. Labels and explanations may change byte-for-byte exports; semantic reproducibility compares normalized events using IDs, check codes, statuses and facts rather than localized display text. Export dates and run IDs are not part of that comparison.

## Comparison rules

A V1 comparison takes an already compiled baseline, applies exactly one new intervention to a copy and executes both effective snapshots. The baseline may contain its own preexisting intervention manifest. The added intervention must not overlap an existing write; edit the baseline first if it does.

Keep asset universe, seed, profile revision, engine and model versions identical. Otherwise show runs separately and reject the controlled comparison. Every comparison displays the actual changed fields so a user can verify the experiment. Never edit a recorded baseline in place.

## Errors

Return an ordered diagnostic list with `code`, `path`, `message` and optional `entity_id`. For example: `UNKNOWN_ASSET` at `network.links[2].target_id`. An invalid scenario cannot start. Unknown environmental facts are valid model values and must not be mistaken for import errors.

Each diagnostic also has a `severity` (`error` or `warning`). Parse-stage diagnostics carry an optional `location` (`line`, `column`, both 1-based). Warnings never block compilation. They make assumptions visible: `INTERVENTION_NOOP`, and `VULNERABILITY_FACT_MISSING` when an exploit capability's linked targets have no fact for its vulnerability, so those checks will be unknown rather than patched. The empty path `""` denotes the whole document. Paths index the arrays as authored, before canonical sorting. The code vocabulary is the `DiagnosticCode` union in `src/core/domain/diagnostics.ts`.

## Compiled snapshot

`compileScenario(value)` and `importScenario(bytes | text, { fileName? | format? })` return `{ ok: true, value: CompiledScenario, diagnostics: warnings }` or `{ ok: false, diagnostics }`. A `CompiledScenario` is deep-frozen and contains:

- `model_version`, `id`, `name` and optional `metadata`.
- `source`: the authored document in canonical order, before interventions. It can be re-imported, and recompiling it yields an identical snapshot.
- `effective`: `{ network, profile, initial_asset_id }` with interventions applied. This is the only input the engine reads.
- `manifest`: the intervention records.
- `input_digest` and `profile_content_digest`.

Compilation copies its input and never retains or mutates caller-owned objects.
