import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { type CliIO, runCli } from "../../src/cli/run.js";
import { PACKAGE_NAME, VERSION } from "../../src/version.js";
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
    promptLine: async () => "",
    ...overrides,
  };
  return { io: base, out: () => out.join(""), err: () => err.join(""), home, cwd };
}

/** A System One answer to doctor's and setup's one-question check. */
function pong(model: string): Response {
  return jsonResponse({ model, answers: { alive: { type: "noul", noul: 1 } } });
}

/** Answers prompts in order, then empty lines. */
function script(lines: string[]): () => Promise<string> {
  return async () => lines.shift() ?? "";
}

/** The environment setup stored for the jev server in OpenCode's user config. */
function stored(home: string): Record<string, string> | undefined {
  return JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")).mcp
    .jev.environment;
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
    expect(v.out()).toMatch(/@french-castle\/jev-code \d+\.\d+\.\d+/);
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

  it("reports the pinned version of each registration and when to re-run setup", async () => {
    const d = io({
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      exec: async (_bin, args) =>
        args[1] === "get"
          ? {
              code: 0,
              stdout: `jev\n  Command: npx\n  Args: -y ${PACKAGE_NAME}@0.1.0 mcp\n`,
              stderr: "",
            }
          : { code: 0, stdout: "", stderr: "" },
    });
    mkdirSync(join(d.home, ".config", "opencode"), { recursive: true });
    writeFileSync(
      join(d.home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        mcp: { jev: { type: "local", command: ["npx", "-y", PACKAGE_NAME, "mcp"] } },
      }),
    );
    mkdirSync(join(d.home, ".codex"), { recursive: true });
    writeFileSync(
      join(d.home, ".codex", "config.toml"),
      `[mcp_servers.jev]\ncommand = "npx"\nargs = ["-y", "${PACKAGE_NAME}@${VERSION}", "mcp"]\n`,
    );
    expect(await runCli(["doctor"], d.io)).toBe(0);
    expect(d.out()).toMatch(/Claude Code.*registered v0\.1\.0, run setup to move to v/);
    expect(d.out()).toMatch(
      new RegExp(`Codex.*registered v${VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    expect(d.out()).toMatch(/OpenCode.*registered unpinned, run setup to pin v/);
  });

  it("shows the provider in doctor, warns about extra keys, and flags broken combinations", async () => {
    const { fetch } = fakeFetch([
      () =>
        jsonResponse({ model: "typesafe/jev-1.13", answers: { alive: { type: "noul", noul: 1 } } }),
    ]);
    const openrouter = io({
      fetch,
      env: {
        OPENROUTER_API_KEY: "sk-or-v1-1234567890",
        TYPESAFE_API_KEY: "ts_0987654321",
        JEV_CODE_PROVIDER: "openrouter",
      },
    });
    expect(await runCli(["doctor", "--live"], openrouter.io)).toBe(0);
    expect(openrouter.out()).toMatch(/provider\s+OpenRouter \(OPENROUTER_API_KEY sk-o…7890\)/);
    expect(openrouter.out()).toContain("https://openrouter.ai/api");
    expect(openrouter.out()).toContain("both set; using OpenRouter (OPENROUTER_API_KEY)");
    expect(openrouter.out()).toContain("Set JEV_CODE_PROVIDER=typesafe to switch");
    expect(openrouter.out()).toContain("via OpenRouter (typesafe/jev-1.13)");
    expect(openrouter.out()).not.toContain("1234567890");
    expect(openrouter.out()).not.toContain("0987654321");
    // A key that merely looks like another host's stays where it is, with a hint.
    const lookalike = io({ env: { TYPESAFE_API_KEY: "sk-or-v1-0987654321" } });
    expect(await runCli(["doctor"], lookalike.io)).toBe(0);
    expect(lookalike.out()).toMatch(/provider\s+TypeSafe \(TYPESAFE_API_KEY sk-o…4321\)/);
    expect(lookalike.out()).toContain("looks like an OpenRouter key");
    const broken = io({
      env: { OPENROUTER_API_KEY: "sk-or-a", TYPESAFE_BASE_URL: "https://api.typesafe.ai" },
    });
    expect(await runCli(["doctor"], broken.io)).toBe(1);
    expect(broken.out()).toContain("PROBLEM");
    expect(broken.out()).toContain("export TYPESAFE_API_KEY");
    const brokenLive = io({
      env: { OPENROUTER_API_KEY: "sk-or-a", TYPESAFE_BASE_URL: "https://api.typesafe.ai" },
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
      promptLine: async (question) => {
        asked.push(question);
        return "";
      },
    });
    expect(await runCli(["setup", "opencode"], s.io)).toBe(0);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/Paste a key for TypeSafe or another decision API/);
    expect(asked[1]).toMatch(
      /Which host is this key for\? \[1\] TypeSafe {2}\[2\] OpenRouter {2}\[3\] Vercel AI Gateway {2}\[4\] OpenAI Decisions API {2}\[5\] Azure OpenAI Decisions API {2}\[6\] Microsoft Foundry {2}\[7\] Gemini Decisions API {2}\[8\] Perplexity Decisions API {2}\[9\] Cloudflare Workers AI {2}\[10\] Other System One gateway\. Number or name, Enter for OpenRouter: /,
    );
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

  it("treats a pasted OpenAI key as the opt-in and bakes JEV_CODE_PROVIDER with it", async () => {
    const s = io({ env: {}, promptSecret: async () => "sk-proj-abcdefghijkl" });
    expect(await runCli(["setup", "opencode"], s.io)).toBe(0);
    const config = JSON.parse(
      readFileSync(join(s.home, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(config.mcp.jev.environment).toEqual({
      OPENAI_API_KEY: "sk-proj-abcdefghijkl",
      JEV_CODE_PROVIDER: "openai",
    });
    expect(s.out()).toContain("Using OpenAI Decisions API (OPENAI_API_KEY");
    expect(s.out()).toContain("export OPENAI_API_KEY=...");
    expect(s.out()).toContain("export JEV_CODE_PROVIDER=openai");
    expect(s.out()).not.toContain("abcdefghijkl");
  });

  it("explains the OpenAI opt-in in doctor and explains a 403 from the Decisions API", async () => {
    const ambient = io({ env: { OPENAI_API_KEY: "sk-proj-abcdefghijkl" } });
    expect(await runCli(["doctor"], ambient.io)).toBe(1);
    expect(ambient.out()).toContain("NOT SET");
    expect(ambient.out()).toContain("JEV_CODE_PROVIDER=openai");
    const { fetch } = fakeFetch([
      () =>
        jsonResponse(
          {
            error: {
              message: "Decision API is not enabled for this user.",
              type: "invalid_request_error",
            },
          },
          403,
        ),
    ]);
    const preview = io({
      fetch,
      env: { OPENAI_API_KEY: "sk-proj-abcdefghijkl", JEV_CODE_PROVIDER: "openai" },
    });
    expect(await runCli(["doctor", "--live"], preview.io)).toBe(1);
    expect(preview.out()).toMatch(/provider\s+OpenAI Decisions API \(OPENAI_API_KEY/);
    expect(preview.out()).toContain("https://api.openai.com");
    expect(preview.out()).toContain("OpenAI refused this key access to the Decisions API");
    expect(preview.out()).toContain("Decision API is not enabled for this user.");
    expect(preview.out()).toContain("check that the key's project may use gpt-6-luna");
    expect(preview.out()).not.toMatch(/limited preview/);
  });

  it("runs Ollama without a key and explains a missing server or model", async () => {
    const down = io({
      env: { JEV_CODE_PROVIDER: "ollama" },
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await runCli(["doctor", "--live"], down.io)).toBe(1);
    expect(down.out()).toMatch(/provider\s+Ollama \(no key\)/);
    expect(down.out()).toContain("http://localhost:11434");
    expect(down.out()).toContain("no Ollama server at http://localhost:11434");
    const { fetch } = fakeFetch([() => jsonResponse({ error: "model 'nimble' not found" }, 404)]);
    const noModel = io({ env: { JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "gpu-box" }, fetch });
    expect(await runCli(["doctor", "--live"], noModel.io)).toBe(1);
    expect(noModel.out()).toContain("ollama pull nimble");
    expect(noModel.out()).toContain("http://gpu-box:11434");
    const { fetch: ok, calls } = fakeFetch([
      () => jsonResponse({ model: "nimble", answers: { alive: { type: "noul", noul: 1 } } }),
    ]);
    const up = io({ env: { JEV_CODE_PROVIDER: "ollama" }, fetch: ok });
    expect(await runCli(["doctor", "--live"], up.io)).toBe(0);
    expect(up.out()).toContain("via Ollama (nimble)");
    const sent = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(sent.Authorization).toBeUndefined();
    const prompt = io({ env: { JEV_CODE_PROVIDER: "ollama" }, promptSecret: async () => "never" });
    expect(await runCli(["setup", "opencode"], prompt.io)).toBe(0);
    expect(prompt.out()).toContain("Using Ollama (no key)");
  });

  it("stores a pasted key where the user says, defaulting to TypeSafe or the named host", async () => {
    const plain = io({ env: {}, promptSecret: async () => "opaque-key-1234" });
    expect(await runCli(["setup", "opencode"], plain.io)).toBe(0);
    expect(plain.out()).toContain("Using TypeSafe (TYPESAFE_API_KEY");
    expect(plain.out()).toContain("export TYPESAFE_API_KEY=");
    const named = io({
      env: { JEV_CODE_PROVIDER: "vercel" },
      promptSecret: async () => "opaque-key-1234",
      promptLine: async (question) => {
        expect(question).toContain("Enter for Vercel AI Gateway");
        return "";
      },
    });
    expect(await runCli(["setup", "opencode"], named.io)).toBe(0);
    expect(named.out()).toContain("Using Vercel AI Gateway (AI_GATEWAY_API_KEY");
    const byNumber = io({
      env: {},
      promptSecret: async () => "opaque-key-1234",
      promptLine: async () => " 2 ",
    });
    expect(await runCli(["setup", "opencode"], byNumber.io)).toBe(0);
    expect(byNumber.out()).toContain("Using OpenRouter (OPENROUTER_API_KEY");
    const byName = io({
      env: {},
      promptSecret: async () => "opaque-key-1234",
      promptLine: async () => "Vercel AI Gateway",
    });
    expect(await runCli(["setup", "opencode"], byName.io)).toBe(0);
    expect(byName.out()).toContain("Using Vercel AI Gateway (AI_GATEWAY_API_KEY");
    const unknown = io({
      env: {},
      promptSecret: async () => "opaque-key-1234",
      promptLine: async () => "42",
    });
    expect(await runCli(["setup", "opencode"], unknown.io)).toBe(0);
    expect(unknown.out()).toContain('Did not recognise "42"; using TypeSafe.');
    expect(unknown.out()).toContain("Using TypeSafe (TYPESAFE_API_KEY");
    // A host-specific key chosen against JEV_CODE_PROVIDER is a conflict, so nothing is written.
    const conflicting = io({
      env: { JEV_CODE_PROVIDER: "vercel" },
      promptSecret: async () => "opaque-key-1234",
      promptLine: async () => "openrouter",
    });
    expect(await runCli(["setup", "opencode"], conflicting.io)).toBe(0);
    expect(conflicting.out()).not.toContain("Using ");
    expect(conflicting.out()).toContain("no key is set for Vercel AI Gateway");
    expect(conflicting.out()).toContain("No key was written into any config");
  });

  it("asks for the account endpoint when a pasted key is for Azure or Cloudflare", async () => {
    const azure = io({
      env: {},
      promptSecret: async () => "azure-key-1234",
      promptLine: script(["azure", "https://contoso.openai.azure.com"]),
    });
    expect(await runCli(["setup", "opencode"], azure.io)).toBe(0);
    expect(azure.out()).toContain("Using Azure OpenAI Decisions API (AZURE_OPENAI_API_KEY");
    expect(stored(azure.home)).toEqual({
      AZURE_OPENAI_API_KEY: "azure-key-1234",
      AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com",
      JEV_CODE_PROVIDER: "azure",
    });
    expect(azure.out()).toContain("export AZURE_OPENAI_ENDPOINT=https://contoso.openai.azure.com");
    // Without an endpoint, or with one that cannot work, nothing is stored.
    for (const answer of ["", "http://contoso.openai.azure.com"]) {
      const refused = io({
        env: {},
        promptSecret: async () => "azure-key-1234",
        promptLine: script(["azure", answer]),
      });
      expect(await runCli(["setup", "opencode"], refused.io)).toBe(0);
      expect(refused.out()).toMatch(/the key was not stored/i);
      expect(refused.out()).not.toContain("Using Azure");
    }
    // A TYPESAFE_BASE_URL in the shell does not let a bad endpoint through unchecked.
    const proxied = io({
      env: { TYPESAFE_BASE_URL: "https://proxy.example.com" },
      promptSecret: async () => "azure-key-1234",
      promptLine: script(["azure", "https://evil.example"]),
    });
    expect(await runCli(["setup", "opencode"], proxied.io)).toBe(0);
    expect(proxied.out()).toContain("must name a host under");
    expect(proxied.out()).toMatch(/the key was not stored/i);
    // A Cloudflare token is a secret too: the advice never prints it.
    const cloudflare = io({
      env: {},
      promptSecret: async () => "cf-token-secret-1",
      promptLine: script(["cloudflare", "0123456789abcdef0123456789abcdef"]),
    });
    expect(await runCli(["setup", "opencode"], cloudflare.io)).toBe(0);
    expect(cloudflare.out()).toContain("export CLOUDFLARE_API_TOKEN=...");
    expect(cloudflare.out()).not.toContain("cf-token-secret-1");
  });

  it("stores a pasted gateway key in the SDK's variables once the gateway answers a check", async () => {
    const asked: string[] = [];
    const answers = ["10", " https://gateway.example/api/ ", " vendor/jev "];
    const { fetch, calls } = fakeFetch([() => pong("vendor/jev-2")]);
    const s = io({
      env: {},
      fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: async (question) => {
        asked.push(question);
        return answers.shift() ?? "";
      },
    });
    expect(await runCli(["setup", "opencode"], s.io)).toBe(0);
    expect(asked[0]).toContain("[10] Other System One gateway");
    expect(asked[1]).toContain("the client appends /v1/systemone");
    expect(asked[2]).toContain("Enter for jev-latest");
    expect(asked).toHaveLength(3);
    // One check, with the model that will be stored, before anything is written.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://gateway.example/api/v1/systemone");
    expect(calls[0]?.body.model).toBe("vendor/jev");
    const sent = calls[0]?.init.headers as Record<string, string>;
    expect(sent.Authorization).toBe("Bearer gw-opaque-key-1234");
    expect(sent["User-Agent"]).toBe(`${PACKAGE_NAME}/${VERSION} setup`);
    expect(s.out()).toMatch(/The gateway answered in \d+ ms \(vendor\/jev-2\)\./);
    expect(stored(s.home)).toEqual({
      TYPESAFE_API_KEY: "gw-opaque-key-1234",
      TYPESAFE_BASE_URL: "https://gateway.example/api",
      TYPESAFE_DEFAULT_MODEL: "vendor/jev",
    });
    expect(s.out()).toContain(
      "Using System One gateway at gateway.example (TYPESAFE_API_KEY gw-o…1234)",
    );
    expect(s.out()).toContain("Requests go to https://gateway.example/api (TYPESAFE_BASE_URL)");
    expect(s.out()).toContain("export TYPESAFE_API_KEY=...");
    expect(s.out()).toContain("export TYPESAFE_BASE_URL=https://gateway.example/api");
    expect(s.out()).toContain("export TYPESAFE_DEFAULT_MODEL=vendor/jev");
    expect(s.out()).not.toContain("opaque");
    // By name, keeping the default model: no TYPESAFE_DEFAULT_MODEL is stored.
    const byName = io({
      env: {},
      fetch: fakeFetch([() => pong("jev-latest")]).fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: script(["gateway", "https://gateway.example", ""]),
    });
    expect(await runCli(["setup", "opencode"], byName.io)).toBe(0);
    expect(stored(byName.home)).toEqual({
      TYPESAFE_API_KEY: "gw-opaque-key-1234",
      TYPESAFE_BASE_URL: "https://gateway.example",
    });
    // Without a URL the key has no destination, so it is not stored, and nothing is sent.
    const noUrl = io({
      env: {},
      fetch: fakeFetch([]).fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: script(["10", ""]),
    });
    expect(await runCli(["setup", "opencode"], noUrl.io)).toBe(0);
    expect(noUrl.out()).toContain("No base URL given, so the key was not stored.");
    expect(noUrl.out()).toContain("No API key found in this shell");
    expect(stored(noUrl.home)).toBeUndefined();
    // The full endpoint pasted as the base URL is refused before any request.
    const endpoint = io({
      env: {},
      fetch: fakeFetch([]).fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: script(["10", "https://gateway.example/v1/systemone", ""]),
    });
    expect(await runCli(["setup", "opencode"], endpoint.io)).toBe(0);
    expect(endpoint.out()).toContain(
      "TYPESAFE_BASE_URL must stop before /v1/systemone; the client appends it. The key was not stored.",
    );
    expect(endpoint.out()).not.toContain("Using ");
    expect(endpoint.out()).not.toContain("export TYPESAFE_BASE_URL");
    expect(stored(endpoint.home)).toBeUndefined();
  });

  it("asks before storing a gateway that fails its check, and offers the model it will use", async () => {
    const refusal = () =>
      jsonResponse(
        { error: { type: "invalid_request_error", message: 'model: unknown model "jev-latest"' } },
        422,
      );
    // Declined: nothing is stored, and the message says what to change.
    const declined = io({
      env: {},
      fetch: fakeFetch([refusal]).fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: script(["10", "https://gateway.example", "", ""]),
    });
    expect(await runCli(["setup", "opencode"], declined.io)).toBe(0);
    expect(declined.out()).toContain(
      'The gateway did not answer the check: Jev API error 422: model: unknown model "jev-latest".',
    );
    expect(declined.out()).toContain("give its model id when setup asks");
    expect(declined.out()).toContain("The key was not stored.");
    expect(declined.out()).not.toContain("Using ");
    expect(stored(declined.home)).toBeUndefined();
    // Accepted: stored as given, for a gateway that is down right now, say.
    const asked: string[] = [];
    const answers = ["10", "https://gateway.example", "vendor/jev", "y"];
    const accepted = io({
      env: {},
      fetch: fakeFetch([
        () => {
          throw new TypeError("fetch failed");
        },
      ]).fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: async (question) => {
        asked.push(question);
        return answers.shift() ?? "";
      },
    });
    expect(await runCli(["setup", "opencode"], accepted.io)).toBe(0);
    expect(asked[3]).toBe("Store the key anyway? [y/N]: ");
    expect(stored(accepted.home)).toEqual({
      TYPESAFE_API_KEY: "gw-opaque-key-1234",
      TYPESAFE_BASE_URL: "https://gateway.example",
      TYPESAFE_DEFAULT_MODEL: "vendor/jev",
    });
    expect(accepted.out()).not.toContain("give its model id");
    // JEV_CODE_PROVIDER in the shell picks the row, so its model is the one offered and checked.
    const offered: string[] = [];
    const viaVercel = ["10", "https://proxy.example", ""];
    const { fetch, calls } = fakeFetch([() => pong("typesafe-ai/jev")]);
    const proxied = io({
      env: { JEV_CODE_PROVIDER: "vercel" },
      fetch,
      promptSecret: async () => "gw-opaque-key-1234",
      promptLine: async (question) => {
        offered.push(question);
        return viaVercel.shift() ?? "";
      },
    });
    expect(await runCli(["setup", "opencode"], proxied.io)).toBe(0);
    expect(offered[2]).toContain("Enter for typesafe-ai/jev");
    expect(calls[0]?.body.model).toBe("typesafe-ai/jev");
  });

  it("shows a gateway in doctor and reports a malformed base URL without echoing it", async () => {
    const gateway = io({
      env: {
        TYPESAFE_API_KEY: "gw-opaque-key-1234",
        TYPESAFE_BASE_URL: "https://gateway.example/api",
        TYPESAFE_DEFAULT_MODEL: "vendor/jev",
      },
    });
    expect(await runCli(["doctor"], gateway.io)).toBe(0);
    expect(gateway.out()).toMatch(
      /provider\s+System One gateway at gateway\.example \(TYPESAFE_API_KEY gw-o…1234\)/,
    );
    expect(gateway.out()).toMatch(/base URL\s+https:\/\/gateway\.example\/api/);
    expect(gateway.out()).toMatch(/model\s+vendor\/jev/);
    expect(gateway.out()).toContain("Requests go to https://gateway.example/api");
    const leaky = io({
      env: {
        TYPESAFE_API_KEY: "gw-opaque-key-1234",
        TYPESAFE_BASE_URL: "https://user:secret@gateway.example",
      },
    });
    expect(await runCli(["doctor", "--live"], leaky.io)).toBe(1);
    expect(leaky.out()).toContain("PROBLEM: TYPESAFE_BASE_URL must not embed credentials");
    expect(leaky.out()).toContain("Live check: skipped, fix the configuration problem");
    expect(leaky.out()).not.toContain("secret");
    // Without a key, the URL problem still shows under the list of keys to set.
    const keyless = io({ env: { TYPESAFE_BASE_URL: "gateway.example" } });
    expect(await runCli(["doctor"], keyless.io)).toBe(1);
    expect(keyless.out()).toContain("NOT SET");
    expect(keyless.out()).toContain("PROBLEM: TYPESAFE_BASE_URL must be an absolute http(s) URL.");
  });
});
