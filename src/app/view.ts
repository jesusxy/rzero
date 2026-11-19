import type {
  Asset,
  AttemptView,
  CompiledScenario,
  PropagationResolvedEvent,
  ReplayState,
  SimulationEvent,
  Step,
} from '../core'

export type HostStatus = 'compromised' | 'unknown' | 'blocked' | null

export type RouteState = 'untried' | 'pending' | 'succeeded' | 'blocked' | 'indeterminate'

export type Metrics = {
  readonly total: number
  readonly compromised: number
  readonly blocked: number
  readonly unknown: number
  readonly blastRadius: number
}

export function stepIndexAt(steps: readonly Step[], cursor: number): number {
  if (cursor <= 0) return -1
  return steps.findIndex((step) => step.start < cursor && cursor <= step.end)
}

export function isStepComplete(steps: readonly Step[], cursor: number): boolean {
  const index = stepIndexAt(steps, cursor)
  return index >= 0 && cursor === steps[index]!.end
}

export function nextCursor(steps: readonly Step[], cursor: number): number {
  if (steps.length === 0) return cursor
  const index = stepIndexAt(steps, cursor)
  if (index === -1) return steps[0]!.end
  const step = steps[index]!
  if (cursor < step.end) return step.end
  return index + 1 < steps.length ? steps[index + 1]!.end : cursor
}

export function backCursor(steps: readonly Step[], cursor: number): number {
  const index = stepIndexAt(steps, cursor)
  return index > 0 ? steps[index - 1]!.end : cursor
}

export function stepRange(step: Step): string {
  return step.end - step.start === 1 ? `seq ${step.start}` : `seq ${step.start}–${step.end - 1}`
}

export function assetById(compiled: CompiledScenario, id: string): Asset | undefined {
  return compiled.effective.network.assets.find((asset) => asset.id === id)
}

export function displayName(compiled: CompiledScenario | null, id: string): string {
  const label = compiled === null ? undefined : assetById(compiled, id)?.label
  return label !== undefined && label !== '' ? label : id
}

export function hostStatus(replay: ReplayState, id: string): HostStatus {
  if (replay.compromised.includes(id)) return 'compromised'
  const attempts = Object.values(replay.attempts).filter((attempt) => attempt.target_id === id)
  if (attempts.some((attempt) => attempt.status === 'indeterminate')) return 'unknown'
  if (attempts.some((attempt) => attempt.status === 'blocked')) return 'blocked'
  return null
}

export function latestAttemptByLink(replay: ReplayState): ReadonlyMap<string, AttemptView> {
  const byLink = new Map<string, AttemptView>()
  for (const attempt of Object.values(replay.attempts)) {
    const existing = byLink.get(attempt.link_id)
    if (existing === undefined || (existing.status !== 'succeeded' && attempt.attempt_id > existing.attempt_id)) {
      byLink.set(attempt.link_id, attempt)
    }
  }
  return byLink
}

export function routeState(attempt: AttemptView | undefined): RouteState {
  return attempt === undefined ? 'untried' : attempt.status
}

export function metrics(compiled: CompiledScenario, replay: ReplayState): Metrics {
  const total = compiled.effective.network.assets.length
  const attempts = Object.values(replay.attempts)
  return {
    total,
    compromised: replay.compromised.length,
    blocked: attempts.filter((attempt) => attempt.status === 'blocked').length,
    unknown: attempts.filter((attempt) => attempt.status === 'indeterminate').length,
    blastRadius: total === 0 ? 0 : replay.compromised.length / total,
  }
}

export function percent(ratio: number): string {
  return `${Number((ratio * 100).toFixed(1))}%`
}

export function resolvedAttemptsOn(
  events: readonly SimulationEvent[],
  cursor: number,
  hostId: string,
): PropagationResolvedEvent[] {
  return events
    .slice(0, cursor)
    .filter((event): event is PropagationResolvedEvent => event.type === 'propagation_resolved' && event.target_id === hostId)
}
