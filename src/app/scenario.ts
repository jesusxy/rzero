// The single built-in scenario for checkpoint 1: the canonical five-node lab
// fixture, imported as text and compiled through the public core entry point at
// run time (never pre-parsed here). It is a synthetic demonstration, not a real
// network or malware family.

import scenarioText from '../../fixtures/scenarios/001-five-node-baseline.json?raw'

export const BUILTIN_SCENARIO_TEXT: string = scenarioText
export const BUILTIN_SCENARIO_FILE = '001-five-node-baseline.json'
export const BUILTIN_SCENARIO_LABEL = 'Five-node lab'
export const BUILTIN_SCENARIO_NOTE = 'Synthetic demonstration — not a real network or malware family.'
// Shown before Start as a configured-scenario hint; the authoritative values
// come from compiling the fixture in start().
export const BUILTIN_SCENARIO_SEED = 'A'
export const BUILTIN_SCENARIO_ASSET_COUNT = 5
