import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, VERSION } from "../src/version.js";

const root = join(import.meta.dirname, "..");
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("Claude Code plugin manifests", () => {
  it("declares a plugin whose version tracks the package and whose paths exist", () => {
    const plugin = read(".claude-plugin/plugin.json");
    expect(plugin.name).toBe("jev-code");
    expect(plugin.version).toBe(VERSION);
    expect(existsSync(join(root, plugin.skills, "jev", "SKILL.md"))).toBe(true);
    const marketplace = read(".claude-plugin/marketplace.json");
    expect(marketplace.plugins.map((p: { name: string }) => p.name)).toEqual(["jev-code"]);
  });

  it("bundles the MCP server via .mcp.json at the plugin root", () => {
    const mcp = read(".mcp.json");
    expect(mcp.mcpServers.jev).toEqual({ command: "npx", args: ["-y", PACKAGE_NAME, "mcp"] });
  });

  it("keeps the skill version in sync with the package", () => {
    const skill = readFileSync(join(root, "skills", "jev", "SKILL.md"), "utf8");
    expect(skill).toContain(`version: "${VERSION}"`);
  });
});
