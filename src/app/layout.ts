import type { Asset } from '../core'

export type GridPosition = { readonly x: number; readonly y: number }

const BOARD_SIZE = 30
const COLUMN_GAP = 15
const ROW_GAP = 13
const BLOCK_GAP = 14

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function computeLayout(assets: readonly Asset[], seedId?: string): ReadonlyMap<string, GridPosition> {
  const positions = new Map<string, GridPosition>()
  if (assets.length === 0) return positions

  const seedSegment = assets.find((asset) => asset.id === seedId)?.segment_id
  const segments = [...new Set(assets.map((asset) => asset.segment_id))].sort(
    (a, b) => Number(b === seedSegment) - Number(a === seedSegment) || byText(a, b),
  )

  const placed: { id: string; x: number; y: number }[] = []
  let originX = 0
  let originY = 0
  for (const segment of segments) {
    const members = assets.filter((asset) => asset.segment_id === segment).sort(byId)
    const columns = Math.max(1, Math.ceil(Math.sqrt(members.length)))
    const rows = Math.ceil(members.length / columns)
    members.forEach((asset, index) => {
      placed.push({
        id: asset.id,
        x: originX + Math.floor(index / rows) * COLUMN_GAP,
        y: originY + (index % rows) * ROW_GAP,
      })
    })
    originX += (columns - 1) * COLUMN_GAP + BLOCK_GAP
    originY += (rows - 1) * ROW_GAP + BLOCK_GAP
  }

  const width = Math.max(...placed.map((p) => p.x))
  const height = Math.max(...placed.map((p) => p.y))
  const startX = (BOARD_SIZE - width) / 2
  const startY = (BOARD_SIZE - height) / 2
  for (const p of placed) positions.set(p.id, { x: startX + p.x, y: startY + p.y })
  return positions
}
