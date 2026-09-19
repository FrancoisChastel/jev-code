import { describe, expect, it } from "vitest";
import { JevValidationError } from "../../src/core/errors.js";
import { runClassify } from "../../src/tools/classify.js";
import { choice, clientWith } from "../helpers.js";

const classes = { bug: "Broken behaviour", feature: "New capability", other: null };

describe("jev_classify", () => {
  it("sends one choice question per item with the shared classes and maps decisions", async () => {
    const { client, calls } = clientWith((id) =>
      id === "issue-1"
        ? choice("bug", { bug: 0.92, feature: 0.05, other: 0.03 }, 0.9)
        : choice("feature", { bug: 0.45, feature: 0.5, other: 0.05 }, 0.3),
    );
    const output = await runClassify(client, {
      instructions: "Route each issue.",
      context: "Team notes",
      items: [
        { id: "issue-1", text: "Crash on save" },
        { id: "issue-2", text: "Add dark mode" },
      ],
      classes,
    });
    const request = calls[0]?.body;
    expect(request?.state).toEqual({
      context: "Team notes",
      items: { "issue-1": "Crash on save", "issue-2": "Add dark mode" },
    });
    expect(request?.questions["issue-1"]).toEqual({
      type: "choice",
      instructions:
        "Route each issue. Which class best describes `items.issue-1`? Judge it on its own; other items are unrelated.",
      criteria: classes,
    });
    expect(output.summary).toEqual({
      items: 2,
      auto: 1,
      review: 1,
      by_label: { bug: 1, feature: 1 },
    });
    expect(output.results[0]).toMatchObject({
      id: "issue-1",
      label: "bug",
      probability: 0.92,
      margin: 0.87,
      decision: "auto",
    });
    expect(output.results[1]).toMatchObject({
      id: "issue-2",
      label: "feature",
      decision: "review",
      margin: 0.05,
    });
    expect(output.thresholds).toEqual({ auto_accept: 0.85, min_margin: 0.5 });
    expect(output.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
  });

  it("marks missing or malformed answers as invalid_response instead of guessing", async () => {
    const { client } = clientWith((id) => (id === "a" ? { type: "noul", noul: 0.5 } : undefined));
    const output = await runClassify(client, {
      items: [
        { id: "a", text: "x" },
        { id: "b", text: "y" },
      ],
      classes,
    });
    expect(
      output.results.every((r) => r.status === "invalid_response" && r.decision === "review"),
    ).toBe(true);
    expect(output.summary.review).toBe(2);
  });

  it("honours custom thresholds and flags truncated items", async () => {
    const { client } = clientWith(() => choice("bug", { bug: 0.7, feature: 0.3, other: 0 }, 0.5));
    const output = await runClassify(client, {
      items: [{ id: "a", text: "z".repeat(5000) }],
      classes,
      auto_accept: 0.6,
      min_margin: 0.3,
    });
    expect(output.results[0]).toMatchObject({ decision: "auto", truncated: true });
  });

  it("validates input before calling the API", async () => {
    const { client, calls } = clientWith(() => undefined);
    await expect(runClassify(client, { items: [], classes })).rejects.toThrow(JevValidationError);
    await expect(
      runClassify(client, { items: [{ id: "a", text: "x" }], classes: { only: "one" } }),
    ).rejects.toThrow(/at least 2/);
    await expect(
      runClassify(client, {
        items: [
          { id: "a", text: "x" },
          { id: "a", text: "y" },
        ],
        classes,
      }),
    ).rejects.toThrow(/Duplicate/);
    expect(calls).toHaveLength(0);
  });
});
