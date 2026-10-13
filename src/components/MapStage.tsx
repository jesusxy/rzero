import { For, Show } from 'solid-js'
import type { Asset } from '../core'
import type { GridPosition } from '../app/layout'
import type { MapAsset, MapLink } from '../app/view'

type MapStageProps = {
  assets: readonly MapAsset[]
  links: readonly MapLink[]
  hasRun: boolean
  onSelectAsset: (id: string) => void
  onSelectLink: (id: string) => void
}

type ScreenPoint = { x: number; y: number }

type BlockDimensions = {
  // Grid units (same space as GridPosition); projected like node positions.
  width: number
  depth: number
  height: number
}

const boardSize = 30

const projection = { originX: 50, originY: 8, tileX: 1.55, tileY: 1.02 }

// Silhouette families keyed by the native asset kind. Height is decorative and
// must not imply risk, privilege or data volume.
const blockDimensions: Record<Asset['kind'], BlockDimensions> = {
  workstation: { width: 2.8, depth: 2.8, height: 4.5 },
  server: { width: 3.6, depth: 3.6, height: 6 },
  controller: { width: 4.2, depth: 4.2, height: 7 },
  appliance: { width: 3, depth: 3, height: 5 },
  other: { width: 2.8, depth: 2.8, height: 4 },
}

const gridStep = 2
const gridLines = Array.from({ length: Math.floor(boardSize / gridStep) + 1 }, (_, index) => index * gridStep)

function project(point: GridPosition): ScreenPoint {
  return {
    x: projection.originX + (point.x - point.y) * projection.tileX,
    y: projection.originY + (point.x + point.y) * projection.tileY,
  }
}

function points(pointsToJoin: ScreenPoint[]): string {
  return pointsToJoin.map((point) => `${point.x},${point.y}`).join(' ')
}

function projectedPoints(pointsToJoin: GridPosition[]): string {
  return points(pointsToJoin.map(project))
}

function blockFaces(asset: MapAsset) {
  const size = blockDimensions[asset.kind]
  const halfWidth = size.width / 2
  const halfDepth = size.depth / 2
  const { x, y } = asset.position

  const groundTop = project({ x: x - halfWidth, y: y - halfDepth })
  const groundRight = project({ x: x + halfWidth, y: y - halfDepth })
  const groundBottom = project({ x: x + halfWidth, y: y + halfDepth })
  const groundLeft = project({ x: x - halfWidth, y: y + halfDepth })
  const groundCenter = project(asset.position)
  const shift = (p: ScreenPoint, amount: number): ScreenPoint => ({ x: p.x, y: p.y - amount })

  const rTop = shift(groundTop, size.height)
  const rRight = shift(groundRight, size.height)
  const rBottom = shift(groundBottom, size.height)
  const rLeft = shift(groundLeft, size.height)

  return {
    top: points([rTop, rRight, rBottom, rLeft]),
    left: points([groundLeft, groundBottom, rBottom, rLeft]),
    right: points([groundBottom, groundRight, rRight, rBottom]),
    roof: shift(groundCenter, size.height),
    base: groundBottom,
  }
}

// A directed route trimmed to leave room for node footprints, with an arrowhead.
function edgeGeometry(link: MapLink) {
  const s = project(link.from)
  const t = project(link.to)
  const dx = t.x - s.x
  const dy = t.y - s.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const trim = 2.6
  const start: ScreenPoint = { x: s.x + ux * trim, y: s.y + uy * trim }
  const tip: ScreenPoint = { x: t.x - ux * trim, y: t.y - uy * trim }
  const arrowLength = 2
  const arrowHalf = 1.1
  const back: ScreenPoint = { x: tip.x - ux * arrowLength, y: tip.y - uy * arrowLength }
  const perpX = -uy
  const perpY = ux
  const line = points([start, back])
  const head = points([
    tip,
    { x: back.x + perpX * arrowHalf, y: back.y + perpY * arrowHalf },
    { x: back.x - perpX * arrowHalf, y: back.y - perpY * arrowHalf },
  ])
  // Midpoint for a "stopped" mark on a blocked route.
  const mid: ScreenPoint = { x: (start.x + tip.x) / 2, y: (start.y + tip.y) / 2 }
  return { line, head, mid, perpX, perpY }
}

const stateLabel: Record<MapAsset['state'], string> = {
  modeled: 'modeled',
  discovered: 'discovered',
  compromised: 'compromised',
}

export function MapStage(props: MapStageProps) {
  const orderedAssets = () => [...props.assets].sort((a, b) => project(a.position).y - project(b.position).y)

  const selectAsset = (id: string) => props.onSelectAsset(id)
  const keySelect = (event: KeyboardEvent, id: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectAsset(id)
    }
  }

  return (
    <section class="map-stage" aria-label="Network map">
      <div class="network-map">
        <svg class="network-scene" viewBox="0 0 100 72" role="img" aria-label="Five-node lab network topology">
          <defs>
            <pattern id="block-hatch" width=".4" height=".4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="2" class="block-hatch-bg" />
              <path d="M 0 0 V 2" class="block-hatch-line" />
            </pattern>
          </defs>

          <g class="iso-grid" aria-hidden="true">
            <For each={gridLines}>{(line) => (
              <>
                <polyline class="iso-grid-line" points={projectedPoints([{ x: line, y: 0 }, { x: line, y: boardSize }])} />
                <polyline class="iso-grid-line" points={projectedPoints([{ x: 0, y: line }, { x: boardSize, y: line }])} />
              </>
            )}</For>
          </g>

          <g class="network-edges">
            <For each={props.links}>{(link) => {
              const geo = edgeGeometry(link)
              return (
                <g
                  class={`network-edge edge-${link.access} edge-state-${link.state}`}
                  classList={{ 'edge-selected': link.selected }}
                  role="button"
                  tabindex="0"
                  aria-label={`Link ${link.source} to ${link.target} over ${link.service}, ${link.state === 'none' ? link.access : link.state}`}
                  onClick={() => props.onSelectLink(link.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      props.onSelectLink(link.id)
                    }
                  }}
                >
                  <polyline class="edge-line" points={geo.line} />
                  <polygon class="edge-head" points={geo.head} />
                  <Show when={link.state === 'blocked'}>
                    <polyline
                      class="edge-stop"
                      points={points([
                        { x: geo.mid.x + geo.perpX * 1.3, y: geo.mid.y + geo.perpY * 1.3 },
                        { x: geo.mid.x - geo.perpX * 1.3, y: geo.mid.y - geo.perpY * 1.3 },
                      ])}
                    />
                  </Show>
                  <Show when={link.state === 'indeterminate'}>
                    <text class="edge-badge" x={geo.mid.x} y={geo.mid.y - 1}>?</text>
                  </Show>
                </g>
              )
            }}</For>
          </g>

          <g class="network-nodes">
            <For each={orderedAssets()}>{(asset) => {
              const faces = blockFaces(asset)
              return (
                <g
                  class={`asset-block asset-${asset.state}`}
                  classList={{ 'asset-selected': asset.selected, 'asset-seed': asset.isSeed }}
                  role="button"
                  tabindex="0"
                  aria-pressed={asset.selected}
                  aria-label={`${asset.label} (${asset.id}), ${asset.kind}, ${stateLabel[asset.state]}${asset.isSeed ? ', initial host' : ''}`}
                  onClick={() => selectAsset(asset.id)}
                  onKeyDown={(event) => keySelect(event, asset.id)}
                >
                  <title>{`${asset.label} — ${asset.kind} — ${stateLabel[asset.state]}`}</title>
                  <polygon class="asset-face asset-face-left" points={faces.left} />
                  <polygon class="asset-face asset-face-right" points={faces.right} />
                  <polygon class="asset-face asset-face-top" points={faces.top} />
                  <text class="asset-block-label" x={faces.roof.x} y={faces.roof.y - 0.6}>{asset.id}</text>
                  <Show when={asset.isSeed}>
                    <text class="asset-seed-tag" x={faces.roof.x} y={faces.roof.y - 2.6}>seed</text>
                  </Show>
                  <Show when={asset.state !== 'modeled'}>
                    <text class="asset-state-tag" x={faces.base.x} y={faces.base.y + 2.2}>{stateLabel[asset.state]}</text>
                  </Show>
                </g>
              )
            }}</For>
          </g>
        </svg>
      </div>

      <footer class="map-hints">
        <Show when={props.hasRun} fallback={<span>Press Start to compile and run the synthetic scenario</span>}>
          <span>Click or focus + Enter to inspect a host or route</span>
        </Show>
      </footer>
    </section>
  )
}
