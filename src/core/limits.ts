/**
 * Request bounds enforced locally, before anything is sent to the API.
 * Jev's context is roughly 32K tokens (about 150K characters of English);
 * the request budget below leaves headroom for question text and JSON overhead.
 */
export const LIMITS = {
  /** Items per classify or score call; each item becomes one question. */
  maxItems: 64,
  /** Classes per classify call (Choice supports up to 255 options). */
  maxClasses: 250,
  /** Yes/no checks per check call. */
  maxChecks: 64,
  /** Candidates per rank call. */
  maxCandidates: 250,
  /** Levels per score call. */
  maxLevels: 20,
  /** Characters kept per item text before truncation. */
  itemChars: 4_000,
  /** Characters allowed for the serialised request body. */
  requestChars: 120_000,
  /** Characters allowed in an item id after sanitising. */
  idChars: 64,
} as const;

export const TRUNCATION_MARKER = " […truncated]";
