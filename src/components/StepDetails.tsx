import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { AttemptView, Check, SourceKind } from '../core'
import type { SimulationStore } from '../app/store'
import { capabilityChip, checkName, mechanismWords, platformName, primaryCheck, serviceName } from '../app/narration'
import { displayName, hostStatus, stepRange, type HostStatus } from '../app/view'
import { Text } from './Text'

const RESULT_WORDS: Record<AttemptView['status'], string> = {
  pending: 'In progress',
  succeeded: 'Succeeded',
  blocked: 'Blocked',
  indeterminate: 'Unknown',
}
const SOURCE_KINDS: Record<SourceKind, string> = {
  synthetic: 'Synthetic source',
  research: 'Research source',
  attack: 'ATT&CK source',
  mbc: 'MBC source',
  sandbox: 'Sandbox source',
}
const STATUS_WORDS: Record<Exclude<HostStatus, null>, string> = {
  compromised: 'Compromised',
  blocked: 'Attempt blocked',
  unknown: 'Unknown',
}
const CHECK_MARKS: Record<Check['status'], string> = { pass: '✓', fail: '✕', unknown: '?' }

export function StepDetails(props: { store: SimulationStore }) {
  const store = props.store
  return (
    <aside class="panel right-panel" aria-label="Step details">
      <Switch fallback={<Intro store={store} />}>
        <Match when={store.phase() === 'error'}>
          <div class="details">
            <h2 class="details-title">This scenario can't run</h2>
            <p class="narration">It failed validation. See the diagnostics above the workspace.</p>
          </div>
        </Match>
        <Match when={store.selectedHost()}>{(id) => <HostDetails store={store} id={id()} />}</Match>
        <Match when={store.hasRun() && store.stepIndex() >= 0}>
          <StepView store={store} />
        </Match>
      </Switch>
    </aside>
  )
}

function KeyHint() {
  return <p class="key-hint">← → step · Space play/pause · R restart</p>
}

function Intro(props: { store: SimulationStore }) {
  return (
    <div class="details">
      <p class="step-kicker">{props.store.hasRun() ? 'Starting' : 'Ready'}</p>
      <h2 class="details-title">{props.store.scenario.title}</h2>
      <p class="narration">
        The network and the malware profile are loaded. Press Play to run the engine, then follow each attempt as it
        happens: which host it targets, what it needs, and why it succeeds or stops.
      </p>
      <div class="details-actions">
        <button type="button" class="primary wide" onClick={() => props.store.play()} disabled={props.store.phase() === 'error'}>
          Start ▸
        </button>
      </div>
      <KeyHint />
    </div>
  )
}

function StepView(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'
  const index = () => store.stepIndex()
  const step = () => store.steps()[index()]!
  const narration = () => store.narrations()[index()]!
  const complete = () => store.stepComplete()
  const attempt = createMemo<AttemptView | undefined>(() => {
    const id = step().attempt_id
    return id === undefined ? undefined : store.replay().attempts[id]
  })
  const capability = createMemo(() => {
    const a = attempt()
    return a === undefined ? undefined : store.compiled()?.effective.profile.capabilities.find((c) => c.id === a.capability_id)
  })
  const name = (id: string) => displayName(store.compiled(), id)
  const nextLabel = () => {
    if (store.atEnd()) return 'End of replay'
    if (!complete()) return 'Next: show the result →'
    const next = store.narrations()[index() + 1]
    return next === undefined ? 'Next →' : `Next: ${next.preview} →`
  }
  const body = () => {
    const parts = narration().parts
    if (parts === undefined) return narration().body
    return complete() ? [parts.lead, ...parts.result].join(' ') : parts.lead
  }

  return (
    <div class="details">
      <p class="step-kicker">
        Step {index() + 1} of {store.steps().length}
        <Show when={command()}>
          <span class="kicker-raw"> · {stepRange(step())}</span>
        </Show>
      </p>
      <h2 class="details-title">
        <Text value={complete() ? narration().title : narration().preview} />
      </h2>
      <p class="narration">
        <Text value={body()} />
      </p>

      <Show when={complete() && narration().parts?.note}>
        <p class="note">
          <Text value={narration().parts!.note} />
        </p>
      </Show>

      <Show when={complete() && narration().parts?.stop}>
        {(stop) => (
          <div class="why-stopped" classList={{ unknown: stop().check.status === 'unknown' }}>
            <p class="why-kicker">Why it stopped</p>
            <p class="why-title">{checkName(stop().check)}</p>
            <p class="why-text">
              <Text value={stop().sentences.join(' ')} />
            </p>
            <p class="why-code">
              {stop().check.code} · expected {stop().check.expected} · observed {stop().check.observed}
              {stop().check.intervention_ids?.length ? ` · via ${stop().check.intervention_ids!.join(', ')}` : ''}
            </p>
          </div>
        )}
      </Show>

      <Show when={step().kind === 'attempt' && attempt()}>
        {(a) => (
          <>
            <dl class="facts">
              <dt>From</dt>
              <dd>
                {name(a().source_id)}
                <Show when={command()}>
                  <span class="raw"> · {a().source_id}</span>
                </Show>
              </dd>
              <dt>To</dt>
              <dd>
                {name(a().target_id)}
                <Show when={command()}>
                  <span class="raw"> · {a().target_id}</span>
                </Show>
              </dd>
              <dt>Method</dt>
              <dd>
                <Show when={capability()} fallback={a().capability_id}>
                  {(c) => (
                    <>
                      {capabilityChip(c())} <span class="muted">({mechanismWords(c())})</span>
                    </>
                  )}
                </Show>
                <Show when={command()}>
                  <span class="raw"> · {a().capability_id}</span>
                </Show>
              </dd>
              <dt>Result</dt>
              <dd class={`result result-${complete() ? a().status : 'pending'}`}>{RESULT_WORDS[complete() ? a().status : 'pending']}</dd>
              <Show when={command()}>
                <dt>Link</dt>
                <dd class="raw">{a().link_id}</dd>
                <dt>Attempt</dt>
                <dd class="raw">{a().attempt_id}</dd>
              </Show>
            </dl>
            <Show when={complete() && a().status !== 'pending'}>
              <Requirements checks={a().checks} command={command()} />
            </Show>
            <Evidence store={store} />
          </>
        )}
      </Show>

      <div class="details-actions">
        <button type="button" class="secondary" onClick={() => store.back()} disabled={index() <= 0}>
          ← Back
        </button>
        <button type="button" class="primary wide" onClick={() => store.next()} disabled={store.atEnd()}>
          <Text value={nextLabel()} />
        </button>
      </div>
      <KeyHint />
    </div>
  )
}

function Requirements(props: { checks: readonly Check[]; command: boolean }) {
  const [open, setOpen] = createSignal(false)
  const deciding = () => primaryCheck(props.checks)
  const others = () => props.checks.filter((check) => check !== deciding())
  const met = () => others().filter((check) => check.status === 'pass').length
  return (
    <div class="requirements">
      <div class="req-row">
        <span>
          <b>{deciding() ? 'Other requirements' : 'Requirements'}</b>
          <span class="muted">
            {' '}
            · {met()} of {others().length} met
          </span>
        </span>
        <button type="button" class="link-button" aria-expanded={open()} onClick={() => setOpen(!open())}>
          {open() ? 'Hide checks' : `Show all ${props.checks.length} checks`}
        </button>
      </div>
      <Show when={open()}>
        <ul class="check-list">
          <For each={props.checks}>
            {(check) => (
              <li class={`check check-${check.status}`} classList={{ deciding: check === deciding() }}>
                <span class="check-mark" aria-hidden="true">
                  {CHECK_MARKS[check.status]}
                </span>
                <span class="check-name">{checkName(check)}</span>
                <Show when={props.command}>
                  <span class="check-raw">
                    {check.code} · expected {check.expected} · observed {check.observed}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

function Evidence(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'
  const [open, setOpen] = createSignal(false)
  const profile = () => store.compiled()?.effective.profile
  const shortName = () => (profile()?.name ?? '').replace(/\s*\([^)]*\)\s*$/, '')
  const sources = createMemo(() => {
    const compiled = store.compiled()
    const step = store.steps()[store.stepIndex()]
    if (compiled === null || step?.attempt_id === undefined) return []
    const events = store.run()?.events ?? []
    const attempted = events.find((event) => event.type === 'propagation_attempted' && event.attempt_id === step.attempt_id)
    const capability =
      attempted?.type === 'propagation_attempted'
        ? compiled.effective.profile.capabilities.find((c) => c.id === attempted.capability_id)
        : undefined
    return (capability?.evidence_ids ?? []).flatMap((id) => {
      const source = compiled.effective.profile.sources.find((s) => s.id === id)
      return source === undefined ? [] : [source]
    })
  })
  return (
    <Show when={sources().length > 0}>
      <div class="evidence">
        <Show
          when={command()}
          fallback={
            <>
              <p class="eyebrow">How {shortName()} does this</p>
              <Show when={profile()?.summary}>
                {(summary) => (
                  <p class="evidence-summary">
                    <Text value={summary()} />
                  </p>
                )}
              </Show>
              <button type="button" class="link-button sources-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
                Sources ({sources().length}) <span aria-hidden="true">{open() ? '⌄' : '›'}</span>
              </button>
              <Show when={open()}>
                <ul class="source-list">
                  <For each={sources()}>
                    {(source) => (
                      <li>
                        <Show when={source.url} fallback={<span class="source-title">{source.title}</span>}>
                          {(url) => (
                            <a class="source-title" href={url()} target="_blank" rel="noreferrer">
                              {source.title}
                            </a>
                          )}
                        </Show>
                        <span class="evidence-meta">{SOURCE_KINDS[source.kind]}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </>
          }
        >
          <p class="eyebrow">Why the malware can do this</p>
          <For each={sources()}>
            {(source) => (
              <div class="evidence-item">
                <p class="evidence-title">{source.title}</p>
                <p class="evidence-claim">
                  <Text value={source.claim_summary} />
                </p>
                <p class="evidence-meta">
                  {SOURCE_KINDS[source.kind]} · {source.id}
                </p>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}

function HostDetails(props: { store: SimulationStore; id: string }) {
  const store = props.store
  const command = () => store.mode() === 'command'
  const asset = () => store.compiled()?.effective.network.assets.find((a) => a.id === props.id)
  const segment = () => store.compiled()?.effective.network.segments.find((s) => s.id === asset()?.segment_id)
  const status = () => hostStatus(store.replay(), props.id)
  const attempts = createMemo(() =>
    Object.values(store.replay().attempts)
      .filter((attempt) => attempt.target_id === props.id)
      .sort((a, b) => (a.attempt_id < b.attempt_id ? -1 : 1)),
  )
  const stepOf = (attemptId: string) => store.steps().findIndex((step) => step.attempt_id === attemptId)
  const capabilityLabel = (id: string) => {
    const c = store.compiled()?.effective.profile.capabilities.find((entry) => entry.id === id)
    return c === undefined ? id : capabilityChip(c)
  }
  return (
    <Show when={asset()}>
      {(host) => (
        <div class="details">
          <button type="button" class="link-button back-link" onClick={() => store.clearHost()}>
            ← Step details
          </button>
          <p class="step-kicker">Host</p>
          <h2 class="details-title">
            {host().label}
            <Show when={store.compiled()?.effective.initial_asset_id === host().id}>
              <span class="tag-start">start</span>
            </Show>
          </h2>
          <Show when={status()}>{(st) => <p class={`host-status status-${st()}`}>{STATUS_WORDS[st()]}</p>}</Show>
          <dl class="facts">
            <Show when={command()}>
              <dt>Internal ID</dt>
              <dd class="raw">{host().id}</dd>
            </Show>
            <dt>Kind</dt>
            <dd>{host().kind}</dd>
            <dt>Platform</dt>
            <dd>{platformName(host().platform)}</dd>
            <dt>Segment</dt>
            <dd>{segment()?.label ?? host().segment_id}</dd>
            <dt>Services</dt>
            <dd>
              {host().services.map((s) => `${serviceName(s.id)} ${s.status} (${s.transport}/${s.port})`).join(', ') || 'none'}
            </dd>
            <dt>Weaknesses</dt>
            <dd>{host().vulnerabilities.map((v) => `${v.id}: ${v.status}`).join(', ') || 'none recorded'}</dd>
            <dt>Credentials</dt>
            <dd>{host().credential_ids.join(', ') || 'none'}</dd>
          </dl>
          <p class="eyebrow">Attempts on this host</p>
          <Show
            when={attempts().length > 0}
            fallback={<p class="muted small">{store.hasRun() ? `No attempt has targeted ${host().label} yet.` : 'Run the scenario to see attempts.'}</p>}
          >
            <ul class="attempt-list">
              <For each={attempts()}>
                {(attempt) => {
                  const deciding = () => (attempt.status === 'pending' ? undefined : primaryCheck(attempt.checks))
                  return (
                    <li>
                      <button type="button" class="attempt-row" onClick={() => store.goToStep(stepOf(attempt.attempt_id))}>
                        <span class="attempt-main">
                          Step {stepOf(attempt.attempt_id) + 1} · {displayName(store.compiled(), attempt.source_id)} →{' '}
                          {host().label}
                        </span>
                        <span class="attempt-sub">
                          {capabilityLabel(attempt.capability_id)}
                          {command() ? ` · ${attempt.attempt_id}` : ''}
                        </span>
                        <span class={`result result-${attempt.status}`}>
                          {RESULT_WORDS[attempt.status]}
                          {deciding() ? ` · ${checkName(deciding()!).toLowerCase()}` : ''}
                        </span>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </div>
      )}
    </Show>
  )
}
