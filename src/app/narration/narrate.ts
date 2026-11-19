// Plain-English narration of one replay step, for a step-by-step walkthrough.
//
// Facts come only from the recorded events (and, for the summary, the replay
// state at the step's end) plus the compiled scenario for names. Nothing here
// re-evaluates propagation. Prose lives in ./templates.

import {
  seekReplay,
  type Asset,
  type Capability,
  type Check,
  type CompiledScenario,
  type PropagationAttemptedEvent,
  type PropagationResolvedEvent,
  type SimulationEvent,
  type Step,
} from '../../core'
import { INTERVENTION_KINDS, REASONS, REASON_VARIANTS, STEP_TEXT, type DecidingStatus, type ReasonTemplate } from './templates'

export type Narration = {
  /** Headline only, e.g. "Blocked at LAB-WS-C". The step number is shown separately. */
  readonly title: string
  /** Outcome-neutral title for a step not yet reached. */
  readonly preview: string
  readonly body: string
  /** The evidence claim behind the attempt's capability, when there is one. */
  readonly why?: string
}

type Vars = Readonly<Record<string, string | undefined>>

/** Replaces `{name}` tokens. A token without a value is left in place, visibly. */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (token, name: string) => vars[name] ?? token)
}

export function narrate(step: Step, events: readonly SimulationEvent[], scenario: CompiledScenario): Narration {
  const context = new NarrationContext(step, events, scenario)
  switch (step.kind) {
    case 'seed':
      return context.seed()
    case 'attempt':
      return context.attempt()
    case 'summary':
      return context.summary()
    case 'aborted':
      return context.aborted()
  }
}

/** The primary reason: the first failed check in fixed order, else the first unknown. */
export function primaryCheck(checks: readonly Check[]): Check | undefined {
  return checks.find((check) => check.status === 'fail') ?? checks.find((check) => check.status === 'unknown')
}

class NarrationContext {
  private readonly step: Step
  private readonly events: readonly SimulationEvent[]
  private readonly scenario: CompiledScenario
  private readonly range: readonly SimulationEvent[]
  private readonly assets: ReadonlyMap<string, Asset>

  constructor(step: Step, events: readonly SimulationEvent[], scenario: CompiledScenario) {
    this.step = step
    this.events = events
    this.scenario = scenario
    this.range = events.slice(step.start, step.end)
    this.assets = new Map(scenario.effective.network.assets.map((asset) => [asset.id, asset]))
  }

  seed(): Narration {
    const started = this.range.find((event) => event.type === 'run_started')
    const vars = { seed: this.label(started?.initial_asset_id ?? this.scenario.effective.initial_asset_id) }
    const recorded = this.range.some((event) => event.type === 'asset_compromised' && event.parent_id === null)
    const text = recorded ? STEP_TEXT.seed : STEP_TEXT.seedUnrecorded
    return { title: fill(text.title, vars), preview: fill(text.preview, vars), body: fill(text.body, vars) }
  }

  attempt(): Narration {
    const attempted = this.range.find(
      (event): event is PropagationAttemptedEvent =>
        event.type === 'propagation_attempted' && event.attempt_id === this.step.attempt_id,
    )
    if (attempted === undefined) throw new Error(`narrate: attempt step ${this.step.index} has no attempted event`)
    const resolved = this.range.find(
      (event): event is PropagationResolvedEvent =>
        event.type === 'propagation_resolved' && event.attempt_id === attempted.attempt_id,
    )
    const capability = this.scenario.effective.profile.capabilities.find((entry) => entry.id === attempted.capability_id)
    const vars = this.attemptVars(attempted, capability)

    const preview = fill(this.hasAlternatives(attempted) ? STEP_TEXT.attempt.previewWithCapability : STEP_TEXT.attempt.preview, vars)
    const sentences = [...this.skipSentences(), fill(this.lead(attempted), vars)]
    const why = this.why(resolved?.evidence_ids ?? capability?.evidence_ids ?? [])

    if (resolved === undefined) {
      sentences.push(STEP_TEXT.unresolved.consequence)
      return withWhy({ title: fill(STEP_TEXT.unresolved.title, vars), preview, body: sentences.join(' ') }, why)
    }

    if (resolved.outcome === 'succeeded') {
      const credential = resolved.checks.find((check) => check.code === 'CREDENTIAL_AUTHORIZED')
      const requirements =
        capability?.mechanism === 'remote_execution'
          ? STEP_TEXT.succeeded.requirementsExecution
          : STEP_TEXT.succeeded.requirementsExploit
      sentences.push(fill(requirements, { ...vars, ...(credential ? checkVars(credential) : {}) }))
      sentences.push(fill(STEP_TEXT.succeeded.consequence, vars))
      return withWhy({ title: fill(STEP_TEXT.succeeded.title, vars), preview, body: sentences.join(' ') }, why)
    }

    const text = resolved.outcome === 'blocked' ? STEP_TEXT.blocked : STEP_TEXT.indeterminate
    const deciding = primaryCheck(resolved.checks)
    if (deciding !== undefined) {
      sentences.push(fill(reasonTemplate(deciding).because, { ...vars, ...checkVars(deciding) }))
      const intervention = this.interventionPhrase(deciding.intervention_ids ?? [])
      if (intervention !== undefined) sentences.push(fill(text.intervention, { intervention }))
      const others = resolved.checks.filter((check) => check !== deciding && check.status !== 'pass')
      if (others.length > 0) {
        const issues = joinList(others.map((check) => fill(reasonTemplate(check).also, { ...vars, ...checkVars(check) })))
        sentences.push(fill(STEP_TEXT.alsoIssues, { issues }))
      }
      if (deciding.status === 'fail' && resolved.checks.some((check) => check.status === 'unknown')) {
        sentences.push(STEP_TEXT.failOutweighsUnknown)
      }
    }
    const unreachable =
      resolved.outcome === 'blocked' &&
      resolved.checks.some((check) => check.code === 'TARGET_NOT_ISOLATED' && check.status === 'fail')
    sentences.push(fill(unreachable ? STEP_TEXT.blocked.consequenceUnreachable : text.consequence, vars))
    return withWhy({ title: fill(text.title, vars), preview, body: sentences.join(' ') }, why)
  }

  summary(): Narration {
    const state = seekReplay(this.events, this.step.end)
    const compromised = new Set(state.compromised)
    const vars = this.resultVars(state.compromised)
    const sentences = [
      ...this.skipSentences(),
      STEP_TEXT.summary.lead,
      fill(STEP_TEXT.summary.compromised, vars),
    ]

    const untouched = this.scenario.effective.network.assets.filter((asset) => !compromised.has(asset.id))
    if (untouched.length > 0) sentences.push(fill(STEP_TEXT.summary.untouched, this.hostsVars(untouched.map((a) => a.id))))

    const critical = this.scenario.effective.network.assets.filter((asset) => asset.critical)
    const criticalReached = critical.filter((asset) => compromised.has(asset.id))
    if (critical.length === 0) sentences.push(STEP_TEXT.summary.noCritical)
    else if (criticalReached.length === 0) sentences.push(fill(STEP_TEXT.summary.criticalSpared, this.hostsVars(critical.map((a) => a.id))))
    else sentences.push(fill(STEP_TEXT.summary.criticalReached, this.hostsVars(criticalReached.map((a) => a.id))))

    const indeterminate = [
      ...new Set(
        Object.values(state.attempts)
          .filter((attempt) => attempt.status === 'indeterminate' && !compromised.has(attempt.target_id))
          .map((attempt) => attempt.target_id),
      ),
    ]
    if (indeterminate.length > 0) sentences.push(fill(STEP_TEXT.summary.indeterminate, this.hostsVars(indeterminate)))

    return { title: fill(STEP_TEXT.summary.title, vars), preview: STEP_TEXT.summary.preview, body: sentences.join(' ') }
  }

  aborted(): Narration {
    const state = seekReplay(this.events, this.step.end)
    const abort = this.range.find((event) => event.type === 'run_aborted')
    const reason = abort === undefined ? undefined : STEP_TEXT.aborted.reasons[abort.error_code]
    const sentences = [...this.skipSentences(), fill(STEP_TEXT.aborted.lead, { reason })]
    const pending = this.range.filter((event) => event.type === 'asset_discovered').at(-1)
    if (pending?.type === 'asset_discovered') {
      sentences.push(fill(STEP_TEXT.aborted.pendingTarget, { target: this.label(pending.asset_id) }))
    }
    sentences.push(fill(STEP_TEXT.aborted.partial, this.resultVars(state.compromised)))
    return { title: STEP_TEXT.aborted.title, preview: STEP_TEXT.aborted.preview, body: sentences.join(' ') }
  }

  private label(id: string): string {
    const label = this.assets.get(id)?.label
    return label !== undefined && label !== '' ? label : id
  }

  private attemptVars(attempted: PropagationAttemptedEvent, capability: Capability | undefined): Vars {
    const link = this.scenario.effective.network.links.find((entry) => entry.id === attempted.link_id)
    return {
      source: this.label(attempted.source_id),
      target: this.label(attempted.target_id),
      capability: capability?.label || attempted.capability_id,
      service: capability?.service_id ?? link?.service_id,
      vulnerability: capability?.mechanism === 'remote_exploit' ? capability.vulnerability_id : undefined,
      privilege: capability?.mechanism === 'remote_execution' ? capability.minimum_privilege : undefined,
      platforms: capability === undefined ? undefined : joinList([...capability.target_platforms], 'or'),
    }
  }

  /** Another attempt on the same source → target pair (alternative capabilities). */
  private hasAlternatives(attempted: PropagationAttemptedEvent): boolean {
    return this.events.some(
      (event) =>
        event.type === 'propagation_attempted' &&
        event.attempt_id !== attempted.attempt_id &&
        event.source_id === attempted.source_id &&
        event.target_id === attempted.target_id,
    )
  }

  private lead(attempted: PropagationAttemptedEvent): string {
    const earlier = this.events
      .slice(0, this.step.start)
      .filter((event): event is PropagationResolvedEvent => event.type === 'propagation_resolved')
    const previous = earlier.at(-1)
    if (
      previous !== undefined &&
      previous.outcome !== 'succeeded' &&
      previous.source_id === attempted.source_id &&
      previous.target_id === attempted.target_id
    ) {
      return STEP_TEXT.attempt.leadNextOption
    }
    if (earlier.some((event) => event.target_id === attempted.target_id && event.outcome !== 'succeeded')) {
      return STEP_TEXT.attempt.leadRetried
    }
    return STEP_TEXT.attempt.lead
  }

  private skipSentences(): string[] {
    return this.range.flatMap((event) =>
      event.type === 'propagation_skipped'
        ? [fill(STEP_TEXT.skipped, { source: this.label(event.source_id), target: this.label(event.target_id) })]
        : [],
    )
  }

  /** "the segmentation rule deny-ws-srv-smb", for each intervention that wrote the deciding fact. */
  private interventionPhrase(ids: readonly string[]): string | undefined {
    if (ids.length === 0) return undefined
    return joinList(
      ids.map((id) => {
        const record = this.scenario.manifest.find((entry) => entry.intervention_id === id)
        let kind: string = INTERVENTION_KINDS.unknown
        if (record?.type === 'set_vulnerability_status' && record.value.status === 'absent') {
          kind = INTERVENTION_KINDS.set_vulnerability_status_absent
        } else if (record?.type === 'set_grant_status' && record.value.status === 'invalid') {
          kind = INTERVENTION_KINDS.set_grant_status_invalid
        } else if (record !== undefined) {
          kind = INTERVENTION_KINDS[record.type]
        }
        return `the ${kind} ${id}`
      }),
    )
  }

  private why(evidenceIds: readonly string[]): string | undefined {
    const claims = evidenceIds.flatMap((id) => {
      const claim = this.scenario.effective.profile.sources.find((source) => source.id === id)?.claim_summary
      return claim === undefined ? [] : [claim]
    })
    return claims.length === 0 ? undefined : claims.join(' ')
  }

  private resultVars(compromised: readonly string[]): Vars {
    const total = this.scenario.effective.network.assets.length
    return {
      count: String(compromised.length),
      total: String(total),
      are: compromised.length === 1 ? 'is' : 'are',
      were: compromised.length === 1 ? 'was' : 'were',
      percent: percent(total === 0 ? 0 : compromised.length / total),
      hosts: joinList(compromised.map((id) => this.label(id))),
    }
  }

  private hostsVars(ids: readonly string[]): Vars {
    return {
      hosts: joinList(ids.map((id) => this.label(id))),
      were: ids.length === 1 ? 'was' : 'were',
      are: ids.length === 1 ? 'is' : 'are',
      them: ids.length === 1 ? 'it' : 'them',
      they: ids.length === 1 ? 'it' : 'they',
    }
  }
}

/** Facts from one check, for the reason templates. */
function checkVars(check: Check): Vars {
  const vars: Record<string, string | undefined> = { observed: check.observed }
  if (check.code === 'CREDENTIAL_AUTHORIZED') {
    vars.credential = check.entity_refs[0]
    vars.granted = check.observed.split(':')[1]
  }
  return vars
}

/** The observed-fact variant that sharpens a reason, if any (see REASON_VARIANTS). */
function reasonVariant(check: Check): string | undefined {
  if (check.code === 'SERVICE_ENABLED' && check.status === 'fail' && check.observed === 'absent') return 'absent'
  if (check.code === 'VULNERABILITY_PRESENT' && check.status === 'unknown' && check.observed === 'missing') return 'missing'
  if (check.code === 'CREDENTIAL_AUTHORIZED' && check.status === 'fail' && check.observed !== 'none') {
    return check.observed.startsWith('invalid:') ? 'invalid' : 'underprivileged'
  }
  return undefined
}

export function reasonTemplate(check: Check): ReasonTemplate {
  const status: DecidingStatus = check.status === 'fail' ? 'fail' : 'unknown'
  const base = REASONS[check.code][status]
  const variant = reasonVariant(check)
  return variant === undefined ? base : { ...base, ...REASON_VARIANTS[`${check.code}/${status}/${variant}`] }
}

function withWhy(narration: Omit<Narration, 'why'>, why: string | undefined): Narration {
  return why === undefined ? narration : { ...narration, why }
}

/** "a", "a and b", "a, b and c". */
function joinList(items: readonly string[], conjunction = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`
}

/** 0.6 → "60%", 1/3 → "33.3%". */
function percent(ratio: number): string {
  return `${Number((ratio * 100).toFixed(1))}%`
}
