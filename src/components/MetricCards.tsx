import { createMemo, Show } from 'solid-js'
import type { SimulationStore } from '../app/store'
import { metrics, percent } from '../app/view'

export function MetricCards(props: { store: SimulationStore }) {
  const store = props.store
  const m = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : metrics(compiled, store.replay())
  })
  const attempts = (n: number) => (n === 1 ? 'attempt' : 'attempts')
  return (
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
  )
}
