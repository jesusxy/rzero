import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js'
import type { AttemptView, Capability } from '../core'
import type { SimulationStore } from '../app/store'
import { blockTag, capabilityChip, platformName, primaryCheck } from '../app/narration'
import {
  bounds,
  districts,
  expand,
  gridLines,
  labelSide,
  nodeShape,
  pointAt,
  routeGeometry,
  splitAt,
  toPoints,
  trimEnd,
  type Point,
  type RouteGeometry,
} from '../app/scene'
import { hostStatus, latestAttemptByLink, routeState, type HostStatus, type RouteState } from '../app/view'
import { FitIcon, MinusIcon, PlusIcon } from './icons'

type View = { x: number; y: number; w: number; h: number }

const STATUS_WORDS: Record<Exclude<HostStatus, null>, string> = {
  compromised: 'Compromised',
  blocked: 'Attempt blocked',
  unknown: 'Unknown',
}

const BARRIER_AT = 0.7
const CHIP_REST = { blocked: 0.32, other: 0.5 }

export function MapStage(props: { store: SimulationStore }) {
  const store = props.store
  const command = () => store.mode() === 'command'

  const scene = createMemo(() => {
    const compiled = store.compiled()
    if (compiled === null) return null
    const layout = store.layout()
    const network = compiled.effective.network
    const shapes = new Map(network.assets.map((asset) => [asset.id, nodeShape(asset, layout.get(asset.id) ?? { x: 15, y: 15 })]))
    const routes = network.links.flatMap((link) => {
      const route = routeGeometry(link, shapes)
      return route === null ? [] : [route]
    })
    const areas = districts(network.assets, layout, network.segments)
    const box = bounds([...[...shapes.values()].flatMap((shape) => shape.hull), ...areas.map((area) => area.labelAt)])
    return {
      assets: [...network.assets].sort((a, b) => shapes.get(a.id)!.anchor.y - shapes.get(b.id)!.anchor.y),
      shapes,
      routes,
      areas,
      grid: gridLines(layout),
      sides: new Map(network.assets.map((asset) => [asset.id, labelSide(asset.id, shapes.get(asset.id)!.anchor, routes)])),
      compactSides: new Map(
        network.assets.map((asset) => [asset.id, labelSide(asset.id, shapes.get(asset.id)!.anchor, routes, ['bottom', 'top'])]),
      ),
      capabilities: new Map(compiled.effective.profile.capabilities.map((capability) => [capability.id, capability])),
      seed: compiled.effective.initial_asset_id,
      box,
      longestName: Math.max(...network.assets.map((asset) => asset.label.length)),
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
  const sideOf = (id: string) => (compact() ? scene()!.compactSides.get(id)! : scene()!.sides.get(id)!)

  const fitFor = (w: number, h: number): View => {
    const sc = scene()
    if (sc === null || w <= 0 || h <= 0) return { x: 0, y: 0, w: 100, h: 70 }
    const { box } = sc
    const cw = box.maxX - box.minX
    const ch = box.maxY - box.minY
    const statusW = 15 * (compact() ? 6.6 : 7.3)
    const subW = compact() ? 0 : ('Windows · start'.length + (command() ? sc.longestId + 3 : 0)) * 6.6
    const nameW = sc.longestName * (compact() ? 6.9 : 7.8)
    const labelW = Math.max(statusW, subW, nameW)
    const labelH = compact() ? 30 : 48
    let scale = Math.min(w / cw, h / ch)
    let need = { left: 0, right: 0, top: 0, bottom: 0 }
    for (let i = 0; i < 4; i += 1) {
      need = { left: 0, right: 0, top: 0, bottom: 0 }
      for (const asset of sc.assets) {
        const shape = sc.shapes.get(asset.id)!
        const hull = bounds(shape.hull)
        const ax = (shape.anchor.x - box.minX) * scale
        const ay = (shape.anchor.y - box.minY) * scale
        const halfW = ((hull.maxX - hull.minX) / 2) * scale + 16
        const halfH = ((hull.maxY - hull.minY) / 2) * scale + 12
        const side = sideOf(asset.id)
        const rect =
          side === 'right'
            ? { l: ax + halfW, r: ax + halfW + labelW, t: ay - labelH / 2, b: ay + labelH / 2 }
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
      scale = Math.max(0.5, Math.min((w - need.left - need.right - 16) / cw, (h - need.top - need.bottom - 16) / ch))
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
  const upcomingOutcome = (attemptId: string) => {
    for (const event of store.run()?.events ?? []) {
      if (event.type === 'propagation_resolved' && event.attempt_id === attemptId) return event.outcome
    }
    return undefined
  }
  const flowing = () => store.playing() && !store.reducedMotion()

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

  const stroke = (width: number, dash?: [number, number]) => ({
    'stroke-width': `${px(width)}`,
    ...(dash ? { 'stroke-dasharray': `${px(dash[0])} ${px(dash[1])}`, '--dash-cycle': `${-px(dash[0] + dash[1])}` } : {}),
  })
  const arrowhead = (points: readonly Point[]) => {
    const tip = points[points.length - 1]!
    const prev = points[points.length - 2] ?? tip
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1
    const dir = { x: (tip.x - prev.x) / len, y: (tip.y - prev.y) / len }
    const back = { x: tip.x - dir.x * px(10), y: tip.y - dir.y * px(10) }
    const half = px(4.5)
    return toPoints([tip, { x: back.x - dir.y * half, y: back.y + dir.x * half }, { x: back.x + dir.y * half, y: back.y - dir.x * half }])
  }
  const barrier = (route: RouteGeometry) => {
    const { point, direction } = pointAt(route.points, BARRIER_AT)
    const half = px(8)
    return toPoints([
      { x: point.x - direction.y * half, y: point.y + direction.x * half },
      { x: point.x + direction.y * half, y: point.y - direction.x * half },
    ])
  }
  const tagStyle = (route: RouteGeometry) => {
    const { point, direction } = pointAt(route.points, BARRIER_AT)
    const p = toScreen(point)
    const side = { x: -direction.y, y: direction.x }
    const normal = side.y >= 0 ? side : { x: -side.x, y: -side.y }
    return { left: `${p.x + normal.x * 26}px`, top: `${p.y + normal.y * 26}px` }
  }
  const chipFraction = (rv: RouteView) => {
    if (rv.state === 'pending') {
      const outcome = rv.attempt === undefined ? undefined : upcomingOutcome(rv.attempt.attempt_id)
      return store.travel() * (outcome === 'blocked' ? CHIP_REST.blocked : CHIP_REST.other)
    }
    return rv.state === 'blocked' ? CHIP_REST.blocked : CHIP_REST.other
  }

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
                  <For each={s().grid}>{(line) => <polyline class="grid-line" points={toPoints(line)} />}</For>
                </g>
                <g class="districts" aria-hidden="true">
                  <For each={s().areas}>
                    {(area) => <polygon class="district" points={toPoints(area.polygon)} style={stroke(1, [5, 4])} />}
                  </For>
                </g>
                <g class="nodes">
                  <For each={s().assets}>
                    {(asset) => {
                      const shape = s().shapes.get(asset.id)!
                      const status = () => hostStatus(store.replay(), asset.id)
                      const isCurrent = () => currentTarget() === asset.id
                      const isSelected = () => store.selectedHost() === asset.id
                      return (
                        <g
                          class={`node node-${shape.silhouette}`}
                          classList={{ compromised: status() === 'compromised', current: isCurrent(), selected: isSelected() }}
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
                            <polygon class="ring ring-selected" points={toPoints(expand(shape.hull, px(6)))} style={stroke(2)} />
                          </Show>
                          <Show when={isCurrent()}>
                            <polygon class="ring ring-current" points={toPoints(expand(shape.hull, px(9)))} style={stroke(1.6, [5, 4])} />
                          </Show>
                        </g>
                      )
                    }}
                  </For>
                </g>
                <g class="routes" aria-hidden="true">
                  <For each={s().routes}>
                    {(route) => {
                      const rv = createMemo(() => routeView(route))
                      return (
                        <g class={`route route-${rv().state}`} classList={{ current: rv().current, flowing: rv().current && flowing() }}>
                          <Switch>
                            <Match when={rv().state === 'blocked'}>
                              {(() => {
                                const parts = () => splitAt(route.points, BARRIER_AT)
                                return (
                                  <>
                                    <polyline
                                      class="route-line before"
                                      points={toPoints(parts()[0])}
                                      style={rv().current ? stroke(2, [6, 4]) : stroke(1.25)}
                                    />
                                    <polyline class="route-line after" points={toPoints(parts()[1])} style={stroke(1.25, [3, 4])} />
                                    <polyline class="barrier" points={barrier(route)} style={stroke(3.2)} />
                                  </>
                                )
                              })()}
                            </Match>
                            <Match when={true}>
                              <polyline
                                class="route-line"
                                points={toPoints(trimEnd(route.points, px(7)))}
                                style={
                                  rv().state === 'succeeded'
                                    ? stroke(2.6)
                                    : rv().state === 'pending'
                                      ? stroke(2, [6, 4])
                                      : rv().state === 'indeterminate'
                                        ? stroke(2, [5, 4])
                                        : stroke(1.25)
                                }
                              />
                              <polygon class="arrowhead" points={arrowhead(route.points)} />
                            </Match>
                          </Switch>
                        </g>
                      )
                    }}
                  </For>
                </g>
              </svg>

              <div class="map-overlay" aria-hidden="true">
                <For each={s().areas}>
                  {(area) => (
                    <span class="district-label" style={{ left: `${toScreen(area.labelAt).x}px`, top: `${toScreen(area.labelAt).y}px` }}>
                      {area.label}
                    </span>
                  )}
                </For>
                <For each={s().assets}>
                  {(asset) => {
                    const shape = s().shapes.get(asset.id)!
                    const side = () => sideOf(asset.id)
                    const status = () => hostStatus(store.replay(), asset.id)
                    const position = () => {
                      const c = toScreen(shape.anchor)
                      const b = bounds(shape.hull)
                      const scale = transform().scale
                      const halfW = ((b.maxX - b.minX) / 2) * scale + 16
                      const halfH = ((b.maxY - b.minY) / 2) * scale + 12
                      if (side() === 'right') return { left: `${c.x + halfW}px`, top: `${c.y}px` }
                      if (side() === 'left') return { left: `${c.x - halfW}px`, top: `${c.y}px` }
                      if (side() === 'top') return { left: `${c.x}px`, top: `${c.y - halfH}px` }
                      return { left: `${c.x}px`, top: `${c.y + halfH}px` }
                    }
                    return (
                      <div class={`node-label side-${side()}`} classList={{ selected: store.selectedHost() === asset.id }} style={position()}>
                        <span class="nl-name">{asset.label}</span>
                        <span class="nl-sub">
                          {command() ? `${asset.id} · ` : ''}
                          {platformName(asset.platform)}
                          {asset.id === s().seed ? ' · start' : ''}
                        </span>
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
                    const check = () => {
                      const attempt = rv().attempt
                      return attempt === undefined || attempt.status === 'pending' ? undefined : primaryCheck(attempt.checks)
                    }
                    const at = (fraction: number) => toScreen(pointAt(route.points, fraction).point)
                    return (
                      <>
                        <Show when={rv().current && rv().capability}>
                          {(capability) => (
                            <span
                              class="route-chip"
                              style={{ left: `${at(chipFraction(rv())).x}px`, top: `${at(chipFraction(rv())).y}px` }}
                            >
                              {capabilityChip(capability())}
                              {command() ? ` · ${route.linkId}` : ''}
                            </span>
                          )}
                        </Show>
                        <Show when={rv().state === 'blocked' && check()}>
                          {(c) => (
                            <span
                              class="route-tag tag-blocked"
                              classList={{ past: !rv().current }}
                              style={tagStyle(route)}
                            >
                              ✕ {command() ? c().code : blockTag(c())}
                            </span>
                          )}
                        </Show>
                        <Show when={rv().state === 'indeterminate'}>
                          <span class="route-tag tag-unknown" style={{ left: `${at(0.66).x + 12}px`, top: `${at(0.66).y - 16}px` }}>
                            ?{command() && check() ? ` ${check()!.code}` : ''}
                          </span>
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
        <span class="legend-item"><span class="lg-swatch lg-compromised" />compromised</span>
        <span class="legend-item"><span class="lg-line lg-spread" />spread</span>
        <span class="legend-item"><span class="lg-line lg-current" />current attempt</span>
        <span class="legend-item"><span class="lg-bar" />blocked</span>
        <span class="legend-item"><span class="lg-line lg-idle" />not yet tried</span>
        <span class="legend-hint">drag to pan · Enter on a host to inspect</span>
      </footer>
    </section>
  )
}
