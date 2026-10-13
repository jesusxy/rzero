// Presentation-only layout. Maps asset IDs to stable grid positions for the
// isometric map. It is derived solely from the asset IDs and segments (sorted),
// so it is deterministic and never depends on — or affects — simulation results.
// Layout is excluded from the scenario's semantic identity (see docs).

import type { Asset } from '../core'

export type GridPosition = { readonly x: number; readonly y: number }

const BOARD_SIZE = 30
const COLUMN_GAP = 8
const ROW_GAP = 9

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const bySegment = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Lays assets on the grid in a compact column-major grid, ordered by segment
 * then asset ID. For the five-node lab this gives readable, non-overlapping
 * positions where directed links do not pass through a third node.
 */
export function computeLayout(assets: readonly Asset[]): ReadonlyMap<string, GridPosition> {
  const ordered = [...assets].sort((a, b) => bySegment(a.segment_id, b.segment_id) || byId(a, b))
  const count = ordered.length
  const positions = new Map<string, GridPosition>()
  if (count === 0) return positions

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / columns)
  const gridWidth = (columns - 1) * COLUMN_GAP
  const gridHeight = (rows - 1) * ROW_GAP
  const startX = (BOARD_SIZE - gridWidth) / 2
  const startY = (BOARD_SIZE - gridHeight) / 2

  ordered.forEach((asset, index) => {
    const column = Math.floor(index / rows)
    const row = index % rows
    positions.set(asset.id, { x: startX + column * COLUMN_GAP, y: startY + row * ROW_GAP })
  })
  return positions
}
