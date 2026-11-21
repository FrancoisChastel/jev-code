import { describe, expect, it } from "vitest";
import { trimTrailing } from "../../src/core/text.js";

describe("trimTrailing", () => {
  it("removes every trailing copy of the character and nothing else", () => {
    expect(trimTrailing("https://gw.example///", "/")).toBe("https://gw.example");
    expect(trimTrailing("api.openai.com.", ".")).toBe("api.openai.com");
    expect(trimTrailing("a/b", "/")).toBe("a/b");
    expect(trimTrailing("///", "/")).toBe("");
    expect(trimTrailing("", "/")).toBe("");
  });

  it("stays linear on a long run of the character that does not end the string", () => {
    const hostile = `${"/".repeat(200_000)}x`;
    const started = performance.now();
    expect(trimTrailing(hostile, "/")).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
