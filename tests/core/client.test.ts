import { describe, expect, it } from "vitest";
import { JevClient, retryAfterMs } from "../../src/core/client.js";
import { JevApiError, JevConnectionError, JevTimeoutError } from "../../src/core/errors.js";
import { fakeFetch, jsonResponse } from "../helpers.js";

const request = {
  state: "hello",
  questions: { q: { type: "noul" as const, instructions: "Is this a greeting?" } },
};

describe("JevClient", () => {
  it("posts to OpenRouter's System One API with bearer auth and the fixed Jev model", async () => {
    const { fetch, calls } = fakeFetch([
      () =>
        jsonResponse({ model: "typesafe/jev-1.13", answers: { q: { type: "noul", noul: 0.9 } } }),
    ]);
    const client = new JevClient({ apiKey: "sk-or-abc", fetch });
    const response = await client.systemOne(request);
    expect(response.answers.q).toEqual({ type: "noul", noul: 0.9 });
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/systemone");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-abc");
    expect(calls[0]?.body.model).toBe("typesafe/jev-1.13");
    expect(calls[0]?.body.state).toBe("hello");
  });

  it("always sends the fixed Jev model", async () => {
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ model: "typesafe/jev-1.13", answers: {} }),
    ]);
    const client = new JevClient({ apiKey: "k", fetch });
    await client.systemOne({ ...request, model: "other/model" } as typeof request);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(calls[0]?.body.model).toBe("typesafe/jev-1.13");
  });

  it("retries a 429 honouring retry-after-ms, then succeeds", async () => {
    const delays: number[] = [];
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ message: "slow down" }, 429, { "retry-after-ms": "40" }),
      () => jsonResponse({ model: "typesafe/jev-1.13", answers: {} }),
    ]);
    const client = new JevClient({
      apiKey: "k",
      fetch,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await client.systemOne(request);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([40]);
  });

  it("gives up after maxRetries and surfaces the API error with status and request id", async () => {
    const { fetch } = fakeFetch([
      () => jsonResponse({ error: "overloaded" }, 529, { "x-openrouter-request-id": "req_1" }),
      () => jsonResponse({ error: "overloaded" }, 529),
    ]);
    const client = new JevClient({ apiKey: "k", fetch, maxRetries: 1, sleep: async () => {} });
    const error = await client.systemOne(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevApiError);
    expect((error as JevApiError).status).toBe(529);
    expect((error as JevApiError).message).toContain("overloaded");
  });

  it("does not retry a 401", async () => {
    const { fetch, calls } = fakeFetch([() => jsonResponse({ message: "bad key" }, 401)]);
    const client = new JevClient({ apiKey: "k", fetch, sleep: async () => {} });
    await expect(client.systemOne(request)).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("wraps network failures as JevConnectionError after retrying", async () => {
    const { fetch, calls } = fakeFetch([
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const client = new JevClient({ apiKey: "k", fetch, sleep: async () => {} });
    await expect(client.systemOne(request)).rejects.toBeInstanceOf(JevConnectionError);
    expect(calls).toHaveLength(3);
  });

  it("times out a hanging attempt", async () => {
    const fetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const client = new JevClient({ apiKey: "k", fetch, timeoutMs: 5, maxRetries: 0 });
    await expect(client.systemOne(request)).rejects.toBeInstanceOf(JevTimeoutError);
  });

  it("propagates caller aborts without retrying", async () => {
    const controller = new AbortController();
    const fetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        controller.abort(new Error("user cancelled"));
      });
    const client = new JevClient({ apiKey: "k", fetch });
    await expect(client.systemOne(request, { signal: controller.signal })).rejects.toThrow(
      "user cancelled",
    );
  });

  it("rejects a 200 without answers", async () => {
    const { fetch } = fakeFetch([() => jsonResponse({ hello: "world" })]);
    const client = new JevClient({ apiKey: "k", fetch });
    await expect(client.systemOne(request)).rejects.toThrow(/without answers/);
  });

  it("requires an api key and reads configuration from the environment", () => {
    expect(() => new JevClient({ apiKey: "" })).toThrow();
    JevClient.fromEnv({
      OPENROUTER_API_KEY: "sk-or-env",
    });
    expect(() => JevClient.fromEnv({})).toThrow(/OPENROUTER_API_KEY is not set/);
  });
});

describe("retryAfterMs", () => {
  it("parses ms and seconds headers and caps them", () => {
    expect(retryAfterMs(new Headers({ "retry-after-ms": "250" }))).toBe(250);
    expect(retryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(retryAfterMs(new Headers({ "retry-after": "999" }))).toBe(30_000);
    expect(retryAfterMs(new Headers({ "retry-after": "soon" }))).toBeUndefined();
    expect(retryAfterMs(new Headers())).toBeUndefined();
  });
});
