// Fixed mechanism evaluators (docs/simulation-engine.md#check-semantics).
//
// Both mechanisms check isolation, platform, reachability and service status.
// `remote_exploit` then requires a present vulnerability; `remote_execution`
// then requires an authorizing credential grant. Every applicable check is
// emitted in the fixed order even when an earlier one fails, so the inspector
// can show two simultaneous barriers. Unknown is a distinct status, never a
// probability, and a missing fact is unknown — never silently safe.

import type { Asset, Link, Privilege } from '../domain/network'
import type { Capability } from '../domain/profile'
import { fieldRefs } from '../scenario/interventions'
import type { Check, CheckStatus, Outcome } from './events'
import { grantKey, type CredentialIndex } from './indexes'

export type EvaluationContext = {
  readonly assets: ReadonlyMap<string, Asset>
  readonly credentials: CredentialIndex
  readonly interventionFields: ReadonlyMap<string, readonly string[]>
}

export type Evaluation = {
  readonly outcome: Outcome
  readonly checks: readonly Check[]
}

const PRIVILEGE_RANK: Record<Privilege, number> = { user: 0, admin: 1 }

/** Evaluates one capability against a candidate source→target transition. */
export function evaluateCapability(
  source: Asset,
  target: Asset,
  link: Link,
  capability: Capability,
  context: EvaluationContext,
): Evaluation {
  const checks: Check[] = [
    isolationCheck('SOURCE_NOT_ISOLATED', source, context),
    isolationCheck('TARGET_NOT_ISOLATED', target, context),
    platformCheck(target, capability),
    networkAccessCheck(link, context),
    serviceCheck(target, capability, context),
    capability.mechanism === 'remote_exploit'
      ? vulnerabilityCheck(target, capability, context)
      : credentialCheck(source, target, capability, context),
  ]
  return { outcome: outcomeOf(checks), checks }
}

/**
 * Any fail → blocked (a denied boundary is decisive even beside an unknown);
 * otherwise any unknown → indeterminate; otherwise succeeded.
 */
export function outcomeOf(checks: readonly Check[]): Outcome {
  let unknown = false
  for (const check of checks) {
    if (check.status === 'fail') return 'blocked'
    if (check.status === 'unknown') unknown = true
  }
  return unknown ? 'indeterminate' : 'succeeded'
}

function withInterventions(context: EvaluationContext, fieldRef: string, check: Omit<Check, 'intervention_ids'>): Check {
  const ids = context.interventionFields.get(fieldRef)
  return ids !== undefined && ids.length > 0 ? { ...check, intervention_ids: ids } : check
}

function isolationCheck(
  code: 'SOURCE_NOT_ISOLATED' | 'TARGET_NOT_ISOLATED',
  asset: Asset,
  context: EvaluationContext,
): Check {
  const observed = asset.isolated ? 'isolated' : 'not_isolated'
  return withInterventions(context, fieldRefs.assetIsolation(asset.id), {
    code,
    status: asset.isolated ? 'fail' : 'pass',
    expected: 'not_isolated',
    observed,
    entity_refs: [asset.id],
  })
}

function platformCheck(target: Asset, capability: Capability): Check {
  const status: CheckStatus =
    target.platform === 'unknown'
      ? 'unknown'
      : capability.target_platforms.includes(target.platform)
        ? 'pass'
        : 'fail'
  // Platform is not settable by an intervention, so no field reference.
  return {
    code: 'TARGET_PLATFORM',
    status,
    expected: capability.target_platforms.join(','),
    observed: target.platform,
    entity_refs: [target.id],
  }
}

function networkAccessCheck(link: Link, context: EvaluationContext): Check {
  const status: CheckStatus = link.access === 'allow' ? 'pass' : link.access === 'deny' ? 'fail' : 'unknown'
  return withInterventions(context, fieldRefs.linkAccess(link.id), {
    code: 'NETWORK_ACCESS',
    status,
    expected: 'allow',
    observed: link.access,
    entity_refs: [link.id],
  })
}

function serviceCheck(target: Asset, capability: Capability, context: EvaluationContext): Check {
  const service = target.services.find((entry) => entry.id === capability.service_id)
  const status: CheckStatus =
    service === undefined
      ? 'fail'
      : service.status === 'enabled'
        ? 'pass'
        : service.status === 'disabled'
          ? 'fail'
          : 'unknown'
  return withInterventions(context, fieldRefs.serviceStatus(target.id, capability.service_id), {
    code: 'SERVICE_ENABLED',
    status,
    expected: 'enabled',
    observed: service === undefined ? 'absent' : service.status,
    entity_refs: [target.id],
  })
}

function vulnerabilityCheck(
  target: Asset,
  capability: Capability & { mechanism: 'remote_exploit' },
  context: EvaluationContext,
): Check {
  const fact = target.vulnerabilities.find((entry) => entry.id === capability.vulnerability_id)
  // A missing entry is unknown, not patched.
  const status: CheckStatus =
    fact === undefined ? 'unknown' : fact.status === 'present' ? 'pass' : fact.status === 'absent' ? 'fail' : 'unknown'
  return withInterventions(context, fieldRefs.vulnerabilityStatus(target.id, capability.vulnerability_id), {
    code: 'VULNERABILITY_PRESENT',
    status,
    expected: 'present',
    observed: fact === undefined ? 'missing' : fact.status,
    entity_refs: [target.id],
  })
}

/**
 * Considers only credentials available on the source and their exact grant to
 * (target, service). A valid, sufficiently privileged grant passes; failing
 * that, an unknown one is indeterminate; everything else — missing, invalid or
 * underprivileged — fails. The witness credential is chosen by ID order.
 */
function credentialCheck(
  source: Asset,
  target: Asset,
  capability: Capability & { mechanism: 'remote_execution' },
  context: EvaluationContext,
): Check {
  const required = PRIVILEGE_RANK[capability.minimum_privilege]
  let valid: { credentialId: string; grant: { status: string; privilege: Privilege } } | undefined
  let unknown: typeof valid

  for (const credentialId of [...source.credential_ids].sort()) {
    const grant = context.credentials.grants
      .get(credentialId)
      ?.get(grantKey(target.id, capability.service_id))
    if (grant === undefined) continue
    if (PRIVILEGE_RANK[grant.privilege] < required) continue // insufficient privilege does not qualify
    if (grant.status === 'valid') {
      valid ??= { credentialId, grant }
    } else if (grant.status === 'unknown') {
      unknown ??= { credentialId, grant }
    }
  }

  const witness = valid ?? unknown
  const status: CheckStatus = valid !== undefined ? 'pass' : unknown !== undefined ? 'unknown' : 'fail'
  const fieldRef =
    witness === undefined
      ? undefined
      : fieldRefs.grantStatus(witness.credentialId, target.id, capability.service_id)
  const check: Omit<Check, 'intervention_ids'> = {
    code: 'CREDENTIAL_AUTHORIZED',
    status,
    expected: `valid:${capability.minimum_privilege}`,
    observed: witness === undefined ? 'none' : `${witness.grant.status}:${witness.grant.privilege}`,
    entity_refs: witness === undefined ? [] : [witness.credentialId],
  }
  return fieldRef === undefined ? check : withInterventions(context, fieldRef, check)
}
