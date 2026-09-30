import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "..", "scripts", "sync-version.mjs");
const NAME = "@acme/tool";

function fixture(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "jev-sync-"));
  mkdirSync(join(root, ".claude-plugin"));
  mkdirSync(join(root, "skills", "jev"), { recursive: true });
  mkdirSync(join(root, "docs", "harnesses"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: NAME, version }));
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    '{\n  "name": "x",\n  "version": "0.1.0"\n}\n',
  );
  writeFileSync(join(root, "skills", "jev", "SKILL.md"), 'metadata:\n  version: "0.1.0"\nbody\n');
  writeFileSync(
    join(root, ".mcp.json"),
    `{"mcpServers":{"jev":{"command":"npx","args":["-y","${NAME}","mcp"]}}}`,
  );
  writeFileSync(
    join(root, "README.md"),
    `Run npx -y ${NAME}@latest setup, which registers npx -y ${NAME}@0.1.0 mcp. Marketplace: claude plugin install jev-code@jev-code.\n`,
  );
  writeFileSync(join(root, "docs", "harnesses", "a.md"), `args = ["-y", "${NAME}@0.1.0", "mcp"]\n`);
  return root;
}

describe("scripts/sync-version.mjs", () => {
  it("moves every version field and pinned command to package.json's version, and nothing else", () => {
    const root = fixture("1.2.3");
    const out = execFileSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(out).toContain("synced 1.2.3");
    expect(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")).toContain(
      '"version": "1.2.3"',
    );
    expect(readFileSync(join(root, "skills", "jev", "SKILL.md"), "utf8")).toContain(
      'version: "1.2.3"',
    );
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers.jev.args).toEqual([
      "-y",
      `${NAME}@1.2.3`,
      "mcp",
    ]);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain(`${NAME}@latest setup`);
    expect(readme).toContain(`${NAME}@1.2.3 mcp`);
    expect(readme).toContain("claude plugin install jev-code@jev-code");
    expect(readFileSync(join(root, "docs", "harnesses", "a.md"), "utf8")).toContain(
      `"${NAME}@1.2.3"`,
    );
    const again = execFileSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(again).toContain("everything already at 1.2.3");
  });

  it("handles prerelease versions", () => {
    const root = fixture("2.0.0-beta.1");
    execFileSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(readFileSync(join(root, "docs", "harnesses", "a.md"), "utf8")).toContain(
      `${NAME}@2.0.0-beta.1`,
    );
    execFileSync(process.execPath, [script, root], { encoding: "utf8" });
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain(`${NAME}@2.0.0-beta.1 mcp`);
  });
});
