import { describe, expect, test } from 'bun:test'
import { ADMISSION_LIMITS, compileScenario, importScenario, validateNetwork, validateProfile } from '../../src/core'
import { asset, errorsOf, expectCompiled, expectRejected, scenario001, winrmProfile } from './helpers'

describe('scenario 011: invalid and bounded input', () => {
  test('duplicate asset IDs', () => {
    const document = scenario001()
    asset(document, 'C').id = 'B'
    expectRejected(compileScenario(document), 'DUPLICATE_ID', 'network.assets[2].id')
  })

  test('dangling link endpoints', () => {
    const document = scenario001()
    document.network.links[2].target_id = 'Z'
    const result = compileScenario(document)
    expectRejected(result, 'UNKNOWN_ASSET', 'network.links[2].target_id')
    expect(result.diagnostics[0]!.entity_id).toBe('bd')
  })

  test('duplicate source/target/service links', () => {
    const document = scenario001()
    document.network.links.push({ id: 'ab-2', source_id: 'A', target_id: 'B', service_id: 'smb', access: 'deny' })
    expectRejected(compileScenario(document), 'DUPLICATE_LINK', 'network.links[4]')
  })

  test('the same endpoints on a different service are a separate link', () => {
    const document = scenario001()
    document.network.links.push({ id: 'ab-winrm', source_id: 'A', target_id: 'B', service_id: 'winrm', access: 'allow' })
    expect(compileScenario(document).ok).toBe(true)
  })

  test('self-links', () => {
    const document = scenario001()
    document.network.links.push({ id: 'aa', source_id: 'A', target_id: 'A', service_id: 'smb', access: 'allow' })
    expectRejected(compileScenario(document), 'SELF_LINK', 'network.links[4].target_id')
  })

  test('invalid sample hashes', () => {
    const document = scenario001()
    document.profile.scope = 'sample'
    document.profile.sha256 = 'not-a-hash'
    expectRejected(compileScenario(document), 'INVALID_FORMAT', 'profile.sha256')
  })

  test('draft profiles cannot execute', () => {
    const document = scenario001()
    document.profile.review_status = 'draft'
    expect(errorsOf(compileScenario(document))).toEqual([['PROFILE_NOT_REVIEWED', 'profile.review_status']])
  })

  test('a draft profile is still valid as a standalone authoring artifact', () => {
    const profile = { ...scenario001().profile, review_status: 'draft' }
    expect(validateProfile(profile).ok).toBe(true)
    expectRejected(validateProfile(profile, { requireReviewed: true }), 'PROFILE_NOT_REVIEWED', 'review_status')
  })

  test('missing capability evidence: unresolved evidence ID', () => {
    const document = scenario001()
    document.profile.capabilities[0].evidence_ids = ['lab-definition', 'nowhere']
    expectRejected(compileScenario(document), 'UNKNOWN_EVIDENCE', 'profile.capabilities[0].evidence_ids[1]')
  })

  test('unsupported model versions', () => {
    const document = scenario001()
    document.model_version = 'rzero/2'
    expect(errorsOf(compileScenario(document))).toEqual([['UNSUPPORTED_MODEL_VERSION', 'model_version']])
  })

  test('missing model version', () => {
    const document = scenario001()
    delete document.model_version
    expect(errorsOf(compileScenario(document))).toEqual([['MISSING_FIELD', 'model_version']])
  })

  test('executable unknown fields', () => {
    const document = scenario001()
    document.network.links[0].guarded_by = 'firewall-01'
    expectRejected(compileScenario(document), 'UNKNOWN_FIELD', 'network.links[0].guarded_by')
  })

  test('duplicate JSON keys and YAML aliases/tags', () => {
    const json = '{"model_version": "rzero/1", "model_version": "rzero/1"}'
    expect(errorsOf(importScenario(json))).toEqual([['DUPLICATE_KEY', 'model_version']])
    const yaml = 'model_version: rzero/1\nid: &x canonical\nname: *x\n'
    expect(errorsOf(importScenario(yaml))).toEqual([['YAML_ANCHOR', 'id']])
    expect(errorsOf(importScenario('model_version: !!str rzero/1\n'))).toEqual([['YAML_TAG', 'model_version']])
  })

  test('admission limits are enforced before shape or semantic validation', () => {
    const document = scenario001()
    const template = asset(document, 'B')
    for (let index = document.network.assets.length; index <= ADMISSION_LIMITS.maxAssets; index += 1) {
      document.network.assets.push({ ...template, id: `extra-${index}`, unknown_field: true })
    }
    const result = compileScenario(document)
    expect(errorsOf(result)).toEqual([['LIMIT_EXCEEDED', 'network.assets']])
  })

  test('link and capability limits', () => {
    const document = scenario001()
    document.network.links = Array.from({ length: ADMISSION_LIMITS.maxLinks + 1 }, (_, index) => ({
      id: `l${index}`, source_id: 'A', target_id: 'B', service_id: `svc${index}`, access: 'allow',
    }))
    const capability = document.profile.capabilities[0]
    document.profile.capabilities = [0, 1, 2, 3, 4].map((index) => ({ ...capability, id: `cap-${index}` }))
    expect(errorsOf(compileScenario(document))).toEqual([
      ['LIMIT_EXCEEDED', 'network.links'],
      ['LIMIT_EXCEEDED', 'profile.capabilities'],
    ])
  })

  test('exactly at the limits is accepted', () => {
    const document = scenario001()
    const template = asset(document, 'B')
    while (document.network.assets.length < ADMISSION_LIMITS.maxAssets) {
      document.network.assets.push({ ...template, id: `extra-${document.network.assets.length}` })
    }
    expect(compileScenario(document).ok).toBe(true)
  })
})

describe('network references and invariants', () => {
  test('every asset belongs to an existing segment', () => {
    const document = scenario001()
    asset(document, 'D').segment_id = 'servers'
    expectRejected(compileScenario(document), 'UNKNOWN_SEGMENT', 'network.assets[3].segment_id')
  })

  test('credential references resolve', () => {
    const document = scenario001()
    asset(document, 'A').credential_ids = ['cred-missing']
    expectRejected(compileScenario(document), 'UNKNOWN_CREDENTIAL', 'network.assets[0].credential_ids[0]')
  })

  test('service and vulnerability IDs are unique per asset', () => {
    const document = scenario001()
    asset(document, 'A').services.push({ id: 'smb', transport: 'tcp', port: 139, status: 'enabled' })
    asset(document, 'A').vulnerabilities.push({ id: 'LAB-SMB-1', status: 'absent' })
    expect(errorsOf(compileScenario(document))).toEqual([
      ['DUPLICATE_ID', 'network.assets[0].services[1].id'],
      ['DUPLICATE_ID', 'network.assets[0].vulnerabilities[1].id'],
    ])
  })

  test('the same service ID on different assets is fine', () => {
    expect(compileScenario(scenario001()).ok).toBe(true)
  })

  test('SMB and WinRM must be TCP; other inventoried services may use UDP', () => {
    const document = scenario001()
    asset(document, 'A').services[0].transport = 'udp'
    asset(document, 'B').services.push({ id: 'dns', transport: 'udp', port: 53, status: 'enabled' })
    expect(errorsOf(compileScenario(document))).toEqual([
      ['INVALID_SERVICE_TRANSPORT', 'network.assets[0].services[0].transport'],
    ])
  })

  test('grant targets exist and duplicate grants are rejected, not merged', () => {
    const document = scenario001()
    document.network.credentials = [
      {
        id: 'cred-a',
        label: 'Lab admin',
        grants: [
          { target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' },
          { target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' },
          { target_id: 'Q', service_id: 'smb', privilege: 'user', status: 'unknown' },
        ],
      },
    ]
    expect(errorsOf(compileScenario(document))).toEqual([
      ['DUPLICATE_GRANT', 'network.credentials[0].grants[1]'],
      ['UNKNOWN_ASSET', 'network.credentials[0].grants[2].target_id'],
    ])
  })

  test('the initial asset must exist', () => {
    const document = scenario001()
    document.initial_asset_id = 'Z'
    expect(errorsOf(compileScenario(document))).toEqual([['UNKNOWN_ASSET', 'initial_asset_id']])
  })

  test('semantic errors are all reported together, in document order', () => {
    const document = scenario001()
    asset(document, 'C').id = 'B'
    document.network.links[0].source_id = 'nobody'
    document.profile.review_status = 'draft'
    // Renaming C to B also leaves link "ac" pointing at a missing asset.
    expect(errorsOf(compileScenario(document))).toEqual([
      ['DUPLICATE_ID', 'network.assets[2].id'],
      ['UNKNOWN_ASSET', 'network.links[0].source_id'],
      ['UNKNOWN_ASSET', 'network.links[1].target_id'],
      ['PROFILE_NOT_REVIEWED', 'profile.review_status'],
    ])
  })

  test('standalone network validation canonicalizes and freezes', () => {
    const network = scenario001().network
    network.assets.reverse()
    const result = validateNetwork(network)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assets.map((entry) => entry.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(Object.isFrozen(result.value.assets[0])).toBe(true)
  })
})

describe('unknown facts are valid model values, never import errors', () => {
  test('explicit unknown platform, service, vulnerability, access and grant all compile', () => {
    const document = scenario001()
    asset(document, 'B').platform = 'unknown'
    asset(document, 'C').services[0].status = 'unknown'
    asset(document, 'D').vulnerabilities[0].status = 'unknown'
    document.network.links[0].access = 'unknown'
    document.network.credentials = [
      { id: 'cred-a', label: 'Lab admin', grants: [{ target_id: 'B', service_id: 'smb', privilege: 'admin', status: 'unknown' }] },
    ]
    asset(document, 'A').credential_ids = ['cred-a']
    const compiled = expectCompiled(compileScenario(document))
    const effectiveB = compiled.effective.network.assets.find((entry) => entry.id === 'B')!
    expect(effectiveB.platform).toBe('unknown')
  })

  test('a missing vulnerability entry stays missing (unknown), never becomes absent, and is surfaced', () => {
    const document = scenario001()
    asset(document, 'B').vulnerabilities = []
    const result = compileScenario(document)
    const compiled = expectCompiled(result)
    const effectiveB = compiled.effective.network.assets.find((entry) => entry.id === 'B')!
    expect(effectiveB.vulnerabilities).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'VULNERABILITY_FACT_MISSING',
        path: 'profile.capabilities[0].vulnerability_id',
        entity_id: 'smb-exploit',
      }),
    ])
    expect(result.diagnostics[0]!.message).toContain(': B.')
  })

  test('a missing service entry is not exposed and needs no warning', () => {
    const document = scenario001()
    asset(document, 'B').services = []
    const result = compileScenario(document)
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })
})

describe('profile evidence and review rules', () => {
  const realProfile = () => ({
    ...scenario001().profile,
    id: 'example-family',
    name: 'Example family (fictional)',
    scope: 'family',
  })

  test('a family profile cannot rest on synthetic evidence alone', () => {
    expectRejected(
      validateProfile(realProfile()),
      'MISSING_NONSYNTHETIC_EVIDENCE',
      'capabilities[0].evidence_ids',
    )
  })

  test('a family profile with research evidence per capability is accepted', () => {
    const profile = realProfile()
    profile.sources = [
      ...profile.sources,
      {
        id: 'research-1',
        kind: 'research',
        title: 'Placeholder research record for validation tests',
        url: 'https://example.invalid/report',
        accessed_on: '2026-10-12',
        claim_summary: 'Test-only record; not a real citation.',
        external_object_id: 'malware--00000000-0000-4000-8000-000000000000',
      },
    ]
    profile.capabilities = [{ ...profile.capabilities[0], evidence_ids: ['lab-definition', 'research-1'] }]
    expect(validateProfile(profile).ok).toBe(true)
  })

  test('a sample profile requires a lowercase SHA-256', () => {
    const profile: Record<string, unknown> = { ...realProfile(), scope: 'sample' }
    expectRejected(validateProfile(profile), 'MISSING_FIELD', 'sha256')
  })

  test('source IDs are unique and capability IDs are unique', () => {
    const profile = scenario001().profile
    profile.sources.push({ ...profile.sources[0] })
    profile.capabilities.push({ ...profile.capabilities[0], label: 'Copy' })
    expect(errorsOf(validateProfile(profile))).toEqual([
      ['DUPLICATE_ID', 'sources[1].id'],
      ['DUPLICATE_ID', 'capabilities[1].id'],
    ])
  })

  test('dates must be real calendar dates', () => {
    const profile = scenario001().profile
    profile.sources[0].accessed_on = '2026-02-30'
    expectRejected(validateProfile(profile), 'INVALID_DATE', 'sources[0].accessed_on')
  })

  test('a remote-execution capability requires a privilege and rejects a vulnerability', () => {
    const profile: any = winrmProfile()
    expect(validateProfile(profile).ok).toBe(true)
    profile.capabilities[0].vulnerability_id = 'LAB-SMB-1'
    delete profile.capabilities[0].minimum_privilege
    expect(errorsOf(validateProfile(profile))).toEqual([
      ['MISSING_FIELD', 'capabilities[0].minimum_privilege'],
      ['FIELD_NOT_ALLOWED', 'capabilities[0].vulnerability_id'],
    ])
  })
})
