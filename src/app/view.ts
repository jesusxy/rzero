// Pure view derivation. Turns the immutable run recording and a replay state
// (the viewer's position) into what the map and inspector display. It never
// recomputes propagation: asset and link visuals come only from the recorded
// events as reduced into the replay state.

import type {
  Asset,
  AttemptView,
  Capability,
  CompiledScenario,
  Link,
  ReplayState,
  SimulationEvent,
} from '../core'
import type { GridPosition } from './layout'

export type AssetViewState = 'modeled' | 'discovered' | 'compromised'
export type LinkViewState = 'none' | 'pending' | 'succeeded' | 'blocked' | 'indeterminate'

export type Selection = { readonly type: 'asset'; readonly id: string } | { readonly type: 'attempt'; readonly id: string } | null

export type MapAsset = {
  readonly id: string
  readonly label: string
  readonly kind: Asset['kind']
  readonly position: GridPosition
  readonly state: AssetViewState
  readonly isSeed: boolean
  readonly isolated: boolean
  readonly critical: boolean
  readonly selected: boolean
}

export type MapLink = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly service: string
  readonly access: Link['access']
  readonly from: GridPosition
  readonly to: GridPosition
  readonly state: LinkViewState
  readonly selected: boolean
}

export type PlaybackCounts = {
  readonly total: number
  readonly compromised: number
  readonly discovered: number
  readonly succeeded: number
  readonly blocked: number
  readonly indeterminate: number
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

function linkState(attempt: AttemptView | undefined): LinkViewState {
  if (attempt === undefined) return 'none'
  return attempt.status // 'pending' | 'succeeded' | 'blocked' | 'indeterminate'
}

export function buildMapAssets(
  compiled: CompiledScenario,
  replay: ReplayState,
  layout: ReadonlyMap<string, GridPosition>,
  selection: Selection,
): MapAsset[] {
  const seedId = compiled.effective.initial_asset_id
  const selectedAsset = selection?.type === 'asset' ? selection.id : null
  return compiled.effective.network.assets.map((asset) => ({
    id: asset.id,
    label: asset.label,
    kind: asset.kind,
    position: layout.get(asset.id) ?? { x: 15, y: 15 },
    state: assetState(replay, asset.id),
    isSeed: asset.id === seedId,
    isolated: asset.isolated,
    critical: asset.critical,
    selected: asset.id === selectedAsset,
  }))
}

export function buildMapLinks(
  compiled: CompiledScenario,
  replay: ReplayState,
  layout: ReadonlyMap<string, GridPosition>,
  selection: Selection,
): MapLink[] {
  const byLink = attemptsByLink(replay)
  const selectedAttemptLink =
    selection?.type === 'attempt' ? replay.attempts[selection.id]?.link_id ?? null : null
  const fallback = { x: 15, y: 15 }
  return compiled.effective.network.links.map((link) => ({
    id: link.id,
    source: link.source_id,
    target: link.target_id,
    service: link.service_id,
    access: link.access,
    from: layout.get(link.source_id) ?? fallback,
    to: layout.get(link.target_id) ?? fallback,
    state: linkState(byLink.get(link.id)),
    selected: link.id === selectedAttemptLink,
  }))
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

/** One-line, readable description of an applied event. */
export function describeEvent(event: SimulationEvent): string {
  switch (event.type) {
    case 'run_started':
      return `Run started — seed ${event.initial_asset_id}`
    case 'asset_compromised':
      return event.parent_id === null
        ? `${event.asset_id} compromised (seed)`
        : `${event.asset_id} compromised via ${event.parent_id}`
    case 'asset_discovered':
      return `${event.asset_id} discovered from ${event.source_id} over ${event.link_id}`
    case 'propagation_attempted':
      return `Attempt ${event.source_id} → ${event.target_id} (${event.capability_id})`
    case 'propagation_resolved':
      return `${event.source_id} → ${event.target_id}: ${event.outcome}`
    case 'propagation_skipped':
      return `Skipped ${event.source_id} → ${event.target_id} (target already compromised)`
    case 'run_completed':
      return `Run complete — ${event.compromised_ids.length} compromised`
    case 'run_aborted':
      return `Run aborted (${event.error_code})`
  }
}

export function assetById(compiled: CompiledScenario, id: string): Asset | undefined {
  return compiled.effective.network.assets.find((asset) => asset.id === id)
}

export function linkById(compiled: CompiledScenario, id: string): Link | undefined {
  return compiled.effective.network.links.find((link) => link.id === id)
}

export function capabilityById(compiled: CompiledScenario, id: string): Capability | undefined {
  return compiled.effective.profile.capabilities.find((capability) => capability.id === id)
}
