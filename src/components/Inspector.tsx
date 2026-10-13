import { For, Show, Switch, Match } from 'solid-js'
import { firstCompromisePath, type AttemptView, type Check } from '../core'
import type { SimulationStore } from '../app/store'
import {
  assetById,
  assetState,
  attemptStaticInfo,
  capabilityById,
  displayName,
  eventAttemptId,
  explainAttempt,
  explainEvent,
  linkById,
  type EventExplanation,
} from '../app/view'

const checkSymbol: Record<Check['status'], string> = { pass: '✓', fail: '✗', unknown: '?' }

export function Inspector(props: { store: SimulationStore }) {
  const store = props.store
  const pinnedAssetId = () => (store.selection()?.type === 'asset' ? (store.selection() as { id: string }).id : null)
  const pinnedAttemptId = () => (store.selection()?.type === 'attempt' ? (store.selection() as { id: string }).id : null)

  return (
    <aside class="inspector" aria-label="Inspector">
      <div class="panel-heading">
        <p class="eyebrow">Inspector</p>
        <h2>Explanation</h2>
      </div>

      <Switch fallback={<p class="inspector-empty">Preparing scenario…</p>}>
        <Match when={store.phase() === 'error'}>
          <p class="inspector-empty">The scenario could not be prepared — see the banner above.</p>
        </Match>

        {/* Pinned host — available before and after Start */}
        <Match when={pinnedAssetId()}>
          {(id) => (
            <>
              <HostPanel store={store} assetId={id()} />
              <FollowButton store={store} />
            </>
          )}
        </Match>

        {/* Pinned attempt — only meaningful after a run */}
        <Match when={pinnedAttemptId()}>
          {(id) => (
            <>
              <PinnedAttemptPanel store={store} attemptId={id()} />
              <FollowButton store={store} />
            </>
          )}
        </Match>

        {/* No pin, before Start */}
        <Match when={store.phase() === 'prepared'}>
          <p class="inspector-hint">
            Select a host to inspect its facts. Press <strong>Start</strong> to run the scenario and step through events.
          </p>
        </Match>

        {/* No pin, after Start — follow the current step */}
        <Match when={store.phase() === 'ready'}>
          <CurrentEventPanel store={store} />
        </Match>
      </Switch>
    </aside>
  )
}

function Headline(props: { explanation: EventExplanation }) {
  return (
    <div class={`explanation tone-${props.explanation.tone}`}>
      <p class="explanation-headline">{props.explanation.headline}</p>
      <Show when={props.explanation.detail}>
        <p class="explanation-detail">{props.explanation.detail}</p>
      </Show>
    </div>
  )
}

function FollowButton(props: { store: SimulationStore }) {
  return (
    <div class="inspector-actions">
      <button type="button" class="secondary" onClick={() => props.store.followCurrentStep()}>
        {props.store.hasRun() ? 'Follow current step' : 'Clear selection'}
      </button>
    </div>
  )
}

function CurrentEventPanel(props: { store: SimulationStore }) {
  const store = props.store
  const event = () => store.currentEvent()
  return (
    <section class="inspector-section" aria-label="Current event">
      <p class="eyebrow">Step {store.cursor()} / {store.totalEvents()}</p>
      <Show
        when={event()}
        fallback={<p class="inspector-hint">At the start of the recording. Step forward to begin.</p>}
      >
        {(current) => (
          <>
            <Headline explanation={explainEvent(current(), store.compiled())} />
            <Show when={eventAttemptId(current())}>
              {(attemptId) => <AttemptDetail store={store} attemptId={attemptId()} />}
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}

function PinnedAttemptPanel(props: { store: SimulationStore; attemptId: string }) {
  const store = props.store
  const run = () => store.run()
  const info = () => {
    const current = run()
    return current === null ? null : attemptStaticInfo(current, props.attemptId)
  }
  const ledger = (): AttemptView | undefined => store.replay().attempts[props.attemptId]

  return (
    <section class="inspector-section" aria-label="Pinned attempt">
      <p class="eyebrow">Pinned attempt</p>
      <Show when={ledger()} fallback={
        <Show when={info()} fallback={<p class="inspector-hint">Attempt not found in this run.</p>}>
          {(stat) => (
            <>
              <Headline
                explanation={{
                  headline: `${displayName(store.compiled(), stat().source_id)} → ${displayName(store.compiled(), stat().target_id)}`,
                  tone: 'neutral',
                  detail: `This attempt has not occurred yet at step ${store.cursor()}. Step forward to reach it.`,
                }}
              />
              <AttemptFacts store={store} link_id={stat().link_id} capability_id={stat().capability_id} />
            </>
          )}
        </Show>
      }>
        {(attempt) => (
          <>
            <Headline explanation={explainAttempt(attempt(), store.compiled())} />
            <AttemptFacts store={store} link_id={attempt().link_id} capability_id={attempt().capability_id} />
            <Checks attempt={attempt()} />
          </>
        )}
      </Show>
    </section>
  )
}

/** Attempt detail shown inline under the current-event explanation. */
function AttemptDetail(props: { store: SimulationStore; attemptId: string }) {
  const attempt = (): AttemptView | undefined => props.store.replay().attempts[props.attemptId]
  return (
    <Show when={attempt()}>
      {(a) => (
        <>
          <AttemptFacts store={props.store} link_id={a().link_id} capability_id={a().capability_id} />
          <Checks attempt={a()} />
        </>
      )}
    </Show>
  )
}

function AttemptFacts(props: { store: SimulationStore; link_id: string; capability_id: string }) {
  const compiled = () => props.store.compiled()
  const service = () => {
    const c = compiled()
    return c === null ? props.link_id : linkById(c, props.link_id)?.service_id ?? props.link_id
  }
  const mechanism = () => {
    const c = compiled()
    return c === null ? '' : capabilityById(c, props.capability_id)?.mechanism ?? ''
  }
  return (
    <dl class="facts">
      <dt>Service</dt><dd>{service()}</dd>
      <dt>Capability</dt><dd>{props.capability_id}{mechanism() ? ` (${mechanism()})` : ''}</dd>
      <dt>Link</dt><dd>{props.link_id}</dd>
    </dl>
  )
}

function Checks(props: { attempt: AttemptView }) {
  return (
    <Show
      when={props.attempt.status !== 'pending'}
      fallback={<p class="inspector-hint">Attempt pending — step forward to resolve it.</p>}
    >
      <p class="eyebrow checks-heading">Requirement checks</p>
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
  )
}

function HostPanel(props: { store: SimulationStore; assetId: string }) {
  const store = props.store
  const asset = () => {
    const c = store.compiled()
    return c === null ? null : assetById(c, props.assetId) ?? null
  }
  const state = () => assetState(store.replay(), props.assetId)
  const isSeed = () => store.compiled()?.effective.initial_asset_id === props.assetId

  return (
    <Show when={asset()}>
      {(host) => (
        <section class="inspector-section" aria-label="Selected host">
          <p class="eyebrow">Host</p>
          <h3>{displayName(store.compiled(), props.assetId)} <span class="muted">{host().id}</span></h3>
          <div class="host-badges">
            <span class={`state-badge state-${state()}`}>{state()}</span>
            <Show when={isSeed()}>
              <span class="state-badge badge-seed">configured start</span>
            </Show>
          </div>
          <dl class="facts">
            <dt>Label</dt><dd>{host().label}</dd>
            <dt>Internal ID</dt><dd>{host().id}</dd>
            <dt>Kind</dt><dd>{host().kind}</dd>
            <dt>Platform</dt><dd>{host().platform}</dd>
            <dt>Segment</dt><dd>{host().segment_id}</dd>
            <dt>Services</dt>
            <dd>{host().services.map((s) => `${s.id}/${s.transport}:${s.port} (${s.status})`).join(', ') || 'none'}</dd>
            <dt>Vulnerabilities</dt>
            <dd>{host().vulnerabilities.map((v) => `${v.id}: ${v.status}`).join(', ') || 'none modeled'}</dd>
            <dt>Credentials</dt>
            <dd>{host().credential_ids.join(', ') || 'none available'}</dd>
            <dt>Flags</dt>
            <dd>{[host().critical ? 'critical' : null, host().isolated ? 'isolated' : null].filter(Boolean).join(', ') || 'none'}</dd>
          </dl>
          <Show when={state() === 'compromised'}>
            <CompromisePath store={store} assetId={props.assetId} />
          </Show>
        </section>
      )}
    </Show>
  )
}

function CompromisePath(props: { store: SimulationStore; assetId: string }) {
  const path = () => {
    const current = props.store.run()
    return current === null ? [] : firstCompromisePath(current, props.assetId) ?? []
  }
  return (
    <div class="path-block">
      <p class="eyebrow">First-compromise path</p>
      <ol class="path-list">
        <For each={path()}>{(step) => (
          <li>
            <span class="path-node">{displayName(props.store.compiled(), step.asset_id)}</span>
            <Show when={step.via}>
              {(via) => <span class="path-via">via {displayName(props.store.compiled(), via().source_id)} / {via().capability_id}</span>}
            </Show>
          </li>
        )}</For>
      </ol>
    </div>
  )
}
