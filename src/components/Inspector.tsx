import { For, Show } from 'solid-js'
import { firstCompromisePath, type AttemptView, type Check } from '../core'
import type { SimulationStore } from '../app/store'
import {
  assetById,
  assetState,
  capabilityById,
  eventAttemptId,
  linkById,
} from '../app/view'

const checkSymbol: Record<Check['status'], string> = { pass: '✓', fail: '✗', unknown: '?' }

export function Inspector(props: { store: SimulationStore }) {
  const store = props.store
  const selection = store.selection

  const selectedAsset = () => {
    const current = selection()
    const compiled = store.compiled()
    if (current?.type !== 'asset' || compiled === null) return null
    return assetById(compiled, current.id) ?? null
  }

  // Active attempt = a pinned attempt, else the one the current step refers to.
  const activeAttempt = (): AttemptView | null => {
    const pinnedId = selection()?.type === 'attempt' ? (selection() as { id: string }).id : null
    const id = pinnedId ?? eventAttemptId(store.currentEvent())
    if (id === null) return null
    return store.replay().attempts[id] ?? null
  }

  return (
    <aside class="inspector" aria-label="Inspector">
      <div class="panel-heading">
        <p class="eyebrow">Inspector</p>
        <h2>Details</h2>
      </div>

      <Show
        when={store.phase() === 'ready'}
        fallback={<p class="inspector-empty">Run the scenario to inspect hosts and attempts.</p>}
      >
        {/* Selected host */}
        <Show when={selectedAsset()}>
          {(asset) => (
            <section class="inspector-section" aria-label="Selected host">
              <p class="eyebrow">Host</p>
              <h3>{asset().label} <span class="muted">{asset().id}</span></h3>
              <StateBadge label={assetState(store.replay(), asset().id)} />
              <dl class="facts">
                <dt>Kind</dt><dd>{asset().kind}</dd>
                <dt>Platform</dt><dd>{asset().platform}</dd>
                <dt>Segment</dt><dd>{asset().segment_id}</dd>
                <dt>Services</dt>
                <dd>{asset().services.map((s) => `${s.id}/${s.transport}:${s.port} (${s.status})`).join(', ') || 'none'}</dd>
                <dt>Vulnerabilities</dt>
                <dd>{asset().vulnerabilities.map((v) => `${v.id}: ${v.status}`).join(', ') || 'none modeled'}</dd>
                <dt>Credentials</dt>
                <dd>{asset().credential_ids.join(', ') || 'none available'}</dd>
                <dt>Flags</dt>
                <dd>
                  {[asset().critical ? 'critical' : null, asset().isolated ? 'isolated' : null]
                    .filter(Boolean)
                    .join(', ') || 'none'}
                </dd>
              </dl>

              <Show when={assetState(store.replay(), asset().id) === 'compromised'}>
                <CompromisePath store={store} assetId={asset().id} />
              </Show>
            </section>
          )}
        </Show>

        {/* Attempt — pinned or the current step */}
        <Show
          when={activeAttempt()}
          fallback={
            <Show when={selection() === null && eventAttemptId(store.currentEvent()) === null}>
              <p class="inspector-hint">Select a host or route, or step to an attempt event.</p>
            </Show>
          }
        >
          {(attempt) => <AttemptCard store={store} attempt={attempt()} />}
        </Show>
      </Show>
    </aside>
  )
}

function StateBadge(props: { label: string }) {
  return <span class={`state-badge state-${props.label}`}>{props.label}</span>
}

function CompromisePath(props: { store: SimulationStore; assetId: string }) {
  const run = () => props.store.run()
  const path = () => {
    const current = run()
    return current === null ? [] : firstCompromisePath(current, props.assetId) ?? []
  }
  return (
    <div class="path-block">
      <p class="eyebrow">First-compromise path</p>
      <ol class="path-list">
        <For each={path()}>{(step) => (
          <li>
            <span class="path-node">{step.asset_id}</span>
            <Show when={step.via}>
              {(via) => <span class="path-via">via {via().source_id} / {via().capability_id}</span>}
            </Show>
          </li>
        )}</For>
      </ol>
    </div>
  )
}

function AttemptCard(props: { store: SimulationStore; attempt: AttemptView }) {
  const compiled = () => props.store.compiled()
  const service = () => {
    const c = compiled()
    return c === null ? props.attempt.link_id : linkById(c, props.attempt.link_id)?.service_id ?? props.attempt.link_id
  }
  const mechanism = () => {
    const c = compiled()
    return c === null ? '' : capabilityById(c, props.attempt.capability_id)?.mechanism ?? ''
  }
  const pinned = () => props.store.selection()?.type === 'attempt'

  return (
    <section class="inspector-section" aria-label="Attempt">
      <p class="eyebrow">{pinned() ? 'Attempt (pinned)' : 'Attempt (current step)'}</p>
      <h3>{props.attempt.source_id} → {props.attempt.target_id}</h3>
      <span class={`state-badge attempt-${props.attempt.status}`}>{props.attempt.status}</span>
      <dl class="facts">
        <dt>Service</dt><dd>{service()}</dd>
        <dt>Capability</dt><dd>{props.attempt.capability_id}{mechanism() ? ` (${mechanism()})` : ''}</dd>
        <dt>Link</dt><dd>{props.attempt.link_id}</dd>
      </dl>

      <Show
        when={props.attempt.status !== 'pending'}
        fallback={<p class="inspector-hint">Attempt pending — step forward to resolve it.</p>}
      >
        <p class="eyebrow">Requirement checks</p>
        <ul class="checks">
          <For each={props.attempt.checks}>{(check) => (
            <li class={`check check-${check.status}`}>
              <span class="check-symbol" aria-hidden="true">{checkSymbol[check.status]}</span>
              <span class="check-code">{check.code}</span>
              <span class="check-status">{check.status.toUpperCase()}</span>
              <span class="check-facts">expected {check.expected} / observed {check.observed}</span>
              <Show when={check.intervention_ids && check.intervention_ids.length > 0}>
                <span class="check-intervention">via {check.intervention_ids!.join(', ')}</span>
              </Show>
            </li>
          )}</For>
        </ul>
      </Show>
    </section>
  )
}
