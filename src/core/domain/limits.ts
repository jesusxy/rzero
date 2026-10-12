// V1 admission limits (docs/architecture.md#scale-and-reproducibility).
// Product limits, not benchmark claims. Oversize input is rejected, never truncated.

export const ADMISSION_LIMITS = {
  /** Bytes per imported document, measured before UTF-8 decoding. */
  maxDocumentBytes: 5 * 1024 * 1024,
  maxAssets: 250,
  maxLinks: 2000,
  maxCapabilitiesPerProfile: 4,
  /** Enforced by the engine (milestone 2); recorded here so all limits live together. */
  maxEventsPerRun: 50_000,
  /**
   * Structural bound on JSON nesting. Native documents need fewer than ten
   * levels; the rest is headroom for metadata. Also rejects cyclic in-memory input.
   */
  maxNestingDepth: 64,
} as const

export type AdmissionLimits = typeof ADMISSION_LIMITS
