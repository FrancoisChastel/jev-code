import { describe, expect, it } from "vitest";
import { JevValidationError } from "../../src/core/errors.js";
import { runAsk, validateQuestion } from "../../src/tools/ask.js";
import { choice, clientWith, noul } from "../helpers.js";

describe("jev_ask", () => {
  it("forwards state, questions, and model and returns the raw response", async () => {
    const { client, calls } = clientWith((id) =>
      id === "dept" ? choice("tech", { tech: 0.9, sales: 0.1 }) : noul(0.8),
    );
    const output = await runAsk(client, {
      state: { message: "500s everywhere" },
      model: "jev-1.13",
      questions: {
        dept: {
          type: "choice",
          instructions: "Which team?",
          criteria: { tech: "Bugs", sales: null },
        },
        urgent: { type: "noul", instructions: "Urgent?", criteria: { true: "time pressure" } },
      },
    });
    expect(calls[0]?.body.model).toBe("jev-1.13");
    expect(calls[0]?.body.questions.urgent).toEqual({
      type: "noul",
      instructions: "Urgent?",
      criteria: { true: "time pressure" },
    });
    expect(output.answers.dept).toMatchObject({ choice: "tech" });
    expect(output.model).toBe("jev-latest");
  });

  it("rejects criteria shapes the API would refuse, naming the caller's path", () => {
    expect(() =>
      validateQuestion("q", { type: "choice", instructions: "x", criteria: ["a", "b"] }),
    ).toThrow(/questions\["q"\].criteria: choice/);
    expect(() =>
      validateQuestion("q", { type: "choice", instructions: "x", criteria: { a: null } }),
    ).toThrow(/at least 2/);
    expect(() =>
      validateQuestion("q", { type: "score", instructions: "x", criteria: { a: 1 } }),
    ).toThrow(/score criteria must be an array/);
    expect(() => validateQuestion("q", { type: "score", instructions: "x", criteria: [] })).toThrow(
      /an empty array/,
    );
    expect(() =>
      validateQuestion("q", { type: "noul", instructions: "x", criteria: "yes" }),
    ).toThrow(/noul criteria/);
    expect(() =>
      validateQuestion("q", { type: "noul", instructions: "", criteria: undefined }),
    ).toThrow(/instructions is required/);
    expect(
      validateQuestion("q", { type: "score", instructions: "x", criteria: ["lo", "hi"] }),
    ).toEqual({ type: "score", instructions: "x", criteria: ["lo", "hi"] });
    expect(validateQuestion("q", { type: "noul", instructions: "x", criteria: null })).toEqual({
      type: "noul",
      instructions: "x",
      criteria: null,
    });
  });

  it("validates the envelope", async () => {
    const { client } = clientWith(() => undefined);
    await expect(runAsk(client, { state: "x", questions: {} })).rejects.toThrow(JevValidationError);
    await expect(
      runAsk(client, { state: "x", questions: { q: { type: "maybe", instructions: "?" } } }),
    ).rejects.toThrow(/questions.q.type/);
  });
});
