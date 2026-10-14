import { createMemo, For, Show } from 'solid-js'
import { MapStage } from './components/MapStage'
import { Inspector } from './components/Inspector'
import { createSimulationStore } from './app/store'
import {
  assetState,
  attemptsByLink,
  buildStaticAssets,
  buildStaticLinks,
  displayName,
  isoWaypoints,
  linkViewState,
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
  const occupied = createMemo(() => {
    const set = new Set<string>()
    for (const position of store.layout().values()) set.add(`${position.x},${position.y}`)
    return set
  })
  const staticLinks = createMemo(() => {
    const compiled = store.compiled()
    if (compiled === null) return []
    const occ = occupied()
    return buildStaticLinks(compiled, store.layout(), (_link, from, to) => isoWaypoints(from, to, occ))
  })

  const linkLedger = createMemo(() => attemptsByLink(store.replay()))
  const startName = () => {
    const seed = store.compiled()?.effective.initial_asset_id
    return seed === undefined ? '—' : displayName(store.compiled(), seed)
  }

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
              <dd>{startName()} <span class="muted">configured</span></dd>
            </div>
            <div><dt>Hosts</dt><dd>{staticAssets().length}</dd></div>
          </dl>
        </section>

        <section class="playback-nav" aria-label="Playback controls">
          <span class="nav-step" aria-live="polite">
            <Show when={store.hasRun()} fallback={<span class="muted">Not started</span>}>
              Step {store.cursor()} / {store.totalEvents()}
            </Show>
          </span>
          <div class="nav-buttons">
            <button
              type="button"
              class="secondary"
              onClick={() => store.restart()}
              disabled={store.phase() !== 'ready' || store.atStart()}
              aria-label="Restart replay at the beginning"
            >⟲</button>
            <button
              type="button"
              class="secondary"
              onClick={() => store.stepBackward()}
              disabled={store.phase() !== 'ready' || store.atStart()}
              aria-label="Previous step"
            >◀</button>
            <button
              type="button"
              class="secondary"
              onClick={() => store.stepForward()}
              disabled={store.phase() !== 'ready' || store.atEnd()}
              aria-label="Next step"
            >▶</button>
            <button type="button" class="nav-run" onClick={() => store.start()}>
              {store.phase() === 'ready' ? 'Re-run' : 'Start'}
            </button>
          </div>
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
        </div>

        <Inspector store={store} />
      </section>
    </main>
  )
}

export default App
