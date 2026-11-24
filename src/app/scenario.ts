import baselineText from '../../fixtures/scenarios/001-five-node-baseline.json?raw'
import segmentedText from '../../fixtures/scenarios/002-counterfactual-segmentation.json?raw'
import wannacryText from '../../fixtures/scenarios/wannacry-small-office.json?raw'
import wannacryDefenses from '../../fixtures/scenarios/wannacry-small-office.defenses.json?raw'
import type { CompiledScenario } from '../core'

export type BuiltinScenario = {
  readonly key: string
  readonly file: string
  readonly text: string
  readonly title: string
  readonly description: string
  readonly defenses?: string
}

export const BUILTIN_SCENARIOS: readonly BuiltinScenario[] = [
  {
    key: 'wannacry',
    file: 'wannacry-small-office.json',
    text: wannacryText,
    title: 'WannaCry in a small office',
    description: 'Reviewed WannaCry (May 2017) profile · fictional office network',
    defenses: wannacryDefenses,
  },
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

export const DEFAULT_SCENARIO = BUILTIN_SCENARIOS[0]!

export function selectBuiltinScenario(search: string): BuiltinScenario {
  const key = new URLSearchParams(search).get('scenario')
  return BUILTIN_SCENARIOS.find((scenario) => scenario.key === key) ?? DEFAULT_SCENARIO
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function scenarioFacts(compiled: CompiledScenario): string {
  const network = compiled.effective.network
  const kind = compiled.effective.profile.scope === 'synthetic' ? 'Synthetic demo' : 'Real malware'
  return [kind, plural(network.assets.length, 'host'), plural(network.segments.length, 'segment')].join(' · ')
}
