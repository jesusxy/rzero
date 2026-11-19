import { describe, expect, test } from 'bun:test'
import { groupSteps, importScenario, runScenario, seekReplay } from '../../src/core'
import { backCursor, hostStatus, isStepComplete, latestAttemptByLink, metrics, nextCursor, stepIndexAt } from '../../src/app/view'
import { exitPoint, labelSide, nodeShape, pointAt, routeGeometry, splitAt, trimEnd, type Point } from '../../src/app/scene'
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
  const layout = computeLayout(compiled.effective.network.assets)
  const shapes = new Map(compiled.effective.network.assets.map((a) => [a.id, nodeShape(a, layout.get(a.id)!)]))
  const inside = (p: Point, hull: readonly Point[]) => {
    let sign = 0
    for (let i = 0; i < hull.length; i += 1) {
      const a = hull[i]!
      const b = hull[(i + 1) % hull.length]!
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
      if (Math.abs(cross) < 1e-6) continue
      if (sign === 0) sign = Math.sign(cross)
      else if (Math.sign(cross) !== sign) return false
    }
    return true
  }

  test('workstations are low slabs with a monitor; servers are tall boxes with rack lines', () => {
    expect(shapes.get('A')!.silhouette).toBe('workstation')
    expect(shapes.get('A')!.monitor.length).toBe(3)
    expect(shapes.get('D')!.silhouette).toBe('server')
    expect(shapes.get('D')!.racks.length).toBeGreaterThan(0)
  })

  test('routes are trimmed to the silhouettes of both nodes', () => {
    const link = compiled.effective.network.links.find((l) => l.id === 'ab')!
    const route = routeGeometry(link, shapes)!
    const [start, end] = [route.points[0]!, route.points.at(-1)!]
    expect(inside(start, shapes.get('A')!.hull)).toBe(true) // on the boundary
    expect(inside(end, shapes.get('B')!.hull)).toBe(true)
    expect(inside(pointAt(route.points, 0.5).point, shapes.get('A')!.hull)).toBe(false)
    expect(exitPoint(shapes.get('A')!.anchor, shapes.get('B')!.anchor, shapes.get('A')!.hull)).toEqual(start)
  })

  test('path helpers split and trim by length', () => {
    const line: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(splitAt(line, 0.7)[0].at(-1)).toEqual({ x: 7, y: 0 })
    expect(trimEnd(line, 2).at(-1)).toEqual({ x: 8, y: 0 })
    expect(pointAt(line, 0.25).point).toEqual({ x: 2.5, y: 0 })
  })

  test('labels go on the side away from routes', () => {
    const routes = compiled.effective.network.links.map((l) => routeGeometry(l, shapes)!)
    const side = (id: string) => labelSide(id, shapes.get(id)!.anchor, routes)
    expect(side('A')).toBe('top') // routes leave A down-left and down-right
    expect(side('B')).toBe('left') // routes reach B from the upper right and leave down-right
    expect(side('C')).toBe('right')
    expect(labelSide('A', shapes.get('A')!.anchor, routes, ['bottom', 'top'])).toBe('top')
  })
})
