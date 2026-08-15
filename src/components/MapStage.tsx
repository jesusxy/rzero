import { For } from 'solid-js'
import {
  type AssetNode,
  type AssetType,
  type MapPosition,
  type NetworkEdge,
  type Topology,
} from '../domain/topology'

type MapStageProps = {
  topology: Topology
}

type ScreenPoint = {
  x: number
  y: number
}

type BlockDimensions = {
  // width/depth are expressed in grid units (same space as MapPosition),
  // not raw SVG pixels — they get projected the same way node positions do.
  width: number
  depth: number
  height: number
}

const boardSize = 30

const projection = {
  originX: 50,
  originY: 8,
  tileX: 1.55,
  tileY: 1.02,
}

const blockDimensions: Record<AssetType, BlockDimensions> = {
  endpoint: { width: 2.8, depth: 2.8, height: 4.5 },
  server: { width: 3.6, depth: 3.6, height: 6 },
  database: { width: 3.6, depth: 3.6, height: 5.5 },
  router: { width: 2.8, depth: 2.8, height: 4.5 },
  firewall: { width: 2.8, depth: 2.8, height: 4.5 },
  'mail-server': { width: 3.6, depth: 3.6, height: 5.5 },
  'domain-controller': { width: 4.2, depth: 4.2, height: 7 },
}

const gridStep = 2;

const gridLines = Array.from(
  {length: Math.floor(boardSize / gridStep) + 1},
  (_, index) => index * gridStep,
)

function project(point: MapPosition): ScreenPoint {
  return {
    x: projection.originX + (point.x - point.y) * projection.tileX,
    y: projection.originY + (point.x + point.y) * projection.tileY,
  }
}

function points(pointsToJoin: ScreenPoint[]) {
  return pointsToJoin.map((point) => `${point.x},${point.y}`).join(' ')
}

function projectedPoints(pointsToJoin: MapPosition[]) {
  return points(pointsToJoin.map(project))
}

function routePoints(edge: NetworkEdge, nodes: AssetNode[]) {
  if (edge.route) {
    return projectedPoints(edge.route)
  }

  const source = nodes.find((node) => node.id === edge.source)
  const target = nodes.find((node) => node.id === edge.target)

  return source && target
    ? projectedPoints([source.position, target.position])
    : undefined
}

function layerCountFor(node: AssetNode): number {
  const count = node.instanceCount ?? 1
  if (count <= 1) return 1
  if (count <= 10) return 2
  return 3
}

type BlockLayer = {
  top: string
  left: string
  right: string
}

const layerGap = 0.3

function blockFaces(node: AssetNode) {
  const size = blockDimensions[node.type]
  const halfWidth = size.width / 2
  const halfDepth = size.depth / 2

  const groundTop = project({ x: node.position.x - halfWidth, y: node.position.y - halfDepth })
  const groundRight = project({ x: node.position.x + halfWidth, y: node.position.y - halfDepth })
  const groundBottom = project({ x: node.position.x + halfWidth, y: node.position.y + halfDepth })
  const groundLeft = project({ x: node.position.x - halfWidth, y: node.position.y + halfDepth })
  const groundCenter = project(node.position)

  const shift = (p: ScreenPoint, amount: number): ScreenPoint => ({ x: p.x, y: p.y - amount })

  const layerCount = layerCountFor(node)
  const totalGap = layerGap * (layerCount - 1)
  const layerHeight = (size.height - totalGap) / layerCount

  const layers: BlockLayer[] = []
  for (let i = 0; i < layerCount; i++) {
    const baseLift = i * (layerHeight + layerGap)
    const gTop = shift(groundTop, baseLift)
    const gRight = shift(groundRight, baseLift)
    const gBottom = shift(groundBottom, baseLift)
    const gLeft = shift(groundLeft, baseLift)
    const rTop = shift(gTop, layerHeight)
    const rRight = shift(gRight, layerHeight)
    const rBottom = shift(gBottom, layerHeight)
    const rLeft = shift(gLeft, layerHeight)

    layers.push({
      top: points([rTop, rRight, rBottom, rLeft]),
      left: points([gLeft, gBottom, rBottom, rLeft]),
      right: points([gBottom, gRight, rRight, rBottom]),
    })
  }

  return {
    center: shift(groundCenter, size.height),
    groundBottom,
    size,
    layers,
  }
}
export function MapStage(props: MapStageProps) {
  const orderedNodes = () =>
    [...props.topology.nodes].sort(
      (a, b) => project(a.position).y - project(b.position).y,
    )

  return (
    <section class="map-stage" aria-label="Network map">
      <div class="map-toolbar" aria-label="Map controls">
        <button type="button" class="compact" aria-label="Zoom in">
          +
        </button>
        <button type="button" class="compact" aria-label="Zoom out">
          -
        </button>
      </div>

      <div class="network-map">
        <svg
          class="network-scene"
          viewBox="0 0 100 72"
          role="img"
          aria-label={`${props.topology.label} network topology`}
        >
          <defs>
            <pattern
              id="block-hatch"
              width=".4"
              height=".4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="2" height="2" class="block-hatch-bg" />
              <path d="M 0 0 V 2" class="block-hatch-line" />
            </pattern>
          </defs>

          <g class="iso-grid" aria-hidden="true">
            <For each={gridLines}>{(line) => (
              <>
                <polyline
                  class="iso-grid-line"
                  points={projectedPoints([
                    { x: line, y: 0 },
                    { x: line, y: boardSize },
                  ])}
                />
                <polyline
                  class="iso-grid-line"
                  points={projectedPoints([
                    { x: 0, y: line },
                    { x: boardSize, y: line },
                  ])}
                />
              </>
            )}</For>
          </g>
          {/* 
          <g class="network-edges" aria-hidden="true">
            <For each={props.topology.edges}>{(edge) => {
              const route = routePoints(edge, props.topology.nodes)

              return route ? (
                <polyline class="network-edge" points={route} />
              ) : null
            }}</For>
          </g> */}

          <g class="network-nodes">
            <For each={orderedNodes()}>{(node) => {
              const block = blockFaces(node)

              return (
             <g
                class={`asset-block asset-${node.type}`}
                role="button"
                tabindex="0"
                aria-label={`${node.hostname}, ${node.type}`}
              >
                <title>{`${node.hostname} - ${node.os}`}</title>
                <For each={block.layers}>{(layer) => (
                  <>
                    <polygon class="asset-face asset-face-left" points={layer.left} />
                    <polygon class="asset-face asset-face-right" points={layer.right} />
                    <polygon class="asset-face asset-face-top" points={layer.top} />
                  </>
                )}</For>
                <text class="asset-block-label" x={block.center.x} y={block.center.y + 0.8}>
                  {node.label}
                </text>
                <text class="asset-block-hostname" x={block.center.x} y={block.groundBottom.y + 1.6}>
                  {node.hostname.split('.')[0]}
                </text>
              </g>
              )
            }}</For>
          </g>
        </svg>
      </div>

      <footer class="map-hints">
        Click an asset to inspect / Choose Set Initial Access to begin
      </footer>
    </section>
  )
}
