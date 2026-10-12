import { describe, expect, test } from 'bun:test'
import {
  canonicalJson,
  compileScenario,
  importScenario,
  semanticProjection,
  validateProfile,
  type CompiledScenario,
} from '../../src/core'
import {
  asset,
  errorsOf,
  expectCompiled,
  fixtureBytes,
  fixtureText,
  scenario001,
  scenario002,
  warningsOf,
} from './helpers'

const compile001 = () => expectCompiled(compileScenario(scenario001()))

function reversedArrays(value: any): any {
  if (Array.isArray(value)) return value.map(reversedArrays).reverse()
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reversedArrays(entry)]))
  }
  return value
}

describe('the complete five-node example (scenario 001)', () => {
  test('imports from JSON bytes with no diagnostics', () => {
    const result = importScenario(fixtureBytes('001-five-node-baseline.json'), {
      fileName: '001-five-node-baseline.json',
    })
    expect(result.diagnostics).toEqual([])
    const compiled = expectCompiled(result)
    expect(compiled.model_version).toBe('rzero/1')
    expect(compiled.effective.initial_asset_id).toBe('A')
    expect(compiled.manifest).toEqual([])
  })

  test('holds exactly the facts stated in docs/validation-scenarios.md', () => {
    const { network, profile } = compile001().effective
    expect(network.assets.map((entry) => entry.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(
      network.links.map((link) => [link.id, link.source_id, link.target_id, link.service_id, link.access]),
    ).toEqual([
      ['ab', 'A', 'B', 'smb', 'allow'],
      ['ac', 'A', 'C', 'smb', 'deny'],
      ['bd', 'B', 'D', 'smb', 'allow'],
      ['de', 'D', 'E', 'smb', 'allow'],
    ])
    for (const entry of network.assets) {
      expect(entry.platform).toBe('windows')
      expect(entry.isolated).toBe(false)
      expect(entry.critical).toBe(false)
      expect(entry.segment_id).toBe('lab')
      expect(entry.credential_ids).toEqual([])
      expect(entry.services).toEqual([{ id: 'smb', transport: 'tcp', port: 445, status: 'enabled' }])
      expect(entry.vulnerabilities).toEqual([
        { id: 'LAB-SMB-1', status: entry.id === 'E' ? 'absent' : 'present' },
      ])
    }
    expect(network.credentials).toEqual([])
    expect(profile.scope).toBe('synthetic')
    expect(profile.review_status).toBe('reviewed')
    expect(profile.capabilities.map((capability) => capability.id)).toEqual(['smb-exploit'])
  })

  test('JSON and restricted YAML are equivalent: same snapshot, same digest', () => {
    const fromJson = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
    const fromYaml = expectCompiled(
      importScenario(fixtureBytes('001-five-node-baseline.yaml'), { fileName: '001-five-node-baseline.yaml' }),
    )
    expect(fromYaml).toEqual(fromJson)
    expect(fromYaml.input_digest).toBe(fromJson.input_digest)
  })

  test('the digest is the SHA-256 of the canonical semantic projection', () => {
    const compiled = compile001()
    const projection = semanticProjection(compiled.model_version, compiled.effective)
    const canonical = canonicalJson(projection)
    expect(compiled.input_digest).toBe(new Bun.CryptoHasher('sha256').update(canonical).digest('hex'))
    expect(compiled.input_digest).toMatch(/^[0-9a-f]{64}$/)
    // The projection carries facts and identifiers, not display text.
    expect(canonical).not.toContain('LAB-WS-A')
    expect(canonical).not.toContain('Synthetic SMB exploit')
    expect(canonical).not.toContain('Canonical lab rule')
    expect(canonical).toContain('"evidence_ids":["lab-definition"]')
    expect(canonical).toContain('"version":"1"')
  })

  test('regression pin: canonicalization changes must be deliberate', () => {
    // Update only together with docs/scenario-model.md when the digest scheme changes.
    expect(compile001().input_digest).toBe('1a760284704bd3837028ab9729bef28047d4309c7a40f0381f5cfd407a43dd08')
  })
})

describe('canonicalization and identity (scenario 010 input invariants)', () => {
  test('reversing every input array and key order leaves snapshot and digest unchanged', () => {
    const baseline = compile001()
    const reversed = expectCompiled(compileScenario(reversedArrays(scenario001())))
    expect(reversed.input_digest).toBe(baseline.input_digest)
    expect(reversed.effective).toEqual(baseline.effective)
    expect(canonicalJson(reversed.source as never)).toBe(canonicalJson(baseline.source as never))
  })

  test('labels, names, free text and metadata (including layout) do not change the digest', () => {
    const document = scenario001()
    document.id = 'renamed'
    document.name = 'Another name'
    document.metadata = { layout: { A: { x: 1, y: 2 } } }
    document.network.segments[0].label = 'Laboratory'
    asset(document, 'A').label = 'patient-zero'
    asset(document, 'A').metadata = { layout: { x: 9, y: 9 }, os: 'Windows 11 23H2' }
    document.profile.name = 'Renamed worm'
    document.profile.capabilities[0].label = 'Renamed capability'
    document.profile.capabilities[0].assumptions = ['Reworded assumption.']
    document.profile.capabilities[0].technique_refs = ['T1210']
    document.profile.sources[0].title = 'Retitled'
    document.profile.limitations = ['Reworded limitation.']
    expect(expectCompiled(compileScenario(document)).input_digest).toBe(compile001().input_digest)
  })

  test.each([
    ['a vulnerability status', (d: any) => { asset(d, 'E').vulnerabilities[0].status = 'unknown' }],
    ['a missing versus unknown vulnerability fact', (d: any) => { asset(d, 'E').vulnerabilities = [] }],
    ['link access', (d: any) => { d.network.links[1].access = 'allow' }],
    ['the initial asset', (d: any) => { d.initial_asset_id = 'B' }],
    ['asset criticality', (d: any) => { asset(d, 'D').critical = true }],
    ['a service port', (d: any) => { asset(d, 'B').services[0].port = 139 }],
    ['profile revision', (d: any) => { d.profile.version = '2' }],
    ['evidence identifiers', (d: any) => {
      d.profile.sources[0].id = 'lab-rule'
      d.profile.capabilities[0].evidence_ids = ['lab-rule']
    }],
    ['claim confidence', (d: any) => { d.profile.capabilities[0].confidence = 'medium' }],
  ])('changing %s changes the digest', (_name, mutate) => {
    const document = scenario001()
    mutate(document)
    expect(expectCompiled(compileScenario(document)).input_digest).not.toBe(compile001().input_digest)
  })

  test('the profile content digest tracks text that the semantic digest ignores', () => {
    const document = scenario001()
    document.profile.capabilities[0].assumptions = ['Reworded assumption.']
    const changed = expectCompiled(compileScenario(document))
    expect(changed.input_digest).toBe(compile001().input_digest)
    expect(changed.profile_content_digest).not.toBe(compile001().profile_content_digest)
  })

  test('canonical ordering: entities by ID, grants by target/service, sets sorted, prose kept', () => {
    const document = scenario001()
    document.network.credentials = [
      {
        id: 'cred-z',
        label: 'Z',
        grants: [
          { target_id: 'C', service_id: 'winrm', privilege: 'user', status: 'valid' },
          { target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' },
          { target_id: 'B', service_id: 'smb', privilege: 'admin', status: 'invalid' },
        ],
      },
      { id: 'cred-a', label: 'A', grants: [] },
    ]
    asset(document, 'A').credential_ids = ['cred-z', 'cred-a']
    document.profile.capabilities[0].target_platforms = ['windows', 'linux']
    document.profile.limitations = ['second', 'first']
    const { network, profile } = expectCompiled(compileScenario(document)).effective
    expect(network.credentials.map((credential) => credential.id)).toEqual(['cred-a', 'cred-z'])
    expect(network.credentials[1]!.grants.map((grant) => `${grant.target_id}/${grant.service_id}`)).toEqual([
      'B/smb',
      'B/winrm',
      'C/winrm',
    ])
    expect(network.assets[0]!.credential_ids).toEqual(['cred-a', 'cred-z'])
    expect(profile.capabilities[0]!.target_platforms).toEqual(['linux', 'windows'])
    expect(profile.limitations).toEqual(['second', 'first'])
  })
})

describe('immutability and isolation', () => {
  test('the compiled scenario is deeply frozen', () => {
    const compiled = compile001()
    expect(Object.isFrozen(compiled)).toBe(true)
    expect(Object.isFrozen(compiled.effective.network.assets[1]!.vulnerabilities[0])).toBe(true)
    expect(Object.isFrozen(compiled.source.profile.capabilities[0]!.target_platforms)).toBe(true)
    expect(() => {
      ;(compiled.effective.network.links[0] as { access: string }).access = 'deny'
    }).toThrow()
  })

  test('compilation neither mutates nor retains the caller-owned input', () => {
    const document = scenario001()
    document.network.assets.reverse()
    const before = JSON.stringify(document)
    const compiled = expectCompiled(compileScenario(document))
    expect(JSON.stringify(document)).toBe(before)
    asset(document, 'B').vulnerabilities[0].status = 'absent'
    expect(compiled.effective.network.assets[1]!.vulnerabilities[0]!.status).toBe('present')
  })

  test('the canonical source document recompiles to the same snapshot', () => {
    const compiled = expectCompiled(compileScenario(scenario002()))
    const recompiled = expectCompiled(compileScenario(compiled.source))
    expect(recompiled).toEqual(compiled)
  })

  test('in-memory values that JSON cannot represent are rejected with paths', () => {
    const document = scenario001()
    document.metadata = { when: new Date(0), score: Number.NaN }
    expect(errorsOf(compileScenario(document))).toEqual([
      ['NOT_JSON_VALUE', 'metadata.when'],
      ['NONFINITE_NUMBER', 'metadata.score'],
    ])
    const cyclic: any = scenario001()
    cyclic.metadata = { self: cyclic }
    expect(errorsOf(compileScenario(cyclic))[0]![0]).toBe('NESTING_TOO_DEEP')
  })
})

describe('STIX intelligence stays distinct from executable profiles', () => {
  const bundle = {
    type: 'bundle',
    id: 'bundle--6f1c3a4e-1d2b-4c5d-9e8f-0a1b2c3d4e5f',
    objects: [
      {
        type: 'malware',
        spec_version: '2.1',
        id: 'malware--2b4c6d8e-0f1a-4b3c-8d5e-6f7a8b9c0d1e',
        name: 'Example',
        is_family: true,
      },
    ],
  }

  test('a STIX bundle is detected and explained, not imported', () => {
    const result = importScenario(JSON.stringify(bundle))
    expect(errorsOf(result)).toEqual([['STIX_NOT_NATIVE', '']])
    expect(result.diagnostics[0]!.message).toContain('reviewed native profile')
  })

  test('a STIX object in the profile slot is rejected', () => {
    const document = scenario001()
    document.profile = bundle.objects[0]
    expect(errorsOf(compileScenario(document))).toEqual([['STIX_NOT_NATIVE', 'profile']])
  })

  test('a STIX object is not a native profile', () => {
    expect(errorsOf(validateProfile(bundle.objects[0]))).toEqual([['STIX_NOT_NATIVE', '']])
  })

  test('STIX identifiers may appear only as provenance on source records', () => {
    const profile = scenario001().profile
    profile.sources[0].external_object_id = 'malware--2b4c6d8e-0f1a-4b3c-8d5e-6f7a8b9c0d1e'
    profile.sources[0].external_version = '2026-10-01T00:00:00.000Z'
    expect(validateProfile(profile).ok).toBe(true)
  })
})

describe('interventions and manifests', () => {
  const effectiveLink = (compiled: CompiledScenario, id: string) =>
    compiled.effective.network.links.find((link) => link.id === id)!

  test('scenario 002: the workstation→server SMB deny changes only bd', () => {
    const compiled = expectCompiled(importScenario(fixtureText('002-counterfactual-segmentation.json')))
    expect(compiled.manifest).toEqual([
      {
        intervention_id: 'deny-ws-srv-smb',
        type: 'set_boundary_access',
        selector: { from_segment_id: 'workstations', to_segment_id: 'servers', service_id: 'smb' },
        value: { access: 'deny' },
        affected_entity_ids: ['bd'],
        changes: [
          {
            field_ref: 'link:bd/access',
            entity_kind: 'link',
            entity_id: 'bd',
            original: 'allow',
            effective: 'deny',
            noop: false,
          },
        ],
        noop: false,
      },
    ])
    expect(effectiveLink(compiled, 'bd').access).toBe('deny')
    expect(compiled.source.network.links.find((link) => link.id === 'bd')!.access).toBe('allow')
    for (const id of ['ab', 'ac', 'de']) {
      expect(effectiveLink(compiled, id)).toEqual(compiled.source.network.links.find((link) => link.id === id)!)
    }
  })

  test('the digest identifies the effective input: an intervention equals authoring the same fact', () => {
    const viaIntervention = expectCompiled(compileScenario(scenario002()))
    const authored = scenario002()
    authored.interventions = []
    authored.network.links.find((link: { id: string }) => link.id === 'bd').access = 'deny'
    expect(expectCompiled(compileScenario(authored)).input_digest).toBe(viaIntervention.input_digest)

    const baseline = scenario002()
    baseline.interventions = []
    expect(expectCompiled(compileScenario(baseline)).input_digest).not.toBe(viaIntervention.input_digest)
  })

  test('a boundary selector matching zero links is an error', () => {
    const document = scenario002()
    document.interventions[0].from_segment_id = 'servers'
    document.interventions[0].to_segment_id = 'workstations'
    expect(errorsOf(compileScenario(document))).toEqual([['INTERVENTION_NO_MATCH', 'interventions[0]']])
  })

  test('boundary selectors are service-specific and never create links', () => {
    const document = scenario002()
    document.interventions[0].service_id = 'winrm'
    expect(errorsOf(compileScenario(document))).toEqual([['INTERVENTION_NO_MATCH', 'interventions[0]']])
  })

  test('boundary selectors must name existing segments', () => {
    const document = scenario002()
    document.interventions[0].to_segment_id = 'dmz'
    expect(errorsOf(compileScenario(document))).toEqual([['UNKNOWN_SEGMENT', 'interventions[0].to_segment_id']])
  })

  test('two interventions writing the same field conflict, even with equal values', () => {
    const document = scenario002()
    document.interventions.push({ ...document.interventions[0], id: 'deny-again' })
    const result = compileScenario(document)
    expect(errorsOf(result)).toEqual([['CONFLICTING_INTERVENTIONS', 'interventions[1]']])
    expect(result.diagnostics[0]!.message).toContain('link:bd/access')
  })

  test('isolation and boundary changes on the same asset coexist', () => {
    const document = scenario002()
    document.interventions.push({ type: 'set_asset_isolation', id: 'isolate-d', asset_id: 'D', isolated: true })
    const compiled = expectCompiled(compileScenario(document))
    expect(compiled.manifest.map((record) => record.intervention_id)).toEqual(['deny-ws-srv-smb', 'isolate-d'])
    expect(compiled.effective.network.assets.find((entry) => entry.id === 'D')!.isolated).toBe(true)
  })

  test('duplicate intervention IDs are rejected', () => {
    const document = scenario001()
    document.interventions = [
      { type: 'set_asset_isolation', id: 'x', asset_id: 'B', isolated: true },
      { type: 'set_asset_isolation', id: 'x', asset_id: 'C', isolated: true },
    ]
    expect(errorsOf(compileScenario(document))).toEqual([['DUPLICATE_ID', 'interventions[1].id']])
  })

  test('an intervention setting an equal value is allowed and reported as a no-op', () => {
    const document = scenario001()
    document.interventions = [{ type: 'set_asset_isolation', id: 'keep-b', asset_id: 'B', isolated: false }]
    const result = compileScenario(document)
    const compiled = expectCompiled(result)
    expect(compiled.manifest[0]).toMatchObject({
      noop: true,
      changes: [{ field_ref: 'asset:B/isolated', original: false, effective: false, noop: true }],
    })
    expect(warningsOf(result).map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      ['INTERVENTION_NOOP', 'interventions[0]'],
    ])
    expect(compiled.input_digest).toBe(compile001().input_digest)
  })

  test('set_vulnerability_status upserts the exact fact and records a null original', () => {
    const document = scenario001()
    asset(document, 'C').vulnerabilities = []
    document.interventions = [
      { type: 'set_vulnerability_status', id: 'patch-c', asset_id: 'C', vulnerability_id: 'LAB-SMB-1', status: 'absent' },
      { type: 'set_vulnerability_status', id: 'flag-d', asset_id: 'D', vulnerability_id: 'LAB-OTHER-2', status: 'present' },
    ]
    const compiled = expectCompiled(compileScenario(document))
    const vulnerabilities = (id: string) => compiled.effective.network.assets.find((entry) => entry.id === id)!.vulnerabilities
    expect(vulnerabilities('C')).toEqual([{ id: 'LAB-SMB-1', status: 'absent' }])
    expect(vulnerabilities('D')).toEqual([
      { id: 'LAB-OTHER-2', status: 'present' },
      { id: 'LAB-SMB-1', status: 'present' },
    ])
    expect(compiled.manifest[1]!.changes[0]).toMatchObject({
      field_ref: 'asset:C/vulnerability:LAB-SMB-1/status',
      original: null,
      effective: 'absent',
      noop: false,
    })
    expect(compiled.source.network.assets.find((entry) => entry.id === 'C')!.vulnerabilities).toEqual([])
  })

  test('set_service_status requires an existing service', () => {
    const document = scenario001()
    document.interventions = [
      { type: 'set_service_status', id: 'disable-winrm', asset_id: 'B', service_id: 'winrm', status: 'disabled' },
    ]
    expect(errorsOf(compileScenario(document))).toEqual([['UNKNOWN_SERVICE', 'interventions[0].service_id']])

    document.interventions[0].service_id = 'smb'
    const compiled = expectCompiled(compileScenario(document))
    expect(compiled.effective.network.assets.find((entry) => entry.id === 'B')!.services[0]!.status).toBe('disabled')
    expect(compiled.manifest[0]!.changes[0]!.field_ref).toBe('asset:B/service:smb/status')
  })

  test('set_grant_status requires an existing grant and records the credential', () => {
    const document = scenario001()
    document.network.credentials = [
      { id: 'cred-a', label: 'Lab admin', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
    ]
    asset(document, 'A').credential_ids = ['cred-a']
    document.interventions = [
      { type: 'set_grant_status', id: 'revoke', credential_id: 'cred-a', target_id: 'C', service_id: 'winrm', status: 'invalid' },
    ]
    expect(errorsOf(compileScenario(document))).toEqual([['UNKNOWN_GRANT', 'interventions[0]']])

    document.interventions[0].target_id = 'B'
    const compiled = expectCompiled(compileScenario(document))
    expect(compiled.effective.network.credentials[0]!.grants[0]!.status).toBe('invalid')
    expect(compiled.manifest[0]).toMatchObject({
      affected_entity_ids: ['cred-a'],
      changes: [{ field_ref: 'credential:cred-a/grant:B:winrm/status', original: 'valid', effective: 'invalid' }],
    })
  })

  test('intervention targets must exist', () => {
    const document = scenario001()
    document.interventions = [
      { type: 'set_asset_isolation', id: 'iso', asset_id: 'Z', isolated: true },
      { type: 'set_grant_status', id: 'grant', credential_id: 'nope', target_id: 'B', service_id: 'smb', status: 'valid' },
    ]
    expect(errorsOf(compileScenario(document))).toEqual([
      ['UNKNOWN_ASSET', 'interventions[0].asset_id'],
      ['UNKNOWN_CREDENTIAL', 'interventions[1].credential_id'],
    ])
  })

  test('intervention order in the input does not matter', () => {
    const document = scenario002()
    document.interventions.push({ type: 'set_asset_isolation', id: 'isolate-c', asset_id: 'C', isolated: true })
    const forward = expectCompiled(compileScenario(document))
    document.interventions.reverse()
    const backward = expectCompiled(compileScenario(document))
    expect(backward).toEqual(forward)
  })
})
