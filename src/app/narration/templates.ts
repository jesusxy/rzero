// Plain-English templates for replay steps. All display prose lives here, out
// of src/core: the codes and facts in events are authoritative, and this text
// is derived from them. `{name}` tokens are filled by narrate(); a token with no
// value is left in place so a missing fact is visible rather than silently
// blank.
//
// Unknown always reads as "we don't know" — never as safe or as vulnerable.
// No template mentions seconds or elapsed time: hop is a logical depth, and
// the engine computes no durations.

import type { CheckCode } from '../../core'

/** The two check statuses that can decide an attempt that did not succeed. */
export type DecidingStatus = 'fail' | 'unknown'

export type ReasonTemplate = {
  /** A full sentence explaining why this check decided the attempt. */
  readonly because: string
  /** A short clause naming the same issue, for listing additional reasons. */
  readonly also: string
}

/**
 * One template per (check code, deciding status), for every CheckCode. The
 * isolation checks cannot currently be unknown (isolation is a boolean fact);
 * their templates exist so the table stays total if that changes.
 *
 * Tokens: {source} {target} {noun} {service} {vulnerability} {privilege}
 * {platforms} {observed} {credential} {granted}. Reasons refer to the capability
 * by its short noun ("the exploit"); the lead sentence names it in full.
 */
export const REASONS: { readonly [C in CheckCode]: { readonly [S in DecidingStatus]: ReasonTemplate } } = {
  SOURCE_NOT_ISOLATED: {
    fail: {
      because: '{source} is cut off from the network, so it cannot reach {target} or any other host.',
      also: '{source} is cut off from the network',
    },
    unknown: {
      because: "We don't know whether {source} is cut off from the network, so we can't say whether it can reach {target}.",
      also: "we don't know whether {source} is cut off from the network",
    },
  },
  TARGET_NOT_ISOLATED: {
    fail: {
      because: '{target} is cut off from the network, so {source} cannot reach it.',
      also: '{target} is cut off from the network',
    },
    unknown: {
      because: "We don't know whether {target} is cut off from the network, so we can't say whether {source} can reach it.",
      also: "we don't know whether {target} is cut off from the network",
    },
  },
  TARGET_PLATFORM: {
    fail: {
      because: '{target} runs {observed}, but the {noun} only works on {platforms}.',
      also: '{target} runs {observed}, not {platforms}',
    },
    unknown: {
      because: "We don't know which platform {target} runs, so we can't say whether the {noun} works on it.",
      also: "we don't know which platform {target} runs",
    },
  },
  NETWORK_ACCESS: {
    fail: {
      because: "The network doesn't allow {service} traffic from {source} to {target}, so the attempt never connects.",
      also: "the network doesn't allow {service} traffic from {source} to {target}",
    },
    unknown: {
      because:
        "We don't know whether the network allows {service} traffic from {source} to {target}, so we can't say whether the attempt connects.",
      also: "we don't know whether the network allows {service} traffic from {source} to {target}",
    },
  },
  SERVICE_ENABLED: {
    fail: {
      because: '{target} has its {service} service turned off, so the {noun} has nothing to connect to.',
      also: '{target} has no {service} service running',
    },
    unknown: {
      because:
        "We don't know whether {target} has its {service} service turned on, so we can't say whether the {noun} has anything to connect to.",
      also: "we don't know whether {target} has its {service} service turned on",
    },
  },
  VULNERABILITY_PRESENT: {
    fail: {
      because: "{target} doesn't have the {vulnerability} weakness the {noun} needs.",
      also: "{target} doesn't have the {vulnerability} weakness",
    },
    unknown: {
      because:
        "We don't know whether {target} has the {vulnerability} weakness, so we can't say whether the {noun} would work.",
      also: "we don't know whether {target} has the {vulnerability} weakness",
    },
  },
  CREDENTIAL_AUTHORIZED: {
    fail: {
      because: "{source} has no credential for {target}'s {service} service, and the {noun} needs valid {privilege} access.",
      also: '{source} has no working {privilege} credential for {target}',
    },
    unknown: {
      because:
        "{source} holds credential {credential} for {target}, but we don't know whether it still works, so we can't say whether the {noun} succeeds.",
      also: "we don't know whether {source}'s credential {credential} for {target} still works",
    },
  },
}

/**
 * Sharper wording when the observed fact distinguishes cases the base template
 * covers together. Keyed `CODE/status/variant`; see `reasonVariant` in narrate.ts.
 */
export const REASON_VARIANTS: Readonly<Record<string, Partial<ReasonTemplate>>> = {
  'SERVICE_ENABLED/fail/absent': {
    because: "{target} doesn't run the {service} service at all, so the {noun} has nothing to connect to.",
  },
  'VULNERABILITY_PRESENT/unknown/missing': {
    because:
      "The scenario doesn't say whether {target} has the {vulnerability} weakness, so we don't know whether the {noun} would work.",
  },
  'CREDENTIAL_AUTHORIZED/fail/invalid': {
    because:
      "{source}'s credential {credential} for {target} is not valid, and the {noun} needs valid {privilege} access.",
  },
  'CREDENTIAL_AUTHORIZED/fail/underprivileged': {
    because: "{source}'s credential {credential} only gives {granted} access to {target}, but the {noun} needs {privilege}.",
  },
}

/** Display names for service IDs; any other ID is shown as written. */
export const SERVICE_NAMES: Readonly<Record<string, string>> = {
  smb: 'SMB',
  winrm: 'WinRM',
}

/**
 * Short nouns for a capability once the story has named it in full, by
 * mechanism ("with the same exploit"). `unknown` covers a capability ID the
 * profile does not define.
 */
export const CAPABILITY_NOUNS = {
  remote_exploit: 'exploit',
  remote_execution: 'remote execution',
  unknown: 'capability',
} as const

/** Intervention types, as a reader would name them. Tokens: none. */
export const INTERVENTION_KINDS = {
  set_boundary_access: 'segmentation rule',
  set_asset_isolation: 'isolation change',
  set_service_status: 'service change',
  set_vulnerability_status: 'vulnerability change',
  set_vulnerability_status_absent: 'patch',
  set_grant_status: 'credential change',
  set_grant_status_invalid: 'credential revocation',
  unknown: 'intervention',
} as const

export const STEP_TEXT = {
  seed: {
    title: '{seed} starts compromised',
    preview: '{seed} starts compromised',
    body:
      "{seed} is compromised from the start. That is the scenario's chosen starting point, not the result of an attempt. " +
      'Each compromised host takes one turn to try its outgoing links, in a fixed order, and {seed} goes first.',
  },
  /** The rare seed step of a run that stopped before the seed compromise was recorded. */
  seedUnrecorded: {
    title: 'The run starts at {seed}',
    preview: 'The run starts at {seed}',
    body: 'The run is set to start at {seed}, but it stops before anything else is recorded.',
  },

  attempt: {
    preview: '{source} tries {target}',
    /** Used when the same source tries the same target more than once (alternative capabilities). */
    previewWithCapability: '{source} tries {target} with the {capability}',
    // Each lead has a first-mention form (the capability's full label) and a
    // "same" form for a capability the story has already named.
    lead: '{source} tries {target} over {service}, using the {capability}.',
    leadSame: '{source} tries {target} over {service} with the same {noun}.',
    leadNextOption: "That didn't work, so {source} tries its next option on {target}: the {capability} over {service}.",
    leadNextOptionSame: "That didn't work, so {source} tries its next option on {target}: the {noun} it used before, over {service}.",
    leadRetried:
      "An earlier attempt on {target} didn't get through, but that doesn't protect it for good. Now {source} tries it over {service}, using the {capability}.",
    leadRetriedSame:
      "An earlier attempt on {target} didn't get through, but that doesn't protect it for good. Now {source} tries it over {service} with the same {noun}.",
  },
  succeeded: {
    title: '{target} compromised',
    requirementsExploit:
      "It works: the network allows {service} from {source} to {target}, {target}'s {service} service is on, and {target} has the {vulnerability} weakness.",
    requirementsExecution:
      "It works: the network allows {service} from {source} to {target}, {target}'s {service} service is on, and {source}'s credential {credential} gives {granted} access.",
    consequence: '{target} is now compromised and will take its own turn to try its links.',
  },
  blocked: {
    title: 'Blocked at {target}',
    intervention: 'It is blocked by {intervention}, a change this scenario makes.',
    // What can still try the target, from the static network. Only links whose
    // service some profile capability uses count.
    /** Later capabilities on this same link will still be tried. */
    moreOptionsOnLink: '{source} still has another way to try {target} over {service}.',
    /** Token {sources}: the other links' source hosts. */
    otherLinks: '{target} can still be reached through other links (from {sources}).',
    noOtherLinks: 'No other host has a link to {target}, so nothing else will try.',
    /** When the target itself is isolated: no route in this model can reach it. */
    consequenceUnreachable: 'Being cut off protects {target} from every route in this model.',
  },
  indeterminate: {
    title: 'Inconclusive at {target}',
    intervention: 'That gap comes from {intervention}, a change this scenario makes.',
    consequence:
      "The model doesn't guess: {target} is not counted as compromised, and not as safe either.",
  },
  unresolved: {
    title: '{source} tries {target}',
    consequence: 'The run stopped before this attempt was decided.',
  },
  /** Additional non-passing checks besides the deciding one. Token {issues}: joined `also` clauses. */
  alsoIssues: "That isn't the only issue: {issues}.",
  /** When a failure decides the outcome while other facts are unknown. */
  failOutweighsUnknown: 'A failed requirement decides the outcome on its own, even when other facts are unknown.',
  skipped: "{source}'s link to {target} is skipped, because {target} is already compromised.",

  summary: {
    title: '{count} of {total} hosts compromised',
    preview: 'Results',
    lead: 'No compromised host has any links left to try, so the spread stops here.',
    compromised: '{count} of {total} hosts {are} compromised, a {percent} blast radius: {hosts}.',
    untouched:
      '{hosts} {were} never compromised. That means this model never got through to {them}, not that {they} {are} proven safe.',
    noCritical: 'No hosts are marked critical in this scenario.',
    criticalSpared: 'None of the critical hosts ({hosts}) {were} reached.',
    criticalReached: 'Critical hosts reached: {hosts}.',
    indeterminate: "We couldn't tell what would happen at {hosts}: count {them} as unknown, not as safe.",
  },
  aborted: {
    title: 'The run stopped early',
    preview: 'Results',
    lead: 'The run stopped before it finished, because {reason}.',
    pendingTarget: 'It had just picked {target} as a target but never got to try it.',
    partial:
      'These results are partial: {count} of {total} hosts {were} compromised before it stopped, a {percent} blast radius so far. Hosts it never got to are not shown to be safe.',
    reasons: {
      EVENT_LIMIT: 'it hit the limit on how many events one run may record',
      CANCELLED: 'it was cancelled',
    },
  },
} as const
