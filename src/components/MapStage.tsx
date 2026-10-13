import { createMemo, For, Show } from 'solid-js'
import type { Asset } from '../core'
import type { GridPosition } from '../app/layout'
import type { AssetViewState, LinkViewState, StaticMapAsset, StaticMapLink } from '../app/view'

type MapStageProps = {
  assets: readonly StaticMapAsset[]
  links: readonly StaticMapLink[]
  // Dynamic state is read through accessors so the static elements (and their
  // keyboard focus) persist across playback and selection updates.
  stateOf: (id: string) => AssetViewState
  assetSelected: (id: string) => boolean
  linkStateOf: (id: string) => LinkViewState
  linkSelected: (id: string) => boolean
  hasRun: boolean
  onSelectAsset: (id: string) => void
  onSelectLink: (id: string) => void
}

type ScreenPoint = { x: number; y: number }

type BlockDimensions = { width: number; depth: number; height: number }

const boardSize = 30
const projection = { originX: 50, originY: 8, tileX: 1.55, tileY: 1.02 }

// Silhouette families keyed by native asset kind. Height is decorative and must
// not imply risk, privilege or data volume.
const blockDimensions: Record<Asset['kind'], BlockDimensions> = {
  workstation: { width: 2.8, depth: 2.8, height: 4.5 },
  server: { width: 3.6, depth: 3.6, height: 6 },
  controller: { width: 4.2, depth: 4.2, height: 7 },
  appliance: { width: 3, depth: 3, height: 5 },
  other: { width: 2.8, depth: 2.8, height: 4 },
}

const gridStep = 2
const gridLines = Array.from({ length: Math.floor(boardSize / gridStep) + 1 }, (_, i) => i * gridStep)

function project(point: GridPosition): ScreenPoint {
  return {
    x: projection.originX + (point.x - point.y) * projection.tileX,
    y: projection.originY + (point.x + point.y) * projection.tileY,
  }
}

function points(pts: ScreenPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
}

function projectedPoints(pts: GridPosition[]): string {
  return points(pts.map(project))
}

function blockFaces(asset: StaticMapAsset) {
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

// A directed route through from → waypoints → to, trimmed to leave room for the
// node footprints, with an arrowhead on the final segment and a mid-path point
// for a "stopped" mark on blocked routes.
function edgeGeometry(link: StaticMapLink) {
  const pathGrid = [link.from, ...link.waypoints, link.to]
  const pathScreen = pathGrid.map(project)
  const first = pathScreen[0]!
  const second = pathScreen[1]!
  const last = pathScreen[pathScreen.length - 1]!
  const prev = pathScreen[pathScreen.length - 2]!

  const unit = (a: ScreenPoint, b: ScreenPoint) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: dx / len, y: dy / len }
  }
  const trim = 2.6
  const headDir = unit(prev, last)
  const startDir = unit(first, second)
  const start: ScreenPoint = { x: first.x + startDir.x * trim, y: first.y + startDir.y * trim }
  const tip: ScreenPoint = { x: last.x - headDir.x * trim, y: last.y - headDir.y * trim }
  const linePts = [start, ...pathScreen.slice(1, -1), tip]

  const arrowLength = 2
  const arrowHalf = 1.1
  const back: ScreenPoint = { x: tip.x - headDir.x * arrowLength, y: tip.y - headDir.y * arrowLength }
  const perp = { x: -headDir.y, y: headDir.x }
  const head = points([
    tip,
    { x: back.x + perp.x * arrowHalf, y: back.y + perp.y * arrowHalf },
    { x: back.x - perp.x * arrowHalf, y: back.y - perp.y * arrowHalf },
  ])

  // Mid point at half the polyline length (for the blocked stop mark).
  let total = 0
  for (let i = 1; i < linePts.length; i += 1) total += Math.hypot(linePts[i]!.x - linePts[i - 1]!.x, linePts[i]!.y - linePts[i - 1]!.y)
  let acc = 0
  let mid = linePts[0]!
  let midPerp = perp
  for (let i = 1; i < linePts.length; i += 1) {
    const seg = Math.hypot(linePts[i]!.x - linePts[i - 1]!.x, linePts[i]!.y - linePts[i - 1]!.y)
    if (acc + seg >= total / 2) {
      const t = (total / 2 - acc) / (seg || 1)
      mid = { x: linePts[i - 1]!.x + (linePts[i]!.x - linePts[i - 1]!.x) * t, y: linePts[i - 1]!.y + (linePts[i]!.y - linePts[i - 1]!.y) * t }
      const u = unit(linePts[i - 1]!, linePts[i]!)
      midPerp = { x: -u.y, y: u.x }
      break
    }
    acc += seg
  }

  return { line: points(linePts), head, mid, midPerp }
}

export function MapStage(props: MapStageProps) {
  // Draw order depends only on the static positions, so it stays stable.
  const ordered = createMemo(() => [...props.assets].sort((a, b) => project(a.position).y - project(b.position).y))

  const keyActivate = (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
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
              const state = () => props.linkStateOf(link.id)
              return (
                <g
                  class={`network-edge edge-${link.access} edge-state-${state()}`}
                  classList={{ 'edge-selected': props.linkSelected(link.id) }}
                  role="button"
                  tabindex="0"
                  aria-label={`Link ${link.source} to ${link.target} over ${link.service}, ${state() === 'none' ? link.access : state()}`}
                  onClick={() => props.onSelectLink(link.id)}
                  onKeyDown={(event) => keyActivate(event, () => props.onSelectLink(link.id))}
                >
                  <polyline class="edge-line" points={geo.line} />
                  <polygon class="edge-head" points={geo.head} />
                  <Show when={state() === 'blocked'}>
                    <polyline
                      class="edge-stop"
                      points={points([
                        { x: geo.mid.x + geo.midPerp.x * 1.3, y: geo.mid.y + geo.midPerp.y * 1.3 },
                        { x: geo.mid.x - geo.midPerp.x * 1.3, y: geo.mid.y - geo.midPerp.y * 1.3 },
                      ])}
                    />
                  </Show>
                  <Show when={state() === 'indeterminate'}>
                    <text class="edge-badge" x={geo.mid.x} y={geo.mid.y - 1}>?</text>
                  </Show>
                </g>
              )
            }}</For>
          </g>

          <g class="network-nodes">
            <For each={ordered()}>{(asset) => {
              const faces = blockFaces(asset)
              const state = () => props.stateOf(asset.id)
              return (
                <g
                  class="asset-block"
                  classList={{
                    'asset-modeled': state() === 'modeled',
                    'asset-discovered': state() === 'discovered',
                    'asset-compromised': state() === 'compromised',
                    'asset-selected': props.assetSelected(asset.id),
                    'asset-seed': asset.isSeed,
                  }}
                  role="button"
                  tabindex="0"
                  aria-pressed={props.assetSelected(asset.id)}
                  aria-label={`${asset.shortName} (${asset.id}), ${asset.kind}, ${state()}${asset.isSeed ? ', configured starting host' : ''}`}
                  onClick={() => props.onSelectAsset(asset.id)}
                  onKeyDown={(event) => keyActivate(event, () => props.onSelectAsset(asset.id))}
                >
                  <title>{`${asset.shortName} — ${asset.kind} — ${state()}`}</title>
                  <polygon class="asset-face asset-face-left" points={faces.left} />
                  <polygon class="asset-face asset-face-right" points={faces.right} />
                  <polygon class="asset-face asset-face-top" points={faces.top} />
                  <text class="asset-block-label" x={faces.roof.x} y={faces.roof.y - 0.6}>{asset.shortName}</text>
                  <Show when={asset.isSeed}>
                    <text class="asset-seed-tag" x={faces.roof.x} y={faces.roof.y - 2.6}>start</text>
                  </Show>
                  <Show when={state() !== 'modeled'}>
                    <text class="asset-state-tag" x={faces.base.x} y={faces.base.y + 2.2}>{state()}</text>
                  </Show>
                </g>
              )
            }}</For>
          </g>
        </svg>
      </div>

      <footer class="map-hints">
        <Show when={props.hasRun} fallback={<span>Network loaded — press Start to run the synthetic scenario</span>}>
          <span>Click or focus + Enter to inspect a host or route</span>
        </Show>
      </footer>
    </section>
  )
}
