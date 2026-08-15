import { For } from 'solid-js'
import { MapStage } from './components/MapStage'
import { placeholderProfiles } from './data/malwareProfiles/placeholders'
import { startupTopology } from './data/topologies/startup'
import './App.css'

const topologyOptions = [startupTopology]
const activeTopology = startupTopology

function segmentAssetCount(segmentId: string) {
  return activeTopology.nodes.filter((node) => node.segment === segmentId).length
}

function App() {
  return (
    <main class="app-shell">
      <header class="topbar" aria-label="Scenario controls">
        <section class="brand-block" aria-label="Product identity">
          <p class="eyebrow">Threat Propagation Simulator</p>
          <h1>rzero</h1>
        </section>

        <section class="scenario-controls" aria-label="Simulation controls">
          <label>
            Topology
            <select aria-label="Topology preset">
              <For each={topologyOptions}>{(topology) => (
                <option value={topology.id}>{topology.label}</option>
              )}</For>
            </select>
          </label>

          <label>
            Profile
            <select aria-label="Malware behavior profile">
              <For each={placeholderProfiles}>{(profile) => (
                <option value={profile.id}>{profile.label}</option>
              )}</For>
            </select>
          </label>

          <button type="button">Start</button>
          <button type="button" class="secondary">
            Reset
          </button>
        </section>
      </header>

      <section class="workspace">
        <aside class="left-rail" aria-label="Topology zones">
          <div class="panel-heading">
            <p class="eyebrow">Topology</p>
            <h2>{activeTopology.label}</h2>
          </div>

          <nav class="zone-list" aria-label="Network segments">
            <For each={activeTopology.segments}>{(zone) => (
              <button type="button" class="zone-card">
                <span>{zone.label}</span>
                <small>
                  {segmentAssetCount(zone.id)} assets / {zone.status}
                </small>
              </button>
            )}</For>
          </nav>
        </aside>

        <MapStage topology={activeTopology} />

        <aside class="story-panel" aria-label="Story mode">
          <div class="mode-tabs" role="tablist" aria-label="View mode">
            <button type="button" class="active" role="tab" aria-selected="true">
              Story
            </button>
            <button type="button" role="tab" aria-selected="false">
              Command
            </button>
          </div>

          <section class="story-content">
            <p class="eyebrow">Current Phase</p>
            <h2>Set Initial Access</h2>
            <p>
              Pick the first compromised asset. rzero will use the selected
              malware behavior profile and topology to explain what happens
              next.
            </p>

            <div class="callout">
              <strong>Scenario question</strong>
              <span>
                Starting from this asset, what can the malware reach, and which
                controls reduce the blast radius?
              </span>
            </div>

            <ol class="story-steps">
              <li class="current">Choose a topology</li>
              <li>Choose a behavior profile</li>
              <li>Set Initial Access on a node</li>
              <li>Watch the kill chain unfold</li>
            </ol>
          </section>
        </aside>
      </section>
    </main>
  )
}

export default App
