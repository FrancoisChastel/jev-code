import { describe, expect, it } from "vitest";
import {
  assertOrderedThresholds,
  checkVerdict,
  classifyDecision,
  confidenceDecision,
  marginOf,
  topProbability,
} from "../../src/tools/policy.js";

describe("policy", () => {
  it("computes margin and top probability", () => {
    expect(marginOf({ a: 0.7, b: 0.2, c: 0.1 })).toBeCloseTo(0.5);
    expect(marginOf({ a: 1 })).toBe(0);
    expect(marginOf(undefined)).toBe(0);
    expect(topProbability({ a: 0.3, b: 0.6 })).toBe(0.6);
    expect(topProbability({})).toBe(0);
  });

  it("auto-accepts only with both a high top and a clear margin", () => {
    expect(classifyDecision(0.9, 0.8, 0.85, 0.5)).toBe("auto");
    expect(classifyDecision(0.9, 0.3, 0.85, 0.5)).toBe("review");
    expect(classifyDecision(0.8, 0.8, 0.85, 0.5)).toBe("review");
  });

  it("maps probabilities to verdicts", () => {
    expect(checkVerdict(0.9, 0.75, 0.25)).toBe("yes");
    expect(checkVerdict(0.1, 0.75, 0.25)).toBe("no");
    expect(checkVerdict(0.5, 0.75, 0.25)).toBe("uncertain");
    expect(confidenceDecision(0.7, 0.7)).toBe("auto");
    expect(confidenceDecision(0.69, 0.7)).toBe("review");
  });

  it("rejects inverted thresholds", () => {
    expect(() => assertOrderedThresholds(0.8, 0.2, "no_at", "yes_at")).toThrow(/no_at/);
    expect(() => assertOrderedThresholds(0.2, 0.8, "no_at", "yes_at")).not.toThrow();
  });
});
