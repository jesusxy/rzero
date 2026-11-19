import baselineText from '../../fixtures/scenarios/001-five-node-baseline.json?raw'
import segmentedText from '../../fixtures/scenarios/002-counterfactual-segmentation.json?raw'

export type BuiltinScenario = {
  readonly key: string
  readonly file: string
  readonly text: string
  readonly title: string
  readonly description: string
}

export const BUILTIN_SCENARIOS: readonly BuiltinScenario[] = [
  {
    key: '001',
    file: '001-five-node-baseline.json',
    text: baselineText,
    title: 'Five-node lab',
    description: 'Synthetic demo: not a real network or malware family',
  },
  {
    key: '002',
    file: '002-counterfactual-segmentation.json',
    text: segmentedText,
    title: 'Five-node lab, segmented',
    description: 'Synthetic demo: a workstation/server boundary denies SMB',
  },
]

export function selectBuiltinScenario(search: string): BuiltinScenario {
  const key = new URLSearchParams(search).get('scenario')
  return BUILTIN_SCENARIOS.find((scenario) => scenario.key === key) ?? BUILTIN_SCENARIOS[0]!
}
