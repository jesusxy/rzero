import { createMemo, Show } from 'solid-js'
import type { SimulationStore } from '../app/store'
import { joinList } from '../app/narration'
import { displayName, metrics, percent } from '../app/view'

function points(change: number): string {
  const value = Number(Math.abs(change).toFixed(1))
  if (value === 0) return 'no change'
  return `${change > 0 ? '−' : '+'}${value} points`
}

export function MetricCards(props: { store: SimulationStore }) {
  const store = props.store
  const m = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : metrics(compiled, store.replay())
  })
  const compare = createMemo(() => {
    const comparison = store.comparison()
    if (!store.atResults() || comparison === null) return null
    const { baseline, defended, metrics: diff } = comparison.result
    const names = (ids: readonly string[]) => joinList(ids.map((id) => displayName(store.compiled(), id)))
    const savedCritical = baseline.critical_compromised.filter((id) => !defended.critical_compromised.includes(id))
    return {
      total: diff.total_assets,
      compromised: [baseline.compromised.length, defended.compromised.length] as const,
      critical: [baseline.critical_compromised.length, defended.critical_compromised.length] as const,
      criticalNote: savedCritical.length > 0 ? `${names(savedCritical)} saved` : '',
      unknown: [baseline.indeterminate_targets.length, defended.indeterminate_targets.length] as const,
      unknownNote: names(defended.indeterminate_targets),
      radius: [percent(baseline.blast_radius), percent(defended.blast_radius)] as const,
      radiusNote: points(diff.percentage_point_change),
    }
  })
  const attempts = (n: number) => (n === 1 ? 'attempt' : 'attempts')
  return (
    <Show
      when={compare()}
      fallback={
        <Show when={m()}>
          {(value) => (
            <div class="metrics" aria-label="Totals at this step">
              <div class="metric metric-compromised">
                <span class="metric-label">Compromised</span>
                <span class="metric-value">
                  <b>
                    {value().compromised} / {value().total}
                  </b>
                  <small>hosts</small>
                </span>
              </div>
              <div class="metric metric-blocked">
                <span class="metric-label">Blocked</span>
                <span class="metric-value">
                  <b>{value().blocked}</b>
                  <small>{attempts(value().blocked)}</small>
                </span>
              </div>
              <div class="metric metric-unknown">
                <span class="metric-label">Unknown</span>
                <span class="metric-value">
                  <b>{value().unknown}</b>
                  <small>{attempts(value().unknown)}</small>
                </span>
              </div>
              <div class="metric metric-radius">
                <span class="metric-label">Blast radius</span>
                <span class="metric-value">
                  <b>{percent(value().blastRadius)}</b>
                  <small>{store.atEnd() ? 'final' : 'so far'}</small>
                </span>
              </div>
            </div>
          )}
        </Show>
      }
    >
      {(c) => (
        <div class="metrics compare" aria-label="Original run compared with your defense">
          <div class="metric metric-compromised">
            <span class="metric-label">Compromised</span>
            <span class="metric-value">
              <b>
                {c().compromised[0]} → {c().compromised[1]}
              </b>
              <small>of {c().total} hosts</small>
            </span>
          </div>
          <div class="metric" classList={{ 'metric-saved': c().critical[1] < c().critical[0], 'metric-compromised': c().critical[1] >= c().critical[0] }}>
            <span class="metric-label">Critical reached</span>
            <span class="metric-value">
              <b>
                {c().critical[0]} → {c().critical[1]}
              </b>
              <small>{c().criticalNote}</small>
            </span>
          </div>
          <div class="metric metric-unknown">
            <span class="metric-label">Unknown</span>
            <span class="metric-value">
              <b>
                {c().unknown[0]} → {c().unknown[1]}
              </b>
              <small>{c().unknownNote}</small>
            </span>
          </div>
          <div class="metric metric-radius">
            <span class="metric-label">Blast radius</span>
            <span class="metric-value">
              <b>
                {c().radius[0]} → {c().radius[1]}
              </b>
              <small>{c().radiusNote}</small>
            </span>
          </div>
        </div>
      )}
    </Show>
  )
}
