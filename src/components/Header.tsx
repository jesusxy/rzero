import { For, Show } from 'solid-js'
import type { SimulationStore } from '../app/store'
import { BackIcon, NextIcon, PauseIcon, PlayIcon, RestartIcon } from './icons'

export function Header(props: { store: SimulationStore }) {
  const store = props.store
  const index = () => store.stepIndex()
  return (
    <header class="topbar">
      <div class="brand">
        <span class="brand-kicker">Threat propagation simulator</span>
        <span class="brand-name">rzero</span>
      </div>

      <div class="scenario-info">
        <span class="scenario-title">{store.scenario.title}</span>
        <span class="scenario-desc">{store.scenario.description}</span>
      </div>

      <div class="mode-toggle" role="group" aria-label="Mode">
        <button type="button" aria-pressed={store.mode() === 'story'} onClick={() => store.setMode('story')}>
          Story
        </button>
        <button type="button" aria-pressed={store.mode() === 'command'} onClick={() => store.setMode('command')}>
          Command
        </button>
      </div>

      <div class="progress" aria-live="polite">
        <span class="progress-label">
          <Show when={store.hasRun() && store.steps().length > 0} fallback="Not started">
            Step {Math.max(index() + 1, 0)} of {store.steps().length}
          </Show>
        </span>
        <div class="progress-bar" aria-hidden="true">
          <For each={store.steps()}>
            {(_, i) => <span class="segment" classList={{ done: i() < index(), current: i() === index() }} />}
          </For>
        </div>
      </div>

      <div class="transport" role="group" aria-label="Playback">
        <button type="button" class="icon-button" aria-label="Restart" onClick={() => store.restart()} disabled={!store.hasRun()}>
          <RestartIcon />
        </button>
        <button type="button" class="icon-button" aria-label="Back" onClick={() => store.back()} disabled={index() <= 0}>
          <BackIcon />
        </button>
        <button
          type="button"
          class="icon-button primary"
          aria-label={store.playing() ? 'Pause' : store.hasRun() ? 'Play' : 'Start'}
          onClick={() => store.togglePlay()}
          disabled={store.phase() === 'error'}
        >
          <Show when={store.playing()} fallback={<PlayIcon />}>
            <PauseIcon />
          </Show>
        </button>
        <button type="button" class="icon-button" aria-label="Next" onClick={() => store.next()} disabled={!store.hasRun() || store.atEnd()}>
          <NextIcon />
        </button>
      </div>
    </header>
  )
}
