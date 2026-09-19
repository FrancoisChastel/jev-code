/**
 * Pure policy helpers that turn probabilities into decisions.
 * Thresholds are parameters; callers own the policy.
 */

export type Decision = "auto" | "review";
export type Verdict = "yes" | "no" | "uncertain";

/** Gap between the top probability and the runner-up. A lone option has margin 0. */
export function marginOf(probabilities: Record<string, number> | undefined): number {
  const sorted = Object.values(probabilities ?? {}).sort((a, b) => b - a);
  if (sorted.length < 2) return 0;
  return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

/** Top probability from a distribution, or 0 when empty. */
export function topProbability(probabilities: Record<string, number> | undefined): number {
  return Math.max(0, ...Object.values(probabilities ?? {}));
}

/**
 * Auto-accept a classification only when the winner is both probable and clearly ahead.
 * Conservative on purpose: wording of similar classes sways uncertain cases.
 */
export function classifyDecision(
  top: number,
  margin: number,
  autoAccept: number,
  minMargin: number,
): Decision {
  return top >= autoAccept && margin >= minMargin ? "auto" : "review";
}

/** Map a yes-probability to a verdict with two thresholds. */
export function checkVerdict(probability: number, yesAt: number, noAt: number): Verdict {
  if (probability >= yesAt) return "yes";
  if (probability <= noAt) return "no";
  return "uncertain";
}

/** Score answers carry a confidence; accept automatically above the threshold. */
export function confidenceDecision(confidence: number, autoAccept: number): Decision {
  return confidence >= autoAccept ? "auto" : "review";
}

/** Thresholds must be ordered so a value cannot be both yes and no. */
export function assertOrderedThresholds(
  low: number,
  high: number,
  lowName: string,
  highName: string,
): void {
  if (low > high) {
    throw new RangeError(`${lowName} (${low}) must be at or below ${highName} (${high}).`);
  }
}
