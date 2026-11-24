import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { AttemptView, Capability } from '../core'
import type { SimulationStore } from '../app/store'
import { capabilityChip, platformName, primaryCheck } from '../app/narration'
import {
  bounds,
  districts,
  expand,
  fractionAt,
  gridLines,
  labelSide,
  nodeShape,
  pointAt,
  routeGeometry,
  splitAt,
  toPoints,
  toScene,
  trimEnd,
  type Point,
  type RouteGeometry,
} from '../app/scene'
import { hostStatus, latestAttemptByLink, routeState, type HostStatus, type RouteState } from '../app/view'
import { FitIcon, LockIcon, MinusIcon, PlusIcon, ShieldIcon } from './icons'

type View = { x: number; y: number; w: number; h: number }

const STATUS_WORDS: Record<Exclude<HostStatus, null> | 'saved', string> = {
  compromised: 'Compromised',
  blocked: 'Blocked',
  unknown: 'Unknown',
  saved: 'Saved',
}

const DEFENSE_LEGEND = {
  segmentation: 'zone protected by your defense',
  patch: 'host patched by your defense',
  link: 'link blocked by your defense',
} as const

const STRAIGHT_STOP = 0.6
const WIDTH = { idle: 1.25, tried: 1.5, spread: 2.6, current: 2.2 } as const
type Ink = keyof typeof WIDTH

export function MapStage(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'

  const scene = createMemo(() => {
    const compiled = store.compiled()
    if (compiled === null) return null
    const layout = store.layout()
    const network = compiled.effective.network
    const shapes = new Map(
      network.assets.map((asset) => [asset.id, nodeShape(asset, toScene(layout.cells.get(asset.id) ?? { x: 0, y: 0 }))]),
    )
    const segmentOf = new Map(network.assets.map((asset) => [asset.id, asset.segment_id]))
    const boxOf = new Map(layout.districts.map((box) => [box.id, box]))
    const routes = layout.routes.flatMap((route) => {
      const across = segmentOf.get(route.source) !== segmentOf.get(route.target)
      const geometry = routeGeometry(route, shapes, across ? boxOf.get(segmentOf.get(route.target)!) : undefined)
      return geometry === null ? [] : [geometry]
    })
    const areas = districts(layout.districts)
    const seed = compiled.effective.initial_asset_id
    const markers = new Map(
      network.assets.map((asset) => [
        asset.id,
        [
          asset.id === seed ? 'start' : null,
          asset.critical ? 'critical' : null,
          asset.platform === 'windows' ? null : platformName(asset.platform),
        ].filter((marker): marker is string => marker !== null),
      ]),
    )
    const box = bounds([
      ...[...shapes.values()].flatMap((shape) => shape.hull),
      ...routes.flatMap((route) => route.points),
      ...areas.map((area) => area.labelAt),
    ])
    return {
      assets: [...network.assets].sort((a, b) => shapes.get(a.id)!.anchor.y - shapes.get(b.id)!.anchor.y),
      shapes,
      routes,
      areas,
      markers,
      grid: gridLines(layout.districts),
      coarseGrid: gridLines(layout.districts, 2),
      compactSides: new Map(
        network.assets.map((asset) => [
          asset.id,
          labelSide(
            asset.id,
            shapes.get(asset.id)!.anchor,
            routes,
            ['bottom', 'top'],
            areas.map((area) => area.labelAt),
          ),
        ]),
      ),
      capabilities: new Map(compiled.effective.profile.capabilities.map((capability) => [capability.id, capability])),
      box,
      longestName: Math.max(...network.assets.map((asset) => asset.label.length)),
      longestMarkers: Math.max(...[...markers.values()].map((list) => list.join(' · ').length)),
      longestId: Math.max(...network.assets.map((asset) => asset.id.length)),
    }
  })

  const aspect = () => {
    const box = scene()?.box
    if (!box) return '1.45'
    return String(Math.min(1.45, Math.max(1, (box.maxX - box.minX) / (box.maxY - box.minY))))
  }
  const [size, setSize] = createSignal({ w: 800, h: 520 })
  const compact = () => size().w < 520
  const sideOf = (id: string) => (compact() ? scene()!.compactSides.get(id)! : 'right')

  const labelBox = (anchor: Point, hull: ReturnType<typeof bounds>, scale: number) => ({
    halfW: ((hull.maxX - hull.minX) / 2) * scale + 14,
    halfH: ((hull.maxY - hull.minY) / 2) * scale + 8,
    lift: compact() ? 0 : ((hull.maxY - hull.minY) / 2) * scale * 0.45,
    anchor,
  })

  const fitFor = (w: number, h: number): View => {
    const sc = scene()
    if (sc === null || w <= 0 || h <= 0) return { x: 0, y: 0, w: 100, h: 70 }
    const { box } = sc
    const cw = box.maxX - box.minX
    const ch = box.maxY - box.minY
    const statusW = 11 * (compact() ? 6.6 : 7.3)
    const subW = compact() ? 0 : (sc.longestMarkers + (command() ? sc.longestId + 3 : 0)) * 6.6
    const nameW = sc.longestName * (compact() ? 6.9 : 7.8)
    const labelW = Math.max(statusW, subW, nameW)
    const labelH = compact() ? 30 : 48
    let scale = Math.min(w / cw, h / ch)
    let need = { left: 0, right: 0, top: 0, bottom: 0 }
    for (let i = 0; i < 4; i += 1) {
      need = { left: 0, right: 0, top: 0, bottom: 0 }
      for (const asset of sc.assets) {
        const shape = sc.shapes.get(asset.id)!
        const ax = (shape.anchor.x - box.minX) * scale
        const ay = (shape.anchor.y - box.minY) * scale
        const { halfW, halfH, lift } = labelBox(shape.anchor, bounds(shape.hull), scale)
        const side = sideOf(asset.id)
        const rect =
          side === 'right'
            ? { l: ax + halfW, r: ax + halfW + labelW, t: ay - lift - labelH / 2, b: ay - lift + labelH / 2 }
            : side === 'left'
              ? { l: ax - halfW - labelW, r: ax - halfW, t: ay - labelH / 2, b: ay + labelH / 2 }
              : side === 'top'
                ? { l: ax - labelW / 2, r: ax + labelW / 2, t: ay - halfH - labelH, b: ay - halfH }
                : { l: ax - labelW / 2, r: ax + labelW / 2, t: ay + halfH, b: ay + halfH + labelH }
        need = {
          left: Math.max(need.left, -rect.l),
          right: Math.max(need.right, rect.r - cw * scale),
          top: Math.max(need.top, -rect.t),
          bottom: Math.max(need.bottom, rect.b - ch * scale),
        }
      }
      scale = Math.max(0.5, Math.min((w - need.left - need.right - 40) / cw, (h - need.top - need.bottom - 40) / ch))
    }
    const vw = w / scale
    const vh = h / scale
    const usedW = cw + (need.left + need.right) / scale
    const usedH = ch + (need.top + need.bottom) / scale
    return {
      x: box.minX - need.left / scale - (vw - usedW) / 2,
      y: box.minY - need.top / scale - (vh - usedH) / 2,
      w: vw,
      h: vh,
    }
  }

  const [view, setView] = createSignal<View>(fitFor(800, 520))
  let cameraMoved = false
  let wrap: HTMLDivElement | undefined

  onMount(() => {
    if (wrap === undefined) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
      if (!cameraMoved) setView(fitFor(entry.contentRect.width, entry.contentRect.height))
    })
    observer.observe(wrap)
    onCleanup(() => observer.disconnect())
  })

  const transform = createMemo(() => {
    const v = view()
    const s = size()
    const scale = Math.min(s.w / v.w, s.h / v.h) || 1
    return { v, scale, offX: (s.w - v.w * scale) / 2, offY: (s.h - v.h * scale) / 2 }
  })
  const px = (n: number) => n / transform().scale
  const toScreen = (p: Point) => {
    const t = transform()
    return { x: (p.x - t.v.x) * t.scale + t.offX, y: (p.y - t.v.y) * t.scale + t.offY }
  }

  const zoomBy = (factor: number) => {
    cameraMoved = true
    setView((v) => {
      const fit = fitFor(size().w, size().h)
      const w = Math.max(fit.w * 0.3, Math.min(v.w * factor, fit.w * 3))
      const h = v.h * (w / v.w)
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h }
    })
  }
  const fit = () => {
    cameraMoved = false
    setView(fitFor(size().w, size().h))
  }

  let drag: { x: number; y: number; view: View } | null = null
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    drag = { x: event.clientX, y: event.clientY, view: view() }
    cameraMoved = true
    ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (drag === null) return
    const scale = transform().scale
    setView({ ...drag.view, x: drag.view.x - (event.clientX - drag.x) / scale, y: drag.view.y - (event.clientY - drag.y) / scale })
  }
  const endDrag = (event: PointerEvent) => {
    drag = null
    ;(event.currentTarget as Element).releasePointerCapture?.(event.pointerId)
  }

  const marks = () => store.comparison()?.marks
  const saved = createMemo(() => new Set(store.atResults() ? (store.comparison()?.changes.saved ?? []) : []))
  const shownStatus = (id: string): keyof typeof STATUS_WORDS | null => (saved().has(id) ? 'saved' : hostStatus(store.replay(), id))
  const ledger = createMemo(() => latestAttemptByLink(store.replay()))
  const currentStep = createMemo(() => store.steps()[store.stepIndex()] ?? null)
  const currentAttempt = createMemo<AttemptView | null>(() => {
    const step = currentStep()
    if (step?.kind !== 'attempt' || step.attempt_id === undefined) return null
    return store.replay().attempts[step.attempt_id] ?? null
  })
  const currentTarget = () => {
    const step = currentStep()
    return step?.kind === 'attempt' ? (step.target_id ?? null) : null
  }

  type RouteView = {
    state: RouteState
    current: boolean
    attempt: AttemptView | undefined
    capability: Capability | undefined
  }
  const routeView = (route: RouteGeometry): RouteView => {
    const current = currentAttempt()
    const isCurrent = current !== null && current.link_id === route.linkId
    const attempt = isCurrent ? current : ledger().get(route.linkId)
    return {
      state: isCurrent ? current.status : routeState(attempt),
      current: isCurrent,
      attempt,
      capability: attempt === undefined ? undefined : scene()?.capabilities.get(attempt.capability_id),
    }
  }

  const stopFraction = (route: RouteGeometry, rv: RouteView) => {
    const check = rv.attempt === undefined || rv.attempt.status === 'pending' ? undefined : primaryCheck(rv.attempt.checks)
    if (check?.code === 'NETWORK_ACCESS' && route.entry !== null) return fractionAt(route.points, route.entry)
    const corner = route.corners.at(-1)
    return corner === undefined ? STRAIGHT_STOP : fractionAt(route.points, corner)
  }
  const chipFraction = (route: RouteGeometry, rv: RouteView) => {
    const corner = route.corners[0]
    const rest = corner === undefined ? STRAIGHT_STOP / 2 : fractionAt(route.points, corner)
    return rv.state === 'pending' ? store.travel() * rest : rest
  }
  const badgeAt = (route: RouteGeometry) => route.corners.at(-1) ?? pointAt(route.points, 0.7).point
  const inkOf = (rv: RouteView): Ink =>
    rv.current ? 'current' : rv.state === 'succeeded' ? 'spread' : rv.state === 'untried' ? 'idle' : 'tried'
  const LAYER: Record<Ink, number> = { idle: 0, tried: 1, spread: 2, current: 3 }
  const layered = createMemo(() => {
    const sc = scene()
    if (sc === null) return []
    const rank = new Map(sc.routes.map((route) => [route.linkId, LAYER[inkOf(routeView(route))]]))
    return [...sc.routes].sort((a, b) => rank.get(a.linkId)! - rank.get(b.linkId)!)
  })

  const arrowhead = (points: readonly Point[]) => {
    const tip = points[points.length - 1]!
    const prev = points[points.length - 2] ?? tip
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1
    const dir = { x: (tip.x - prev.x) / len, y: (tip.y - prev.y) / len }
    const back = { x: tip.x - dir.x * px(8), y: tip.y - dir.y * px(8) }
    const half = px(3.6)
    return toPoints([tip, { x: back.x - dir.y * half, y: back.y + dir.x * half }, { x: back.x + dir.y * half, y: back.y - dir.x * half }])
  }
  const tick = (points: readonly Point[], fraction: number) => {
    const { point, direction } = pointAt(points, fraction)
    const half = px(7)
    return toPoints([
      { x: point.x - direction.y * half, y: point.y + direction.x * half },
      { x: point.x + direction.y * half, y: point.y - direction.x * half },
    ])
  }
  const width = (ink: Ink) => ({ 'stroke-width': `${px(WIDTH[ink])}` })

  return (
    <section class="map-card" aria-label="Network map">
      <div class="map-wrap" classList={{ compact: compact() }} style={{ 'aspect-ratio': aspect() }} ref={(el) => (wrap = el)}>
        <Show when={scene()}>
          {(s) => (
            <>
              <svg class="map-svg" viewBox={`${view().x} ${view().y} ${view().w} ${view().h}`} role="img" aria-label="Isometric network map">
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
                <g class="grid" aria-hidden="true">
                  <For each={compact() ? s().coarseGrid : s().grid}>{(line) => <polyline class="grid-line" points={toPoints(line)} />}</For>
                </g>
                <g class="districts" aria-hidden="true">
                  <For each={s().areas}>
                    {(area) => {
                      const guarded = () => marks()?.protectedSegments.has(area.id) === true
                      return (
                        <polygon
                          class="district"
                          classList={{ protected: guarded() }}
                          points={toPoints(area.polygon)}
                          style={
                            guarded()
                              ? { 'stroke-width': `${px(2)}` }
                              : { 'stroke-width': `${px(1)}`, 'stroke-dasharray': `${px(4)} ${px(4)}` }
                          }
                        />
                      )
                    }}
                  </For>
                </g>
                <g class="routes" aria-hidden="true">
                  <For each={layered()}>
                    {(route) => {
                      const rv = createMemo(() => routeView(route))
                      const parts = createMemo(() => {
                        const v = rv()
                        if (v.state !== 'blocked') return { head: route.points, tail: null, stop: 0 }
                        const stop = stopFraction(route, v)
                        const [head, tail] = splitAt(route.points, stop)
                        return { head, tail, stop }
                      })
                      const tipInk = (): Ink => (parts().tail === null ? inkOf(rv()) : 'idle')
                      return (
                        <g class={`route route-${rv().state}`} classList={{ current: rv().current }}>
                          <Show
                            when={parts().tail}
                            fallback={
                              <polyline class={`route-line ink-${inkOf(rv())}`} points={toPoints(trimEnd(route.points, px(5)))} style={width(inkOf(rv()))} />
                            }
                          >
                            {(tail) => (
                              <>
                                <polyline class="route-line ink-idle" points={toPoints(trimEnd(tail(), px(5)))} style={width('idle')} />
                                <polyline class={`route-line ink-${inkOf(rv())}`} points={toPoints(parts().head)} style={width(inkOf(rv()))} />
                                <polyline class="tick" points={tick(route.points, parts().stop)} style={{ 'stroke-width': `${px(3)}` }} />
                              </>
                            )}
                          </Show>
                          <polygon class={`arrowhead ink-${tipInk()}`} points={arrowhead(route.points)} />
                        </g>
                      )
                    }}
                  </For>
                </g>
                <g class="nodes">
                  <For each={s().assets}>
                    {(asset) => {
                      const shape = s().shapes.get(asset.id)!
                      const status = () => shownStatus(asset.id)
                      const isCurrent = () => currentTarget() === asset.id
                      const isSelected = () => store.selectedHost() === asset.id
                      return (
                        <g
                          class={`node node-${shape.silhouette}`}
                          classList={{
                            compromised: status() === 'compromised',
                            saved: status() === 'saved',
                            current: isCurrent(),
                            selected: isSelected(),
                          }}
                          role="button"
                          tabindex="0"
                          aria-pressed={isSelected()}
                          aria-label={`${asset.label}, ${asset.kind}${status() ? `, ${STATUS_WORDS[status()!]}` : ''}`}
                          onClick={() => store.selectHost(asset.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              store.selectHost(asset.id)
                            }
                          }}
                        >
                          <For each={shape.faces}>{(face) => <polygon class={`face face-${face.kind}`} points={toPoints(face.points)} />}</For>
                          <For each={shape.racks}>{(rack) => <polyline class="rack" points={toPoints(rack)} />}</For>
                          <For each={shape.monitor}>
                            {(face) => <polygon class={`monitor monitor-${face.kind}`} points={toPoints(face.points)} />}
                          </For>
                          <Show when={shape.screen.length > 0}>
                            <polygon class="screen" points={toPoints(shape.screen)} />
                          </Show>
                          <Show when={isSelected()}>
                            <polygon class="ring ring-selected" points={toPoints(expand(shape.hull, px(6)))} style={{ 'stroke-width': `${px(2)}` }} />
                          </Show>
                          <Show when={isCurrent()}>
                            <polygon
                              class="ring ring-current"
                              points={toPoints(expand(shape.hull, px(8)))}
                              style={{ 'stroke-width': `${px(1.6)}`, 'stroke-dasharray': `${px(4)} ${px(3)}` }}
                            />
                          </Show>
                        </g>
                      )
                    }}
                  </For>
                </g>
              </svg>

              <div class="map-overlay" aria-hidden="true">
                <For each={s().areas}>
                  {(area) => (
                    <span
                      class="district-label"
                      classList={{ protected: marks()?.protectedSegments.has(area.id) === true }}
                      style={{ left: `${toScreen(area.labelAt).x}px`, top: `${toScreen(area.labelAt).y}px` }}
                    >
                      {area.label}
                      <Show when={marks()?.protectedSegments.has(area.id)}>
                        <LockIcon />
                      </Show>
                    </span>
                  )}
                </For>
                <For each={s().assets}>
                  {(asset) => (
                    <Show when={marks()?.patchedHosts.has(asset.id)}>
                      {(() => {
                        const hull = bounds(s().shapes.get(asset.id)!.hull)
                        const at = () => toScreen({ x: hull.minX, y: hull.minY })
                        return (
                          <span class="map-badge badge-shield" style={{ left: `${at().x}px`, top: `${at().y}px` }}>
                            <ShieldIcon />
                          </span>
                        )
                      })()}
                    </Show>
                  )}
                </For>
                <For each={s().routes}>
                  {(route) => (
                    <Show when={marks()?.lockedLinks.has(route.linkId)}>
                      <span
                        class="map-badge badge-lock"
                        style={{ left: `${toScreen(pointAt(route.points, 0.5).point).x}px`, top: `${toScreen(pointAt(route.points, 0.5).point).y}px` }}
                      >
                        <LockIcon />
                      </span>
                    </Show>
                  )}
                </For>
                <For each={s().assets}>
                  {(asset) => {
                    const shape = s().shapes.get(asset.id)!
                    const side = () => sideOf(asset.id)
                    const status = () => shownStatus(asset.id)
                    const markers = () => [...(command() ? [asset.id] : []), ...s().markers.get(asset.id)!].join(' · ')
                    const position = () => {
                      const c = toScreen(shape.anchor)
                      const { halfW, halfH, lift } = labelBox(shape.anchor, bounds(shape.hull), transform().scale)
                      if (side() === 'right') return { left: `${c.x + halfW}px`, top: `${c.y - lift}px` }
                      if (side() === 'left') return { left: `${c.x - halfW}px`, top: `${c.y}px` }
                      if (side() === 'top') return { left: `${c.x}px`, top: `${c.y - halfH}px` }
                      return { left: `${c.x}px`, top: `${c.y + halfH}px` }
                    }
                    return (
                      <div class={`node-label side-${side()}`} classList={{ selected: store.selectedHost() === asset.id }} style={position()}>
                        <span class="nl-name">{asset.label}</span>
                        <Show when={markers() !== ''}>
                          <span class="nl-sub">{markers()}</span>
                        </Show>
                        <Show when={status()}>
                          {(st) => <span class={`nl-status status-${st()}`}>{STATUS_WORDS[st()]}</span>}
                        </Show>
                      </div>
                    )
                  }}
                </For>
                <For each={s().routes}>
                  {(route) => {
                    const rv = createMemo(() => routeView(route))
                    const at = (p: Point) => ({ left: `${toScreen(p).x}px`, top: `${toScreen(p).y}px` })
                    return (
                      <>
                        <Show when={rv().state === 'indeterminate'}>
                          <span class="route-badge" style={at(badgeAt(route))}>
                            ?
                          </span>
                        </Show>
                        <Show when={rv().current && rv().capability}>
                          {(capability) => (
                            <span class="route-chip" style={at(pointAt(route.points, chipFraction(route, rv())).point)}>
                              {capabilityChip(capability())}
                              {command() ? ` · ${route.linkId}` : ''}
                            </span>
                          )}
                        </Show>
                      </>
                    )
                  }}
                </For>
              </div>
            </>
          )}
        </Show>

        <div class="map-tools" aria-label="Camera">
          <button type="button" class="icon-button" aria-label="Zoom in" onClick={() => zoomBy(0.8)}>
            <PlusIcon />
          </button>
          <button type="button" class="icon-button" aria-label="Zoom out" onClick={() => zoomBy(1.25)}>
            <MinusIcon />
          </button>
          <button type="button" class="icon-button" aria-label="Fit network" onClick={fit}>
            <FitIcon />
          </button>
        </div>
      </div>

      <footer class="map-legend" aria-label="Legend">
        <span class="legend-item">
          <span class="lg-swatch" />
          compromised
        </span>
        <span class="legend-item">
          <span class="lg-line lg-spread" />
          spread
        </span>
        <span class="legend-item">
          <span class="lg-line lg-current" />
          current step
        </span>
        <span class="legend-item">
          <span class="lg-line lg-tried">
            <span class="lg-tick" />
          </span>
          tried and stopped
        </span>
        <span class="legend-item">
          <span class="lg-badge">?</span>
          outcome unknown
        </span>
        <span class="legend-item">
          <span class="lg-line lg-idle" />
          not tried
        </span>
        <Show when={store.defense()}>
          {(applied) => (
            <>
              <span class="legend-item">
                <span class={`lg-defense lg-${applied().option.kind}`}>
                  <Show when={applied().option.kind === 'patch'}>
                    <ShieldIcon size={12} />
                  </Show>
                  <Show when={applied().option.kind === 'link'}>
                    <LockIcon size={11} />
                  </Show>
                </span>
                {DEFENSE_LEGEND[applied().option.kind]}
              </span>
              <span class="legend-item">
                <span class="lg-swatch lg-saved" />
                saved by your defense
              </span>
            </>
          )}
        </Show>
      </footer>
    </section>
  )
}
