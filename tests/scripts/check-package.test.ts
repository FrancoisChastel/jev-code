import { describe, expect, it } from "vitest";
import { checkPackage } from "../../scripts/check-package.mjs";

const clean = (paths: string[], files: Record<string, string> = {}) =>
  checkPackage(paths, (path) => files[path] ?? "");

describe("checkPackage", () => {
  it("accepts the files the package is meant to ship", () => {
    expect(
      clean([
        "package.json",
        "LICENSE",
        "README.md",
        "CHANGELOG.md",
        "dist/cli.js",
        "dist/core/client.js.map",
        "skills/jev/SKILL.md",
        "integrations/pi/jev.ts",
      ]),
    ).toEqual([]);
  });

  it("rejects anything outside the allowlist", () => {
    expect(clean(["src/core/client.ts", ".mcp.json", "SECURITY.md"])).toEqual([
      "src/core/client.ts: not in the package allowlist",
      ".mcp.json: not in the package allowlist",
      "SECURITY.md: not in the package allowlist",
    ]);
  });

  it("rejects secret-shaped and artefact paths even under an allowed directory", () => {
    const problems = clean([
      "dist/.env",
      "dist/.env.local",
      "skills/jev/server.pem",
      "dist/.npmrc",
      "integrations/pi/.mcp.json",
      "dist/tests/helpers.js",
      "dist/coverage/index.html",
      "dist/config.json.bak-2026-11-20T00-00-00",
      "dist/jev-code-0.5.1.tgz",
    ]);
    expect(problems).toHaveLength(9);
    expect(problems[0]).toBe("dist/.env: looks like a environment file");
  });

  it("does not flag look-alike names", () => {
    expect(clean(["dist/core/environment.js", "skills/jev/references/tests-and-keys.md"])).toEqual(
      [],
    );
  });

  it("rejects shipped content that contains a credential", () => {
    const files = {
      "dist/a.js": `const key = "sk-or-v1-${"a".repeat(64)}";`,
      "dist/b.js": `const token = "npm_${"B".repeat(36)}";`,
      "dist/c.js": "-----BEGIN OPENSSH PRIVATE KEY-----",
      "dist/d.js": `export const k = "ts_${"c".repeat(40)}";`,
      "dist/e.js": `const g = "AIza${"d".repeat(35)}";`,
      "dist/f.js": `const p = "pplx-${"e".repeat(48)}";`,
      "dist/g.js": `const v = "vck_${"f".repeat(40)}";`,
    };
    expect(clean(Object.keys(files), files)).toEqual([
      "dist/a.js: contains something that looks like a API key (sk-…)",
      "dist/b.js: contains something that looks like a npm token",
      "dist/c.js: contains something that looks like a private key",
      "dist/d.js: contains something that looks like a API key",
      "dist/e.js: contains something that looks like a Google API key",
      "dist/f.js: contains something that looks like a Perplexity API key",
      "dist/g.js: contains something that looks like a Vercel AI Gateway key",
    ]);
  });

  it("lets masked examples from the docs through", () => {
    expect(
      clean(["README.md"], { "README.md": "doctor shows sk-o…1234 and ts_abcd…wxyz" }),
    ).toEqual([]);
  });

  it("skips files it cannot read", () => {
    expect(checkPackage(["dist/cli.js"], () => undefined)).toEqual([]);
  });
});
