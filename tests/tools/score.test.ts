import { describe, expect, it } from "vitest";
import { runScore } from "../../src/tools/score.js";
import { clientWith, score } from "../helpers.js";

const levels = ["cosmetic", "minor", "major", "critical"];

describe("jev_score", () => {
  it("sends one score question per item and maps levels, decisions, and the summary", async () => {
    const { client, calls } = clientWith((id) =>
      id === "t1"
        ? score(1.08, 0.81, { "0": 0.1, "1": 0.74, "2": 0.14, "3": 0.02 })
        : score(2.6, 0.4),
    );
    const output = await runScore(client, {
      instructions: "How severe is this failure?",
      levels,
      items: [
        { id: "t1", text: "rounding" },
        { id: "t2", text: "timeout" },
      ],
    });
    expect(calls[0]?.body.questions.t1).toEqual({
      type: "score",
      instructions:
        "How severe is this failure? Rate `items.t1` on its own; other items are unrelated.",
      criteria: levels,
    });
    expect(output.legend).toEqual({ "0": "cosmetic", "1": "minor", "2": "major", "3": "critical" });
    expect(output.results[0]).toMatchObject({
      id: "t1",
      score: 1.08,
      level: 1,
      label: "minor",
      decision: "auto",
      probabilities: { "1": 0.74 },
    });
    expect(output.results[1]).toMatchObject({
      id: "t2",
      score: 2.6,
      level: 3,
      label: "critical",
      decision: "review",
    });
    expect(output.summary).toEqual({
      items: 2,
      auto: 1,
      review: 1,
      mean_score: 1.84,
      by_level: { "1": 1, "3": 1 },
    });
  });

  it("clamps out-of-range scores and marks invalid answers", async () => {
    const { client } = clientWith((id) => (id === "a" ? score(9, 1) : undefined));
    const output = await runScore(client, {
      instructions: "x",
      levels,
      items: [
        { id: "a", text: "1" },
        { id: "b", text: "2" },
      ],
    });
    expect(output.results[0]?.level).toBe(3);
    expect(output.results[1]).toMatchObject({ status: "invalid_response", decision: "review" });
    expect(output.summary.mean_score).toBe(9);
  });

  it("requires at least two levels", async () => {
    const { client } = clientWith(() => undefined);
    await expect(
      runScore(client, { instructions: "x", levels: ["one"], items: [{ id: "a", text: "1" }] }),
    ).rejects.toThrow(/levels/);
  });
});
