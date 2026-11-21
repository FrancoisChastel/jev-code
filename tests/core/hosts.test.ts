import { describe, expect, it } from "vitest";
import { JevClient } from "../../src/core/client.js";
import { resolveConfig } from "../../src/core/config.js";
import { JevApiError, JevConfigError } from "../../src/core/errors.js";
import type { SystemOneRequest } from "../../src/core/types.js";
import { fakeFetch, jsonResponse } from "../helpers.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const REQUEST: SystemOneRequest = {
  state: { ticket: "Checkout is down for EU customers." },
  questions: {
    urgent: {
      type: "noul",
      instructions: "Is this urgent?",
      criteria: { true: "Customers are blocked", false: "Nobody is blocked" },
    },
    team: { type: "choice", instructions: "Which team?", criteria: { billing: null, eng: "Bugs" } },
    severity: { type: "score", instructions: "How severe?", criteria: ["Minor", "Major"] },
  },
};

/** Answers in System One's shape, as Perplexity, Foundry, and Clef return them. */
const SYSTEM_ONE_ANSWERS = {
  model: "served-model",
  answers: {
    urgent: { type: "noul", noul: 0.9 },
    team: {
      type: "choice",
      choice: "eng",
      probabilities: { billing: 0.1, eng: 0.9 },
      confidence: 0.8,
    },
    severity: {
      type: "score",
      score: 0.7,
      legend: { "0": "Minor", "1": "Major" },
      probabilities: { "0": 0.3, "1": 0.7 },
      confidence: 0.4,
    },
  },
  usage: { input_tokens: 40, output_tokens: 0 },
};

/** Send REQUEST through a client built from `env`; return the call it made and the answer. */
async function send(env: Record<string, string>, reply: unknown) {
  const { fetch, calls } = fakeFetch([() => jsonResponse(reply)]);
  const client = JevClient.fromEnv(env, { fetch, sleep: async () => {}, maxRetries: 0 });
  const response = await client.systemOne(REQUEST);
  const [call] = calls;
  if (!call) throw new Error("no request was sent");
  return { call, headers: call.init.headers as Record<string, string>, response };
}

function configError(env: Record<string, string>): string {
  try {
    resolveConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(JevConfigError);
    return (error as Error).message;
  }
  throw new Error("expected a configuration error");
}

describe("decision hosts beyond TypeSafe", () => {
  it("keeps every one of them opt-in: an exported key alone sends nothing anywhere", () => {
    const keys: Record<string, string> = {
      azure: "AZURE_OPENAI_API_KEY",
      foundry: "AZURE_API_KEY",
      gemini: "GEMINI_API_KEY",
      perplexity: "PERPLEXITY_API_KEY",
      cloudflare: "CLOUDFLARE_API_TOKEN",
    };
    for (const [name, keyEnv] of Object.entries(keys)) {
      const message = configError({ [keyEnv]: "abc12345" });
      expect(message).toMatch(/^No API key found/);
      expect(message).toContain(`${keyEnv} is set, but`);
      expect(message).toContain(`JEV_CODE_PROVIDER=${name} is set.`);
    }
    // With a TypeSafe key beside it, TypeSafe is used and the other key stays put.
    expect(resolveConfig({ TYPESAFE_API_KEY: "ts_a", GEMINI_API_KEY: "AIza1" }).provider).toBe(
      "typesafe",
    );
  });

  it("never lets TYPESAFE_API_KEY follow an override to another company's model", () => {
    for (const name of ["perplexity", "foundry", "cloudflare", "gemini", "azure"]) {
      const message = configError({ TYPESAFE_API_KEY: "ts_a", JEV_CODE_PROVIDER: name });
      expect(message).toContain("no key is set for");
      expect(message).not.toContain("or TYPESAFE_API_KEY");
    }
  });

  it("sends Azure OpenAI the Decisions body, with the key in api-key and no Authorization", async () => {
    const env = {
      JEV_CODE_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "azure-key-1",
      AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com/",
    };
    const { call, headers, response } = await send(env, {
      model: "gpt-6-luna",
      answers: [
        { type: "predicate", name: "urgent", probability: 0.9 },
        { type: "refusal", name: "team" },
      ],
    });
    expect(call.url).toBe("https://contoso.openai.azure.com/openai/v1/decisions");
    expect(headers["api-key"]).toBe("azure-key-1");
    expect(headers.Authorization).toBeUndefined();
    expect(Array.isArray((call.body as unknown as { questions: unknown }).questions)).toBe(true);
    expect(call.body.model).toBe("gpt-6-luna");
    expect(response.answers.urgent).toEqual({ type: "noul", noul: 0.9 });
    expect(response.refused).toEqual(["team"]);
    // The endpoint as the SDK examples write it lands in the same place.
    for (const endpoint of [
      "https://contoso.openai.azure.com/openai",
      "https://contoso.openai.azure.com/openai/v1/",
    ]) {
      expect(resolveConfig({ ...env, AZURE_OPENAI_ENDPOINT: endpoint }).baseUrl).toBe(
        "https://contoso.openai.azure.com/openai",
      );
    }
    // The model field names the deployment.
    expect(resolveConfig({ ...env, TYPESAFE_DEFAULT_MODEL: "my-luna" }).model).toBe("my-luna");
  });

  it("requires the account endpoint, over https, before any Azure or Cloudflare key is used", () => {
    expect(configError({ JEV_CODE_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "azure-key-1" })).toBe(
      "Azure OpenAI Decisions API needs AZURE_OPENAI_ENDPOINT (https://<resource>.openai.azure.com) as well as AZURE_OPENAI_API_KEY.",
    );
    const http = configError({
      JEV_CODE_PROVIDER: "azure",
      AZURE_OPENAI_API_KEY: "azure-key-1",
      AZURE_OPENAI_ENDPOINT: "http://contoso.openai.azure.com",
    });
    expect(http).toContain("over plain http");
    // An endpoint on a private domain (a gateway in front of the resource) still needs https.
    expect(
      configError({
        JEV_CODE_PROVIDER: "foundry",
        AZURE_API_KEY: "k",
        AZURE_ENDPOINT: "http://apim.contoso.internal",
      }),
    ).toBe(
      "AZURE_ENDPOINT must be an https URL, such as https://<resource>.services.ai.azure.com.",
    );
    expect(
      configError({
        JEV_CODE_PROVIDER: "cloudflare",
        CLOUDFLARE_API_TOKEN: "cf-token",
        CLOUDFLARE_ACCOUNT_ID: "../../zones",
      }),
    ).toBe("CLOUDFLARE_ACCOUNT_ID must be your 32-character account id.");
  });

  it("refuses plain http to any Azure host through TYPESAFE_BASE_URL too", () => {
    expect(
      configError({
        TYPESAFE_API_KEY: "ts_a",
        TYPESAFE_BASE_URL: "http://x.services.ai.azure.com",
      }),
    ).toBe(
      "TYPESAFE_BASE_URL points at an azure.com host over plain http; use https://x.services.ai.azure.com.",
    );
  });

  it("sends Microsoft Foundry the System One body under /providers/microsoft", async () => {
    const env = {
      JEV_CODE_PROVIDER: "foundry",
      AZURE_API_KEY: "foundry-key-1",
      AZURE_ENDPOINT: "https://contoso.services.ai.azure.com/providers/microsoft/v1/systemone",
    };
    const { call, headers, response } = await send(env, SYSTEM_ONE_ANSWERS);
    expect(call.url).toBe("https://contoso.services.ai.azure.com/providers/microsoft/v1/systemone");
    expect(headers["api-key"]).toBe("foundry-key-1");
    expect(headers.Authorization).toBeUndefined();
    expect(call.body).toMatchObject({ model: "Microsoft-Decision-1.1", state: REQUEST.state });
    expect(response.answers.team).toMatchObject({ choice: "eng" });
  });

  it("sends Perplexity the System One body at /v1/decisions with a Bearer key", async () => {
    const { call, headers, response } = await send(
      { JEV_CODE_PROVIDER: "perplexity", PERPLEXITY_API_KEY: "pplx-abc" },
      SYSTEM_ONE_ANSWERS,
    );
    expect(call.url).toBe("https://api.perplexity.ai/v1/decisions");
    expect(headers.Authorization).toBe("Bearer pplx-abc");
    // Perplexity rejects unknown top-level fields, so the body carries exactly these three.
    expect(Object.keys(call.body).sort()).toEqual(["model", "questions", "state"]);
    expect(call.body.model).toBe("pplx-decider-latest");
    expect(response.usage).toEqual({ input_tokens: 40, output_tokens: 0 });
  });

  it("translates to and from Gemini's field names, with the key in x-goog-api-key", async () => {
    const { call, headers, response } = await send(
      { JEV_CODE_PROVIDER: "gemini", GEMINI_API_KEY: "AIza-test" },
      {
        model: "gemini-decision-1",
        answers: {
          urgent: { type: "noul", noul: 0.99, confidence: 0.99 },
          team: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.6, eng: 0.4 },
            confidence: 0.6,
          },
          severity: { type: "score", score: 1.2, probabilities: { "0": 0.2, "1": 0.8 } },
        },
        usage: { total_input_tokens: 100, total_output_tokens: 0, total_tokens: 100 },
      },
    );
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/decisions");
    expect(headers["x-goog-api-key"]).toBe("AIza-test");
    expect(headers.Authorization).toBeUndefined();
    const body = call.body as unknown as Record<string, unknown>;
    expect(body.state).toBeUndefined();
    // JSON state goes as its text: a list would be read as content blocks.
    expect(body.input).toBe(JSON.stringify(REQUEST.state));
    expect(body.questions).toEqual({
      urgent: {
        type: "noul",
        instructions: "Is this urgent?",
        criteria: {
          true_description: "Customers are blocked",
          false_description: "Nobody is blocked",
        },
      },
      team: {
        type: "choice",
        instructions: "Which team?",
        criteria: { billing: "billing", eng: "Bugs" },
      },
      severity: { type: "score", instructions: "How severe?", criteria: ["Minor", "Major"] },
    });
    expect(response.answers.urgent).toEqual({ type: "noul", noul: 0.99 });
    expect(response.answers.team).toMatchObject({ choice: "billing", confidence: 0.6 });
    // No legend came back, so it is rebuilt from the request.
    expect(response.answers.severity).toMatchObject({
      score: 1.2,
      legend: { "0": "Minor", "1": "Major" },
      confidence: 0,
    });
    expect(response.usage).toEqual({ input_tokens: 100, output_tokens: 0 });
  });

  it("reports a Gemini body without answers as an API error", async () => {
    const { fetch } = fakeFetch([() => jsonResponse({ error: { code: "safety" } })]);
    const client = JevClient.fromEnv(
      { JEV_CODE_PROVIDER: "gemini", GEMINI_API_KEY: "AIza-test" },
      { fetch, maxRetries: 0 },
    );
    await expect(client.systemOne(REQUEST)).rejects.toBeInstanceOf(JevApiError);
  });

  it("puts the Clef model in Cloudflare's path and unwraps the Workers AI envelope", async () => {
    const env = {
      JEV_CODE_PROVIDER: "cloudflare",
      CLOUDFLARE_API_TOKEN: "cf-token-1",
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT.toUpperCase(),
    };
    const { call, headers, response } = await send(env, {
      result: SYSTEM_ONE_ANSWERS,
      success: true,
      errors: [],
      messages: [],
    });
    expect(call.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/clef-flash`,
    );
    expect(headers.Authorization).toBe("Bearer cf-token-1");
    expect(call.body).toMatchObject({ model: "clef-flash", state: REQUEST.state });
    expect(response.answers.urgent).toEqual({ type: "noul", noul: 0.9 });
    // A bare body (a proxy that already unwrapped it) reads the same.
    const bare = await send(env, SYSTEM_ONE_ANSWERS);
    expect(bare.response.answers.severity).toMatchObject({ score: 0.7 });
    // The model id is one path segment, nothing more.
    expect(resolveConfig({ ...env, TYPESAFE_DEFAULT_MODEL: "clef" }).path).toBe("/clef");
    expect(configError({ ...env, TYPESAFE_DEFAULT_MODEL: "../../zones" })).toContain(
      "it goes into the request path",
    );
  });

  it("keeps a key sent in api-key out of error messages too", async () => {
    const key = "azure-secret-key-9";
    const { fetch } = fakeFetch([
      () => jsonResponse({ error: { message: `bad api-key: ${key}` } }, 401),
    ]);
    const client = JevClient.fromEnv(
      {
        JEV_CODE_PROVIDER: "azure",
        AZURE_OPENAI_API_KEY: key,
        AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com",
      },
      { fetch, maxRetries: 0 },
    );
    const error = await client.systemOne(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevApiError);
    expect(String((error as Error).message)).not.toContain(key);
    expect(JSON.stringify((error as JevApiError).body)).not.toContain(key);
  });
});
