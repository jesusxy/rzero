// Canonical lab scenarios 003–009 from docs/validation-scenarios.md, as LabSpecs
// for compileLab/runLab. Shared by the step and narration tests. 001 and 002
// are fixture files (fixtures/scenarios).

import { winrmProfile } from './helpers'
import { SMB_EXPLOIT_PROFILE, type LabSpec } from './engine-helpers'

const winrmService = { id: 'winrm', transport: 'tcp', port: 5985, status: 'enabled' }

export const lab003Cycle: LabSpec = {
  assets: { A: {}, B: {}, C: {} },
  links: [
    { id: 'ab', source: 'A', target: 'B' },
    { id: 'bc', source: 'B', target: 'C' },
    { id: 'ca', source: 'C', target: 'A' },
  ],
}

export const lab004AlternateRoute: LabSpec = {
  assets: { A: {}, B: {}, C: {} },
  links: [
    { id: 'ab', source: 'A', target: 'B' },
    { id: 'ac', source: 'A', target: 'C', access: 'deny' },
    { id: 'bc', source: 'B', target: 'C' },
  ],
}

export const lab005UnknownVulnerability: LabSpec = {
  assets: { A: {}, B: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'unknown' }] } },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
}

export const lab005MissingVulnerability: LabSpec = {
  assets: { A: {}, B: { vulnerabilities: [] } },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
}

/** 005 second variant: the denied link decides; the unknown vulnerability is kept. */
export const lab005DeniedUnknown: LabSpec = {
  assets: { A: {}, B: { vulnerabilities: [{ id: 'LAB-SMB-1', status: 'unknown' }] } },
  links: [{ id: 'ab', source: 'A', target: 'B', access: 'deny' }],
}

/** 006: A holds cred-a with one B/WinRM grant of the given privilege and status. */
export function lab006Credential(privilege: 'user' | 'admin', status: 'valid' | 'invalid' | 'unknown'): LabSpec {
  return {
    assets: { A: { credential_ids: ['cred-a'] }, B: { services: [winrmService], vulnerabilities: [] } },
    links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
    profile: winrmProfile(),
    credentials: [
      { id: 'cred-a', label: 'Lab credential', grants: [{ target_id: 'B', service_id: 'winrm', privilege, status }] },
    ],
  }
}

/** 006 missing grant: the only grant sits on an unrelated source C. */
export const lab006MissingGrant: LabSpec = {
  assets: {
    A: { credential_ids: [] },
    B: { services: [winrmService], vulnerabilities: [] },
    C: { credential_ids: ['cred-c'] },
  },
  links: [{ id: 'ab', source: 'A', target: 'B', service: 'winrm' }],
  profile: winrmProfile(),
  credentials: [
    { id: 'cred-c', label: 'Other', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
  ],
}

const combinedProfile = () => ({
  ...SMB_EXPLOIT_PROFILE,
  id: 'lab-combined',
  name: 'Lab combined',
  capabilities: [
    SMB_EXPLOIT_PROFILE.capabilities[0],
    {
      id: 'winrm-exec',
      label: 'Synthetic WinRM execution',
      mechanism: 'remote_execution',
      service_id: 'winrm',
      target_platforms: ['windows'],
      minimum_privilege: 'admin',
      evidence_ids: ['lab-definition'],
      confidence: 'high',
      assumptions: ['A valid grant launches the modeled profile; no real command runs.'],
    },
  ],
})

/** 007: SMB and WinRM links A → B; SMB (lexically first) is blocked, WinRM succeeds. */
export const lab007MultipleMechanisms: LabSpec = {
  assets: {
    A: { credential_ids: ['cred-a'] },
    B: {
      services: [{ id: 'smb', transport: 'tcp', port: 445, status: 'enabled' }, winrmService],
      vulnerabilities: [{ id: 'LAB-SMB-1', status: 'absent' }],
    },
  },
  links: [
    { id: 'ab-smb', source: 'A', target: 'B', service: 'smb' },
    { id: 'ab-winrm', source: 'A', target: 'B', service: 'winrm' },
  ],
  profile: combinedProfile(),
  credentials: [
    { id: 'cred-a', label: 'Admin', grants: [{ target_id: 'B', service_id: 'winrm', privilege: 'admin', status: 'valid' }] },
  ],
}

/** 007 same-service variant: two SMB exploits on one link; the first weakness is absent. */
export const lab007SameService: LabSpec = {
  assets: {
    A: {},
    B: {
      vulnerabilities: [
        { id: 'WEAK-1', status: 'absent' },
        { id: 'WEAK-2', status: 'present' },
      ],
    },
  },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
  profile: {
    ...SMB_EXPLOIT_PROFILE,
    id: 'lab-two-exploits',
    capabilities: [
      { ...SMB_EXPLOIT_PROFILE.capabilities[0], id: 'smb-exploit-a', vulnerability_id: 'WEAK-1' },
      { ...SMB_EXPLOIT_PROFILE.capabilities[0], id: 'smb-exploit-b', vulnerability_id: 'WEAK-2' },
    ],
  },
}

export const lab008Converging: LabSpec = {
  assets: { A: {}, B: {}, C: {}, D: {} },
  links: [
    { id: 'ab', source: 'A', target: 'B' },
    { id: 'ac', source: 'A', target: 'C' },
    { id: 'bd', source: 'B', target: 'D' },
    { id: 'cd', source: 'C', target: 'D' },
  ],
}

export const lab009IsolatedTarget: LabSpec = {
  assets: { A: {}, B: { isolated: true } },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
}

export const lab009IsolatedSeed: LabSpec = {
  assets: { A: { isolated: true }, B: {} },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
}

export const lab009ServiceAbsent: LabSpec = {
  assets: { A: {}, B: { services: [] } },
  links: [{ id: 'ab', source: 'A', target: 'B' }],
}

/** Every lab above, by name, for invariant sweeps. */
export const ALL_LABS: Readonly<Record<string, LabSpec>> = {
  '003 cycle': lab003Cycle,
  '004 alternate route': lab004AlternateRoute,
  '005 unknown vulnerability': lab005UnknownVulnerability,
  '005 missing vulnerability': lab005MissingVulnerability,
  '005 denied with unknown vulnerability': lab005DeniedUnknown,
  '006 valid admin': lab006Credential('admin', 'valid'),
  '006 valid user': lab006Credential('user', 'valid'),
  '006 invalid admin': lab006Credential('admin', 'invalid'),
  '006 unknown admin': lab006Credential('admin', 'unknown'),
  '006 missing grant': lab006MissingGrant,
  '007 multiple mechanisms': lab007MultipleMechanisms,
  '007 same service': lab007SameService,
  '008 converging': lab008Converging,
  '009 isolated target': lab009IsolatedTarget,
  '009 isolated seed': lab009IsolatedSeed,
  '009 service absent': lab009ServiceAbsent,
}
