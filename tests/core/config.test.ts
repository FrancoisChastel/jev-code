import { describe, expect, it } from "vitest";
import { describeConfig, maskSecret, resolveConfig } from "../../src/core/config.js";
import { JevConfigError } from "../../src/core/errors.js";

describe("resolveConfig", () => {
  it("applies TypeSafe defaults and trims values", () => {
    const config = resolveConfig({
      TYPESAFE_API_KEY: " ts_key ",
      TYPESAFE_BASE_URL: "https://x.test/",
    });
    expect(config).toEqual({
      provider: "typesafe",
      wire: "systemone",
      keyEnv: "TYPESAFE_API_KEY",
      apiKey: "ts_key",
      baseUrl: "https://x.test",
      model: "jev-latest",
      timeoutMs: 30_000,
      maxRetries: 2,
      headers: {},
      requestIdHeader: "x-typesafe-request-id",
    });
  });

  it("picks OpenRouter from OPENROUTER_API_KEY with its base URL, model, and attribution headers", () => {
    const config = resolveConfig({ OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(config).toMatchObject({
      provider: "openrouter",
      keyEnv: "OPENROUTER_API_KEY",
      apiKey: "sk-or-v1-abc",
      baseUrl: "https://openrouter.ai/api",
      model: "jev-latest",
    });
    expect(config.headers["X-Title"]).toBe("jev-code");
    expect(config.headers["HTTP-Referer"]).toMatch(/^https:\/\/github\.com\//);
    expect(config.requestIdHeader).toBeUndefined();
  });

  it("picks Vercel AI Gateway from AI_GATEWAY_API_KEY with its model id", () => {
    expect(resolveConfig({ AI_GATEWAY_API_KEY: "vck_abc" })).toMatchObject({
      provider: "vercel",
      baseUrl: "https://ai-gateway.vercel.sh/typesafe",
      model: "typesafe-ai/jev",
      requestIdHeader: "x-vercel-id",
    });
  });

  it("routes by key prefix whichever variable holds the key", () => {
    const config = resolveConfig({ TYPESAFE_API_KEY: "sk-or-v1-abc" });
    expect(config.provider).toBe("openrouter");
    expect(config.keyEnv).toBe("TYPESAFE_API_KEY");
    expect(config.baseUrl).toBe("https://openrouter.ai/api");
  });

  it("prefers TypeSafe when several keys are set, and JEV_CODE_PROVIDER switches", () => {
    const both = { TYPESAFE_API_KEY: "ts_a", OPENROUTER_API_KEY: "sk-or-b" };
    expect(resolveConfig(both)).toMatchObject({ provider: "typesafe", apiKey: "ts_a" });
    expect(resolveConfig({ ...both, JEV_CODE_PROVIDER: "OpenRouter" })).toMatchObject({
      provider: "openrouter",
      apiKey: "sk-or-b",
    });
  });

  it("lets TYPESAFE_DEFAULT_MODEL override a preset, and a proxy base URL follow a TypeSafe key", () => {
    expect(
      resolveConfig({ OPENROUTER_API_KEY: "sk-or-b", TYPESAFE_DEFAULT_MODEL: "jev-1.12" }).model,
    ).toBe("jev-1.12");
    const proxied = resolveConfig({
      TYPESAFE_API_KEY: "ts_a",
      TYPESAFE_BASE_URL: "https://proxy.internal/ts/",
    });
    expect(proxied).toMatchObject({ provider: "typesafe", baseUrl: "https://proxy.internal/ts" });
    expect(
      describeConfig({
        TYPESAFE_API_KEY: "ts_a",
        TYPESAFE_BASE_URL: "https://proxy.internal",
      }).notes.join(" "),
    ).toContain("Requests go to https://proxy.internal");
  });

  it("sends another host's key to a proxy only when JEV_CODE_PROVIDER states the intent", () => {
    const ambient = {
      OPENROUTER_API_KEY: "sk-or-b",
      TYPESAFE_BASE_URL: "https://proxy.internal/or/",
    };
    expect(() => resolveConfig(ambient)).toThrow(
      /unrecognised host.*OpenRouter key.*JEV_CODE_PROVIDER=openrouter/s,
    );
    const intended = resolveConfig({ ...ambient, JEV_CODE_PROVIDER: "openrouter" });
    expect(intended).toMatchObject({
      provider: "openrouter",
      baseUrl: "https://proxy.internal/or",
    });
  });

  it("keeps an unprefixed key on its own variable's host and never lends it to another", () => {
    expect(resolveConfig({ OPENROUTER_API_KEY: "opaque-token" })).toMatchObject({
      provider: "openrouter",
      apiKey: "opaque-token",
    });
    expect(
      resolveConfig({ AI_GATEWAY_API_KEY: "eyJhbGciOi.oidc", JEV_CODE_PROVIDER: "vercel" }),
    ).toMatchObject({ provider: "vercel" });
    expect(() =>
      resolveConfig({
        TYPESAFE_API_KEY: "legacy-key-without-prefix",
        JEV_CODE_PROVIDER: "openrouter",
      }),
    ).toThrow(
      /no OpenRouter key is set; found TYPESAFE_API_KEY \(unrecognised prefix\).*OPENROUTER_API_KEY/s,
    );
    expect(() =>
      resolveConfig({
        TYPESAFE_API_KEY: "legacy",
        AI_GATEWAY_API_KEY: "legacy2",
        TYPESAFE_BASE_URL: "https://openrouter.ai/api",
      }),
    ).toThrow(/OpenRouter.*TYPESAFE_API_KEY.*AI_GATEWAY_API_KEY/s);
    expect(() =>
      resolveConfig({
        TYPESAFE_API_KEY: "legacy-key",
        TYPESAFE_BASE_URL: "https://ai-gateway.vercel.sh/typesafe",
      }),
    ).toThrow(/AI_GATEWAY_API_KEY/);
  });

  it("never sends a key to a host that did not issue it", () => {
    expect(() =>
      resolveConfig({ TYPESAFE_API_KEY: "ts_a", TYPESAFE_BASE_URL: "https://openrouter.ai/api" }),
    ).toThrow(/OpenRouter.*TypeSafe key/s);
    expect(() =>
      resolveConfig({ TYPESAFE_API_KEY: "ts_a", JEV_CODE_PROVIDER: "openrouter" }),
    ).toThrow(/OPENROUTER_API_KEY/);
    expect(() =>
      resolveConfig({ OPENROUTER_API_KEY: "sk-or-b", JEV_CODE_PROVIDER: "typesafe" }),
    ).toThrow(/TYPESAFE_API_KEY/);
    expect(() =>
      resolveConfig({
        OPENROUTER_API_KEY: "sk-or-b",
        JEV_CODE_PROVIDER: "openrouter",
        TYPESAFE_BASE_URL: "https://api.typesafe.ai",
      }),
    ).toThrow(/JEV_CODE_PROVIDER/);
  });

  it("uses OpenAI's Decisions API only when JEV_CODE_PROVIDER asks for it", () => {
    let error: unknown;
    try {
      resolveConfig({ OPENAI_API_KEY: "sk-proj-abc" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(JevConfigError);
    expect((error as Error).message).toMatch(/^No API key found/);
    expect((error as Error).message).toContain("OPENAI_API_KEY holds an OpenAI Decisions API key");
    expect((error as Error).message).toContain("JEV_CODE_PROVIDER=openai");
    const summary = describeConfig({ OPENAI_API_KEY: "sk-proj-abc" });
    expect(summary.hasApiKey).toBe(false);
    expect(summary.notes.join(" ")).toContain("JEV_CODE_PROVIDER=openai");

    const config = resolveConfig({ OPENAI_API_KEY: "sk-proj-abc", JEV_CODE_PROVIDER: "openai" });
    expect(config).toMatchObject({
      provider: "openai",
      wire: "openai-decisions",
      keyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com",
      model: "gpt-6-luna",
      requestIdHeader: "x-request-id",
      headers: {},
    });
    // An ambient OpenAI key never displaces a working host, and is not even mentioned then.
    const both = describeConfig({ TYPESAFE_API_KEY: "ts_a", OPENAI_API_KEY: "sk-proj-abc" });
    expect(both.provider).toBe("typesafe");
    expect(both.notes).toEqual([]);
    // A base URL on OpenAI without the opt-in points at the real fix, not at a key already set.
    expect(() =>
      resolveConfig({
        TYPESAFE_API_KEY: "ts_a",
        OPENAI_API_KEY: "sk-proj-abc",
        TYPESAFE_BASE_URL: "https://api.openai.com",
      }),
    ).toThrow(/points at OpenAI Decisions API.*OPENAI_API_KEY holds.*JEV_CODE_PROVIDER=openai/s);
    // An OpenAI key in another variable is held back the same way, and usable once asked for.
    expect(() => resolveConfig({ TYPESAFE_API_KEY: "sk-proj-abc" })).toThrow(
      /JEV_CODE_PROVIDER=openai/,
    );
    expect(
      resolveConfig({ TYPESAFE_API_KEY: "sk-proj-abc", JEV_CODE_PROVIDER: "openai" }),
    ).toMatchObject({
      provider: "openai",
      keyEnv: "TYPESAFE_API_KEY",
    });
  });

  it("rejects an unknown provider name", () => {
    expect(() =>
      resolveConfig({ TYPESAFE_API_KEY: "ts_a", JEV_CODE_PROVIDER: "cloudflare" }),
    ).toThrow(/JEV_CODE_PROVIDER must be one of typesafe, openrouter, vercel, openai/);
  });

  it("fails clearly without a key, naming every accepted variable, and on malformed integers", () => {
    let error: unknown;
    try {
      resolveConfig({});
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(JevConfigError);
    const message = (error as Error).message;
    expect(message).toMatch(/^No API key found/);
    for (const name of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY"]) {
      expect(message).toContain(name);
    }
    expect(() => resolveConfig({ TYPESAFE_API_KEY: "k", JEV_CODE_TIMEOUT_MS: "fast" })).toThrow(
      /JEV_CODE_TIMEOUT_MS/,
    );
  });
});

describe("describeConfig", () => {
  it("describes configuration without leaking the key", () => {
    const summary = describeConfig({ TYPESAFE_API_KEY: "ts_1234567890abcdef" });
    expect(summary).toMatchObject({
      hasApiKey: true,
      apiKeyHint: "ts_1…cdef",
      provider: "typesafe",
      providerLabel: "TypeSafe",
      keyEnv: "TYPESAFE_API_KEY",
      baseUrl: "https://api.typesafe.ai",
      model: "jev-latest",
      notes: [],
    });
    expect(JSON.stringify(summary)).not.toContain("1234567890");
    expect(maskSecret("short")).toBe("*****");
  });

  it("reports a missing key without throwing", () => {
    const summary = describeConfig({});
    expect(summary.hasApiKey).toBe(false);
    expect(summary.provider).toBeUndefined();
    expect(summary.baseUrl).toBe("https://api.typesafe.ai");
    expect(summary.problem).toBeUndefined();
  });

  it("notes when several keys are set and when a key sits in another host's variable", () => {
    const both = describeConfig({ TYPESAFE_API_KEY: "ts_a", OPENROUTER_API_KEY: "sk-or-b" });
    expect(both.notes.join(" ")).toMatch(
      /TYPESAFE_API_KEY and OPENROUTER_API_KEY are both set.*using TypeSafe.*JEV_CODE_PROVIDER=openrouter/,
    );
    const misplaced = describeConfig({ TYPESAFE_API_KEY: "sk-or-b" });
    expect(misplaced.provider).toBe("openrouter");
    expect(misplaced.notes.join(" ")).toMatch(
      /TYPESAFE_API_KEY holds an OpenRouter key.*OPENROUTER_API_KEY/,
    );
  });

  it("surfaces a broken combination as a problem instead of throwing", () => {
    const summary = describeConfig({
      TYPESAFE_API_KEY: "ts_a",
      TYPESAFE_BASE_URL: "https://openrouter.ai/api",
    });
    expect(summary.hasApiKey).toBe(true);
    expect(summary.problem).toMatch(/OpenRouter/);
    expect(summary.provider).toBeUndefined();
  });
});
