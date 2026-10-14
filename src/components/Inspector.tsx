import { createEffect, createMemo, createSignal, on, For, Show, Switch, Match } from 'solid-js'
import { firstCompromisePath, type Check, type SimulationEvent } from '../core'
import type { SimulationStore } from '../app/store'
import {
  assetById,
  assetState,
  attemptStaticInfo,
  capabilityById,
  displayName,
  explainAttempt,
  explainEvent,
  linkById,
  playbackCounts,
  type EventExplanation,
} from '../app/view'

const checkSymbol: Record<Check['status'], string> = { pass: '✓', fail: '✗', unknown: '?' }

/** True for the two attempt-bearing event types (they carry link/capability). */
function isAttemptEvent(
  event: SimulationEvent,
): event is Extract<SimulationEvent, { type: 'propagation_attempted' | 'propagation_resolved' }> {
  return event.type === 'propagation_attempted' || event.type === 'propagation_resolved'
}

export function Inspector(props: { store: SimulationStore }) {
  const store = props.store
  const pinnedAssetId = () => (store.selection()?.type === 'asset' ? (store.selection() as { id: string }).id : null)
  const pinnedAttemptId = () => (store.selection()?.type === 'attempt' ? (store.selection() as { id: string }).id : null)

  const counts = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : playbackCounts(compiled, store.replay())
  })

  // Follow newly reached events while following playback, but only ever bring
  // the current event's *heading* into view — never jump past it to the bottom
  // of a long explanation. Following is suspended when the user scrolls back
  // manually, and resumes on a step/jump or an explicit "Follow current step".
  let bodyEl: HTMLDivElement | undefined
  const [autoFollow, setAutoFollow] = createSignal(true)

  const scrollCurrentIntoView = () => {
    const c = bodyEl
    if (c === undefined) return
    const row = c.querySelector('.row-current') as HTMLElement | null
    if (row === null) return
    const head = (row.querySelector('.history-row-head') as HTMLElement | null) ?? row
    const sticky = c.querySelector('.history-status') as HTMLElement | null
    const stickyH = sticky === null ? 0 : sticky.getBoundingClientRect().height
    const cRect = c.getBoundingClientRect()
    const headRect = head.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const topInset = cRect.top + stickyH
    let target = c.scrollTop
    if (headRect.top < topInset) {
      // Heading is hidden above the fold (under the sticky status bar).
      target = c.scrollTop - (topInset - headRect.top)
    } else if (rowRect.bottom > cRect.bottom) {
      // Row runs past the bottom: align its end to the view if it fits,
      // otherwise pin the heading just under the status bar so a long
      // explanation scrolls below instead of pushing the heading off-screen.
      const available = cRect.bottom - topInset
      target = c.scrollTop + (rowRect.height <= available ? rowRect.bottom - cRect.bottom : headRect.top - topInset)
    }
    c.scrollTop = Math.max(0, Math.round(target))
  }

  const follow = () => {
    if (store.selection() !== null) store.followCurrentStep()
    setAutoFollow(true)
    requestAnimationFrame(scrollCurrentIntoView)
  }

  // A step or jump is an explicit playback action: re-engage following and
  // bring the new current heading into view. Inspecting (selection is an event)
  // leaves the viewport where it is.
  createEffect(
    on(
      () => store.cursor(),
      () => {
        if (store.selection() === null) {
          setAutoFollow(true)
          requestAnimationFrame(scrollCurrentIntoView)
        }
      },
      { defer: true },
    ),
  )

  // Manual scroll-back suspends following. We read it from the input device
  // (wheel up / keyboard up) rather than scrollTop, so the programmatic
  // follow-scroll — which never emits these events — can't be mistaken for it.
  const suspendFollow = () => {
    if (store.selection() === null && autoFollow()) setAutoFollow(false)
  }
  const onBodyWheel = (event: WheelEvent) => {
    if (event.deltaY < 0 && (bodyEl?.scrollTop ?? 0) > 0) suspendFollow()
  }
  const onBodyKeydown = (event: KeyboardEvent) => {
    const back = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home'
    if (back && (bodyEl?.scrollTop ?? 0) > 0) suspendFollow()
  }

  return (
    <aside class="inspector" aria-label="Inspector">
      <div class="panel-heading inspector-heading">
        <p class="eyebrow">Inspector</p>
        <h2>Activity</h2>
      </div>

      <CountsSummary counts={counts()} />

      <div class="inspector-body" ref={(el) => (bodyEl = el)} on:wheel={onBodyWheel} onKeyDown={onBodyKeydown}>
        <Switch fallback={<p class="inspector-empty">Preparing scenario…</p>}>
          <Match when={store.phase() === 'error'}>
            <p class="inspector-empty">The scenario could not be prepared — see the banner above.</p>
          </Match>

          {/* Host inspection — available before and after Start */}
          <Match when={pinnedAssetId()}>
            {(id) => (
              <>
                <BackToHistory onFollow={follow} />
                <HostPanel store={store} assetId={id()} />
              </>
            )}
          </Match>

          {/* Attempt inspection (from a map route) */}
          <Match when={pinnedAttemptId()}>
            {(id) => (
              <>
                <BackToHistory onFollow={follow} />
                <AttemptPanel store={store} attemptId={id()} />
              </>
            )}
          </Match>

          {/* Default: the growing playback history */}
          <Match when={true}>
            <ActivityHistory store={store} autoFollow={autoFollow()} onFollow={follow} />
          </Match>
        </Switch>
      </div>
    </aside>
  )
}

function CountsSummary(props: { counts: ReturnType<typeof playbackCounts> | null }) {
  const c = () => props.counts
  return (
    <dl class="counts-summary" aria-label="Current position totals">
      <div>
        <dt>Compromised</dt>
        <dd>{c()?.compromised ?? 0}<span class="counts-of"> / {c()?.total ?? 0}</span></dd>
      </div>
      <div>
        <dt>Discovered</dt>
        <dd>{c()?.discovered ?? 0}</dd>
      </div>
      <div>
        <dt>Attempts</dt>
        <dd class="counts-attempts">
          <span title="succeeded">✓ {c()?.succeeded ?? 0}</span>
          <span title="blocked">✗ {c()?.blocked ?? 0}</span>
          <span title="indeterminate">? {c()?.indeterminate ?? 0}</span>
        </dd>
      </div>
    </dl>
  )
}

// --- Activity history -------------------------------------------------------

function ActivityHistory(props: { store: SimulationStore; autoFollow: boolean; onFollow: () => void }) {
  const store = props.store

  // Events reached at the current replay position (events[0 .. cursor-1]).
  const reached = createMemo<readonly SimulationEvent[]>(() => {
    const run = store.run()
    return run === null ? [] : run.events.slice(0, store.cursor())
  })
  // The focused (expanded) event index: an explicitly inspected event, else the
  // current step. Following = no explicit event selection.
  const focusedIndex = () => {
    const sel = store.selection()
    return sel?.type === 'event' ? sel.index : store.cursor() - 1
  }
  const inspectingOlder = () => {
    const sel = store.selection()
    return sel?.type === 'event' && sel.index !== store.cursor() - 1
  }
  // Following was paused because the user scrolled back from the current step.
  const scrolledAway = () => store.selection() === null && !props.autoFollow
  const detached = () => inspectingOlder() || scrolledAway()

  return (
    <div class="history">
      <Show when={store.hasRun()} fallback={
        <p class="inspector-hint">
          The network is prepared. Press <strong>Start</strong> to run the scenario and build the activity history.
        </p>
      }>
        <Show when={reached().length > 0} fallback={
          <p class="inspector-hint">At the start of the recording. Step forward to begin.</p>
        }>
          <div class="history-status" aria-live="polite">
            <Show
              when={detached()}
              fallback={<span class="history-following">Following current step · {store.cursor()} / {store.totalEvents()}</span>}
            >
              <span class="history-inspecting">
                {inspectingOlder() ? `Inspecting step ${focusedIndex() + 1} of ${store.cursor()}` : 'Paused — scrolled back'}
              </span>
              <button type="button" class="secondary compact-btn" onClick={() => props.onFollow()}>
                Follow current step
              </button>
            </Show>
          </div>

          <ol class="history-list">
            <For each={reached()}>{(event, index) => (
              <HistoryRow
                store={store}
                event={event}
                index={index()}
                focused={focusedIndex() === index()}
                isCurrent={store.cursor() - 1 === index()}
              />
            )}</For>
          </ol>
        </Show>
      </Show>
    </div>
  )
}

function HistoryRow(props: {
  store: SimulationStore
  event: SimulationEvent
  index: number
  focused: boolean
  isCurrent: boolean
}) {
  const explanation = () => explainEvent(props.event, props.store.compiled())
  return (
    <li
      class="history-row"
      classList={{ 'row-current': props.isCurrent, 'row-focused': props.focused, 'row-inspecting': props.focused && !props.isCurrent }}
    >
      <button
        type="button"
        class="history-row-head"
        aria-expanded={props.focused}
        onClick={() => props.store.selectEvent(props.index)}
      >
        <span class="history-step">{props.index + 1}</span>
        <span class={`history-dot tone-${explanation().tone}`} aria-hidden="true" />
        <span class="history-headline">{explanation().headline}</span>
        <Show when={props.isCurrent}><span class="history-now">current</span></Show>
      </button>

      {/* Expanded detail is mounted only for the focused row. */}
      <Show when={props.focused}>
        <div class="history-detail">
          <Show when={explanation().detail}>
            <p class="explanation-detail">{explanation().detail}</p>
          </Show>
          <Show when={isAttemptEvent(props.event) ? props.event : null}>
            {(e) => (
              <>
                <AttemptFacts store={props.store} link_id={e().link_id} capability_id={e().capability_id} />
                <Show when={e().type === 'propagation_resolved' ? (e() as Extract<SimulationEvent, { type: 'propagation_resolved' }>) : null}>
                  {(resolved) => <ChecksList checks={resolved().checks} evidenceIds={resolved().evidence_ids} />}
                </Show>
              </>
            )}
          </Show>
          <div class="history-actions">
            <Show when={!props.isCurrent}>
              <button type="button" class="secondary compact-btn" onClick={() => props.store.jumpToEvent(props.index)}>
                Jump to this step
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </li>
  )
}

// --- Shared pieces ----------------------------------------------------------

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

function BackToHistory(props: { onFollow: () => void }) {
  return (
    <div class="inspector-actions back-actions">
      <button type="button" class="secondary" onClick={() => props.onFollow()}>
        ← Activity history
      </button>
    </div>
  )
}

function AttemptPanel(props: { store: SimulationStore; attemptId: string }) {
  const store = props.store
  const run = () => store.run()
  const info = () => {
    const current = run()
    return current === null ? null : attemptStaticInfo(current, props.attemptId)
  }
  const ledger = () => store.replay().attempts[props.attemptId]

  return (
    <section class="inspector-section" aria-label="Inspected attempt">
      <p class="eyebrow">Route attempt</p>
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
            <ChecksList checks={attempt().checks} />
          </>
        )}
      </Show>
    </section>
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

function ChecksList(props: { checks: readonly Check[]; evidenceIds?: readonly string[] }) {
  return (
    <Show when={props.checks.length > 0} fallback={<p class="inspector-hint">No requirement checks recorded for this step.</p>}>
      <p class="eyebrow checks-heading">Requirement checks</p>
      <ul class="checks">
        <For each={props.checks}>{(check) => (
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
      <Show when={props.evidenceIds && props.evidenceIds.length > 0}>
        <p class="evidence-line"><span class="eyebrow">Evidence</span> {props.evidenceIds!.join(', ')}</p>
      </Show>
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
