import baselineText from '../../fixtures/scenarios/001-five-node-baseline.json?raw'
import segmentedText from '../../fixtures/scenarios/002-counterfactual-segmentation.json?raw'
import wannacryText from '../../fixtures/scenarios/wannacry-small-office.json?raw'
import wannacrySegmentedText from '../../fixtures/scenarios/wannacry-small-office-segmented.json?raw'

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
  {
    key: 'wannacry',
    file: 'wannacry-small-office.json',
    text: wannacryText,
    title: 'WannaCry in a small office',
    description: 'Fictional office network, reviewed WannaCry (May 2017) profile',
  },
  {
    key: 'wannacry-segmented',
    file: 'wannacry-small-office-segmented.json',
    text: wannacrySegmentedText,
    title: 'WannaCry in a small office, servers segmented',
    description: 'Same office; SMB from the office to the servers is denied',
  },
]

export function selectBuiltinScenario(search: string): BuiltinScenario {
  const key = new URLSearchParams(search).get('scenario')
  return BUILTIN_SCENARIOS.find((scenario) => scenario.key === key) ?? BUILTIN_SCENARIOS[0]!
}
