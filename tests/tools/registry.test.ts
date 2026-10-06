import { describe, expect, it } from "vitest";
import { findTool, TOOL_NAMES, TOOLS, USAGE_GUIDANCE } from "../../src/tools/index.js";

describe("tool registry", () => {
  it("exposes five uniquely named tools with complete metadata", () => {
    expect(TOOL_NAMES).toEqual(["jev_classify", "jev_check", "jev_score", "jev_rank", "jev_ask"]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.description.length).toBeLessThan(1200);
      expect(tool.promptSnippet.length).toBeLessThan(160);
      expect(tool.guidelines.every((line) => line.includes(tool.name))).toBe(true);
      expect(Object.keys(tool.schema.shape).length).toBeGreaterThan(0);
    }
    expect(USAGE_GUIDANCE.length).toBeGreaterThan(3);
  });

  it("finds tools by full or short name", () => {
    expect(findTool("classify")?.name).toBe("jev_classify");
    expect(findTool("jev_rank")?.name).toBe("jev_rank");
    expect(findTool("nope")).toBeUndefined();
  });
});

import { JevClient } from "../../src/core/client.js";
import { CUSTOM_ENV, fakeFetch, jsonResponse } from "../helpers.js";

const customCases = [
  [
    "classify",
    { items: [{ id: "a", text: "bug" }], classes: { bug: "Bug", other: null } },
    { results: [{ label: "bug", decision: "auto" }] },
  ],
  ["check", { state: "green", checks: { a: "Passed?" } }, { results: [{ verdict: "yes" }] }],
  [
    "score",
    { items: [{ id: "a", text: "bug" }], instructions: "Rate severity", levels: ["low", "high"] },
    { results: [{ decision: "auto", level: 1 }] },
  ],
  [
    "rank",
    { query: "bug", candidates: [{ id: "a", text: "bug" }] },
    { ranked: [{ relevant: true }] },
  ],
  [
    "ask",
    {
      state: "green",
      model: "override",
      questions: { a: { type: "noul", instructions: "Passed?" } },
    },
    { answers: { a: { noul: 0.99 } } },
  ],
] as const;

it.each(customCases)(
  "runs %s with a custom environment and existing output contracts",
  async (name, payload, expected) => {
    const { fetch, calls } = fakeFetch([
      (body) =>
        jsonResponse({
          model: body.model,
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([id, question]) => [
              id,
              question.type === "choice"
                ? {
                    type: "choice",
                    choice: "bug",
                    probabilities: { bug: 0.99, other: 0.01 },
                    confidence: 0.99,
                  }
                : question.type === "score"
                  ? { type: "score", score: 1, confidence: 0.99, legend: {} }
                  : { type: "noul", noul: 0.99 },
            ]),
          ),
        }),
    ]);
    const result = await findTool(name)?.run(JevClient.fromEnv(CUSTOM_ENV, { fetch }), payload);
    expect(result).toMatchObject(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://gateway.example/api/v1/systemone");
    expect(calls[0]?.body.model).toBe(name === "ask" ? "override" : CUSTOM_ENV.JEV_CODE_MODEL);
  },
);
