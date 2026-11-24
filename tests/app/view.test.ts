import { describe, expect, test } from 'bun:test'
import { groupSteps, importScenario, runScenario, seekReplay } from '../../src/core'
import { backCursor, hostStatus, isStepComplete, latestAttemptByLink, metrics, nextCursor, stepIndexAt } from '../../src/app/view'
import { fractionAt, insideHull, labelSide, nodeShape, pointAt, routeGeometry, splitAt, toScene, trimEnd, type Point } from '../../src/app/scene'
import { computeLayout } from '../../src/app/layout'
import { expectCompiled, fixtureText } from '../core/helpers'

const compiled = expectCompiled(importScenario(fixtureText('001-five-node-baseline.json')))
const run = runScenario(compiled)
const steps = groupSteps(run.events)

describe('one cursor: step position and navigation (001)', () => {
  // Steps: seed [0,2), A→B [2,6), A→C [6,9), B→D [9,13), D→E [13,16), summary [16,17).
  test('the current step is the one whose range holds the last applied event', () => {
    expect(stepIndexAt(steps, 0)).toBe(-1)
    expect([1, 2, 3, 6, 7, 9, 16, 17].map((c) => stepIndexAt(steps, c))).toEqual([0, 0, 1, 1, 2, 2, 4, 5])
    expect([2, 3, 6, 9, 17].map((c) => isStepComplete(steps, c))).toEqual([true, false, true, true, true])
  })

  test('Next completes a step in progress, otherwise moves to the next step end', () => {
    expect(nextCursor(steps, 0)).toBe(2)
    expect(nextCursor(steps, 3)).toBe(6)
    expect(nextCursor(steps, 6)).toBe(9)
    expect(nextCursor(steps, 17)).toBe(17)
  })

  test('Back moves to the previous step end and stays on the first step', () => {
    expect(backCursor(steps, 9)).toBe(6)
    expect(backCursor(steps, 7)).toBe(6)
    expect(backCursor(steps, 2)).toBe(2)
    expect(backCursor(steps, 0)).toBe(0)
  })
})

describe('host status, routes and metrics at a step', () => {
  test('after the blocked A→C step', () => {
    const replay = seekReplay(run.events, 9)
    expect(['A', 'B', 'C', 'D', 'E'].map((id) => hostStatus(replay, id))).toEqual(['compromised', 'compromised', 'blocked', null, null])
    const ledger = latestAttemptByLink(replay)
    expect([...ledger.entries()].map(([link, a]) => [link, a.status])).toEqual([
      ['ab', 'succeeded'],
      ['ac', 'blocked'],
    ])
    expect(metrics(compiled, replay)).toEqual({ total: 5, compromised: 2, blocked: 1, unknown: 0, blastRadius: 0.4 })
  })
})

describe('map geometry', () => {
  const layout = computeLayout(compiled.effective.network, compiled.effective.initial_asset_id)
  const shapes = new Map(compiled.effective.network.assets.map((a) => [a.id, nodeShape(a, toScene(layout.cells.get(a.id)!))]))
  const routes = layout.routes.map((r) => routeGeometry(r, shapes)!)
  const route = (id: string) => routes.find((r) => r.linkId === id)!

  test('workstations are low slabs with a monitor; servers are tall boxes with rack lines', () => {
    expect(shapes.get('A')!.silhouette).toBe('workstation')
    expect(shapes.get('A')!.monitor.length).toBe(3)
    expect(shapes.get('D')!.silhouette).toBe('server')
    expect(shapes.get('D')!.racks.length).toBeGreaterThan(0)
  })

  test('routes are trimmed to the silhouettes of both nodes and keep their grid corners', () => {
    const ab = route('ab')
    const [start, end] = [ab.points[0]!, ab.points.at(-1)!]
    expect(insideHull(start, shapes.get('A')!.hull)).toBe(true) // on the boundary
    expect(insideHull(end, shapes.get('B')!.hull)).toBe(true)
    expect(insideHull(pointAt(ab.points, 0.5).point, shapes.get('A')!.hull)).toBe(false)
    expect(ab.corners.length).toBe(2)
    expect(ab.points.length).toBe(4)
    const [first, last] = ab.corners.map((corner) => fractionAt(ab.points, corner))
    expect(0 < first! && first! < last! && last! < 1).toBe(true)
    expect(route('bd').corners).toEqual([])
    expect(route('bd').entry).toBeNull()
  })

  test('path helpers split and trim by length', () => {
    const line: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(splitAt(line, 0.7)[0].at(-1)).toEqual({ x: 7, y: 0 })
    expect(trimEnd(line, 2).at(-1)).toEqual({ x: 8, y: 0 })
    expect(pointAt(line, 0.25).point).toEqual({ x: 2.5, y: 0 })
    expect(fractionAt([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { x: 10, y: 5 })).toBe(0.75)
  })

  test('compact labels go above or below, away from routes', () => {
    expect(labelSide('A', shapes.get('A')!.anchor, routes, ['bottom', 'top'])).toBe('top') // A's trunk leaves down-right
  })
})
