import { createMemo, createSignal, For, Show } from 'solid-js'
import type { Asset } from '../core'
import type { GridPosition } from '../app/layout'
import type { AssetViewState, LinkViewState, StaticMapAsset, StaticMapLink } from '../app/view'

type MapStageProps = {
  assets: readonly StaticMapAsset[]
  links: readonly StaticMapLink[]
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
type ViewBox = { x: number; y: number; w: number; h: number }

const boardSize = 30
const projection = { originX: 50, originY: 8, tileX: 1.55, tileY: 1.02 }

const blockDimensions: Record<Asset['kind'], BlockDimensions> = {
  workstation: { width: 3, depth: 3, height: 4.2 },
  server: { width: 3.4, depth: 3.4, height: 6.4 },
  controller: { width: 4, depth: 4, height: 7 },
  appliance: { width: 3.1, depth: 3.1, height: 5 },
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
function lerp(a: ScreenPoint, b: ScreenPoint, t: number): ScreenPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function blockFaces(asset: StaticMapAsset) {
  const size = blockDimensions[asset.kind]
  const hw = size.width / 2
  const hd = size.depth / 2
  const { x, y } = asset.position
  const gTop = project({ x: x - hw, y: y - hd })
  const gRight = project({ x: x + hw, y: y - hd })
  const gBottom = project({ x: x + hw, y: y + hd })
  const gLeft = project({ x: x - hw, y: y + hd })
  const center = project(asset.position)
  const up = (p: ScreenPoint): ScreenPoint => ({ x: p.x, y: p.y - size.height })
  const rTop = up(gTop)
  const rRight = up(gRight)
  const rBottom = up(gBottom)
  const rLeft = up(gLeft)
  return {
    top: points([rTop, rRight, rBottom, rLeft]),
    left: points([gLeft, gBottom, rBottom, rLeft]),
    right: points([gBottom, gRight, rRight, rBottom]),
    roof: { x: center.x, y: center.y - size.height },
    g: { top: gTop, right: gRight, bottom: gBottom, left: gLeft },
    r: { top: rTop, right: rRight, bottom: rBottom, left: rLeft },
  }
}

// Decorative, recognizable detail per silhouette family. Never implies facts.
function decorations(asset: StaticMapAsset, faces: ReturnType<typeof blockFaces>) {
  if (asset.kind === 'server') {
    // Rack-unit lines across the right face.
    return [0.28, 0.5, 0.72].map((t) =>
      points([lerp(faces.g.bottom, faces.r.bottom, t), lerp(faces.g.right, faces.r.right, t)]),
    )
  }
  return []
}
// A small roof vent for workstations (a centred diamond on the top face).
function roofVent(asset: StaticMapAsset, faces: ReturnType<typeof blockFaces>): string | null {
  if (asset.kind !== 'workstation') return null
  const c = faces.roof
  const s = 0.62
  return points([lerp(faces.r.top, c, s), lerp(faces.r.right, c, s), lerp(faces.r.bottom, c, s), lerp(faces.r.left, c, s)])
}

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
  const trim = 2.7
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
  // Mid point + a small direction chevron there.
  let total = 0
  for (let i = 1; i < linePts.length; i += 1) total += Math.hypot(linePts[i]!.x - linePts[i - 1]!.x, linePts[i]!.y - linePts[i - 1]!.y)
  let acc = 0
  let mid = linePts[0]!
  let midDir = headDir
  for (let i = 1; i < linePts.length; i += 1) {
    const seg = Math.hypot(linePts[i]!.x - linePts[i - 1]!.x, linePts[i]!.y - linePts[i - 1]!.y)
    if (acc + seg >= total / 2) {
      const t = (total / 2 - acc) / (seg || 1)
      mid = lerp(linePts[i - 1]!, linePts[i]!, t)
      midDir = unit(linePts[i - 1]!, linePts[i]!)
      break
    }
    acc += seg
  }
  const midPerp = { x: -midDir.y, y: midDir.x }
  const chevron = points([
    { x: mid.x - midDir.x * 0.9 + midPerp.x * 0.9, y: mid.y - midDir.y * 0.9 + midPerp.y * 0.9 },
    { x: mid.x + midDir.x * 0.6, y: mid.y + midDir.y * 0.6 },
    { x: mid.x - midDir.x * 0.9 - midPerp.x * 0.9, y: mid.y - midDir.y * 0.9 - midPerp.y * 0.9 },
  ])
  return { line: points(linePts), head, chevron, mid, midPerp }
}

function sceneBounds(assets: readonly StaticMapAsset[]): ViewBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const asset of assets) {
    const f = blockFaces(asset)
    for (const p of [f.g.top, f.g.right, f.g.bottom, f.g.left, f.r.top, f.r.right, f.r.bottom, f.r.left, f.roof]) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 100, h: 72 }
  const pad = 7
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export function MapStage(props: MapStageProps) {
  let svgRef: SVGSVGElement | undefined
  const ordered = createMemo(() => [...props.assets].sort((a, b) => project(a.position).y - project(b.position).y))
  const bounds = createMemo(() => sceneBounds(props.assets))

  const [view, setView] = createSignal<ViewBox>(sceneBounds(props.assets))
  const viewBox = () => {
    const v = view()
    return `${v.x} ${v.y} ${v.w} ${v.h}`
  }
  const zoomBy = (factor: number) =>
    setView((v) => {
      const base = bounds()
      const nw = Math.max(base.w * 0.25, Math.min(v.w * factor, base.w * 3))
      const nh = v.h * (nw / v.w)
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh }
    })
  const fit = () => setView(bounds())

  let drag: { px: number; py: number; view: ViewBox } | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    drag = { px: event.clientX, py: event.clientY, view: view() }
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (drag === null || svgRef === undefined) return
    const rect = svgRef.getBoundingClientRect()
    const dx = ((event.clientX - drag.px) * drag.view.w) / rect.width
    const dy = ((event.clientY - drag.py) * drag.view.h) / rect.height
    setView({ ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy })
  }
  const endDrag = (event: PointerEvent) => {
    drag = null
    ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
  }

  const keyActivate = (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  return (
    <section class="map-stage" aria-label="Network map">
      <div class="map-toolbar" aria-label="Camera controls">
        <button type="button" class="compact" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>+</button>
        <button type="button" class="compact" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>−</button>
        <button type="button" class="compact" aria-label="Fit network" title="Fit network" onClick={fit}>⤢</button>
      </div>

      <div class="network-map">
        <svg
          ref={svgRef}
          class="network-scene"
          viewBox={viewBox()}
          role="img"
          aria-label="Five-node lab network topology"
        >
          <rect
            class="pan-surface"
            x={view().x}
            y={view().y}
            width={view().w}
            height={view().h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />

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
                  <Show when={state() !== 'blocked' && state() !== 'indeterminate'}>
                    <polyline class="edge-chevron" points={geo.chevron} />
                  </Show>
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
              const racks = decorations(asset, faces)
              const vent = roofVent(asset, faces)
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
                  <For each={racks}>{(line) => <polyline class="asset-rack" points={line} />}</For>
                  <Show when={vent}>{(points) => <polygon class="asset-vent" points={points()} />}</Show>

                  {/* Seed marker (configured start host) — distinct from compromise. */}
                  <Show when={asset.isSeed}>
                    <polygon
                      class="asset-seed-mark"
                      points={points([
                        { x: faces.roof.x, y: faces.roof.y - 3.4 },
                        { x: faces.roof.x - 1.1, y: faces.roof.y - 1.8 },
                        { x: faces.roof.x + 1.1, y: faces.roof.y - 1.8 },
                      ])}
                    />
                  </Show>
                  {/* State mark: filled = compromised, ring = discovered. */}
                  <Show when={state() === 'compromised'}>
                    <circle class="asset-mark mark-compromised" cx={faces.roof.x} cy={faces.roof.y - 0.1} r="0.9" />
                  </Show>
                  <Show when={state() === 'discovered'}>
                    <circle class="asset-mark mark-discovered" cx={faces.roof.x} cy={faces.roof.y - 0.1} r="0.9" />
                  </Show>

                  <text class="asset-block-label" x={faces.roof.x} y={faces.roof.y + 2}>{asset.shortName}</text>
                </g>
              )
            }}</For>
          </g>
        </svg>
      </div>

      <footer class="map-legend" aria-label="Legend">
        <span class="legend-item"><span class="swatch sw-compromised" />compromised</span>
        <span class="legend-item"><span class="swatch sw-discovered" />discovered</span>
        <span class="legend-item"><span class="swatch sw-seed" />start host</span>
        <span class="legend-item"><span class="swatch sw-blocked" />blocked route</span>
        <span class="legend-sep" />
        <span class="legend-hint">Drag to pan · click or focus + Enter to inspect</span>
      </footer>
    </section>
  )
}
