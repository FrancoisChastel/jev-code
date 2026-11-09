import { describe, expect, it } from "vitest";
import { JevClient } from "../../src/core/client.js";
import { JevApiError } from "../../src/core/errors.js";
import { runAsk } from "../../src/tools/ask.js";
import { runCheck } from "../../src/tools/check.js";
import { runScore } from "../../src/tools/score.js";
import { fakeFetch, jsonResponse } from "../helpers.js";

const levels = ["low", "medium", "high"];
const headers = { "x-request-id": "req_ab12", "x-typesafe-request-id": "req_ab12" };

/** A Drex answer to one score question, with the legend in the shape Drex chose. */
function drexScore(id: string, legend: "object" | "array"): Response {
  const answer = {
    type: "score",
    score: 2,
    legend: legend === "array" ? levels : { "0": "low", "1": "medium", "2": "high" },
    probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 },
    confidence: 0.8,
  };
  return jsonResponse(
    {
      model: "drex-v2.0",
      answers: { [id]: answer },
      evaluation_time_ms: 140,
      request_id: "req_ab12",
    },
    200,
    headers,
  );
}

function naceClient(responders: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responders);
  const env = { NACE_API_KEY: "nace_sk_test", JEV_CODE_PROVIDER: "nace" };
  return { client: JevClient.fromEnv(env, { fetch, maxRetries: 0 }), calls };
}

const ask = {
  state: "Production is down.",
  questions: { sev: { type: "score", instructions: "How urgent is it?", criteria: levels } },
};

describe("Drex responses through the Nace row", () => {
  it("asks for object legends, which jev_ask passes through with Drex's extra fields", async () => {
    const { client, calls } = naceClient([() => drexScore("sev", "object")]);
    const output = (await runAsk(client, ask)) as unknown as Record<string, unknown> & {
      answers: Record<string, { legend: unknown }>;
    };
    const sent = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(sent["X-Nace-Legend"]).toBe("object");
    expect(output.answers.sev?.legend).toEqual({ "0": "low", "1": "medium", "2": "high" });
    expect(output).toMatchObject({
      model: "drex-v2.0",
      evaluation_time_ms: 140,
      request_id: "req_ab12",
    });
  });

  it("passes an array legend through jev_ask raw, while jev_score rebuilds its own", async () => {
    // A proxy that drops the header gets Drex's default array.
    const { client } = naceClient([
      () => drexScore("sev", "array"),
      () => drexScore("t1", "array"),
    ]);
    const output = (await runAsk(client, ask)) as unknown as {
      answers: Record<string, { legend: unknown }>;
    };
    expect(output.answers.sev?.legend).toEqual(levels);
    const scored = await runScore(client, {
      instructions: "How urgent is it?",
      levels,
      items: [{ id: "t1", text: "Production is down." }],
    });
    expect(scored.legend).toEqual({ "0": "low", "1": "medium", "2": "high" });
    expect(scored.results[0]).toMatchObject({ id: "t1", level: 2 });
  });

  it("surfaces a Drex 422 from a tool with its message and x-request-id", async () => {
    const body = {
      error: { type: "invalid_request_error", message: 'model: unknown model "jev-latest"' },
      request_id: "req_cd34",
    };
    const { client } = naceClient([() => jsonResponse(body, 422, { "x-request-id": "req_cd34" })]);
    const error = (await runCheck(client, { state: "x", checks: { a: "Is it x?" } }).catch(
      (e: unknown) => e,
    )) as JevApiError;
    expect(error).toBeInstanceOf(JevApiError);
    expect(error.requestId).toBe("req_cd34");
    expect(error.message).toBe(
      'Jev API error 422 (request req_cd34): model: unknown model "jev-latest"',
    );
  });
});
