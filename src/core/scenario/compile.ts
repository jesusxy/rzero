// Scenario compile pipeline (docs/scenario-model.md#compile-pipeline):
//
//   1. size, UTF-8 and duplicate-key-safe parsing   (io/document.ts)
//   2. STIX detection, model version, admission limits, JSON Schema shape
//   3. references, profile review and evidence rules
//   4. intervention targets and conflicting writes
//   5. interventions applied to a canonical copy, with a manifest
//   6. canonical semantic projection and SHA-256 input digest
//   7. deep-frozen snapshot handed to the engine
//
// Each stage runs only when earlier stages produced no errors, so semantic
// checks never see malformed shapes. Warnings accumulate and never block.

import {
  error,
  fail,
  hasErrors,
  ok,
  warning,
  type Diagnostic,
  type Result,
} from '../domain/diagnostics'
import { cloneJson, hasOwn, isJsonObject, type JsonValue } from '../domain/json'
import type { Network } from '../domain/network'
import type { MalwareProfile } from '../domain/profile'
import {
  MODEL_VERSION,
  type CompiledScenario,
  type EffectiveInput,
  type ScenarioDocument,
} from '../domain/scenario'
import { compareCodeUnits } from '../io/canonical-json'
import {
  looksLikeStix,
  parseDocument,
  STIX_MESSAGE,
  toJsonValue,
  type ParseOptions,
} from '../io/document'
import { validateShape } from '../schema'
import { checkNetworkLimits, checkProfileLimits } from '../validation/limits'
import { checkNetworkSemantics } from '../validation/network'
import { checkProfileSemantics } from '../validation/profile'
import {
  canonicalInterventions,
  canonicalNetwork,
  canonicalProfile,
  digestOf,
  profileContentProjection,
  semanticProjection,
} from './canonical'
import { deepFreeze } from './freeze'
import { applyInterventions } from './interventions'

/** Parses and compiles a JSON or restricted-YAML scenario document. */
export function importScenario(
  input: string | Uint8Array,
  options: ParseOptions = {},
): Result<CompiledScenario> {
  const parsed = parseDocument(input, options)
  if (!parsed.ok) return parsed
  return compileParsedScenario(parsed.value)
}

/**
 * Compiles an in-memory scenario (for example one assembled by the UI from
 * built-in objects). The value is copied first; the caller's object is never
 * retained or mutated.
 */
export function compileScenario(input: unknown): Result<CompiledScenario> {
  const value = toJsonValue(input)
  if (!value.ok) return value
  return compileParsedScenario(value.value)
}

function compileParsedScenario(value: JsonValue): Result<CompiledScenario> {
  if (looksLikeStix(value)) {
    return fail([error('STIX_NOT_NATIVE', [], STIX_MESSAGE)])
  }
  if (!isJsonObject(value)) {
    return fail([error('INVALID_TYPE', [], 'A scenario document must be a JSON object.')])
  }
  if (!hasOwn(value, 'model_version')) {
    return fail([
      error(
        'MISSING_FIELD',
        ['model_version'],
        `Scenario documents must declare "model_version": "${MODEL_VERSION}". ` +
          'Standalone networks and profiles are embedded in a scenario to be imported.',
      ),
    ])
  }
  if (value.model_version !== MODEL_VERSION) {
    return fail([
      error(
        'UNSUPPORTED_MODEL_VERSION',
        ['model_version'],
        `Unsupported model version ${JSON.stringify(value.model_version)}; this build supports "${MODEL_VERSION}".`,
      ),
    ])
  }
  if (value.profile !== undefined && looksLikeStix(value.profile)) {
    return fail([error('STIX_NOT_NATIVE', ['profile'], STIX_MESSAGE)])
  }

  const limits = [
    ...checkNetworkLimits(value.network, ['network']),
    ...checkProfileLimits(value.profile, ['profile']),
  ]
  if (limits.length > 0) return fail(limits)

  const shape = validateShape(value, 'scenario')
  if (shape.length > 0) return fail(shape)

  const document = value as unknown as ScenarioDocument
  const semantic = [
    ...checkNetworkSemantics(document.network, ['network']),
    ...checkProfileSemantics(document.profile, ['profile'], { requireReviewed: true }),
  ]
  if (!document.network.assets.some((asset) => asset.id === document.initial_asset_id)) {
    semantic.push(
      error(
        'UNKNOWN_ASSET',
        ['initial_asset_id'],
        `Initial asset "${document.initial_asset_id}" does not exist.`,
        { entityId: document.initial_asset_id },
      ),
    )
  }
  if (hasErrors(semantic)) return fail(semantic)

  const authoredNetwork = canonicalNetwork(document.network)
  const profile = canonicalProfile(document.profile)
  const applied = applyInterventions(authoredNetwork, document.interventions, ['interventions'])
  if (!applied.ok) return fail(applied.diagnostics)

  const effective: EffectiveInput = {
    network: applied.network,
    profile,
    initial_asset_id: document.initial_asset_id,
  }

  const warnings = [
    ...applied.warnings,
    ...missingVulnerabilityFacts(document.profile, effective),
  ]

  const source: ScenarioDocument = {
    model_version: MODEL_VERSION,
    id: document.id,
    name: document.name,
    network: authoredNetwork,
    profile,
    initial_asset_id: document.initial_asset_id,
    interventions: canonicalInterventions(document.interventions),
    ...(document.metadata === undefined ? {} : { metadata: cloneJson(document.metadata) }),
  }

  const compiled: CompiledScenario = {
    model_version: MODEL_VERSION,
    id: document.id,
    name: document.name,
    ...(document.metadata === undefined ? {} : { metadata: cloneJson(document.metadata) }),
    source,
    effective,
    manifest: applied.manifest,
    input_digest: digestOf(semanticProjection(MODEL_VERSION, effective)),
    profile_content_digest: digestOf(profileContentProjection(profile)),
  }

  return ok(deepFreeze(compiled), deepFreeze(warnings))
}

/**
 * Warns when exploit attempts would evaluate the vulnerability check as
 * unknown because a linked target has no fact for it. Missing is unknown,
 * never patched; the warning makes that assumption visible at import time.
 */
function missingVulnerabilityFacts(
  authoredProfile: MalwareProfile,
  effective: EffectiveInput,
): Diagnostic[] {
  const out: Diagnostic[] = []
  const assets = new Map(effective.network.assets.map((asset) => [asset.id, asset]))

  authoredProfile.capabilities.forEach((capability, index) => {
    if (capability.mechanism !== 'remote_exploit') return
    const targets = new Set<string>()
    for (const link of effective.network.links) {
      if (link.service_id !== capability.service_id) continue
      if (link.target_id === effective.initial_asset_id) continue
      const target = assets.get(link.target_id)
      if (target && !target.vulnerabilities.some((fact) => fact.id === capability.vulnerability_id)) {
        targets.add(target.id)
      }
    }
    if (targets.size === 0) return
    const ids = [...targets].sort(compareCodeUnits)
    out.push(
      warning(
        'VULNERABILITY_FACT_MISSING',
        ['profile', 'capabilities', index, 'vulnerability_id'],
        `No "${capability.vulnerability_id}" fact on ${ids.length} ${capability.service_id} link target(s): ` +
          `${ids.join(', ')}. Exploit checks against them evaluate as unknown, not as patched.`,
        { entityId: capability.id },
      ),
    )
  })
  return out
}

/** Validates and canonicalizes a standalone network (for built-in libraries). */
export function validateNetwork(input: unknown): Result<Network> {
  const value = toJsonValue(input)
  if (!value.ok) return value
  const limits = checkNetworkLimits(value.value, [])
  if (limits.length > 0) return fail(limits)
  const shape = validateShape(value.value, 'network')
  if (shape.length > 0) return fail(shape)
  const network = value.value as unknown as Network
  const semantic = checkNetworkSemantics(network, [])
  if (hasErrors(semantic)) return fail(semantic)
  return ok(deepFreeze(canonicalNetwork(network)))
}

export type ProfileValidationOptions = {
  /** Defaults to false: drafts validate but cannot be compiled into a scenario. */
  readonly requireReviewed?: boolean
}

/** Validates and canonicalizes a standalone native profile. STIX input is rejected. */
export function validateProfile(
  input: unknown,
  options: ProfileValidationOptions = {},
): Result<MalwareProfile> {
  const value = toJsonValue(input)
  if (!value.ok) return value
  if (looksLikeStix(value.value)) return fail([error('STIX_NOT_NATIVE', [], STIX_MESSAGE)])
  const limits = checkProfileLimits(value.value, [])
  if (limits.length > 0) return fail(limits)
  const shape = validateShape(value.value, 'profile')
  if (shape.length > 0) return fail(shape)
  const profile = value.value as unknown as MalwareProfile
  const semantic = checkProfileSemantics(profile, [], {
    requireReviewed: options.requireReviewed ?? false,
  })
  if (hasErrors(semantic)) return fail(semantic)
  return ok(deepFreeze(canonicalProfile(profile)))
}
