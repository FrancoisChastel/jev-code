import { describe, expect, it } from "vitest";
import { JevValidationError } from "../../src/core/errors.js";
import { runCheck } from "../../src/tools/check.js";
import { clientWith, noul } from "../helpers.js";

describe("jev_check", () => {
  it("sends one noul per check, passes criteria through, and maps verdicts", async () => {
    const { client, calls } = clientWith((id) =>
      noul(id === "green" ? 0.95 : id === "auth" ? 0.1 : 0.5),
    );
    const output = await runCheck(client, {
      state: { diff: "+ retry()", log: "12 passed" },
      checks: {
        green: "Does `log` show every test passed?",
        auth: { question: "Does `diff` touch auth?", yes: "session code changed", no: "unrelated" },
        risky: "Is `diff` risky?",
      },
    });
    const questions = calls[0]?.body.questions;
    expect(questions?.green).toEqual({
      type: "noul",
      instructions: "Does `log` show every test passed?",
    });
    expect(questions?.auth).toEqual({
      type: "noul",
      instructions: "Does `diff` touch auth?",
      criteria: { true: "session code changed", false: "unrelated" },
    });
    expect(output.summary).toEqual({ checks: 3, yes: 1, no: 1, uncertain: 1 });
    expect(output.results.map((r) => [r.id, r.verdict])).toEqual([
      ["green", "yes"],
      ["auth", "no"],
      ["risky", "uncertain"],
    ]);
    expect(output.results[1]?.question).toBe("Does `diff` touch auth?");
  });

  it("accepts a plain string state and custom thresholds", async () => {
    const { client } = clientWith(() => noul(0.6));
    const output = await runCheck(client, {
      state: "hello",
      checks: { a: "Is it a greeting?" },
      yes_at: 0.6,
      no_at: 0.1,
    });
    expect(output.results[0]?.verdict).toBe("yes");
    expect(output.thresholds).toEqual({ yes_at: 0.6, no_at: 0.1 });
  });

  it("flags malformed answers and rejects bad thresholds or empty checks", async () => {
    const { client } = clientWith(() => ({
      type: "choice",
      choice: "x",
      probabilities: {},
      confidence: 1,
    }));
    const output = await runCheck(client, { state: "x", checks: { a: "q" } });
    expect(output.results[0]).toMatchObject({ verdict: "uncertain", status: "invalid_response" });
    await expect(
      runCheck(client, { state: "x", checks: { a: "q" }, yes_at: 0.2, no_at: 0.8 }),
    ).rejects.toThrow(JevValidationError);
    await expect(runCheck(client, { state: "x", checks: {} })).rejects.toThrow(/must not be empty/);
  });
});
