import { createMemo, For, Show } from 'solid-js'
import { MapStage } from './components/MapStage'
import { Inspector } from './components/Inspector'
import { createSimulationStore } from './app/store'
import {
  attemptsByLink,
  buildMapAssets,
  buildMapLinks,
  describeEvent,
  playbackCounts,
} from './app/view'
import {
  BUILTIN_SCENARIO_ASSET_COUNT,
  BUILTIN_SCENARIO_LABEL,
  BUILTIN_SCENARIO_NOTE,
  BUILTIN_SCENARIO_SEED,
} from './app/scenario'
import './App.css'

function App() {
  const store = createSimulationStore()

  const mapAssets = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? [] : buildMapAssets(compiled, store.replay(), store.layout(), store.selection())
  })
  const mapLinks = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? [] : buildMapLinks(compiled, store.replay(), store.layout(), store.selection())
  })
  const counts = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : playbackCounts(compiled, store.replay())
  })
  const inventory = createMemo(() => mapAssets())
  const currentHop = createMemo(() => store.currentEvent()?.hop ?? 0)

  const selectLink = (id: string) => {
    const attempt = attemptsByLink(store.replay()).get(id)
    if (attempt !== undefined) store.selectAttempt(attempt.attempt_id)
  }

  return (
    <main class="app-shell">
      <header class="topbar" aria-label="Scenario controls">
        <section class="brand-block" aria-label="Product identity">
          <p class="eyebrow">Threat Propagation Simulator</p>
          <h1>rzero</h1>
        </section>

        <section class="status-strip" aria-label="Scenario status">
          <div class="status-scenario">
            <span class="status-name">{BUILTIN_SCENARIO_LABEL}</span>
            <span class="status-note">{BUILTIN_SCENARIO_NOTE}</span>
          </div>
          <dl class="status-metrics">
            <div><dt>Seed</dt><dd>{store.compiled()?.effective.initial_asset_id ?? BUILTIN_SCENARIO_SEED}</dd></div>
            <div><dt>Assets</dt><dd>{counts()?.total ?? BUILTIN_SCENARIO_ASSET_COUNT}</dd></div>
            <div><dt>Compromised</dt><dd>{counts()?.compromised ?? 0}</dd></div>
            <div><dt>Hop</dt><dd>{currentHop()}</dd></div>
          </dl>
        </section>

        <section class="scenario-controls" aria-label="Playback controls">
          <button type="button" onClick={() => store.start()}>
            {store.phase() === 'ready' ? 'Re-run' : 'Start'}
          </button>
          <button type="button" class="secondary" onClick={() => store.stepBackward()} disabled={store.phase() !== 'ready' || store.atStart()} aria-label="Step backward one event">
            ◀ Step
          </button>
          <button type="button" class="secondary" onClick={() => store.stepForward()} disabled={store.phase() !== 'ready' || store.atEnd()} aria-label="Step forward one event">
            Step ▶
          </button>
          <button type="button" class="secondary" onClick={() => store.restart()} disabled={store.phase() !== 'ready' || store.atStart()} aria-label="Restart replay at the beginning">
            ⟲ Restart
          </button>
        </section>
      </header>

      <Show when={store.phase() === 'error'}>
        <div class="diagnostics-banner" role="alert">
          <strong>Scenario cannot run</strong>
          <ul>
            <For each={store.diagnostics().filter((d) => d.severity === 'error')}>{(diagnostic) => (
              <li><code>{diagnostic.code}</code> at <code>{diagnostic.path || '(root)'}</code> — {diagnostic.message}</li>
            )}</For>
          </ul>
        </div>
      </Show>

      <section class="workspace">
        <aside class="left-rail" aria-label="Playback and inventory">
          <div class="panel-heading">
            <p class="eyebrow">Playback</p>
            <h2>{store.phase() === 'ready' ? `Step ${store.cursor()} / ${store.totalEvents()}` : 'Not started'}</h2>
          </div>

          <div class="playback-body">
            <Show
              when={store.phase() === 'ready'}
              fallback={<p class="muted">Start runs the engine once, then you step through the recording.</p>}
            >
              <p class="event-desc">
                <Show when={store.currentEvent()} fallback={<span class="muted">At the start — no event applied yet.</span>}>
                  {(event) => <>{describeEvent(event())}</>}
                </Show>
              </p>
              <dl class="count-row" aria-label="Playback counts">
                <div><dt>Compromised</dt><dd>{counts()?.compromised} / {counts()?.total}</dd></div>
                <div><dt>Discovered</dt><dd>{counts()?.discovered}</dd></div>
                <div class="count-attempts">
                  <dt>Attempts</dt>
                  <dd>✓ {counts()?.succeeded} · ✗ {counts()?.blocked} · ? {counts()?.indeterminate}</dd>
                </div>
              </dl>
            </Show>
          </div>

          <div class="panel-heading inventory-heading">
            <p class="eyebrow">Inventory</p>
          </div>
          <nav class="inventory-list" aria-label="Hosts">
            <Show
              when={inventory().length > 0}
              fallback={<p class="muted inventory-empty">Hosts appear after the scenario is compiled.</p>}
            >
              <For each={inventory()}>{(asset) => (
                <button
                  type="button"
                  class="inventory-item"
                  classList={{ 'inventory-selected': asset.selected }}
                  aria-pressed={asset.selected}
                  onClick={() => store.selectAsset(asset.id)}
                >
                  <span class="inventory-id">{asset.id}</span>
                  <span class="inventory-label">{asset.label}</span>
                  <span class={`state-badge state-${asset.state}`}>{asset.state}</span>
                </button>
              )}</For>
            </Show>
          </nav>
        </aside>

        <MapStage
          assets={mapAssets()}
          links={mapLinks()}
          hasRun={store.phase() === 'ready'}
          onSelectAsset={store.selectAsset}
          onSelectLink={selectLink}
        />

        <Inspector store={store} />
      </section>
    </main>
  )
}

export default App
