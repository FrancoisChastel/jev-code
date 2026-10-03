import { describe, expect, it } from "vitest";
import { JevApiError } from "../../src/core/errors.js";
import type { SystemOneRequest } from "../../src/core/types.js";
import { OPENAI_DECISIONS_WIRE, SYSTEM_ONE_WIRE, WIRES } from "../../src/core/wires.js";

/** The three-question request a preview user recorded against api.openai.com/v1/decisions. */
const request: SystemOneRequest = {
  state: { message: "I was charged twice." },
  questions: {
    urgent: {
      type: "noul",
      instructions: "Is this urgent?",
      criteria: { true: "Needs action today", false: "Can wait" },
    },
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Charges and refunds", technical: "Bugs and outages", other: null },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated is the author?",
      criteria: ["Calm", "Concerned", "Angry"],
    },
  },
};

/** The answer body from the same recording. */
const recorded = {
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "urgent", probability: 1.0 },
    {
      type: "choice",
      name: "department",
      choice: "billing",
      probabilities: [
        { value: "billing", probability: 1.0 },
        { value: "technical", probability: 0.0 },
        { value: "other", probability: 0.0 },
      ],
      confidence: 1.0,
    },
    {
      type: "score",
      name: "frustration",
      score: 1.0,
      probabilities: [
        { value: 0, label: "0", probability: 0.0 },
        { value: 1, label: "1", probability: 1.0 },
        { value: 2, label: "2", probability: 0.0 },
      ],
      confidence: 1.0,
    },
  ],
  usage: {
    input_tokens: 396,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 3,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 399,
  },
};

describe("OpenAI Decisions wire", () => {
  it("posts to /v1/decisions and is registered by name", () => {
    expect(OPENAI_DECISIONS_WIRE.path).toBe("/v1/decisions");
    expect(WIRES["openai-decisions"]).toBe(OPENAI_DECISIONS_WIRE);
    expect(WIRES.systemone).toBe(SYSTEM_ONE_WIRE);
  });

  it("encodes state and typed questions the way the recorded request does", () => {
    expect(OPENAI_DECISIONS_WIRE.encode(request, "gpt-6-luna")).toEqual({
      model: "gpt-6-luna",
      input: JSON.stringify({ message: "I was charged twice." }),
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?\nYes: Needs action today\nNo: Can wait",
        },
        {
          type: "choice",
          name: "department",
          instructions: "Which team should handle this?",
          choices: [
            { value: "billing", description: "Charges and refunds" },
            { value: "technical", description: "Bugs and outages" },
            { value: "other" },
          ],
        },
        {
          type: "score",
          name: "frustration",
          instructions: "How frustrated is the author?",
          levels: [
            { label: "0", description: "Calm" },
            { label: "1", description: "Concerned" },
            { label: "2", description: "Angry" },
          ],
        },
      ],
    });
  });

  it("sends string state verbatim and lets the request override the model", () => {
    const body = OPENAI_DECISIONS_WIRE.encode(
      {
        state: "12 passed",
        questions: { ok: { type: "noul", instructions: "All passed?" } },
        model: "x",
      },
      "gpt-6-luna",
    ) as { model: string; input: string; questions: unknown[] };
    expect(body.model).toBe("x");
    expect(body.input).toBe("12 passed");
    expect(body.questions).toEqual([
      { type: "predicate", name: "ok", instructions: "All passed?" },
    ]);
  });

  it("decodes the recorded answers into System One answers, rebuilding the score legend", () => {
    const response = OPENAI_DECISIONS_WIRE.decode(recorded, request, "gpt-6-luna");
    expect(response.model).toBe("gpt-6-luna");
    expect(response.usage).toEqual({ input_tokens: 396, output_tokens: 3 });
    expect(response.answers.urgent).toEqual({ type: "noul", noul: 1 });
    expect(response.answers.department).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 1, technical: 0, other: 0 },
      confidence: 1,
    });
    expect(response.answers.frustration).toEqual({
      type: "score",
      score: 1,
      legend: { "0": "Calm", "1": "Concerned", "2": "Angry" },
      probabilities: { "0": 0, "1": 1, "2": 0 },
      confidence: 1,
    });
  });

  it("tolerates the minimal answers OpenAI's own client accepts, and drops what it cannot map", () => {
    const minimal = {
      answers: [
        { type: "choice", name: "department", choice: "billing" },
        { type: "predicate", name: "nope" },
        "junk",
      ],
    };
    const response = OPENAI_DECISIONS_WIRE.decode(minimal, request, "gpt-6-luna");
    expect(response.model).toBe("gpt-6-luna");
    expect(response.usage).toBeUndefined();
    expect(response.answers).toEqual({
      department: { type: "choice", choice: "billing", probabilities: {}, confidence: 0 },
    });
  });

  it("rejects a body without an answers array", () => {
    expect(() => OPENAI_DECISIONS_WIRE.decode({ answers: {} }, request, "m", "req_1")).toThrow(
      JevApiError,
    );
    expect(() => SYSTEM_ONE_WIRE.decode({ hello: "world" }, request, "m")).toThrow(
      /without answers/,
    );
  });
});
