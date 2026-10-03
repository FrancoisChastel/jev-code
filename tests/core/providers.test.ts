import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER,
  keyPrefixes,
  PROVIDER_NAMES,
  PROVIDERS,
  providerByName,
  providerForKey,
  providerForUrl,
} from "../../src/core/providers.js";

describe("providers", () => {
  it("lists TypeSafe first and gives every host a key variable, prefix, base URL, and model", () => {
    expect(PROVIDER_NAMES).toEqual(["typesafe", "openrouter", "vercel", "openai", "ollama"]);
    for (const provider of PROVIDERS) {
      expect(provider.keyEnv).toMatch(/_KEY$/);
      if (provider.keyless) {
        expect(provider.keyPrefix).toBeUndefined();
        expect(provider.explicitOnly).toBe(true);
        expect(provider.hostEnv).toBeDefined();
      } else {
        expect(provider.keyPrefix?.length ?? 0).toBeGreaterThan(2);
        expect(provider.baseUrl).toMatch(/^https:\/\//);
        expect(new URL(provider.baseUrl).hostname).toBe(provider.host);
      }
      expect(provider.model.length).toBeGreaterThan(0);
      expect(provider.keysUrl).toMatch(/^https:\/\//);
    }
  });

  it("keeps prefixes distinct and the table frozen", () => {
    for (const a of PROVIDERS) {
      for (const b of PROVIDERS) {
        if (a === b) continue;
        for (const pa of keyPrefixes(a)) {
          for (const pb of keyPrefixes(b)) expect(pa.startsWith(pb)).toBe(false);
        }
      }
      expect(Object.isFrozen(a)).toBe(true);
      if (a.headers) expect(Object.isFrozen(a.headers)).toBe(true);
    }
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
  });

  it("recognises the usual key shapes as hints", () => {
    expect(keyPrefixes(DEFAULT_PROVIDER)).toEqual(["ts_", "apikey_"]);
    expect(providerForKey("ts_abc")?.name).toBe("typesafe");
    expect(providerForKey("apikey_abc")?.name).toBe("typesafe");
    expect(providerForKey("sk-or-v1-abc")?.name).toBe("openrouter");
    expect(providerForKey("vck_abc")?.name).toBe("vercel");
    expect(providerForKey("sk-proj-abc")?.name).toBe("openai");
    expect(providerForKey("sk-svcacct-abc")?.name).toBe("openai");
    expect(providerForKey("sk-or-v1-abc")?.name).toBe("openrouter");
    expect(providerByName("openai")?.explicitOnly).toBe(true);
    expect(providerByName("openai")?.wire).toBe("openai-decisions");
    expect(providerByName("ollama")).toMatchObject({
      keyless: true,
      hostEnv: "OLLAMA_HOST",
      model: "nimble",
    });
    expect(providerForUrl("http://localhost:11434")).toBeUndefined();
    expect(providerForKey("sk-ant-abc")).toBeUndefined();
    expect(providerForKey("")).toBeUndefined();
  });

  it("recognises a provider from a base URL host and tolerates junk", () => {
    expect(providerForUrl("https://openrouter.ai/api")?.name).toBe("openrouter");
    expect(providerForUrl("https://ai-gateway.vercel.sh/typesafe/")?.name).toBe("vercel");
    expect(providerForUrl("https://API.TYPESAFE.AI")?.name).toBe("typesafe");
    expect(providerForUrl("https://proxy.internal/v1")).toBeUndefined();
    expect(providerForUrl("not a url")).toBeUndefined();
  });

  it("looks up providers by name, case-insensitively", () => {
    expect(providerByName("OpenRouter")?.keyEnv).toBe("OPENROUTER_API_KEY");
    expect(providerByName("cloudflare")).toBeUndefined();
  });
});
