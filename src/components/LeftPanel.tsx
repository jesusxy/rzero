import { createMemo, For, Show } from 'solid-js'
import type { SimulationStore } from '../app/store'
import { describeProfile, platformName } from '../app/narration'
import { hostStatus, stepRange, type HostStatus } from '../app/view'
import { CheckIcon } from './icons'
import { Text } from './Text'

const STATUS_WORDS: Record<Exclude<HostStatus, null>, string> = {
  compromised: 'Compromised',
  blocked: 'Attempt blocked',
  unknown: 'Unknown',
}

export function LeftPanel(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'

  const profile = createMemo(() => {
    const compiled = store.compiled()
    return compiled === null ? null : describeProfile(compiled.effective.profile)
  })

  const groups = createMemo(() => {
    const compiled = store.compiled()
    if (compiled === null) return []
    const network = compiled.effective.network
    return network.segments
      .map((segment) => ({ segment, assets: network.assets.filter((asset) => asset.segment_id === segment.id) }))
      .filter((group) => group.assets.length > 0)
  })

  const stepState = (i: number) => (i < store.stepIndex() ? 'done' : i === store.stepIndex() ? 'current' : 'upcoming')
  const reached = (i: number) => i < store.stepIndex() || (i === store.stepIndex() && store.stepComplete())

  return (
    <aside class="panel left-panel" aria-label="Story">
      <section class="panel-section">
        <h2 class="eyebrow">Malware profile</h2>
        <Show when={profile()}>
          {(p) => (
            <div class="profile-card">
              <h3 class="profile-name">{p().name}</h3>
              <p class="profile-summary">
                <Text value={p().summary} />
              </p>
              <div class="chips">
                <For each={p().chips}>{(chip) => <span class="chip">{chip}</span>}</For>
              </div>
            </div>
          )}
        </Show>
      </section>

      <section class="panel-section">
        <h2 class="eyebrow">Steps</h2>
        <Show
          when={store.hasRun()}
          fallback={<p class="hint">Press Play to run the scenario. Each step appears here as the replay reaches it.</p>}
        >
          <ol class="step-list">
            <For each={store.steps()}>
              {(step, i) => {
                const narration = () => store.narrations()[i()]
                return (
                  <li>
                    <button
                      type="button"
                      class={`step-item ${stepState(i())}`}
                      aria-current={stepState(i()) === 'current' ? 'step' : undefined}
                      onClick={() => store.goToStep(i())}
                    >
                      <span class="step-dot" aria-hidden="true">
                        <Show when={stepState(i()) === 'done'} fallback={i() + 1}>
                          <CheckIcon />
                        </Show>
                      </span>
                      <span class="step-text">
                        <span class="step-title">
                          <Text value={reached(i()) ? narration()?.title : narration()?.preview} />
                        </span>
                        <Show when={reached(i()) && narration()?.subtitle}>
                          <span class="step-sub">
                            <Text value={narration()!.subtitle} />
                          </span>
                        </Show>
                        <Show when={command()}>
                          <span class="step-seq">{stepRange(step)}</span>
                        </Show>
                      </span>
                    </button>
                  </li>
                )
              }}
            </For>
          </ol>
        </Show>
      </section>

      <section class="panel-section">
        <h2 class="eyebrow">Hosts</h2>
        <For each={groups()}>
          {(group) => {
            const compromisedCount = () => group.assets.filter((asset) => store.replay().compromised.includes(asset.id)).length
            return (
              <div class="host-group">
                <div class="host-group-head">
                  <span class="host-group-name">{group.segment.label}</span>
                  <span class="host-group-count">
                    {compromisedCount()} / {group.assets.length} compromised
                  </span>
                </div>
                <ul class="host-list">
                  <For each={group.assets}>
                    {(asset) => {
                      const status = () => hostStatus(store.replay(), asset.id)
                      const isSeed = () => store.compiled()?.effective.initial_asset_id === asset.id
                      return (
                        <li>
                          <button
                            type="button"
                            class="host-row"
                            classList={{ selected: store.selectedHost() === asset.id }}
                            aria-pressed={store.selectedHost() === asset.id}
                            onClick={() => store.selectHost(asset.id)}
                          >
                            <span class="host-main">
                              <span class="host-name">{asset.label}</span>
                              <Show when={isSeed()}>
                                <span class="tag-start">start</span>
                              </Show>
                            </span>
                            <span class="host-sub">
                              {command() ? `${asset.id} · ` : ''}
                              {platformName(asset.platform)}
                            </span>
                            <Show when={status()}>
                              {(st) => <span class={`host-status status-${st()}`}>{STATUS_WORDS[st()]}</span>}
                            </Show>
                          </button>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </div>
            )
          }}
        </For>
      </section>
    </aside>
  )
}
