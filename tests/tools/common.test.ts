import { describe, expect, it } from "vitest";
import { JevValidationError } from "../../src/core/errors.js";
import { LIMITS } from "../../src/core/limits.js";
import {
  assertRequestBudget,
  buildState,
  contextValue,
  prepareItems,
  sanitizeId,
  truncate,
} from "../../src/tools/common.js";

describe("common", () => {
  it("sanitises ids to safe keys", () => {
    expect(sanitizeId("src/http/client.ts")).toBe("src_http_client.ts");
    expect(sanitizeId("#412")).toBe("412");
    expect(sanitizeId("  ")).toBe("");
    expect(sanitizeId("x".repeat(100))).toHaveLength(LIMITS.idChars);
  });

  it("prepares items with unique keys and truncation flags", () => {
    const items = prepareItems([
      { id: "a/b", text: "short" },
      { id: "", text: "y".repeat(LIMITS.itemChars + 10) },
    ]);
    expect(items[0]).toMatchObject({ id: "a/b", key: "a_b", truncated: false });
    expect(items[1]?.key).toBe("item_2");
    expect(items[1]?.truncated).toBe(true);
    expect(items[1]?.text.endsWith("[…truncated]")).toBe(true);
  });

  it("rejects duplicate and colliding ids", () => {
    expect(() =>
      prepareItems([
        { id: "a", text: "1" },
        { id: "a", text: "2" },
      ]),
    ).toThrow(JevValidationError);
    expect(() =>
      prepareItems([
        { id: "a/b", text: "1" },
        { id: "a_b", text: "2" },
      ]),
    ).toThrow(/collide/);
  });

  it("builds state and normalises context", () => {
    expect(contextValue(undefined)).toBeUndefined();
    expect(contextValue("")).toBeUndefined();
    expect(contextValue({ policy: "x" })).toEqual({ policy: "x" });
    expect(buildState({ context: undefined, items: { a: "b" } })).toEqual({ items: { a: "b" } });
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("enforces the request budget", () => {
    const big = { state: "x".repeat(LIMITS.requestChars), questions: {} };
    expect(() => assertRequestBudget(big)).toThrow(/budget/);
    expect(() => assertRequestBudget({ state: "small", questions: {} })).not.toThrow();
  });
});
