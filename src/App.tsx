import './App.css'

const topologyZones = [
  { label: 'Ingress', count: 2, status: 'clean' },
  { label: 'Endpoints', count: 12, status: 'ready' },
  { label: 'Servers', count: 5, status: 'clean' },
  { label: 'Identity', count: 2, status: 'guarded' },
  { label: 'Data Stores', count: 3, status: 'clean' },
]

const mapNodes = [
  { id: 'MAIL', label: 'Mail', type: 'Mail Server', className: 'node-mail' },
  { id: 'HR', label: 'HR-04', type: 'Endpoint', className: 'node-hr' },
  { id: 'ENG', label: 'ENG-12', type: 'Endpoint', className: 'node-eng' },
  { id: 'APP', label: 'App', type: 'Server', className: 'node-app' },
  { id: 'DC', label: 'DC-01', type: 'Domain Controller', className: 'node-dc' },
  { id: 'DB', label: 'DB', type: 'Database', className: 'node-db' },
]

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
              <option>Startup</option>
              <option>Mid-size Company</option>
              <option>Enterprise</option>
              <option>Hospital</option>
            </select>
          </label>

          <label>
            Profile
            <select aria-label="Malware behavior profile">
              <option>Phishing Infostealer</option>
              <option>Network Worm</option>
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
            <h2>Startup Network</h2>
          </div>

          <nav class="zone-list" aria-label="Network segments">
            {topologyZones.map((zone) => (
              <button type="button" class="zone-card">
                <span>{zone.label}</span>
                <small>
                  {zone.count} assets / {zone.status}
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
            <div class="network-path path-mail-hr"></div>
            <div class="network-path path-hr-app"></div>
            <div class="network-path path-app-dc"></div>
            <div class="network-path path-app-db"></div>

            {mapNodes.map((node) => (
              <button type="button" class={`asset-node ${node.className}`}>
                <strong>{node.id}</strong>
                <span>{node.label}</span>
                <small>{node.type}</small>
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
