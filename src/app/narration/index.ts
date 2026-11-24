// Plain-English narration of replay steps (see src/core/replay/steps.ts).
// Display prose stays out of src/core; event codes and facts are authoritative.

export { narrate, primaryCheck, type Narration, type NarrationParts, type NarrateOptions } from './narrate'
export { originalRunNote, resultsText, type ResultRow, type ResultsText } from './defense'
export { DEFENSE_TEXT } from './templates'
export {
  blockTag,
  capabilityChip,
  checkName,
  describeProfile,
  joinList,
  mechanismWords,
  platformName,
  serviceName,
  type ProfileDescription,
} from './describe'
