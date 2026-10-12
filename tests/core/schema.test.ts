import { describe, expect, test } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020'
import { compileScenario, NATIVE_SCHEMAS } from '../../src/core'
import { SchemaSet } from '../../src/core/schema/validator'
import { asset, errorsOf, scenario001, scenario002 } from './helpers'

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
for (const [name, schema] of Object.entries(NATIVE_SCHEMAS)) {
  if (name !== 'scenario.schema.json') ajv.addSchema(schema)
}
const ajvScenario = ajv.compile(NATIVE_SCHEMAS['scenario.schema.json']!)

// Each case mutates a fresh copy of scenario 001 and names the expected shape error.
const shapeCases: [string, (d: any) => void, string, string][] = [
  ['unknown executable asset field', (d) => { asset(d, 'A').edr = true }, 'UNKNOWN_FIELD', 'network.assets[0].edr'],
  ['unknown top-level field', (d) => { d.seed = 1 }, 'UNKNOWN_FIELD', 'seed'],
  ['unknown link field', (d) => { d.network.links[0].weight = 0.5 }, 'UNKNOWN_FIELD', 'network.links[0].weight'],
  ['probabilistic capability field', (d) => { d.profile.capabilities[0].success_rate = 0.7 }, 'UNKNOWN_FIELD', 'profile.capabilities[0].success_rate'],
  ['missing platform', (d) => { delete asset(d, 'B').platform }, 'MISSING_FIELD', 'network.assets[1].platform'],
  ['missing services list', (d) => { delete asset(d, 'B').services }, 'MISSING_FIELD', 'network.assets[1].services'],
  ['bad platform', (d) => { asset(d, 'B').platform = 'Windows 11' }, 'INVALID_ENUM', 'network.assets[1].platform'],
  ['bad kind', (d) => { asset(d, 'B').kind = 'domain-controller' }, 'INVALID_ENUM', 'network.assets[1].kind'],
  ['bad access', (d) => { d.network.links[0].access = 'blocked' }, 'INVALID_ENUM', 'network.links[0].access'],
  ['non-boolean critical', (d) => { asset(d, 'A').critical = 'no' }, 'INVALID_TYPE', 'network.assets[0].critical'],
  ['port out of range', (d) => { asset(d, 'A').services[0].port = 70000 }, 'INVALID_VALUE', 'network.assets[0].services[0].port'],
  ['fractional port', (d) => { asset(d, 'A').services[0].port = 445.5 }, 'INVALID_TYPE', 'network.assets[0].services[0].port'],
  ['invalid ID characters', (d) => { asset(d, 'A').id = 'A/1' }, 'INVALID_FORMAT', 'network.assets[0].id'],
  ['empty label', (d) => { asset(d, 'A').label = '' }, 'INVALID_VALUE', 'network.assets[0].label'],
  ['numeric profile version', (d) => { d.profile.version = 1 }, 'INVALID_TYPE', 'profile.version'],
  ['duplicate credential reference', (d) => {
    d.network.credentials = [{ id: 'cred-a', label: 'Lab admin', grants: [] }]
    asset(d, 'A').credential_ids = ['cred-a', 'cred-a']
  }, 'DUPLICATE_ITEM', 'network.assets[0].credential_ids[1]'],
  ['grant for an unsupported service', (d) => {
    d.network.credentials = [{ id: 'cred-a', label: 'Lab admin', grants: [{ target_id: 'B', service_id: 'rdp', privilege: 'admin', status: 'valid' }] }]
  }, 'INVALID_ENUM', 'network.credentials[0].grants[0].service_id'],
  ['capability service without an evaluator', (d) => { d.profile.capabilities[0].service_id = 'rdp' }, 'INVALID_ENUM', 'profile.capabilities[0].service_id'],
  ['capability targeting unknown platform', (d) => { d.profile.capabilities[0].target_platforms = ['unknown'] }, 'INVALID_ENUM', 'profile.capabilities[0].target_platforms[0]'],
  ['missing capability evidence', (d) => { d.profile.capabilities[0].evidence_ids = [] }, 'TOO_FEW_ITEMS', 'profile.capabilities[0].evidence_ids'],
  ['exploit without vulnerability', (d) => { delete d.profile.capabilities[0].vulnerability_id }, 'MISSING_FIELD', 'profile.capabilities[0].vulnerability_id'],
  ['exploit with a privilege', (d) => { d.profile.capabilities[0].minimum_privilege = 'admin' }, 'FIELD_NOT_ALLOWED', 'profile.capabilities[0].minimum_privilege'],
  ['empty assumptions', (d) => { d.profile.capabilities[0].assumptions = [] }, 'TOO_FEW_ITEMS', 'profile.capabilities[0].assumptions'],
  ['empty limitations', (d) => { d.profile.limitations = [] }, 'TOO_FEW_ITEMS', 'profile.limitations'],
  ['sample without hash', (d) => { d.profile.scope = 'sample' }, 'MISSING_FIELD', 'profile.sha256'],
  ['sample with uppercase hash', (d) => { d.profile.scope = 'sample'; d.profile.sha256 = 'A'.repeat(64) }, 'INVALID_FORMAT', 'profile.sha256'],
  ['sample with short hash', (d) => { d.profile.scope = 'sample'; d.profile.sha256 = 'ab12' }, 'INVALID_FORMAT', 'profile.sha256'],
  ['hash on a synthetic profile', (d) => { d.profile.sha256 = 'a'.repeat(64) }, 'FIELD_NOT_ALLOWED', 'profile.sha256'],
  ['source without url or local reference', (d) => { delete d.profile.sources[0].local_reference }, 'MISSING_FIELD', 'profile.sources[0]'],
  ['malformed date', (d) => { d.profile.sources[0].accessed_on = '12/10/2026' }, 'INVALID_FORMAT', 'profile.sources[0].accessed_on'],
  ['bad ATT&CK reference', (d) => { d.profile.capabilities[0].technique_refs = ['lateral-movement'] }, 'INVALID_FORMAT', 'profile.capabilities[0].technique_refs[0]'],
  ['unknown intervention type', (d) => { d.interventions = [{ type: 'install_edr', id: 'x' }] }, 'INVALID_ENUM', 'interventions[0].type'],
  ['intervention with a foreign field', (d) => {
    d.interventions = [{ type: 'set_asset_isolation', id: 'iso', asset_id: 'B', isolated: true, access: 'deny' }]
  }, 'UNKNOWN_FIELD', 'interventions[0].access'],
  ['intervention missing its value', (d) => {
    d.interventions = [{ type: 'set_service_status', id: 'svc', asset_id: 'B', service_id: 'smb' }]
  }, 'MISSING_FIELD', 'interventions[0].status'],
  ['non-object metadata', (d) => { d.metadata = 'notes' }, 'INVALID_TYPE', 'metadata'],
]

describe('JSON Schema shape validation', () => {
  test('the fixtures are valid under both the core interpreter and Ajv', () => {
    for (const document of [scenario001(), scenario002()]) {
      expect(compileScenario(document).ok).toBe(true)
      expect(ajvScenario(document)).toBe(true)
    }
  })

  test.each(shapeCases)('%s', (_name, mutate, code, path) => {
    const document = scenario001()
    mutate(document)
    const result = compileScenario(document)
    expect(result.ok).toBe(false)
    expect(errorsOf(result)).toContainEqual([code, path])
    // Independent reference implementation agrees the shape is invalid.
    expect(ajvScenario(document)).toBe(false)
  })

  test('metadata may hold arbitrary JSON on every entity that allows it', () => {
    const document = scenario001()
    const anything = { layout: { x: 3, y: 4 }, tags: ['a', null, 1.5], nested: { deep: [{ ok: true }] } }
    document.metadata = anything
    document.network.metadata = anything
    document.network.segments[0].metadata = anything
    asset(document, 'A').metadata = anything
    document.network.links[0].metadata = anything
    document.profile.metadata = anything
    document.profile.sources[0].metadata = anything
    document.profile.capabilities[0].metadata = anything
    expect(compileScenario(document).ok).toBe(true)
    expect(ajvScenario(document)).toBe(true)
  })

  test('metadata is not accepted on executable facts (services, vulnerabilities, grants)', () => {
    const document = scenario001()
    asset(document, 'A').services[0].metadata = { note: 'x' }
    expect(errorsOf(compileScenario(document))).toEqual([
      ['UNKNOWN_FIELD', 'network.assets[0].services[0].metadata'],
    ])
  })

  test('messages explain conditional rules', () => {
    const document = scenario001()
    document.profile.capabilities[0].minimum_privilege = 'admin'
    const [diagnostic] = compileScenario(document).diagnostics
    expect(diagnostic!.message).toContain('when mechanism is "remote_exploit"')
  })

  test('the interpreter refuses schemas with keywords it does not implement', () => {
    expect(
      () => new SchemaSet([{ $id: 'x.schema.json', type: 'object', patternProperties: {} }]),
    ).toThrow('Unsupported schema keyword "patternProperties"')
  })
})
