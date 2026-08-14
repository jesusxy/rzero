import { placeholderProfiles } from './data/malwareProfiles/placeholders'
import { startupTopology } from './data/topologies/startup'
import { assetTypeLabel, type NetworkEdge } from './domain/topology'
import './App.css'

const topologyOptions = [startupTopology]
const activeTopology = startupTopology

function segmentAssetCount(segmentId: string) {
  return activeTopology.nodes.filter((node) => node.segment === segmentId).length
}

function edgeStyle(edge: NetworkEdge) {
  const source = activeTopology.nodes.find((node) => node.id === edge.source)
  const target = activeTopology.nodes.find((node) => node.id === edge.target)

  if (!source || !target) {
    return {}
  }

  const deltaX = target.position.x - source.position.x
  const deltaY = target.position.y - source.position.y
  const length = Math.hypot(deltaX, deltaY)
  const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI)

  return {
    left: `${source.position.x}%`,
    top: `${source.position.y}%`,
    width: `${length}%`,
    transform: `rotate(${angle}deg)`,
  }
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
              {topologyOptions.map((topology) => (
                <option value={topology.id}>{topology.label}</option>
              ))}
            </select>
          </label>

          <label>
            Profile
            <select aria-label="Malware behavior profile">
              {placeholderProfiles.map((profile) => (
                <option value={profile.id}>{profile.label}</option>
              ))}
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
            {activeTopology.segments.map((zone) => (
              <button type="button" class="zone-card">
                <span>{zone.label}</span>
                <small>
                  {segmentAssetCount(zone.id)} assets / {zone.status}
                </small>
              </button>
            ))}
          </nav>
        </aside>

        <section class="map-stage" aria-label="Network map">
          <div class="map-toolbar" aria-label="Map controls">
            <button type="button" class="compact">
              +
            </button>
            <button type="button" class="compact">
              -
            </button>
          </div>

          <div class="iso-grid" aria-hidden="true"></div>

          <div class="network-map">
            {activeTopology.edges.map((edge) => (
              <div class="network-path" style={edgeStyle(edge)}></div>
            ))}

            {activeTopology.nodes.map((node) => (
              <button
                type="button"
                class={`asset-node asset-${node.type}`}
                style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }}
              >
                <strong>{node.label}</strong>
                <span>{node.hostname.split('.')[0]}</span>
                <small>{assetTypeLabel(node.type)}</small>
              </button>
            ))}
          </div>

          <footer class="map-hints">
            Click an asset to inspect / Choose Set Initial Access to begin
          </footer>
        </section>

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
