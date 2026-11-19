import { For, onCleanup, onMount, Show } from 'solid-js'
import { createSimulationStore } from './app/store'
import { Header } from './components/Header'
import { LeftPanel } from './components/LeftPanel'
import { MetricCards } from './components/MetricCards'
import { MapStage } from './components/MapStage'
import { EventLog } from './components/EventLog'
import { StepDetails } from './components/StepDetails'
import './App.css'

function App() {
  const store = createSimulationStore()

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === ' ') {
        event.preventDefault()
        store.togglePlay()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        store.next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        store.back()
      } else if (event.key === 'r' || event.key === 'R') {
        store.restart()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })
  onCleanup(() => store.dispose())

  return (
    <div class="app" classList={{ 'mode-command': store.mode() === 'command' }}>
      <Header store={store} />
      <Show when={store.phase() === 'error'}>
        <div class="diagnostics" role="alert">
          <strong>Scenario cannot run</strong>
          <ul>
            <For each={store.diagnostics().filter((d) => d.severity === 'error')}>
              {(d) => (
                <li>
                  <code>{d.code}</code> at <code>{d.path || '(root)'}</code>: {d.message}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <main class="workspace">
        <LeftPanel store={store} />
        <div class="center">
          <MetricCards store={store} />
          <MapStage store={store} />
          <EventLog store={store} />
        </div>
        <StepDetails store={store} />
      </main>
    </div>
  )
}

export default App
