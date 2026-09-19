import { describe, expect, it } from "vitest";
import { findTool, TOOL_NAMES, TOOLS, USAGE_GUIDANCE } from "../../src/tools/index.js";

describe("tool registry", () => {
  it("exposes five uniquely named tools with complete metadata", () => {
    expect(TOOL_NAMES).toEqual(["jev_classify", "jev_check", "jev_score", "jev_rank", "jev_ask"]);
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(80);
      expect(tool.description.length).toBeLessThan(1200);
      expect(tool.promptSnippet.length).toBeLessThan(160);
      expect(tool.guidelines.every((line) => line.includes(tool.name))).toBe(true);
      expect(Object.keys(tool.schema.shape).length).toBeGreaterThan(0);
    }
    expect(USAGE_GUIDANCE.length).toBeGreaterThan(3);
  });

  it("finds tools by full or short name", () => {
    expect(findTool("classify")?.name).toBe("jev_classify");
    expect(findTool("jev_rank")?.name).toBe("jev_rank");
    expect(findTool("nope")).toBeUndefined();
  });
});
