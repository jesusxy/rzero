# Network model

## Purpose and boundary

The network is a static inventory of facts the simulation may evaluate. It is supplied by a person or file, not discovered from a live network. It says where modeled movement can be considered and what conditions are known. Compromise, discovery and parent paths belong to run state.

## Contract

All IDs are unique within their entity collection, case-sensitive ASCII identifiers matching `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. References use exact IDs; array order has no behavioral meaning.

| Entity | Required fields | Meaning |
| --- | --- | --- |
| Segment | `id`, `label` | Visual grouping and control selector; membership alone creates no connectivity |
| Asset | `id`, `label`, `kind`, `platform`, `segment_id`, `critical`, `isolated`, `services`, `vulnerabilities`, `credential_ids` | Static facts for one machine |
| Service | `id`, `transport`, `port`, `status` | Exposure on the target; status is `enabled`, `disabled` or `unknown` |
| Vulnerability | `id`, `status` | `present`, `absent` or `unknown`; absent includes explicitly patched |
| Link | `id`, `source_id`, `target_id`, `service_id`, `access` | Directed candidate movement for one service; access is `allow`, `deny` or `unknown` |
| Credential | `id`, `label`, `grants` | Symbolic access only; never a password or token |
| Grant | `target_id`, `service_id`, `privilege`, `status` | Target authorization; privilege is `user` or `admin`, status `valid`, `invalid` or `unknown` |

Service transport is `tcp` or `udp`; port is an integer from 1 through 65535. V1 executable capabilities use SMB and WinRM over TCP; a non-TCP definition for either service is invalid. Native service IDs are stable identifiers, not display labels. Unknown additional services may be inventoried but have no evaluator unless a supported capability names them.

Asset kind is `workstation`, `server`, `controller`, `appliance` or `other`. Platform is `windows`, `linux`, `macos` or `unknown`. Display OS versions may be optional metadata, but the engine does not infer vulnerability from them. `critical` is a user classification used for result counts, not exploitation logic.

A source's `credential_ids` represents credentials the modeled threat can use once that source is compromised. This explicitly assumes availability; it does not simulate credential dumping or imply every malware family can steal credentials. A capability must support credential use before those grants matter. Privilege ordering is `user < admin`.

## Minimal example

```json
{
  "segments": [{"id": "lab", "label": "Lab"}],
  "assets": [{
    "id": "B", "label": "FILE-02", "kind": "server",
    "platform": "windows", "segment_id": "lab",
    "critical": false, "isolated": false,
    "services": [{"id": "smb", "transport": "tcp", "port": 445, "status": "enabled"}],
    "vulnerabilities": [{"id": "LAB-SMB-1", "status": "present"}],
    "credential_ids": []
  }],
  "links": [],
  "credentials": []
}
```

`LAB-SMB-1` is a synthetic test weakness, not a CVE or a real exploit.

## Reachability rules

A link A → B for SMB does not create B → A or permit WinRM. One unique link is allowed for each `(source_id, target_id, service_id)` tuple. Different services may have separate links. Self-links are rejected for V1.

The scenario enumerates candidate relationships. `access: deny` lets the engine produce a blocked attempt with a reason. An absent link means that movement is outside the modeled candidate graph; it generates no failure event. This distinction must be shown in help text and tests.

Segment controls override access on existing matching links. They do not create links. Host isolation blocks incoming and outgoing attempts involving that asset. The initial compromised asset can be isolated and remains initially compromised; isolation prevents onward movement.

Services describe what the target exposes. Links describe whether the source can reach that service. These are separate facts. An enabled SMB service behind a denied boundary still fails the reachability requirement.

## Missing facts and complete lists

An omitted platform is invalid; `unknown` is permitted. Missing service entries mean the service is not modeled as exposed and the service requirement fails. The required `services` array is declared complete for the scenario's scope; the UI must explain that assumption.

A missing vulnerability entry means unknown vulnerability status, not patched. A missing credential grant means no modeled authorization and fails. Explicit unknown status supports incomplete vulnerability, service, access and credential knowledge. The engine handles unknown conditions as described in `simulation-engine.md`.

Optional metadata can include an inventory source and notes. It is never interpreted into behavior automatically. The importer may warn that empty vulnerability data produces uncertainty for exploit capabilities.

As implemented in rzero/1, `metadata` is an optional free-form object on the network, segments, assets, links and credentials, and is excluded from the input digest. Display-only facts belong there, for example `metadata.layout` positions, an OS version string or a hostname. Services, vulnerability facts and grants are closed executable facts without metadata. The importer emits `VULNERABILITY_FACT_MISSING` when an exploit capability would meet a linked target that has no fact for its vulnerability.

## Invariants and static controls

Every asset belongs to an existing segment. Every link endpoint exists. Every credential reference resolves, and an asset's `credential_ids` contains no repeats. Grants refer to existing targets; their service IDs must use the recognized native vocabulary (`smb`, `winrm` in V1). Service IDs and vulnerability IDs are unique per asset. Duplicate grants for a credential/target/service tuple are rejected rather than merged.

V1 models controls by exact facts: deny a service-specific boundary, mark a vulnerability absent, disable a service, revoke a grant or isolate an asset. An EDR label may be descriptive metadata but cannot block an attempt by itself. Unsupported control names are rejected if supplied as executable controls.

## Later extensions

Identity/domain trust graphs, credential acquisition, discovered connectivity and dynamic containment require additional state and retry rules. They cannot be implemented by quietly reinterpreting the static fields above. Keep metadata extensible, but keep the executable contract closed and versioned.
