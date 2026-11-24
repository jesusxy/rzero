import type { Asset, Link, Segment } from '../core'

export type GridPosition = { readonly x: number; readonly y: number }

export type DistrictBox = {
  readonly id: string
  readonly label: string
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export type RoutePath = {
  readonly linkId: string
  readonly source: string
  readonly target: string
  readonly points: readonly GridPosition[]
}

export type MapLayout = {
  readonly cells: ReadonlyMap<string, GridPosition>
  readonly districts: readonly DistrictBox[]
  readonly routes: readonly RoutePath[]
}

export type StaticNetwork = {
  readonly segments: readonly Segment[]
  readonly assets: readonly Asset[]
  readonly links: readonly Link[]
}

export const CELL = 1.25
export const FOOTPRINT = 1.5

const SIBLING_GAP = 10
const COLUMN_GAP = 13
const LANE_MARGIN = 4
const STREET_MIN = 4
const PAD = { before: 4, after: 5, top: 5, bottom: 4 }
const CLEARANCE = FOOTPRINT + 2
const MAX_SEARCH = 6

export const EMPTY_LAYOUT: MapLayout = { cells: new Map(), districts: [], routes: [] }

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

type Column = { readonly index: number; readonly district: number; readonly hop: number; readonly members: readonly string[] }
type Draft = { readonly link: Link; readonly street: number }

function flow(network: StaticNetwork, seedId: string | undefined) {
  const ids = network.assets.map((asset) => asset.id).sort(byText)
  const known = new Set(ids)
  const outgoing = new Map<string, Link[]>(ids.map((id) => [id, []]))
  for (const link of network.links) {
    if (known.has(link.source_id) && known.has(link.target_id) && link.source_id !== link.target_id) {
      outgoing.get(link.source_id)!.push(link)
    }
  }
  for (const list of outgoing.values()) list.sort((a, b) => byText(a.target_id, b.target_id) || byText(a.id, b.id))
  const root = seedId !== undefined && known.has(seedId) ? seedId : ids[0]
  const hop = new Map<string, number>()
  const parent = new Map<string, string>()
  const order: string[] = []
  if (root !== undefined) {
    hop.set(root, 0)
    order.push(root)
  }
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!
    for (const link of outgoing.get(id)!) {
      if (hop.has(link.target_id)) continue
      hop.set(link.target_id, hop.get(id)! + 1)
      parent.set(link.target_id, id)
      order.push(link.target_id)
    }
  }
  const deepest = Math.max(0, ...hop.values())
  for (const id of ids) if (!hop.has(id)) hop.set(id, deepest + 1)
  const weight = new Map(ids.map((id) => [id, 0]))
  for (const id of [...order].reverse()) {
    const p = parent.get(id)
    if (p !== undefined) weight.set(p, weight.get(p)! + weight.get(id)! + 1)
  }
  return { root, hop, parent, weight }
}

function centerOut(count: number): number[] {
  const mid = Math.floor((count - 1) / 2)
  const slots = [mid]
  for (let d = 1; slots.length < count; d += 1) {
    if (mid - d >= 0) slots.push(mid - d)
    if (mid + d < count) slots.push(mid + d)
  }
  return slots
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
}

function simplify(points: GridPosition[]): GridPosition[] {
  const unique = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true
    const a = unique[i - 1]!
    const b = unique[i + 1]!
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y))
  })
}

export function computeLayout(network: StaticNetwork, seedId?: string): MapLayout {
  const assets = network.assets
  if (assets.length === 0) return EMPTY_LAYOUT
  const { root, hop, parent, weight } = flow(network, seedId)

  const seedSegment = assets.find((asset) => asset.id === root)?.segment_id
  const minHop = (segment: string) => Math.min(...assets.filter((a) => a.segment_id === segment).map((a) => hop.get(a.id)!))
  const segments = [...new Set(assets.map((asset) => asset.segment_id))].sort(
    (a, b) => Number(b === seedSegment) - Number(a === seedSegment) || minHop(a) - minHop(b) || byText(a, b),
  )

  const columns: Column[] = []
  const columnOf = new Map<string, number>()
  segments.forEach((segment, district) => {
    const members = assets.filter((asset) => asset.segment_id === segment)
    for (const h of [...new Set(members.map((asset) => hop.get(asset.id)!))].sort((a, b) => a - b)) {
      const column: Column = {
        index: columns.length,
        district,
        hop: h,
        members: members.filter((asset) => hop.get(asset.id) === h).map((asset) => asset.id).sort(byText),
      }
      columns.push(column)
      for (const id of column.members) columnOf.set(id, column.index)
    }
  })

  const row = new Map<string, number>()
  for (const column of [...columns].sort((a, b) => a.hop - b.hop || a.district - b.district)) {
    const desired = new Map<string, number>()
    const families = new Map<string, string[]>()
    for (const id of column.members) {
      const p = parent.get(id)
      const key = p !== undefined && row.has(p) ? p : ''
      families.set(key, [...(families.get(key) ?? []), id])
    }
    for (const [key, children] of families) {
      children.sort((a, b) => weight.get(b)! - weight.get(a)! || byText(a, b))
      const slots = centerOut(children.length)
      const base = key === '' ? 0 : row.get(key)!
      children.forEach((id, k) => desired.set(id, base + (slots[k]! - (children.length - 1) / 2) * SIBLING_GAP))
    }
    const ordered = [...column.members].sort((a, b) => desired.get(a)! - desired.get(b)! || byText(a, b))
    const placed: number[] = []
    ordered.forEach((id, i) => placed.push(i === 0 ? desired.get(id)! : Math.max(desired.get(id)!, placed[i - 1]! + SIBLING_GAP)))
    const shift = Math.round(ordered.reduce((sum, id, i) => sum + desired.get(id)! - placed[i]!, 0) / ordered.length)
    ordered.forEach((id, i) => row.set(id, Math.round(placed[i]! + shift)))
  }

  const total = columns.length
  const between = (column: number, street: number) =>
    street > column ? range(street - column - 1).map((i) => column + 1 + i) : range(column - street).map((i) => street + i)
  const hits = (crossed: readonly number[], at: number, skip: readonly string[], clearance: number) =>
    crossed.reduce(
      (n, c) => n + columns[c]!.members.filter((id) => !skip.includes(id) && Math.abs(row.get(id)! - at) < clearance).length,
      0,
    )

  const links = network.links
    .filter((link) => columnOf.has(link.source_id) && columnOf.has(link.target_id) && link.source_id !== link.target_id)
    .sort((a, b) => byText(a.id, b.id))
  const drafts: Draft[] = links.map((link) => {
    const cs = columnOf.get(link.source_id)!
    const ct = columnOf.get(link.target_id)!
    const candidates =
      ct > cs ? range(ct - cs).map((i) => cs + 1 + i) : ct === cs ? [cs + 1, cs] : range(cs - ct).map((i) => cs - i)
    const skip = [link.source_id, link.target_id]
    let best = candidates[0]!
    let bestHits = Infinity
    for (const street of candidates) {
      const n =
        hits(between(cs, street), row.get(link.source_id)!, skip, CLEARANCE) +
        hits(between(ct, street), row.get(link.target_id)!, skip, CLEARANCE + 1)
      if (n < bestHits) {
        best = street
        bestHits = n
      }
    }
    return { link, street: best }
  })

  const lanesOf = new Map<number, string[]>()
  for (let street = 0; street <= total; street += 1) {
    const inStreet = drafts.filter((d) => d.street === street)
    if (inStreet.length === 0) continue
    const sources = [...new Set(inStreet.map((d) => d.link.source_id))].sort(
      (a, b) => row.get(a)! - row.get(b)! || byText(a, b),
    )
    const span = new Map(
      sources.map((s) => {
        const rows = [row.get(s)!, ...inStreet.filter((d) => d.link.source_id === s).map((d) => row.get(d.link.target_id)!)]
        return [s, [Math.min(...rows), Math.max(...rows)] as const]
      }),
    )
    const crossings = (order: readonly string[]) => {
      let count = 0
      const passes = (lane: number, toward: 'left' | 'right', at: number) => {
        const others = toward === 'left' ? range(lane) : range(order.length - lane - 1).map((i) => lane + 1 + i)
        for (const j of others) {
          const [lo, hi] = span.get(order[j]!)!
          if (lo <= at && at <= hi) count += 1
        }
      }
      order.forEach((s, lane) => {
        passes(lane, columnOf.get(s)! < street ? 'left' : 'right', row.get(s)!)
        for (const d of inStreet.filter((entry) => entry.link.source_id === s)) {
          passes(lane, columnOf.get(d.link.target_id)! < street ? 'left' : 'right', row.get(d.link.target_id)!)
        }
      })
      return count
    }
    let order = sources
    if (sources.length > 1 && sources.length <= MAX_SEARCH) {
      let fewest = Infinity
      for (const candidate of permutations(sources)) {
        const n = crossings(candidate)
        if (n < fewest) {
          fewest = n
          order = candidate
        }
      }
    }
    lanesOf.set(street, order)
  }

  const xs: number[] = []
  columns.forEach((column, c) => {
    if (c === 0) {
      xs.push(0)
      return
    }
    const lanes = lanesOf.get(c)?.length ?? 0
    const gap =
      columns[c - 1]!.district === column.district
        ? Math.max(COLUMN_GAP, lanes - 1 + 2 * LANE_MARGIN)
        : PAD.after + Math.max(STREET_MIN, lanes + 1) + PAD.before
    xs.push(xs[c - 1]! + gap)
  })

  const laneX = new Map<string, number>()
  for (const [street, order] of lanesOf) {
    const n = order.length
    let start: number
    if (street === 0) start = xs[0]! - LANE_MARGIN - (n - 1)
    else if (street === total) start = xs[total - 1]! + LANE_MARGIN
    else {
      const same = columns[street - 1]!.district === columns[street]!.district
      const lo = same ? xs[street - 1]! + LANE_MARGIN : xs[street - 1]! + PAD.after + 1
      const hi = same ? xs[street]! - LANE_MARGIN : xs[street]! - PAD.before - 1
      start = Math.floor((lo + hi - (n - 1)) / 2)
    }
    order.forEach((source, i) => laneX.set(`${street}:${source}`, start + i))
  }

  const cells = new Map<string, GridPosition>()
  for (const asset of assets) cells.set(asset.id, { x: xs[columnOf.get(asset.id)!]!, y: row.get(asset.id)! })

  const entry = new Map<string, number>()
  const incoming = new Map<string, Draft[]>()
  for (const d of drafts) {
    const key = `${d.link.target_id}:${d.street <= columnOf.get(d.link.target_id)! ? 'before' : 'after'}`
    incoming.set(key, [...(incoming.get(key) ?? []), d])
  }
  for (const group of incoming.values()) {
    const keyed = group.map((d) => {
      const target = cells.get(d.link.target_id)!
      const lane = laneX.get(`${d.street}:${d.link.source_id}`)!
      const dir = Math.sign(row.get(d.link.source_id)! - target.y)
      return { d, dir, distance: Math.abs(lane - target.x) }
    })
    keyed.sort(
      (a, b) =>
        a.dir - b.dir ||
        (a.dir < 0 ? a.distance - b.distance : b.distance - a.distance) ||
        byText(a.d.link.id, b.d.link.id),
    )
    const offsets = keyed.length === 1 ? [0] : keyed.length === 2 ? [-1, 1] : [-1, 0, 1]
    keyed.forEach((k, i) => entry.set(k.d.link.id, offsets[Math.min(i, offsets.length - 1)]!))
  }

  const routes: RoutePath[] = drafts.map((d) => {
    const s = cells.get(d.link.source_id)!
    const t = cells.get(d.link.target_id)!
    const lane = laneX.get(`${d.street}:${d.link.source_id}`)!
    const ty = t.y + entry.get(d.link.id)!
    return {
      linkId: d.link.id,
      source: d.link.source_id,
      target: d.link.target_id,
      points: simplify([s, { x: lane, y: s.y }, { x: lane, y: ty }, { x: t.x, y: ty }]),
    }
  })

  const outer = (street: number) => lanesOf.get(street)?.length ?? 0
  const labels = new Map(network.segments.map((segment) => [segment.id, segment.label]))
  const districts: DistrictBox[] = segments.map((segment, district) => {
    const own = columns.filter((column) => column.district === district)
    const first = own[0]!.index
    const last = own[own.length - 1]!.index
    const ys = own.flatMap((column) => column.members.map((id) => row.get(id)!))
    return {
      id: segment,
      label: labels.get(segment) || segment,
      minX: xs[first]! - PAD.before - (first === 0 && outer(0) > 0 ? outer(0) + 1 : 0),
      maxX: xs[last]! + PAD.after + (last === total - 1 && outer(total) > 0 ? outer(total) : 0),
      minY: Math.min(...ys) - PAD.top,
      maxY: Math.max(...ys) + PAD.bottom,
    }
  })

  return { cells, districts, routes }
}
