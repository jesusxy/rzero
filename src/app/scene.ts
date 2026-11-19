import type { Asset, Link, Segment } from '../core'
import type { GridPosition } from './layout'

export type Point = { readonly x: number; readonly y: number }

export type Silhouette = 'workstation' | 'server' | 'appliance'

export type Face = { readonly kind: 'top' | 'left' | 'right'; readonly points: readonly Point[] }

export type NodeShape = {
  readonly id: string
  readonly silhouette: Silhouette
  readonly anchor: Point
  readonly hull: readonly Point[]
  readonly faces: readonly Face[]
  readonly monitor: readonly Face[]
  readonly screen: readonly Point[]
  readonly racks: readonly (readonly Point[])[]
}

export type District = {
  readonly id: string
  readonly label: string
  readonly polygon: readonly Point[]
  readonly labelAt: Point
}

export type RouteGeometry = {
  readonly linkId: string
  readonly source: string
  readonly target: string
  readonly points: readonly Point[]
}

export type LabelSide = 'right' | 'left' | 'top' | 'bottom'

const PROJECTION = { originX: 50, originY: 8, tileX: 1.55, tileY: 1.02 }

export function project(p: GridPosition): Point {
  return {
    x: PROJECTION.originX + (p.x - p.y) * PROJECTION.tileX,
    y: PROJECTION.originY + (p.x + p.y) * PROJECTION.tileY,
  }
}

const up = (p: Point, h: number): Point => ({ x: p.x, y: p.y - h })
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

function box(cx: number, cy: number, width: number, depth: number, height: number, base = 0) {
  const hw = width / 2
  const hd = depth / 2
  const g = {
    top: up(project({ x: cx - hw, y: cy - hd }), base),
    right: up(project({ x: cx + hw, y: cy - hd }), base),
    bottom: up(project({ x: cx + hw, y: cy + hd }), base),
    left: up(project({ x: cx - hw, y: cy + hd }), base),
  }
  const r = { top: up(g.top, height), right: up(g.right, height), bottom: up(g.bottom, height), left: up(g.left, height) }
  const faces: Face[] = [
    { kind: 'left', points: [g.left, g.bottom, r.bottom, r.left] },
    { kind: 'right', points: [g.bottom, g.right, r.right, r.bottom] },
    { kind: 'top', points: [r.top, r.right, r.bottom, r.left] },
  ]
  return { g, r, faces, hull: [g.left, g.bottom, g.right, r.right, r.top, r.left] }
}

const SIZES: Record<Silhouette, { width: number; depth: number; height: number }> = {
  workstation: { width: 3.7, depth: 2.9, height: 0.95 },
  server: { width: 2.9, depth: 2.9, height: 5.2 },
  appliance: { width: 3, depth: 3, height: 1.5 },
}
const MONITOR = { width: 2.1, depth: 0.28, height: 1.7 }

export function silhouetteOf(kind: Asset['kind']): Silhouette {
  if (kind === 'server' || kind === 'controller') return 'server'
  if (kind === 'workstation') return 'workstation'
  return 'appliance'
}

export function nodeShape(asset: Asset, position: GridPosition): NodeShape {
  const silhouette = silhouetteOf(asset.kind)
  const size = SIZES[silhouette]
  const body = box(position.x, position.y, size.width, size.depth, size.height)
  let monitor: Face[] = []
  let screen: Point[] = []
  let hull = body.hull
  let total = size.height
  if (silhouette === 'workstation') {
    const stand = box(position.x, position.y - 0.6, MONITOR.width, MONITOR.depth, MONITOR.height, size.height)
    monitor = stand.faces
    const front = stand.faces[0]!.points
    const inset = (a: Point, b: Point, c: Point, d: Point) => [lerp(a, c, 0.16), lerp(b, d, 0.16), lerp(c, a, 0.16), lerp(d, b, 0.16)]
    screen = inset(front[0]!, front[1]!, front[2]!, front[3]!)
    total = size.height + MONITOR.height
    hull = box(position.x, position.y, size.width, size.depth, total).hull
  }
  const racks =
    silhouette === 'server'
      ? [0.24, 0.42, 0.6, 0.78].map((t) => [lerp(body.g.bottom, body.r.bottom, t), lerp(body.g.right, body.r.right, t)])
      : []
  const ground = project(position)
  return { id: asset.id, silhouette, anchor: up(ground, total / 2), hull, faces: body.faces, monitor, screen, racks }
}

export function expand(points: readonly Point[], pad: number): Point[] {
  const c = centroid(points)
  return points.map((p) => {
    const d = distance(c, p) || 1
    return { x: p.x + ((p.x - c.x) / d) * pad, y: p.y + ((p.y - c.y) / d) * pad }
  })
}

export function centroid(points: readonly Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

export function bounds(points: readonly Point[]) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

export function districts(
  assets: readonly Asset[],
  layout: ReadonlyMap<string, GridPosition>,
  segments: readonly Segment[],
  margin = 3.6,
): District[] {
  return segments.flatMap((segment) => {
    const members = assets.flatMap((asset) => {
      const p = asset.segment_id === segment.id ? layout.get(asset.id) : undefined
      return p === undefined ? [] : [p]
    })
    if (members.length === 0) return []
    const minX = Math.min(...members.map((p) => p.x)) - margin
    const maxX = Math.max(...members.map((p) => p.x)) + margin
    const minY = Math.min(...members.map((p) => p.y)) - margin
    const maxY = Math.max(...members.map((p) => p.y)) + margin
    const polygon = [
      project({ x: minX, y: minY }),
      project({ x: maxX, y: minY }),
      project({ x: maxX, y: maxY }),
      project({ x: minX, y: maxY }),
    ]
    return [{ id: segment.id, label: segment.label, polygon, labelAt: lerp(polygon[2]!, centroid(polygon), 0.1) }]
  })
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denominator = r.x * s.y - r.y * s.x
  if (Math.abs(denominator) < 1e-9) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

export function exitPoint(from: Point, to: Point, hull: readonly Point[]): Point {
  let best: number | null = null
  hull.forEach((p, i) => {
    const t = segmentIntersection(from, to, p, hull[(i + 1) % hull.length]!)
    if (t !== null && (best === null || t > best)) best = t
  })
  return best === null ? from : lerp(from, to, best)
}

export function routeGeometry(link: Link, shapes: ReadonlyMap<string, NodeShape>): RouteGeometry | null {
  const source = shapes.get(link.source_id)
  const target = shapes.get(link.target_id)
  if (!source || !target) return null
  const start = exitPoint(source.anchor, target.anchor, source.hull)
  const end = exitPoint(target.anchor, source.anchor, target.hull)
  return { linkId: link.id, source: link.source_id, target: link.target_id, points: [start, end] }
}

export function gridLines(layout: ReadonlyMap<string, GridPosition>, margin = 10, step = 3): Point[][] {
  const positions = [...layout.values()]
  if (positions.length === 0) return []
  const minX = Math.min(...positions.map((p) => p.x)) - margin
  const maxX = Math.max(...positions.map((p) => p.x)) + margin
  const minY = Math.min(...positions.map((p) => p.y)) - margin
  const maxY = Math.max(...positions.map((p) => p.y)) + margin
  const lines: Point[][] = []
  for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) lines.push([project({ x, y: minY }), project({ x, y: maxY })])
  for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) lines.push([project({ x: minX, y }), project({ x: maxX, y })])
  return lines
}

export function pathLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!)
  return total
}

export function pointAt(points: readonly Point[], fraction: number): { point: Point; direction: Point } {
  const target = pathLength(points) * Math.max(0, Math.min(1, fraction))
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const segment = distance(a, b)
    if (walked + segment >= target || i === points.length - 1) {
      const t = segment === 0 ? 0 : Math.min(1, (target - walked) / segment)
      return { point: lerp(a, b, t), direction: { x: (b.x - a.x) / (segment || 1), y: (b.y - a.y) / (segment || 1) } }
    }
    walked += segment
  }
  return { point: points[0]!, direction: { x: 1, y: 0 } }
}

export function splitAt(points: readonly Point[], fraction: number): [Point[], Point[]] {
  const target = pathLength(points) * fraction
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const segment = distance(a, b)
    if (walked + segment >= target) {
      const cut = lerp(a, b, segment === 0 ? 0 : (target - walked) / segment)
      return [[...points.slice(0, i), cut], [cut, ...points.slice(i)]]
    }
    walked += segment
  }
  return [[...points], [points[points.length - 1]!]]
}

export function trimEnd(points: readonly Point[], length: number): Point[] {
  const total = pathLength(points)
  return total <= length ? [...points] : splitAt(points, (total - length) / total)[0]
}

const ALL_SIDES: readonly LabelSide[] = ['right', 'left', 'top', 'bottom']

export function labelSide(
  nodeId: string,
  anchor: Point,
  routes: readonly RouteGeometry[],
  allowed: readonly LabelSide[] = ALL_SIDES,
): LabelSide {
  const angles: number[] = []
  for (const route of routes) {
    const pts = route.points
    if (pts.length < 2) continue
    if (route.source === nodeId) angles.push(Math.atan2(pts[1]!.y - anchor.y, pts[1]!.x - anchor.x))
    if (route.target === nodeId) angles.push(Math.atan2(pts[pts.length - 2]!.y - anchor.y, pts[pts.length - 2]!.x - anchor.x))
  }
  const angleOf: Record<LabelSide, number> = { right: 0, left: Math.PI, top: -Math.PI / 2, bottom: Math.PI / 2 }
  const candidates = allowed.map((side): [LabelSide, number] => [side, angleOf[side]])
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b) % (2 * Math.PI)
    return d > Math.PI ? 2 * Math.PI - d : d
  }
  let best: LabelSide = allowed[0] ?? 'right'
  let bestScore = -1
  for (const [side, angle] of candidates) {
    const score = angles.length === 0 ? Math.PI : Math.min(...angles.map((a) => gap(a, angle)))
    if (score > bestScore + 1e-6) {
      best = side
      bestScore = score
    }
  }
  return best
}

export function toPoints(points: readonly Point[]): string {
  return points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')
}
