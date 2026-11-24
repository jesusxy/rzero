import { describe, expect, test } from 'bun:test'
import { importScenario, type CompiledScenario } from '../../src/core'
import { computeLayout, FOOTPRINT, type DistrictBox, type GridPosition, type MapLayout } from '../../src/app/layout'
import { compileLab } from '../core/engine-helpers'
import { expectCompiled, fixtureText } from '../core/helpers'

const fixture = (file: string) => expectCompiled(importScenario(fixtureText(file), { fileName: file }))
const layoutOf = (compiled: CompiledScenario) => computeLayout(compiled.effective.network, compiled.effective.initial_asset_id)

const SCENARIOS = {
  '001': fixture('001-five-node-baseline.json'),
  '002': fixture('002-counterfactual-segmentation.json'),
  wannacry: fixture('wannacry-small-office.json'),
} as const

const overlap = (a: DistrictBox, b: DistrictBox) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

function segmentHitsSquare(a: GridPosition, b: GridPosition, center: GridPosition, half: number): boolean {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
  return lo.x <= center.x + half && hi.x >= center.x - half && lo.y <= center.y + half && hi.y >= center.y - half
}

function routeProblems(layout: MapLayout): string[] {
  const problems: string[] = []
  for (const route of layout.routes) {
    if (route.points.length > 4) problems.push(`${route.linkId}: more than two turns`)
    for (let i = 1; i < route.points.length; i += 1) {
      const a = route.points[i - 1]!
      const b = route.points[i]!
      if (a.x !== b.x && a.y !== b.y) problems.push(`${route.linkId}: diagonal segment`)
      for (const [id, cell] of layout.cells) {
        if (id === route.source || id === route.target) continue
        if (segmentHitsSquare(a, b, cell, FOOTPRINT)) problems.push(`${route.linkId}: passes through ${id}`)
      }
    }
  }
  return problems
}

describe('map layout: districts', () => {
  test('001 has one district; 002 has two, workstations first', () => {
    expect(layoutOf(SCENARIOS['001']).districts.map((d) => d.id)).toEqual(['lab'])
    expect(layoutOf(SCENARIOS['002']).districts.map((d) => d.id)).toEqual(['workstations', 'servers'])
  })

  test('the WannaCry office: Office then Servers, and the districts never overlap', () => {
    const layout = layoutOf(SCENARIOS.wannacry)
    expect(layout.districts.map((d) => d.label)).toEqual(['Office', 'Servers'])
    const [office, servers] = layout.districts
    expect(overlap(office!, servers!)).toBe(false)
    expect(office!.maxX).toBeLessThan(servers!.minX)
  })

  test('every host sits inside its own district only', () => {
    for (const compiled of Object.values(SCENARIOS)) {
      const layout = layoutOf(compiled)
      for (const asset of compiled.effective.network.assets) {
        const cell = layout.cells.get(asset.id)!
        const inside = layout.districts.filter((d) => d.minX < cell.x && cell.x < d.maxX && d.minY < cell.y && cell.y < d.maxY)
        expect(inside.map((d) => d.id)).toEqual([asset.segment_id])
      }
    }
  })
})

describe('map layout: flow order', () => {
  test('hosts sit on integer cells, and hop distance runs along x', () => {
    const cells = layoutOf(SCENARIOS.wannacry).cells
    for (const cell of cells.values()) expect([Number.isInteger(cell.x), Number.isInteger(cell.y)]).toEqual([true, true])
    const x = (id: string) => cells.get(id)!.x
    expect(x('ws01')).toBeLessThan(x('ws02'))
    expect(new Set(['ws02', 'ws03', 'ws04'].map(x)).size).toBe(1)
    expect(new Set(['fs01', 'dc01'].map(x)).size).toBe(1)
    expect(x('ws02')).toBeLessThan(x('fs01'))
    expect(x('fs01')).toBeLessThan(x('nas01'))
  })

  test('the child that leads on stays in line with its parent; siblings spread around it', () => {
    const cells = layoutOf(SCENARIOS.wannacry).cells
    const y = (id: string) => cells.get(id)!.y
    expect(y('ws02')).toBe(y('ws01'))
    expect(y('ws03')).toBeLessThan(y('ws02'))
    expect(y('ws04')).toBeGreaterThan(y('ws02'))
    expect(y('fs01')).toBeLessThan(y('dc01'))
    expect(y('nas01')).toBe(y('fs01'))
  })

  test('the layout uses only the static network: a defense does not move anything', () => {
    const base = layoutOf(SCENARIOS.wannacry)
    const defended = layoutOf(fixture('wannacry-small-office-segmented.json'))
    expect(defended).toEqual(base)
    expect(layoutOf(SCENARIOS['002']).cells).toEqual(layoutOf(SCENARIOS['001']).cells)
  })
})

describe('map layout: routes follow the grid', () => {
  test.each(Object.keys(SCENARIOS))('%s: no diagonal segment, at most two turns, no route through another host', (key) => {
    expect(routeProblems(layoutOf(SCENARIOS[key as keyof typeof SCENARIOS]))).toEqual([])
  })

  test('routes from one source share a trunk; different sources get their own channel', () => {
    const routes = new Map(layoutOf(SCENARIOS.wannacry).routes.map((r) => [r.linkId, r.points]))
    const trunk = (id: string) => routes.get(id)!.slice(0, 2)
    expect(trunk('ws01-ws03')).toEqual(trunk('ws01-ws04'))
    expect(trunk('ws02-fs01')).toEqual(trunk('ws02-dc01'))
    expect(routes.get('ws02-fs01')![1]!.x).not.toBe(routes.get('ws03-fs01')![1]!.x)
    expect(routes.get('ws02-fs01')!.at(-1)).not.toEqual(routes.get('ws03-fs01')!.at(-1))
    expect(routes.get('ws01-ws02')).toEqual([{ x: 0, y: 0 }, { x: 13, y: 0 }])
  })
})

describe('map layout: stress', () => {
  let state = 7
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const ids = Array.from({ length: 20 }, (_, i) => `h${String(i).padStart(2, '0')}`)
  const links = ids.slice(1).map((id, i) => ({ id: `t${i}`, source: ids[Math.floor(random() * (i + 1))]!, target: id }))
  for (let i = 0; i < 12; i += 1) {
    const source = ids[Math.floor(random() * 20)]!
    const target = ids[Math.floor(random() * 20)]!
    const exists = links.some((link) => link.source === source && link.target === target)
    if (source !== target && !exists) links.push({ id: `x${i}`, source, target })
  }
  const compiled = compileLab({
    seed: 'h00',
    segments: [0, 1, 2, 3].map((n) => ({ id: `s${n}`, label: `Segment ${n}` })),
    assets: Object.fromEntries(ids.map((id, i) => [id, { segment_id: `s${i % 4}` }])),
    links,
  })
  const layout = layoutOf(compiled)

  test('20 hosts in 4 segments: no two hosts overlap and no districts overlap', () => {
    const cells = [...layout.cells.entries()]
    expect(cells.length).toBe(20)
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const [a, b] = [cells[i]![1], cells[j]![1]]
        const apart = Math.abs(a.x - b.x) > 2 * FOOTPRINT || Math.abs(a.y - b.y) > 2 * FOOTPRINT
        expect(apart).toBe(true)
      }
    }
    expect(layout.districts.length).toBe(4)
    for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) expect(overlap(layout.districts[i]!, layout.districts[j]!)).toBe(false)
  })

  test('every route is still made of grid-aligned segments with at most two turns', () => {
    const shape = routeProblems(layout).filter((problem) => !problem.includes('passes through'))
    expect(shape).toEqual([])
  })

  test('deterministic, whatever order the input lists hosts and links in', () => {
    const network = compiled.effective.network
    const shuffled = { ...network, assets: [...network.assets].reverse(), links: [...network.links].reverse() }
    expect(computeLayout(shuffled, 'h00')).toEqual(layout)
  })
})
