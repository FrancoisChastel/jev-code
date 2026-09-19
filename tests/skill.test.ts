import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledSkillDir } from "../src/setup/skills.js";

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("missing frontmatter");
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const line of (match[1] ?? "").split("\n")) {
    const key = /^([a-z-]+):\s?(.*)$/.exec(line);
    if (key) {
      current = key[1];
      fields[current ?? ""] = (key[2] ?? "").replace(/^>-?\s*$/, "");
    } else if (current && /^\s+/.test(line)) {
      fields[current] = `${fields[current] ?? ""} ${line.trim()}`.trim();
    }
  }
  return fields;
}

describe("bundled skill", () => {
  const dir = bundledSkillDir();
  const text = readFileSync(join(dir, "SKILL.md"), "utf8");
  const meta = frontmatter(text);

  it("follows the Agent Skills specification", () => {
    expect(meta.name).toBe("jev");
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(dir.endsWith(`${join("skills", meta.name ?? "")}`)).toBe(true);
    expect(meta.description?.length).toBeGreaterThan(50);
    expect(meta.description?.length).toBeLessThanOrEqual(1024);
    expect(meta.license).toBe("MIT");
    expect(meta.compatibility?.length).toBeLessThanOrEqual(500);
  });

  it("stays short and links to reference files that exist", () => {
    const body = text.slice(text.indexOf("\n---\n") + 5);
    expect(body.split("\n").length).toBeLessThan(500);
    const links = [...body.matchAll(/\]\((references\/[^)]+)\)/g)].map((m) => m[1] ?? "");
    expect(links.length).toBeGreaterThan(2);
    for (const link of new Set(links)) expect(existsSync(join(dir, link))).toBe(true);
    for (const tool of ["jev_classify", "jev_check", "jev_score", "jev_rank", "jev_ask"])
      expect(body).toContain(tool);
  });
});
