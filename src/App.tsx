import { createMemo, For, Show } from 'solid-js'
import { MapStage } from './components/MapStage'
import { Inspector } from './components/Inspector'
import { createSimulationStore } from './app/store'
import {
  assetState,
  attemptsByLink,
  buildStaticAssets,
  buildStaticLinks,
  linkViewState,
  playbackCounts,
} from './app/view'
import { BUILTIN_SCENARIO_LABEL, BUILTIN_SCENARIO_NOTE } from './app/scenario'
import './App.css'

function App() {
  const store = createSimulationStore()

  // Static scene — depends only on the compiled scenario (set once), so it keeps
  // a stable identity and the rendered elements/focus survive playback updates.
  const staticAssets = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? [] : buildStaticAssets(compiled, store.layout())
  })
  const staticLinks = createMemo(() => {
    const compiled = store.compiled()
    // Straight routes in this commit; presentation waypoints arrive in commit 2.
    return compiled === null ? [] : buildStaticLinks(compiled, store.layout(), () => [])
  })

  const counts = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : playbackCounts(compiled, store.replay())
  })
  const linkLedger = createMemo(() => attemptsByLink(store.replay()))

  // Reactive accessors read through to the current replay/selection.
  const stateOf = (id: string) => assetState(store.replay(), id)
  const assetSelected = (id: string) => {
    const s = store.selection()
    return s?.type === 'asset' && s.id === id
  }
  const linkStateOf = (id: string) => linkViewState(linkLedger().get(id))
  const linkSelected = (id: string) => {
    const s = store.selection()
    if (s?.type !== 'attempt') return false
    return store.replay().attempts[s.id]?.link_id === id
  }

  return (
    <main class="app-shell">
      <header class="topbar" aria-label="Scenario controls">
        <section class="brand-block" aria-label="Product identity">
          <p class="eyebrow">Threat Propagation Simulator</p>
          <h1>rzero</h1>
        </section>

        <section class="status-strip" aria-label="Scenario">
          <div class="status-scenario">
            <span class="status-name">{BUILTIN_SCENARIO_LABEL}</span>
            <span class="status-note">{BUILTIN_SCENARIO_NOTE}</span>
          </div>
          <dl class="status-metrics">
            <div>
              <dt>Starting host</dt>
              <dd>{store.compiled()?.effective.initial_asset_id ?? '—'} <span class="muted">configured</span></dd>
            </div>
            <div><dt>Hosts</dt><dd>{counts()?.total ?? staticAssets().length}</dd></div>
          </dl>
        </section>

        <section class="scenario-controls" aria-label="Run">
          <button type="button" onClick={() => store.start()}>
            {store.phase() === 'ready' ? 'Re-run' : 'Start'}
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
        <aside class="left-rail" aria-label="Host inventory">
          <div class="panel-heading">
            <p class="eyebrow">Inventory</p>
            <h2>Hosts</h2>
          </div>
          <nav class="inventory-list" aria-label="Hosts">
            <For each={staticAssets()}>{(asset) => (
              <button
                type="button"
                class="inventory-item"
                classList={{ 'inventory-selected': assetSelected(asset.id) }}
                aria-pressed={assetSelected(asset.id)}
                onClick={() => store.selectAsset(asset.id)}
              >
                <span class="inventory-id">{asset.shortName}</span>
                <span class="inventory-label">{asset.label}</span>
                <span class="inventory-tags">
                  <Show when={asset.isSeed}><span class="dot dot-seed" title="configured starting host" /></Show>
                  <span class={`state-badge state-${stateOf(asset.id)}`}>{stateOf(asset.id)}</span>
                </span>
              </button>
            )}</For>
          </nav>
        </aside>

        <div class="map-column">
          <MapStage
            assets={staticAssets()}
            links={staticLinks()}
            stateOf={stateOf}
            assetSelected={assetSelected}
            linkStateOf={linkStateOf}
            linkSelected={linkSelected}
            hasRun={store.hasRun()}
            onSelectAsset={store.selectAsset}
            onSelectLink={store.selectLink}
          />

          <div class="playback-bar" aria-label="Playback">
            <div class="playback-controls">
              <button type="button" class="secondary" onClick={() => store.restart()} disabled={store.phase() !== 'ready' || store.atStart()} aria-label="Restart replay at the beginning">⟲ Restart</button>
              <button type="button" class="secondary" onClick={() => store.stepBackward()} disabled={store.phase() !== 'ready' || store.atStart()} aria-label="Step backward one event">◀ Step</button>
              <button type="button" class="secondary" onClick={() => store.stepForward()} disabled={store.phase() !== 'ready' || store.atEnd()} aria-label="Step forward one event">Step ▶</button>
            </div>
            <div class="playback-position" aria-live="polite">
              <Show when={store.hasRun()} fallback={<span class="muted">Not started — press Start</span>}>
                <span class="position-label">Step {store.cursor()} / {store.totalEvents()}</span>
              </Show>
            </div>
            <dl class="playback-counts" aria-label="Counts">
              <div><dt>Compromised</dt><dd>{counts()?.compromised ?? 0} / {counts()?.total ?? 0}</dd></div>
              <div><dt>Discovered</dt><dd>{counts()?.discovered ?? 0}</dd></div>
              <div><dt>Attempts</dt><dd>✓ {counts()?.succeeded ?? 0} · ✗ {counts()?.blocked ?? 0} · ? {counts()?.indeterminate ?? 0}</dd></div>
            </dl>
          </div>
        </div>

        <Inspector store={store} />
      </section>
    </main>
  )
}

export default App
