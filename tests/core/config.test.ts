import { describe, expect, it } from "vitest";
import {
  describeConfig,
  describeProviderInUse,
  maskSecret,
  resolveConfig,
  serverUrlFromHost,
} from "../../src/core/config.js";
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

  it("sends a key to its variable's host whatever it looks like, and only hints at a lookalike", () => {
    // TypeSafe issues ts_ and apikey_ keys and shapes change, so the variable decides.
    expect(resolveConfig({ TYPESAFE_API_KEY: "apikey_abc" })).toMatchObject({
      provider: "typesafe",
      apiKey: "apikey_abc",
    });
    expect(describeConfig({ TYPESAFE_API_KEY: "apikey_abc" }).notes).toEqual([]);
    expect(resolveConfig({ TYPESAFE_API_KEY: "sk-or-v1-abc" })).toMatchObject({
      provider: "typesafe",
      keyEnv: "TYPESAFE_API_KEY",
      baseUrl: "https://api.typesafe.ai",
    });
    expect(resolveConfig({ OPENROUTER_API_KEY: "ts_abc" })).toMatchObject({
      provider: "openrouter",
      apiKey: "ts_abc",
      baseUrl: "https://openrouter.ai/api",
    });
    expect(describeConfig({ OPENROUTER_API_KEY: "ts_abc" }).notes.join(" ")).toMatch(
      /OPENROUTER_API_KEY looks like a TypeSafe key \(ts_…\) but is sent to OpenRouter.*move it to TYPESAFE_API_KEY/,
    );
    expect(describeConfig({ TYPESAFE_API_KEY: "sk-proj-abc" }).notes.join(" ")).toMatch(
      /looks like an OpenAI Decisions API key.*move it to OPENAI_API_KEY and set JEV_CODE_PROVIDER=openai/,
    );
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
      /unrecognised host.*OPENROUTER_API_KEY, which belongs to OpenRouter.*JEV_CODE_PROVIDER=openrouter/s,
    );
    const intended = resolveConfig({ ...ambient, JEV_CODE_PROVIDER: "openrouter" });
    expect(intended).toMatchObject({
      provider: "openrouter",
      baseUrl: "https://proxy.internal/or",
    });
  });

  it("lets TYPESAFE_API_KEY follow JEV_CODE_PROVIDER and TYPESAFE_BASE_URL like the TypeSafe SDK", () => {
    // The SDK's own OpenRouter and Vercel guides set TYPESAFE_API_KEY plus the base URL.
    const viaUrl = resolveConfig({
      TYPESAFE_API_KEY: "legacy",
      AI_GATEWAY_API_KEY: "legacy2",
      TYPESAFE_BASE_URL: "https://openrouter.ai/api",
    });
    expect(viaUrl).toMatchObject({
      provider: "openrouter",
      keyEnv: "TYPESAFE_API_KEY",
      apiKey: "legacy",
      baseUrl: "https://openrouter.ai/api",
      headers: { "HTTP-Referer": expect.any(String) },
    });
    const viaName = describeConfig({
      TYPESAFE_API_KEY: "legacy-key-without-prefix",
      JEV_CODE_PROVIDER: "openrouter",
    });
    expect(viaName).toMatchObject({ provider: "openrouter", keyEnv: "TYPESAFE_API_KEY" });
    expect(viaName.notes.join(" ")).toMatch(
      /TYPESAFE_API_KEY is sent to OpenRouter because JEV_CODE_PROVIDER=openrouter, as the TypeSafe SDK would; OPENROUTER_API_KEY says the same/,
    );
    expect(
      resolveConfig({
        TYPESAFE_API_KEY: "legacy-key",
        TYPESAFE_BASE_URL: "https://ai-gateway.vercel.sh/typesafe",
      }),
    ).toMatchObject({ provider: "vercel", keyEnv: "TYPESAFE_API_KEY", model: "typesafe-ai/jev" });
    // A ts_ key redirected by an override is still sent, with a hint naming the override.
    const redirected = describeConfig({
      TYPESAFE_API_KEY: "ts_a",
      TYPESAFE_BASE_URL: "https://openrouter.ai/api",
    });
    expect(redirected.provider).toBe("openrouter");
    expect(redirected.notes).toHaveLength(1);
    expect(redirected.notes.join(" ")).toMatch(
      /TYPESAFE_API_KEY looks like a TypeSafe key \(ts_…\) but is sent to OpenRouter.*unset TYPESAFE_BASE_URL/,
    );
    // The host's own variable wins over the generic one, and no switch is offered under a URL.
    const both = describeConfig({
      TYPESAFE_API_KEY: "ts_a",
      OPENROUTER_API_KEY: "sk-or-b",
      TYPESAFE_BASE_URL: "https://openrouter.ai/api",
    });
    expect(both).toMatchObject({ provider: "openrouter", keyEnv: "OPENROUTER_API_KEY" });
    expect(both.notes.join(" ")).toContain("both set; using OpenRouter (OPENROUTER_API_KEY).");
    expect(both.notes.join(" ")).not.toContain("to switch");
  });

  it("never sends a host-specific key to another host", () => {
    expect(resolveConfig({ OPENROUTER_API_KEY: "opaque-token" })).toMatchObject({
      provider: "openrouter",
      apiKey: "opaque-token",
    });
    expect(
      resolveConfig({ AI_GATEWAY_API_KEY: "eyJhbGciOi.oidc", JEV_CODE_PROVIDER: "vercel" }),
    ).toMatchObject({ provider: "vercel" });
    expect(() =>
      resolveConfig({ OPENROUTER_API_KEY: "sk-or-b", JEV_CODE_PROVIDER: "typesafe" }),
    ).toThrow(
      /JEV_CODE_PROVIDER=typesafe, but no key is set for TypeSafe: export TYPESAFE_API_KEY\. Set now: OPENROUTER_API_KEY; a host-specific key is never sent to another host/,
    );
    expect(() =>
      resolveConfig({ OPENROUTER_API_KEY: "sk-or-b", JEV_CODE_PROVIDER: "vercel" }),
    ).toThrow(
      /no key is set for Vercel AI Gateway: export AI_GATEWAY_API_KEY \(or TYPESAFE_API_KEY, which follows JEV_CODE_PROVIDER as the TypeSafe SDK does\)/,
    );
    expect(() =>
      resolveConfig({
        OPENROUTER_API_KEY: "sk-or-b",
        TYPESAFE_BASE_URL: "https://ai-gateway.vercel.sh/typesafe",
      }),
    ).toThrow(
      /TYPESAFE_BASE_URL points at Vercel AI Gateway, but no key is set.*AI_GATEWAY_API_KEY/s,
    );
    expect(() =>
      resolveConfig({
        OPENROUTER_API_KEY: "sk-or-b",
        JEV_CODE_PROVIDER: "openrouter",
        TYPESAFE_BASE_URL: "https://api.typesafe.ai",
      }),
    ).toThrow(/JEV_CODE_PROVIDER=openrouter but TYPESAFE_BASE_URL points at TypeSafe/);
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
    expect((error as Error).message).toContain(
      "OPENAI_API_KEY is set, but OpenAI Decisions API is used only when JEV_CODE_PROVIDER=openai is set.",
    );
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
    ).toThrow(
      /points at OpenAI Decisions API; OPENAI_API_KEY is set, but.*JEV_CODE_PROVIDER=openai/s,
    );
    // TYPESAFE_API_KEY never follows to OpenAI: the TypeSafe SDK does not speak that wire.
    expect(() =>
      resolveConfig({ TYPESAFE_API_KEY: "sk-proj-abc", JEV_CODE_PROVIDER: "openai" }),
    ).toThrow(
      /no key is set for OpenAI Decisions API: export OPENAI_API_KEY\. Set now: TYPESAFE_API_KEY/,
    );
  });

  it("uses Ollama without a key when JEV_CODE_PROVIDER names it, honouring OLLAMA_HOST", () => {
    expect(() => resolveConfig({})).toThrow(/Ollama: set JEV_CODE_PROVIDER=ollama \(no key/);
    // An Ollama key alone is not a held-back key; the opt-in hint still names the host.
    expect(() => resolveConfig({ OLLAMA_API_KEY: "oll_abc" })).toThrow(
      /^No API key found\..*OpenAI Decisions API: export OPENAI_API_KEY.*Ollama: set JEV_CODE_PROVIDER=ollama/s,
    );
    // A held-back OpenAI key and the other opt-in hint are both shown.
    expect(() => resolveConfig({ OPENAI_API_KEY: "sk-proj-abc" })).toThrow(
      /OPENAI_API_KEY is set, but OpenAI Decisions API is used only when JEV_CODE_PROVIDER=openai is set\. Ollama: set JEV_CODE_PROVIDER=ollama/,
    );
    const local = resolveConfig({ JEV_CODE_PROVIDER: "ollama" });
    expect(local).toMatchObject({
      provider: "ollama",
      wire: "systemone",
      keyEnv: "",
      apiKey: "",
      baseUrl: "http://localhost:11434",
      model: "nimble",
      headers: {},
    });
    expect(
      resolveConfig({ JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "gpu-box:11435" }).baseUrl,
    ).toBe("http://gpu-box:11435");
    expect(
      resolveConfig({ JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "https://ollama.internal/" })
        .baseUrl,
    ).toBe("https://ollama.internal");
    expect(
      resolveConfig({
        JEV_CODE_PROVIDER: "ollama",
        OLLAMA_HOST: "10.0.0.5",
        TYPESAFE_BASE_URL: "http://127.0.0.1:9",
      }),
    ).toMatchObject({ baseUrl: "http://127.0.0.1:9" });
    // A stale base URL on another known host never carries Ollama's key or the payload there.
    expect(() =>
      resolveConfig({
        JEV_CODE_PROVIDER: "ollama",
        OLLAMA_API_KEY: "oll_abc",
        TYPESAFE_BASE_URL: "https://api.openai.com",
      }),
    ).toThrow(/JEV_CODE_PROVIDER=ollama but TYPESAFE_BASE_URL points at OpenAI Decisions API/);
    const keyed = resolveConfig({
      JEV_CODE_PROVIDER: "ollama",
      OLLAMA_API_KEY: "oll_abc",
      TYPESAFE_DEFAULT_MODEL: "clef",
    });
    expect(keyed).toMatchObject({ keyEnv: "OLLAMA_API_KEY", apiKey: "oll_abc", model: "clef" });
    expect(serverUrlFromHost("0.0.0.0")).toBe("http://0.0.0.0:11434");
    expect(serverUrlFromHost("http://h:1/")).toBe("http://h:1");

    const summary = describeConfig({ JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "gpu-box" });
    expect(summary).toMatchObject({
      hasApiKey: true,
      provider: "ollama",
      apiKeyHint: null,
      baseUrl: "http://gpu-box:11434",
    });
    expect(summary.keyEnv).toBeUndefined();
    expect(summary.notes.join(" ")).toContain("OLLAMA_HOST");
    expect(describeProviderInUse(summary)).toBe("Using Ollama (no key).");
    // Ollama never captures a working key for another host.
    expect(describeConfig({ TYPESAFE_API_KEY: "ts_a" }).provider).toBe("typesafe");
  });

  it("rejects an unknown provider name", () => {
    expect(() =>
      resolveConfig({ TYPESAFE_API_KEY: "ts_a", JEV_CODE_PROVIDER: "cloudflare" }),
    ).toThrow(/JEV_CODE_PROVIDER must be one of typesafe, openrouter, vercel, openai, ollama/);
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
    expect(misplaced.provider).toBe("typesafe");
    expect(misplaced.notes.join(" ")).toMatch(
      /TYPESAFE_API_KEY looks like an OpenRouter key \(sk-or-…\) but is sent to TypeSafe, as set\. If it belongs to OpenRouter, move it to OPENROUTER_API_KEY/,
    );
  });

  it("surfaces a broken combination as a problem instead of throwing", () => {
    const summary = describeConfig({
      OPENROUTER_API_KEY: "sk-or-b",
      TYPESAFE_BASE_URL: "https://api.typesafe.ai",
    });
    expect(summary.hasApiKey).toBe(true);
    expect(summary.problem).toMatch(/points at TypeSafe, but no key is set for TypeSafe/);
    expect(summary.provider).toBeUndefined();
  });
});
