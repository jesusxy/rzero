import { createMemo, For, Show } from 'solid-js'
import type { SimulationEvent } from '../core'
import type { SimulationStore } from '../app/store'
import { checkName, primaryCheck } from '../app/narration'
import { displayName } from '../app/view'
import { ChevronIcon } from './icons'

const STORY_TYPES: Record<SimulationEvent['type'], string> = {
  run_started: 'run started',
  asset_compromised: 'compromised',
  asset_discovered: 'discovered',
  propagation_attempted: 'attempt',
  propagation_resolved: 'result',
  propagation_skipped: 'skipped',
  run_completed: 'run completed',
  run_aborted: 'run aborted',
}

export function EventLog(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'
  const name = (id: string | null | undefined) => (id ? displayName(store.compiled(), id) : '—')
  const applied = createMemo(() => store.run()?.events.slice(0, store.cursor()) ?? [])
  const currentRange = createMemo(() => store.steps()[store.stepIndex()] ?? null)

  const ends = (event: SimulationEvent): [string | null, string | null] => {
    switch (event.type) {
      case 'run_started':
        return [null, event.initial_asset_id]
      case 'asset_compromised':
        return [event.parent_id, event.asset_id]
      case 'asset_discovered':
      case 'propagation_attempted':
      case 'propagation_resolved':
      case 'propagation_skipped':
        return [event.source_id, event.type === 'asset_discovered' ? event.asset_id : event.target_id]
      default:
        return [null, null]
    }
  }
  const outcome = (event: SimulationEvent): string => {
    switch (event.type) {
      case 'propagation_resolved': {
        const check = primaryCheck(event.checks)
        if (check === undefined) return event.outcome
        return command() ? `${event.outcome} · ${check.code}` : `${event.outcome} · ${checkName(check).toLowerCase()}`
      }
      case 'asset_compromised':
        return event.parent_id === null ? 'seed' : 'compromised'
      case 'propagation_skipped':
        return 'already compromised'
      case 'run_completed':
        return `${event.compromised_ids.length} compromised`
      case 'run_aborted':
        return event.error_code
      default:
        return ''
    }
  }
  const raw = (event: SimulationEvent): string => {
    if (event.type === 'propagation_attempted' || event.type === 'propagation_resolved') {
      return `${event.link_id} · ${event.capability_id} · ${event.attempt_id}`
    }
    if (event.type === 'asset_discovered' || event.type === 'propagation_skipped') return event.link_id
    return ''
  }

  return (
    <section class="event-log" classList={{ open: store.logOpen() }} aria-label="Event log">
      <div class="log-bar">
        <ChevronIcon open={store.logOpen()} />
        <span class="log-title">Event log</span>
        <span class="log-count">
          {store.cursor()} of {store.totalEvents()} engine events so far
        </span>
        <button type="button" class="secondary log-button" aria-expanded={store.logOpen()} onClick={() => store.setLogOpen(!store.logOpen())}>
          {store.logOpen() ? 'Hide log' : 'Show log'}
        </button>
      </div>
      <Show when={store.logOpen()}>
        <div class="log-table-wrap">
          <table class="log-table">
            <thead>
              <tr>
                <th>Seq</th>
                <th>Type</th>
                <th>Source</th>
                <th>Target</th>
                <th>Outcome</th>
                <Show when={command()}>
                  <th>Link · capability · attempt</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={applied()} fallback={<tr><td colSpan={6} class="log-empty">No events yet.</td></tr>}>
                {(event) => {
                  const [source, target] = ends(event)
                  const inStep = () => {
                    const step = currentRange()
                    return step !== null && event.seq >= step.start && event.seq < step.end
                  }
                  return (
                    <tr classList={{ current: inStep() }}>
                      <td>{event.seq}</td>
                      <td>{command() ? event.type : STORY_TYPES[event.type]}</td>
                      <td>{command() && source ? `${name(source)} (${source})` : name(source)}</td>
                      <td>{command() && target ? `${name(target)} (${target})` : name(target)}</td>
                      <td>{outcome(event)}</td>
                      <Show when={command()}>
                        <td class="mono-muted">{raw(event)}</td>
                      </Show>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  )
}
