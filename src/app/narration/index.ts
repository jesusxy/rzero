// Plain-English narration of replay steps (see src/core/replay/steps.ts).
// Display prose stays out of src/core; event codes and facts are authoritative.

export { narrate, primaryCheck, type Narration, type NarrationParts } from './narrate'
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
