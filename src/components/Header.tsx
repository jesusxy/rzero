import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { importScenario } from '../core'
import type { SimulationStore } from '../app/store'
import { scenarioFacts } from '../app/scenario'
import { BackIcon, DownIcon, NextIcon, PauseIcon, PlayIcon, RestartIcon } from './icons'

type PickerItem =
  | { readonly kind: 'scenario'; readonly key: string; readonly title: string; readonly facts: string }
  | { readonly kind: 'file' }

function ScenarioPicker(props: { store: SimulationStore }) {
  const store = props.store
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(0)
  let trigger: HTMLButtonElement | undefined
  let list: HTMLUListElement | undefined
  let root: HTMLDivElement | undefined
  let fileInput: HTMLInputElement | undefined

  const builtins = store.scenarios.map((entry): PickerItem => {
    const compiled = importScenario(entry.text, { fileName: entry.file })
    return { kind: 'scenario', key: entry.key, title: entry.title, facts: compiled.ok ? scenarioFacts(compiled.value) : entry.file }
  })
  const items = createMemo<PickerItem[]>(() => (store.mode() === 'command' ? [...builtins, { kind: 'file' }] : builtins))
  const currentIndex = () => Math.max(0, items().findIndex((item) => item.kind === 'scenario' && item.key === store.scenario().key))
  const optionId = (i: number) => `scenario-option-${i}`

  const onOutside = (event: PointerEvent) => {
    if (root !== undefined && !root.contains(event.target as Node)) close(false)
  }
  const show = () => {
    setActive(currentIndex())
    setOpen(true)
    document.addEventListener('pointerdown', onOutside)
    queueMicrotask(() => list?.focus())
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    document.removeEventListener('pointerdown', onOutside)
    if (refocus) trigger?.focus()
  }
  onCleanup(() => document.removeEventListener('pointerdown', onOutside))

  const choose = (index: number) => {
    const item = items()[index]
    if (item === undefined) return
    close(true)
    if (item.kind === 'file') fileInput?.click()
    else if (item.key !== store.scenario().key) store.selectScenario(item.key)
  }

  const onListKey = (event: KeyboardEvent) => {
    const last = items().length - 1
    if (event.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1))
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(last)
    else if (event.key === 'Enter' || event.key === ' ') choose(active())
    else if (event.key === 'Escape') close(true)
    else if (event.key === 'Tab') close(false)
    else return
    if (event.key !== 'Tab') event.preventDefault()
  }

  const onFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file !== undefined) store.openScenarioFile(file.name, await file.text())
  }

  return (
    <div class="scenario-picker" ref={(el) => (root = el)}>
      <button
        type="button"
        class="picker-trigger"
        ref={(el) => (trigger = el)}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls="scenario-listbox"
        aria-label={`Scenario: ${store.scenario().title}. Change scenario`}
        onClick={() => (open() ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open()) {
            event.preventDefault()
            show()
          }
        }}
      >
        <span class="scenario-info">
          <span class="scenario-title">{store.scenario().title}</span>
          <span class="scenario-desc">{store.scenario().description}</span>
        </span>
        <DownIcon />
      </button>
      <Show when={open()}>
        <div class="picker-pop">
          <p class="eyebrow" id="scenario-listbox-label">
            Scenarios
          </p>
          <ul
            id="scenario-listbox"
            class="picker-list"
            role="listbox"
            tabindex="-1"
            ref={(el) => (list = el)}
            aria-labelledby="scenario-listbox-label"
            aria-activedescendant={optionId(active())}
            onKeyDown={onListKey}
          >
            <For each={items()}>
              {(item, i) => (
                <li
                  id={optionId(i())}
                  role="option"
                  class="picker-option"
                  classList={{ active: active() === i(), file: item.kind === 'file' }}
                  aria-selected={item.kind === 'scenario' && item.key === store.scenario().key}
                  onPointerEnter={() => setActive(i())}
                  onClick={() => choose(i())}
                >
                  <span class="picker-check" aria-hidden="true">
                    {item.kind === 'scenario' && item.key === store.scenario().key ? '✓' : ''}
                  </span>
                  <span class="picker-text">
                    <span class="picker-name">{item.kind === 'scenario' ? item.title : 'Open a scenario file…'}</span>
                    <span class="picker-facts">{item.kind === 'scenario' ? item.facts : 'Command mode · JSON or YAML'}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <input
        type="file"
        class="sr-only"
        accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
        tabindex="-1"
        aria-hidden="true"
        ref={(el) => (fileInput = el)}
        onChange={onFile}
      />
    </div>
  )
}

export function Header(props: { store: SimulationStore }) {
  const store = props.store
  const index = () => store.stepIndex()
  return (
    <header class="topbar">
      <div class="brand">
        <span class="brand-kicker">Threat propagation simulator</span>
        <span class="brand-name">rzero</span>
      </div>

      <ScenarioPicker store={store} />

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
