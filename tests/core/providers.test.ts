import { describe, expect, it } from "vitest";
import {
  keyPrefixes,
  PROVIDER_NAMES,
  PROVIDERS,
  providerByName,
  providerForKey,
  providerForUrl,
} from "../../src/core/providers.js";

describe("providers", () => {
  it("lists TypeSafe first and gives every host a key variable, prefix, base URL, and model", () => {
    expect(PROVIDER_NAMES).toEqual(["typesafe", "openrouter", "vercel", "openai"]);
    for (const provider of PROVIDERS) {
      expect(provider.keyEnv).toMatch(/_KEY$/);
      expect(provider.keyPrefix.length).toBeGreaterThan(2);
      expect(provider.baseUrl).toMatch(/^https:\/\//);
      expect(new URL(provider.baseUrl).hostname).toBe(provider.host);
      expect(provider.model.length).toBeGreaterThan(0);
      expect(provider.keysUrl).toMatch(/^https:\/\//);
    }
  });

  it("keeps prefixes distinct and the table frozen, since it decides where keys go", () => {
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

  it("routes a key by its prefix", () => {
    expect(providerForKey("ts_abc")?.name).toBe("typesafe");
    expect(providerForKey("sk-or-v1-abc")?.name).toBe("openrouter");
    expect(providerForKey("vck_abc")?.name).toBe("vercel");
    expect(providerForKey("sk-proj-abc")?.name).toBe("openai");
    expect(providerForKey("sk-svcacct-abc")?.name).toBe("openai");
    expect(providerForKey("sk-or-v1-abc")?.name).toBe("openrouter");
    expect(providerByName("openai")?.explicitOnly).toBe(true);
    expect(providerByName("openai")?.wire).toBe("openai-decisions");
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
