import { describe, expect, it } from "vitest";
import { JevClient } from "../../src/core/client.js";
import { OPENAI_DECISIONS_WIRE } from "../../src/core/wires.js";
import { findTool, TOOL_NAMES, TOOLS, USAGE_GUIDANCE } from "../../src/tools/index.js";
import { fakeFetch, jsonResponse } from "../helpers.js";

/** A client on OpenAI's wire whose host declines every question it is asked. */
function refusingClient() {
  const { fetch, calls } = fakeFetch([
    (body) => {
      const sent = body as unknown as { questions: Array<{ name: string }> };
      return jsonResponse({
        model: "gpt-6-luna",
        answers: sent.questions.map(({ name }) => ({ type: "refusal", name })),
      });
    },
  ]);
  const client = new JevClient({
    apiKey: "sk-proj-test",
    baseUrl: "https://api.openai.com",
    model: "gpt-6-luna",
    wire: OPENAI_DECISIONS_WIRE,
    fetch,
    maxRetries: 0,
  });
  return { client, calls };
}

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

describe("a question the host declines", () => {
  const items = [{ id: "a/1", text: "Export fails in Safari." }];

  it("is reported as refused, never as a guess, by every tool", async () => {
    const run = async (name: string, payload: unknown) => {
      const { client, calls } = refusingClient();
      const output = await findTool(name)?.run(client, payload);
      expect(calls[0]?.url).toBe("https://api.openai.com/v1/decisions");
      return output as Record<string, any>;
    };
    const check = await run("check", { state: "s", checks: { ok: "Is it fine?" } });
    expect(check.results[0]).toMatchObject({ verdict: "uncertain", status: "refused" });
    expect(check.summary).toMatchObject({ uncertain: 1, yes: 0, no: 0 });
    const classify = await run("classify", { items, classes: { bug: null, other: null } });
    expect(classify.results[0]).toMatchObject({
      id: "a/1",
      label: null,
      decision: "review",
      status: "refused",
    });
    const score = await run("score", { items, instructions: "Severity?", levels: ["low", "high"] });
    expect(score.results[0]).toMatchObject({ decision: "review", status: "refused" });
    const rank = await run("rank", { query: "Safari", candidates: items });
    expect(rank.ranked[0]).toMatchObject({ relevant: false, status: "refused" });
    expect(rank.any_relevant).toBe(0);
    const ask = await run("ask", {
      state: "s",
      questions: { q: { type: "noul", instructions: "Is it fine?" } },
    });
    expect(ask).toMatchObject({ answers: {}, refused: ["q"] });
  });
});
