import { describe, expect, it } from "vitest";
import { describeConfig, maskSecret, resolveConfig } from "../../src/core/config.js";
import { JevConfigError } from "../../src/core/errors.js";

describe("resolveConfig", () => {
  it("applies defaults and trims values", () => {
    const config = resolveConfig({
      TYPESAFE_API_KEY: " ts_key ",
      TYPESAFE_BASE_URL: "https://x.test/",
    });
    expect(config).toEqual({
      apiKey: "ts_key",
      baseUrl: "https://x.test",
      model: "jev-latest",
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("fails clearly without a key and on malformed integers", () => {
    expect(() => resolveConfig({})).toThrow(JevConfigError);
    expect(() => resolveConfig({ TYPESAFE_API_KEY: "k", JEV_CODE_TIMEOUT_MS: "fast" })).toThrow(
      /JEV_CODE_TIMEOUT_MS/,
    );
  });

  it("describes configuration without leaking the key", () => {
    const summary = describeConfig({ TYPESAFE_API_KEY: "ts_1234567890abcdef" });
    expect(summary.hasApiKey).toBe(true);
    expect(summary.apiKeyHint).toBe("ts_1…cdef");
    expect(JSON.stringify(summary)).not.toContain("1234567890");
    expect(describeConfig({}).hasApiKey).toBe(false);
    expect(maskSecret("short")).toBe("*****");
  });
});
