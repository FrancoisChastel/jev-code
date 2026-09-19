import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { type CliIO, runCli } from "../../src/cli/run.js";
import { fakeFetch, jsonResponse } from "../helpers.js";

function io(overrides: Partial<CliIO> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const root = mkdtempSync(join(tmpdir(), "jev-cli-"));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  mkdirSync(home);
  mkdirSync(cwd);
  const base: Partial<CliIO> = {
    stdout: (t) => {
      out.push(t);
    },
    stderr: (t) => {
      err.push(t);
    },
    readStdin: async () => "",
    stdinIsTTY: true,
    stdoutIsTTY: false,
    env: { TYPESAFE_API_KEY: "ts_test" },
    home,
    cwd,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    which: () => null,
    serve: async () => {},
    ...overrides,
  };
  return { io: base, out: () => out.join(""), err: () => err.join(""), home, cwd };
}

describe("parseArgs", () => {
  it("parses commands, positionals, value flags, boolean flags, and negations", () => {
    expect(
      parseArgs([
        "setup",
        "claude",
        "pi",
        "--project",
        "--no-env",
        "--command",
        "node x mcp",
        "--pi-source=./here",
      ]),
    ).toEqual({
      command: "setup",
      positionals: ["claude", "pi"],
      flags: { project: true, env: false, command: "node x mcp", "pi-source": "./here" },
    });
    expect(parseArgs(["-h"]).flags.help).toBe(true);
    expect(parseArgs(["-v"]).flags.version).toBe(true);
    expect(parseArgs(["classify", "--", "--weird"]).positionals).toEqual(["--weird"]);
    expect(() => parseArgs(["classify", "--input"])).toThrow(/requires a value/);
  });
});

describe("runCli", () => {
  it("prints help and version", async () => {
    const h = io();
    expect(await runCli([], h.io)).toBe(0);
    expect(h.out()).toContain("Usage");
    const v = io();
    expect(await runCli(["version"], v.io)).toBe(0);
    expect(v.out()).toMatch(/@francoischastel\/jev-code \d+\.\d+\.\d+/);
    const u = io();
    expect(await runCli(["frobnicate"], u.io)).toBe(2);
    expect(u.err()).toContain("unknown command");
  });

  it("runs a tool from an inline payload and prints compact JSON", async () => {
    const { fetch } = fakeFetch([
      () => jsonResponse({ model: "jev-latest", answers: { ok: { type: "noul", noul: 0.9 } } }),
    ]);
    const t = io({ fetch });
    const code = await runCli(
      ["check", "--json", JSON.stringify({ state: "12 passed", checks: { ok: "All passed?" } })],
      t.io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(t.out());
    expect(parsed.results[0]).toMatchObject({ id: "ok", verdict: "yes" });
    expect(t.out().split("\n")[0]).not.toContain("\n  ");
  });

  it("reads payloads from a file, from stdin, and pretty-prints on request", async () => {
    const { fetch } = fakeFetch([
      () =>
        jsonResponse({
          model: "m",
          answers: {
            a: { type: "choice", choice: "x", probabilities: { x: 1, y: 0 }, confidence: 1 },
          },
        }),
      () => jsonResponse({ model: "m", answers: { a: { type: "noul", noul: 0.2 } } }),
    ]);
    const f = io({ fetch });
    const file = join(f.cwd, "payload.json");
    writeFileSync(
      file,
      JSON.stringify({ items: [{ id: "a", text: "t" }], classes: { x: null, y: null } }),
    );
    expect(await runCli(["classify", "--input", file, "--pretty"], f.io)).toBe(0);
    expect(f.out()).toContain('\n  "summary"');
    const s = io({
      fetch,
      stdinIsTTY: false,
      readStdin: async () => JSON.stringify({ state: "s", checks: { a: "q" } }),
    });
    expect(await runCli(["check"], s.io)).toBe(0);
    expect(JSON.parse(s.out()).results[0].verdict).toBe("no");
  });

  it("fails with usage errors for missing input, bad JSON, invalid payloads, and missing keys", async () => {
    const none = io();
    expect(await runCli(["classify"], none.io)).toBe(2);
    expect(none.err()).toContain("no input");
    const bad = io();
    expect(await runCli(["ask", "--json", "{nope"], bad.io)).toBe(2);
    expect(bad.err()).toContain("not valid JSON");
    const invalid = io();
    expect(await runCli(["rank", "--json", "{}"], invalid.io)).toBe(2);
    expect(invalid.err()).toContain("Invalid input for jev_rank");
    const nokey = io({ env: {} });
    expect(
      await runCli(
        ["check", "--json", JSON.stringify({ state: "s", checks: { a: "q" } })],
        nokey.io,
      ),
    ).toBe(2);
    expect(nokey.err()).toContain("TYPESAFE_API_KEY is not set");
  });

  it("returns 1 when the API fails", async () => {
    const { fetch } = fakeFetch([() => jsonResponse({ message: "nope" }, 403)]);
    const t = io({ fetch });
    expect(
      await runCli(["check", "--json", JSON.stringify({ state: "s", checks: { a: "q" } })], t.io),
    ).toBe(1);
    expect(t.err()).toContain("403");
  });

  it("prints the skill path, runs the MCP server, and reports setup", async () => {
    const s = io();
    expect(await runCli(["skill"], s.io)).toBe(0);
    expect(s.out().trim().endsWith(join("skills", "jev"))).toBe(true);
    let served = false;
    const m = io({
      serve: async () => {
        served = true;
      },
    });
    expect(await runCli(["mcp"], m.io)).toBe(0);
    expect(served).toBe(true);
    const setup = io();
    expect(await runCli(["setup", "opencode", "--dry-run"], setup.io)).toBe(0);
    expect(setup.out()).toContain("OpenCode");
    expect(setup.out()).toContain("would do");
    expect(setup.out()).toContain("Dry run: nothing was written.");
    const badHarness = io();
    expect(await runCli(["setup", "cursor"], badHarness.io)).toBe(2);
    expect(badHarness.err()).toContain("unknown harness");
  });

  it("runs doctor with and without a live check", async () => {
    const missing = io({ env: {} });
    expect(await runCli(["doctor"], missing.io)).toBe(1);
    expect(missing.out()).toContain("NOT SET");
    const { fetch } = fakeFetch([
      () =>
        jsonResponse({
          model: "jev-latest",
          answers: { alive: { type: "noul", noul: 1 } },
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
    ]);
    const live = io({
      fetch,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    expect(await runCli(["doctor", "--live"], live.io)).toBe(0);
    expect(live.out()).toContain("Live check: ok");
    expect(live.out()).toContain("5 input tokens");
    expect(live.out()).toMatch(/Claude Code\s+found\s+missing\s+registered/);
    expect(live.out()).not.toContain("ts_test");
    const { fetch: failing } = fakeFetch([() => jsonResponse({ message: "bad key" }, 401)]);
    const down = io({ fetch: failing });
    expect(await runCli(["doctor", "--live"], down.io)).toBe(1);
    expect(down.out()).toContain("Live check: FAILED");
  });
});
