import { describe, expect, it } from "vitest";
import { runRank } from "../../src/tools/rank.js";
import { clientWith, noul } from "../helpers.js";

describe("jev_rank", () => {
  it("scores each candidate independently, adds an existence check, and sorts", async () => {
    const values: Record<string, number> = {
      "src_a.ts": 0.2,
      "src_b.ts": 0.9,
      "docs_c.md": 0.9,
      __any_relevant: 0.95,
    };
    const { client, calls } = clientWith((id) => noul(values[id] ?? 0));
    const output = await runRank(client, {
      query: "where are retries configured?",
      candidates: [
        { id: "src/a.ts", text: "a" },
        { id: "src/b.ts", text: "b" },
        { id: "docs/c.md", text: "c" },
      ],
    });
    const request = calls[0]?.body;
    expect(request?.state).toMatchObject({
      query: "where are retries configured?",
      candidates: { "src_a.ts": "a" },
    });
    expect(Object.keys(request?.questions ?? {})).toEqual([
      "src_a.ts",
      "src_b.ts",
      "docs_c.md",
      "__any_relevant",
    ]);
    expect(request?.questions["src_b.ts"]?.instructions).toContain("`candidates.src_b.ts`");
    expect(output.any_relevant).toBe(0.95);
    // Ties keep caller order.
    expect(output.ranked.map((r) => r.id)).toEqual(["src/b.ts", "docs/c.md", "src/a.ts"]);
    expect(output.ranked[0]).toMatchObject({ rank: 1, relevance: 0.9, relevant: true });
    expect(output.ranked[2]).toMatchObject({ rank: 3, relevant: false });
    expect(output.summary).toEqual({ candidates: 3, relevant: 2, returned: 3 });
  });

  it("applies top_k, relevant_at, and marks invalid answers", async () => {
    const { client } = clientWith((id) =>
      id === "x" ? noul(0.4) : id === "__any_relevant" ? noul(0.3) : undefined,
    );
    const output = await runRank(client, {
      query: "q",
      candidates: [
        { id: "x", text: "1" },
        { id: "y", text: "2" },
      ],
      top_k: 1,
      relevant_at: 0.3,
    });
    expect(output.ranked).toHaveLength(1);
    expect(output.ranked[0]).toMatchObject({ id: "x", relevant: true });
    expect(output.summary).toEqual({ candidates: 2, relevant: 1, returned: 1 });
    const full = await runRank(clientWith((id) => (id === "x" ? noul(0.4) : undefined)).client, {
      query: "q",
      candidates: [
        { id: "x", text: "1" },
        { id: "y", text: "2" },
      ],
    });
    expect(full.ranked[1]).toMatchObject({ id: "y", status: "invalid_response", relevant: false });
    expect(full.any_relevant).toBe(0);
  });
});
