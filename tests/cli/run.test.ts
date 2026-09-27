import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    promptSecret: async () => {
      throw new Error("stub promptSecret in this test");
    },
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
    expect(nokey.err()).toContain("No API key found");
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
    expect(missing.out()).toContain("OPENROUTER_API_KEY");
    expect(missing.out()).toContain("AI_GATEWAY_API_KEY");
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
    expect(live.out()).toMatch(/provider\s+TypeSafe \(TYPESAFE_API_KEY/);
    expect(live.out()).toContain("via TypeSafe");
    expect(live.out()).toMatch(/Claude Code\s+found\s+missing\s+registered/);
    expect(live.out()).not.toContain("ts_test");
    const { fetch: failing } = fakeFetch([() => jsonResponse({ message: "bad key" }, 401)]);
    const down = io({ fetch: failing });
    expect(await runCli(["doctor", "--live"], down.io)).toBe(1);
    expect(down.out()).toContain("Live check: FAILED");
  });

  it("shows the provider in doctor, warns about extra keys, and flags broken combinations", async () => {
    const { fetch } = fakeFetch([
      () =>
        jsonResponse({ model: "typesafe/jev-1.13", answers: { alive: { type: "noul", noul: 1 } } }),
    ]);
    const openrouter = io({
      fetch,
      env: { OPENROUTER_API_KEY: "sk-or-v1-1234567890", TYPESAFE_API_KEY: "sk-or-v1-0987654321" },
    });
    expect(await runCli(["doctor", "--live"], openrouter.io)).toBe(0);
    expect(openrouter.out()).toMatch(/provider\s+OpenRouter \(TYPESAFE_API_KEY sk-o…4321\)/);
    expect(openrouter.out()).toContain("https://openrouter.ai/api");
    expect(openrouter.out()).toContain("both set");
    expect(openrouter.out()).toContain("via OpenRouter (typesafe/jev-1.13)");
    expect(openrouter.out()).not.toContain("1234567890");
    const broken = io({
      env: { TYPESAFE_API_KEY: "ts_a", TYPESAFE_BASE_URL: "https://openrouter.ai/api" },
    });
    expect(await runCli(["doctor"], broken.io)).toBe(1);
    expect(broken.out()).toContain("PROBLEM");
    expect(broken.out()).toContain("OpenRouter");
    const brokenLive = io({
      env: { TYPESAFE_API_KEY: "ts_a", TYPESAFE_BASE_URL: "https://openrouter.ai/api" },
    });
    expect(await runCli(["doctor", "--live"], brokenLive.io)).toBe(1);
    expect(brokenLive.out()).toContain("Live check: skipped, fix the configuration problem");
    expect(brokenLive.out()).not.toContain("Live check: FAILED");
  });

  it("asks for a key during setup when none is set and stdin is a terminal", async () => {
    const asked: string[] = [];
    const s = io({
      env: {},
      promptSecret: async (question) => {
        asked.push(question);
        return " sk-or-v1-pasted ";
      },
    });
    expect(await runCli(["setup", "opencode"], s.io)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/TypeSafe, OpenRouter, or Vercel AI Gateway key/);
    const config = JSON.parse(
      readFileSync(join(s.home, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(config.mcp.jev.environment).toEqual({ OPENROUTER_API_KEY: "sk-or-v1-pasted" });
    expect(s.out()).toContain("Using OpenRouter (OPENROUTER_API_KEY");
    expect(s.out()).toContain("export OPENROUTER_API_KEY=");
    expect(s.out()).not.toContain("pasted");
  });

  it("skips the prompt when a key is set, without a terminal, on --no-prompt, on --dry-run, and on Enter", async () => {
    let asked = 0;
    const prompt = async () => {
      asked += 1;
      return "";
    };
    await runCli(["setup", "opencode"], io({ promptSecret: prompt }).io);
    await runCli(
      ["setup", "opencode"],
      io({ env: {}, stdinIsTTY: false, promptSecret: prompt }).io,
    );
    await runCli(["setup", "opencode", "--no-prompt"], io({ env: {}, promptSecret: prompt }).io);
    await runCli(["setup", "opencode", "--dry-run"], io({ env: {}, promptSecret: prompt }).io);
    await runCli(["setup", "opencode", "--no-tool"], io({ env: {}, promptSecret: prompt }).io);
    expect(asked).toBe(0);
    const empty = io({ env: {}, promptSecret: prompt });
    expect(await runCli(["setup", "opencode"], empty.io)).toBe(0);
    expect(asked).toBe(1);
    expect(empty.out()).toContain("No API key found");
    const cancelled = io({
      env: {},
      promptSecret: async () => {
        throw new Error("Cancelled.");
      },
    });
    expect(await runCli(["setup", "opencode"], cancelled.io)).toBe(1);
    expect(cancelled.err()).toContain("Cancelled");
  });

  it("stores an unrecognised pasted key as TypeSafe's, and reports a conflicting override", async () => {
    const plain = io({ env: {}, promptSecret: async () => "opaque-key-1234" });
    expect(await runCli(["setup", "opencode"], plain.io)).toBe(0);
    expect(plain.out()).toContain("Using TypeSafe (TYPESAFE_API_KEY");
    expect(plain.out()).toContain("export TYPESAFE_API_KEY=");
    const conflicting = io({
      env: { JEV_CODE_PROVIDER: "vercel" },
      promptSecret: async () => "opaque-key-1234",
    });
    expect(await runCli(["setup", "opencode"], conflicting.io)).toBe(0);
    expect(conflicting.out()).not.toContain("Using ");
    expect(conflicting.out()).toContain("no Vercel AI Gateway key is set");
    expect(conflicting.out()).toContain("No key was written into any config");
  });
});
