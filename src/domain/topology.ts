export type AssetType =
  | 'endpoint'
  | 'server'
  | 'database'
  | 'router'
  | 'firewall'
  | 'mail-server'
  | 'domain-controller'

export type PatchLevel = 'current' | 'recent' | 'outdated' | 'legacy'

export type PrivilegeTier = 'standard-user' | 'power-user' | 'admin' | 'domain-admin'

export type InfectionState = 'clean' | 'infected' | 'spreading' | 'contained'

export type MapPosition = {
  x: number
  y: number
}

export type AssetNode = {
  id: string
  label: string
  hostname: string
  type: AssetType
  os: string
  patchLevel: PatchLevel
  segment: string
  privilegeTier: PrivilegeTier
  edr: boolean
  infectionState: InfectionState
  position: MapPosition
}

export type NetworkEdge = {
  id: string
  source: string
  target: string
  label: string
  allowedProtocols: string[]
  guardedBy?: string
}

export type NetworkSegment = {
  id: string
  label: string
  status: string
}

export type Topology = {
  id: string
  label: string
  description: string
  segments: NetworkSegment[]
  nodes: AssetNode[]
  edges: NetworkEdge[]
}

export function assetTypeLabel(type: AssetType) {
  const labels: Record<AssetType, string> = {
    endpoint: 'Endpoint',
    server: 'Server',
    database: 'Database',
    router: 'Router',
    firewall: 'Firewall',
    'mail-server': 'Mail Server',
    'domain-controller': 'Domain Controller',
  }

  return labels[type]
}
