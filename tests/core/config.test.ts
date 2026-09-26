import { describe, expect, it } from "vitest";
import { describeConfig, maskSecret, resolveConfig } from "../../src/core/config.js";
import { JevConfigError } from "../../src/core/errors.js";

describe("resolveConfig", () => {
  it("applies defaults and trims values", () => {
    const config = resolveConfig({
      OPENROUTER_API_KEY: " sk-or-key ",
    });
    expect(config).toEqual({
      apiKey: "sk-or-key",
      baseUrl: "https://openrouter.ai/api",
      model: "typesafe/jev-1.13",
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("fails clearly without a key and on malformed integers", () => {
    expect(() => resolveConfig({})).toThrow(JevConfigError);
    expect(() => resolveConfig({ OPENROUTER_API_KEY: "k", JEV_CODE_TIMEOUT_MS: "fast" })).toThrow(
      /JEV_CODE_TIMEOUT_MS/,
    );
  });

  it("describes configuration without leaking the key", () => {
    const summary = describeConfig({ OPENROUTER_API_KEY: "sk-or-1234567890abcdef" });
    expect(summary.hasApiKey).toBe(true);
    expect(summary.apiKeyHint).toBe("sk-o…cdef");
    expect(JSON.stringify(summary)).not.toContain("1234567890");
    expect(describeConfig({}).hasApiKey).toBe(false);
    expect(maskSecret("short")).toBe("*****");
  });
});
