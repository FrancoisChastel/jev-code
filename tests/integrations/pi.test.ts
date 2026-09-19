/**
 * Loads the Pi extension with a fake ExtensionAPI. The extension imports the built package,
 * so this file needs `npm run build` first (CI builds before testing).
 */
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "../helpers.js";

const distReady = existsSync(new URL("../../dist/index.js", import.meta.url));

interface Registered {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: { type: string; properties: Record<string, unknown>; required?: string[] };
  execute: (
    id: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
}

describe.skipIf(!distReady)("Pi extension", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TYPESAFE_API_KEY;

  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = "ts_pi_test";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  });

  it("registers the five tools with object schemas and executes one end to end", async () => {
    const { default: extension } = await import("../../integrations/pi/jev.js");
    const tools: Registered[] = [];
    extension({ registerTool: (definition: Registered) => tools.push(definition) } as never);
    expect(tools.map((t) => t.name)).toEqual([
      "jev_classify",
      "jev_check",
      "jev_score",
      "jev_rank",
      "jev_ask",
    ]);
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(Object.keys(tool.parameters.properties).length).toBeGreaterThan(0);
      expect(tool.promptSnippet?.length).toBeGreaterThan(20);
      expect(
        tool.promptGuidelines?.every((line) => line.includes(tool.name) || line.includes("Jev")),
      ).toBe(true);
    }
    const { fetch } = fakeFetch([
      () => jsonResponse({ model: "jev-latest", answers: { green: { type: "noul", noul: 0.95 } } }),
    ]);
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const check = tools.find((t) => t.name === "jev_check");
    const result = await check?.execute("call-1", {
      state: "12 passed",
      checks: { green: "All passed?" },
    });
    expect(JSON.parse(result?.content[0]?.text ?? "{}").results[0]).toMatchObject({
      id: "green",
      verdict: "yes",
    });
    expect(result?.details).toMatchObject({ summary: { yes: 1 } });
  });

  it("throws a readable error on aborts and bad input", async () => {
    const { default: extension } = await import("../../integrations/pi/jev.js");
    const tools: Registered[] = [];
    extension({ registerTool: (definition: Registered) => tools.push(definition) } as never);
    const classify = tools.find((t) => t.name === "jev_classify");
    const aborted = new AbortController();
    aborted.abort();
    await expect(classify?.execute("c", {}, aborted.signal)).rejects.toThrow(/aborted/);
    await expect(classify?.execute("c", { items: [], classes: {} })).rejects.toThrow(
      /jev_classify failed: Invalid input/,
    );
  });
});
