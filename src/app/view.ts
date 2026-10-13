// Pure view derivation. Turns the immutable run recording and a replay state
// (the viewer's position) into what the map and inspector display. It never
// recomputes propagation: asset and link visuals come only from the recorded
// events as reduced into the replay state.
//
// The static scene (ids, kinds, positions, link endpoints) depends only on the
// compiled scenario, so it keeps a stable identity across playback and selection
// updates — the components iterate it once and read dynamic state through
// accessors, which keeps rendered elements (and keyboard focus) in place.

import type {
  Asset,
  AttemptView,
  Capability,
  Check,
  CompiledScenario,
  Link,
  PropagationResolvedEvent,
  ReplayState,
  RunResult,
  SimulationEvent,
} from '../core'
import type { GridPosition } from './layout'

export type AssetViewState = 'modeled' | 'discovered' | 'compromised'
export type LinkViewState = 'none' | 'pending' | 'succeeded' | 'blocked' | 'indeterminate'

export type Selection =
  | { readonly type: 'asset'; readonly id: string }
  | { readonly type: 'attempt'; readonly id: string }
  | null

/** Stable per-asset facts for the map/inventory (independent of playback). */
export type StaticMapAsset = {
  readonly id: string
  readonly label: string
  /** Concise map name, e.g. WS-01; consistent across panels. */
  readonly shortName: string
  readonly kind: Asset['kind']
  readonly platform: Asset['platform']
  readonly position: GridPosition
  readonly isSeed: boolean
}

/** Stable per-link facts for the map (endpoints and presentation waypoints). */
export type StaticMapLink = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly service: string
  readonly access: Link['access']
  readonly from: GridPosition
  readonly to: GridPosition
  /** Presentation-only bend points between from and to (grid space). */
  readonly waypoints: readonly GridPosition[]
}

export type PlaybackCounts = {
  readonly total: number
  readonly compromised: number
  readonly discovered: number
  readonly succeeded: number
  readonly blocked: number
  readonly indeterminate: number
}

// Concise, consistent display names (WS-01, SRV-01, …): a per-kind sequence over
// assets sorted by ID. Cached per compiled scenario so every panel agrees. The
// internal fixture ID remains available (and is shown in the inspector).
const KIND_ABBREV: Record<Asset['kind'], string> = {
  workstation: 'WS',
  server: 'SRV',
  controller: 'DC',
  appliance: 'APP',
  other: 'ND',
}
const nameCache = new WeakMap<CompiledScenario, ReadonlyMap<string, string>>()

function nameMap(compiled: CompiledScenario): ReadonlyMap<string, string> {
  const cached = nameCache.get(compiled)
  if (cached !== undefined) return cached
  const counters: Record<string, number> = {}
  const map = new Map<string, string>()
  for (const asset of [...compiled.effective.network.assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const prefix = KIND_ABBREV[asset.kind]
    counters[prefix] = (counters[prefix] ?? 0) + 1
    map.set(asset.id, `${prefix}-${String(counters[prefix]).padStart(2, '0')}`)
  }
  nameCache.set(compiled, map)
  return map
}

export function buildStaticAssets(
  compiled: CompiledScenario,
  layout: ReadonlyMap<string, GridPosition>,
): StaticMapAsset[] {
  const seedId = compiled.effective.initial_asset_id
  const names = nameMap(compiled)
  return compiled.effective.network.assets.map((asset) => ({
    id: asset.id,
    label: asset.label,
    shortName: names.get(asset.id) ?? asset.id,
    kind: asset.kind,
    platform: asset.platform,
    position: layout.get(asset.id) ?? { x: 15, y: 15 },
    isSeed: asset.id === seedId,
  }))
}

/**
 * Presentation-only waypoints that route a link along the two isometric grid
 * directions (grid-axis segments), bending around building footprints. Returns
 * [] when the link is already axis-aligned. Deterministic; for the fixed scene.
 */
export function isoWaypoints(
  from: GridPosition,
  to: GridPosition,
  occupied: ReadonlySet<string>,
): GridPosition[] {
  if (from.x === to.x || from.y === to.y) return []
  const key = (p: GridPosition) => `${p.x},${p.y}`
  const elbowA = { x: to.x, y: from.y }
  const elbowB = { x: from.x, y: to.y }
  if (!occupied.has(key(elbowA))) return [elbowA]
  if (!occupied.has(key(elbowB))) return [elbowB]
  return []
}

export function buildStaticLinks(
  compiled: CompiledScenario,
  layout: ReadonlyMap<string, GridPosition>,
  waypointsFor: (link: Link, from: GridPosition, to: GridPosition) => readonly GridPosition[],
): StaticMapLink[] {
  const fallback = { x: 15, y: 15 }
  return compiled.effective.network.links.map((link) => {
    const from = layout.get(link.source_id) ?? fallback
    const to = layout.get(link.target_id) ?? fallback
    return {
      id: link.id,
      source: link.source_id,
      target: link.target_id,
      service: link.service_id,
      access: link.access,
      from,
      to,
      waypoints: waypointsFor(link, from, to),
    }
  })
}

/** Persistent replay state of a single asset at the current cursor. */
export function assetState(replay: ReplayState, id: string): AssetViewState {
  if (replay.compromised.includes(id)) return 'compromised'
  if (replay.discovered.includes(id)) return 'discovered'
  return 'modeled'
}

/** Latest attempt recorded for each link up to the cursor (succeeded wins, else newest). */
export function attemptsByLink(replay: ReplayState): ReadonlyMap<string, AttemptView> {
  const byLink = new Map<string, AttemptView>()
  for (const attempt of Object.values(replay.attempts)) {
    const existing = byLink.get(attempt.link_id)
    if (existing === undefined) {
      byLink.set(attempt.link_id, attempt)
    } else if (existing.status !== 'succeeded' && attempt.attempt_id > existing.attempt_id) {
      byLink.set(attempt.link_id, attempt)
    }
  }
  return byLink
}

export function linkViewState(attempt: AttemptView | undefined): LinkViewState {
  return attempt === undefined ? 'none' : attempt.status
}

export function playbackCounts(compiled: CompiledScenario, replay: ReplayState): PlaybackCounts {
  let succeeded = 0
  let blocked = 0
  let indeterminate = 0
  for (const attempt of Object.values(replay.attempts)) {
    if (attempt.status === 'succeeded') succeeded += 1
    else if (attempt.status === 'blocked') blocked += 1
    else if (attempt.status === 'indeterminate') indeterminate += 1
  }
  return {
    total: compiled.effective.network.assets.length,
    compromised: replay.compromised.length,
    discovered: replay.discovered.length,
    succeeded,
    blocked,
    indeterminate,
  }
}

/** The attempt ID a replay event refers to, if it is an attempt event. */
export function eventAttemptId(event: SimulationEvent | null): string | null {
  if (event === null) return null
  if (event.type === 'propagation_attempted' || event.type === 'propagation_resolved') return event.attempt_id
  return null
}

// --- Event explanations -----------------------------------------------------

export type ExplanationTone = 'neutral' | 'succeeded' | 'blocked' | 'indeterminate' | 'pending'

export type EventExplanation = {
  readonly headline: string
  readonly tone: ExplanationTone
  readonly detail?: string
}

/** The decisive check: first failure, else first unknown. */
export function primaryCheck(checks: readonly Check[]): Check | null {
  return checks.find((c) => c.status === 'fail') ?? checks.find((c) => c.status === 'unknown') ?? null
}

function reasonPhrase(check: Check | null): string {
  if (check === null) return 'requirements not met'
  const failed = check.status === 'fail'
  switch (check.code) {
    case 'SOURCE_NOT_ISOLATED':
      return 'source host is isolated'
    case 'TARGET_NOT_ISOLATED':
      return 'target host is isolated'
    case 'TARGET_PLATFORM':
      return failed ? 'target platform not supported' : 'target platform unknown'
    case 'NETWORK_ACCESS':
      return failed ? 'network access denied' : 'network access unknown'
    case 'SERVICE_ENABLED':
      return failed ? 'target service not enabled' : 'service status unknown'
    case 'VULNERABILITY_PRESENT':
      return failed ? 'vulnerability absent' : 'vulnerability status unknown'
    case 'CREDENTIAL_AUTHORIZED':
      return failed ? 'no authorizing credential' : 'credential authorization unknown'
  }
}

/** A readable, checks-derived explanation of an applied event. Covers every event type. */
export function explainEvent(event: SimulationEvent, compiled: CompiledScenario | null): EventExplanation {
  const name = (id: string) => displayName(compiled, id)
  switch (event.type) {
    case 'run_started':
      return { headline: `Run started — initial host ${name(event.initial_asset_id)}`, tone: 'neutral' }
    case 'asset_compromised':
      return event.parent_id === null
        ? { headline: `${name(event.asset_id)} is the initial compromised host`, tone: 'neutral' }
        : { headline: `${name(event.asset_id)} compromised`, tone: 'succeeded', detail: `Reached from ${name(event.parent_id)}.` }
    case 'asset_discovered':
      return {
        headline: `${name(event.asset_id)} discovered`,
        tone: 'neutral',
        detail: `Now a candidate target, reached from ${name(event.source_id)}. Discovery is not compromise.`,
      }
    case 'propagation_attempted':
      return {
        headline: `Attempting ${name(event.source_id)} → ${name(event.target_id)}`,
        tone: 'pending',
        detail: 'Evaluating requirement checks — step forward to resolve.',
      }
    case 'propagation_resolved': {
      const target = name(event.target_id)
      const source = name(event.source_id)
      if (event.outcome === 'succeeded') {
        return { headline: `Succeeded: ${target} compromised`, tone: 'succeeded', detail: `${source} → ${target}.` }
      }
      const reason = reasonPhrase(primaryCheck(event.checks))
      return event.outcome === 'blocked'
        ? { headline: `Blocked: ${reason}`, tone: 'blocked', detail: `${source} → ${target}.` }
        : { headline: `Indeterminate: ${reason}`, tone: 'indeterminate', detail: `${source} → ${target}.` }
    }
    case 'propagation_skipped':
      return {
        headline: `Skipped ${name(event.source_id)} → ${name(event.target_id)}`,
        tone: 'neutral',
        detail: 'Target already compromised.',
      }
    case 'run_completed':
      return { headline: `Run complete — ${event.compromised_ids.length} hosts compromised`, tone: 'neutral' }
    case 'run_aborted':
      return { headline: `Run aborted (${event.error_code})`, tone: 'neutral' }
  }
}

/** Explanation for an attempt from its ledger view (status + recorded checks). */
export function explainAttempt(attempt: AttemptView, compiled: CompiledScenario | null): EventExplanation {
  const source = displayName(compiled, attempt.source_id)
  const target = displayName(compiled, attempt.target_id)
  if (attempt.status === 'pending') {
    return { headline: `Attempting ${source} → ${target}`, tone: 'pending', detail: 'Evaluating requirement checks.' }
  }
  if (attempt.status === 'succeeded') {
    return { headline: `Succeeded: ${target} compromised`, tone: 'succeeded', detail: `${source} → ${target}.` }
  }
  const reason = reasonPhrase(primaryCheck(attempt.checks))
  return attempt.status === 'blocked'
    ? { headline: `Blocked: ${reason}`, tone: 'blocked', detail: `${source} → ${target}.` }
    : { headline: `Indeterminate: ${reason}`, tone: 'indeterminate', detail: `${source} → ${target}.` }
}

// --- Lookups ----------------------------------------------------------------

export function assetById(compiled: CompiledScenario, id: string): Asset | undefined {
  return compiled.effective.network.assets.find((asset) => asset.id === id)
}

export function linkById(compiled: CompiledScenario, id: string): Link | undefined {
  return compiled.effective.network.links.find((link) => link.id === id)
}

export function capabilityById(compiled: CompiledScenario, id: string): Capability | undefined {
  return compiled.effective.profile.capabilities.find((capability) => capability.id === id)
}

/** The concise display name for an asset ID, consistent across all panels. */
export function displayName(compiled: CompiledScenario | null, id: string): string {
  if (compiled === null) return id
  return nameMap(compiled).get(id) ?? id
}

/** Resolved event for an attempt ID, from the full recording (any cursor). */
export function attemptResolvedEvent(run: RunResult, id: string): PropagationResolvedEvent | null {
  for (const event of run.events) {
    if (event.type === 'propagation_resolved' && event.attempt_id === id) return event
  }
  return null
}

/** Static source/target/link/capability for an attempt ID, from the full recording. */
export function attemptStaticInfo(
  run: RunResult,
  id: string,
): { source_id: string; target_id: string; link_id: string; capability_id: string } | null {
  for (const event of run.events) {
    if ((event.type === 'propagation_attempted' || event.type === 'propagation_resolved') && event.attempt_id === id) {
      return {
        source_id: event.source_id,
        target_id: event.target_id,
        link_id: event.link_id,
        capability_id: event.capability_id,
      }
    }
  }
  return null
}

/** The most recent attempt ID recorded on a link across the whole run, if any. */
export function attemptIdForLink(run: RunResult, linkId: string): string | null {
  let id: string | null = null
  for (const event of run.events) {
    if (event.type === 'propagation_attempted' && event.link_id === linkId) id = event.attempt_id
  }
  return id
}
