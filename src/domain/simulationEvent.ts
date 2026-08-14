export type MitreTechniqueId = `T${number}` | `T${number}.${number}`

export type SimulationEventType =
  | 'initial-access'
  | 'execution'
  | 'credential-access'
  | 'persistence'
  | 'c2-comms'
  | 'propagation-attempt'
  | 'blocked-by-control'
  | 'quarantined'

export type SimulationEvent = {
  id: string
  time: number
  type: SimulationEventType
  technique?: MitreTechniqueId
  title: string
  description: string
  nodeId: string
  sourceNodeId?: string
}
