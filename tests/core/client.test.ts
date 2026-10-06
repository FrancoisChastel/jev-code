import { describe, expect, it } from "vitest";
import { JevClient, retryAfterMs } from "../../src/core/client.js";
import { JevApiError, JevConnectionError, JevTimeoutError } from "../../src/core/errors.js";
import { OPENAI_DECISIONS_WIRE } from "../../src/core/wires.js";
import { CUSTOM_ENV, fakeFetch, jsonResponse } from "../helpers.js";

const request = {
  state: "hello",
  questions: { q: { type: "noul" as const, instructions: "Is this a greeting?" } },
};

describe("JevClient", () => {
  it("posts to /v1/systemone with bearer auth and the default model", async () => {
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ model: "jev-latest", answers: { q: { type: "noul", noul: 0.9 } } }),
    ]);
    const client = new JevClient({ apiKey: "ts_abc", fetch });
    const response = await client.systemOne(request);
    expect(response.answers.q).toEqual({ type: "noul", noul: 0.9 });
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ts_abc");
    expect(calls[0]?.body.model).toBe("jev-latest");
    expect(calls[0]?.body.state).toBe("hello");
  });

  it("lets the request override the client model and strips trailing slashes from the base URL", async () => {
    const { fetch, calls } = fakeFetch([() => jsonResponse({ model: "jev-1", answers: {} })]);
    const client = new JevClient({
      apiKey: "k",
      fetch,
      baseUrl: "https://proxy.example/",
      model: "jev-1",
    });
    await client.systemOne({ ...request, model: "jev-2" });
    expect(calls[0]?.url).toBe("https://proxy.example/v1/systemone");
    expect(calls[0]?.body.model).toBe("jev-2");
  });

  it("retries a 429 honouring retry-after-ms, then succeeds", async () => {
    const delays: number[] = [];
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ message: "slow down" }, 429, { "retry-after-ms": "40" }),
      () => jsonResponse({ model: "jev-latest", answers: {} }),
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
      () => jsonResponse({ error: "overloaded" }, 529, { "x-typesafe-request-id": "req_1" }),
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

  it("rejects a 200 without answers, keeping the raw body when it is not JSON", async () => {
    const { fetch } = fakeFetch([
      () => jsonResponse({ hello: "world" }),
      () => new Response("<html>proxy error</html>", { status: 200 }),
    ]);
    const client = new JevClient({ apiKey: "k", fetch });
    await expect(client.systemOne(request)).rejects.toThrow(/without answers/);
    const error = (await client.systemOne(request).catch((e: unknown) => e)) as JevApiError;
    expect(error).toBeInstanceOf(JevApiError);
    expect(error.body).toBe("<html>proxy error</html>");
  });

  it("sends no Authorization header without a key, for local hosts", async () => {
    const { fetch, calls } = fakeFetch([() => jsonResponse({ model: "nimble", answers: {} })]);
    const client = new JevClient({ fetch, baseUrl: "http://localhost:11434", model: "nimble" });
    await client.systemOne(request);
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/systemone");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("reads configuration from the environment", () => {
    const client = JevClient.fromEnv({
      TYPESAFE_API_KEY: "ts_env",
      TYPESAFE_DEFAULT_MODEL: "jev-9",
    });
    expect(client.model).toBe("jev-9");
    expect(() => JevClient.fromEnv({})).toThrow(/No API key found/);
    const viaOpenRouter = JevClient.fromEnv({ OPENROUTER_API_KEY: "sk-or-v1-x" });
    expect(viaOpenRouter.baseUrl).toBe("https://openrouter.ai/api");
    expect(viaOpenRouter.model).toBe("jev-latest");
  });

  it("speaks OpenAI's Decisions API when given that wire", async () => {
    const { fetch, calls } = fakeFetch([
      () =>
        jsonResponse({
          model: "gpt-6-luna",
          answers: [{ type: "predicate", name: "q", probability: 0.9 }],
          usage: { input_tokens: 40, output_tokens: 1, total_tokens: 41 },
        }),
    ]);
    const client = new JevClient({
      apiKey: "sk-proj-x",
      fetch,
      baseUrl: "https://api.openai.com",
      model: "gpt-6-luna",
      wire: OPENAI_DECISIONS_WIRE,
    });
    const response = await client.systemOne(request);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/decisions");
    const body = calls[0]?.body as unknown as { input: string; questions: Array<{ type: string }> };
    expect(body.input).toBe("hello");
    expect(body.questions).toEqual([
      { type: "predicate", name: "q", instructions: "Is this a greeting?" },
    ]);
    expect(response.answers.q).toEqual({ type: "noul", noul: 0.9 });
    expect(response.usage).toEqual({ input_tokens: 40, output_tokens: 1 });
    const viaEnv = JevClient.fromEnv({ OPENAI_API_KEY: "sk-proj-x", JEV_CODE_PROVIDER: "openai" });
    expect(viaEnv.baseUrl).toBe("https://api.openai.com");
    expect(viaEnv.model).toBe("gpt-6-luna");
  });

  it("merges override headers with the provider's instead of replacing them", async () => {
    const { fetch, calls } = fakeFetch([() => jsonResponse({ model: "m", answers: {} })]);
    const client = JevClient.fromEnv(
      { OPENROUTER_API_KEY: "sk-or-v1-x" },
      { fetch, headers: { "X-Custom": "1" } },
    );
    await client.systemOne(request);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Custom"]).toBe("1");
    expect(headers["X-Title"]).toBe("jev-code");
    expect(headers["HTTP-Referer"]).toContain("github.com");
  });

  it("sends extra headers under the fixed ones and reads the configured request id header", async () => {
    const { fetch, calls } = fakeFetch([
      () =>
        jsonResponse({ error: { message: "User not found.", code: 401 } }, 401, {
          "x-vercel-id": "iad1::abc",
        }),
    ]);
    const client = new JevClient({
      apiKey: "sk-or-x",
      fetch,
      sleep: async () => {},
      headers: { "X-Title": "jev-code", Authorization: "Bearer stolen" },
      requestIdHeader: "x-vercel-id",
    });
    const error = (await client.systemOne(request).catch((e: unknown) => e)) as JevApiError;
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Title"]).toBe("jev-code");
    expect(headers.Authorization).toBe("Bearer sk-or-x");
    expect(error).toBeInstanceOf(JevApiError);
    expect(error.requestId).toBe("iad1::abc");
    expect(error.message).toContain("User not found.");
    expect(error.message).not.toContain("{");
  });

  it("summarises nested error bodies from every host", async () => {
    const { fetch } = fakeFetch([
      () =>
        jsonResponse(
          { detail: { error_type: "authentication_error", message: "Cannot authenticate." } },
          401,
        ),
      () =>
        jsonResponse({ message: "Authentication failed", error_type: "authentication_error" }, 401),
      () => jsonResponse({ error: { code: 402 } }, 402),
    ]);
    const client = new JevClient({ apiKey: "k", fetch, sleep: async () => {} });
    await expect(client.systemOne(request)).rejects.toThrow("Cannot authenticate.");
    await expect(client.systemOne(request)).rejects.toThrow("Authentication failed");
    await expect(client.systemOne(request)).rejects.toThrow('{"code":402}');
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

describe("custom provider transport", () => {
  it("uses the exact destination, key and model and permits request model overrides", async () => {
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ model: "override", answers: { q: { type: "noul", noul: 0.9 } } }),
    ]);
    const result = await JevClient.fromEnv(CUSTOM_ENV, { fetch }).systemOne({
      ...request,
      model: "override",
    });
    expect(result.answers.q).toMatchObject({ noul: 0.9 });
    expect(calls[0]?.url).toBe("https://gateway.example/api/v1/systemone");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${CUSTOM_ENV.JEV_CODE_API_KEY}`,
    });
    expect(calls[0]?.body).toEqual({ ...request, model: "override" });
  });

  it.each([429, 503, "connection", "timeout"])(
    "attempts once by default for %s",
    async (failure) => {
      let attempts = 0;
      const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
        attempts++;
        if (failure === "connection") throw new Error("offline");
        if (failure === "timeout")
          return new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
          );
        return jsonResponse({ error: "try later" }, Number(failure));
      };
      await expect(
        JevClient.fromEnv(
          { ...CUSTOM_ENV, JEV_CODE_TIMEOUT_MS: "5" },
          { fetch, sleep: async () => {} },
        ).systemOne(request),
      ).rejects.toThrow();
      expect(attempts).toBe(1);
    },
  );

  it("honors explicit custom retries", async () => {
    const { fetch, calls } = fakeFetch([
      () => jsonResponse({ error: "busy" }, 503),
      () => jsonResponse({ model: CUSTOM_ENV.JEV_CODE_MODEL, answers: {} }),
    ]);
    await JevClient.fromEnv(
      { ...CUSTOM_ENV, JEV_CODE_MAX_RETRIES: "1" },
      { fetch, sleep: async () => {} },
    ).systemOne(request);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body.model).toBe(CUSTOM_ENV.JEV_CODE_MODEL);
  });

  it("fails invalid custom configuration before sending a request", () => {
    const { fetch, calls } = fakeFetch([]);
    expect(() => JevClient.fromEnv({ ...CUSTOM_ENV, JEV_CODE_MODEL: "" }, { fetch })).toThrow(
      "JEV_CODE_MODEL",
    );
    expect(calls).toHaveLength(0);
  });
});
