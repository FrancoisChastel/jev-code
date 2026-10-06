import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../../src/setup/exec.js";
import { detectHarnesses, harnessPaths, parseHarness } from "../../src/setup/harnesses.js";
import { runSetup } from "../../src/setup/index.js";
import { installSkill, listFiles } from "../../src/setup/skills.js";
import { PACKAGE_NAME, VERSION } from "../../src/version.js";

const PINNED = `${PACKAGE_NAME}@${VERSION}`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "jev-setup-"));
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { root, home, cwd };
}

function recordingExec(
  code = 0,
  output = "",
): { exec: Exec; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const exec: Exec = async (command, args) => {
    calls.push({ command, args: [...args] });
    return { code, stdout: output, stderr: "" };
  };
  return { exec, calls };
}

describe("harness detection", () => {
  it("resolves aliases and paths", () => {
    expect(parseHarness("Claude-Code")).toBe("claude");
    expect(parseHarness("pi")).toBe("pi");
    expect(parseHarness("cursor")).toBeUndefined();
    const paths = harnessPaths("codex", "/h", "/p");
    expect(paths.userSkillsDir).toBe("/h/.agents/skills");
    expect(paths.projectSkillsDir).toBe("/p/.agents/skills");
  });

  it("detects by binary or config directory", () => {
    const { home, cwd } = sandbox();
    mkdirSync(join(home, ".codex"), { recursive: true });
    const detected = detectHarnesses({
      home,
      cwd,
      which: (bin) => (bin === "pi" ? "/bin/pi" : null),
    });
    expect(detected.map((d) => [d.harness, d.detected])).toEqual([
      ["claude", false],
      ["codex", true],
      ["pi", true],
      ["opencode", false],
    ]);
  });
});

describe("installSkill", () => {
  it("copies the bundled skill, reports updates, and is idempotent", () => {
    const { home } = sandbox();
    const skillsDir = join(home, ".agents", "skills");
    const first = installSkill(skillsDir);
    expect(first.status).toBe("installed");
    expect(existsSync(join(first.path, "SKILL.md"))).toBe(true);
    expect(listFiles(first.path)).toContain("references/tools.md");
    expect(installSkill(skillsDir).status).toBe("unchanged");
    writeFileSync(join(first.path, "SKILL.md"), "stale");
    expect(installSkill(skillsDir, { dryRun: true }).status).toBe("planned");
    expect(installSkill(skillsDir).status).toBe("updated");
    expect(readFileSync(join(first.path, "SKILL.md"), "utf8")).toContain("name: jev");
  });
});

describe("runSetup", () => {
  it("uses each harness CLI when present and shares the skill between codex, pi, and opencode", async () => {
    const { home, cwd } = sandbox();
    const { exec, calls } = recordingExec();
    const report = await runSetup({
      all: true,
      home,
      cwd,
      env: { TYPESAFE_API_KEY: "ts_secret", PATH: "" },
      exec,
      which: (bin) => `/usr/bin/${bin}`,
    });
    const status = Object.fromEntries(
      report.actions.map((a) => [`${a.harness}:${a.kind}`, a.status]),
    );
    expect(status).toEqual({
      "claude:skill": "installed",
      "claude:tool": "installed",
      "codex:skill": "installed",
      "codex:tool": "installed",
      "pi:skill": "unchanged",
      "pi:tool": "installed",
      "opencode:skill": "unchanged",
      "opencode:tool": "installed",
    });
    expect(calls.map((c) => `${c.args[0]} ${c.args[1]}`)).toEqual([
      "mcp get",
      "mcp add",
      "mcp get",
      "mcp add",
      "install npm:@french-castle/jev-code",
    ]);
    expect(calls[1]?.args).toEqual([
      "mcp",
      "add",
      "--scope",
      "user",
      "jev",
      "-e",
      "TYPESAFE_API_KEY=ts_secret",
      "--",
      "npx",
      "-y",
      PINNED,
      "mcp",
    ]);
    expect(calls[3]?.args).toEqual([
      "mcp",
      "add",
      "jev",
      "--env",
      "TYPESAFE_API_KEY=ts_secret",
      "--",
      "npx",
      "-y",
      PINNED,
      "mcp",
    ]);
    expect(existsSync(join(home, ".claude", "skills", "jev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".agents", "skills", "jev", "SKILL.md"))).toBe(true);
    const opencode = JSON.parse(
      readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(opencode.mcp.jev.environment).toEqual({ TYPESAFE_API_KEY: "ts_secret" });
    expect(report.notes.join(" ")).toContain("was copied into the harness configs");
  });

  it("falls back to file edits and manual steps when CLIs are missing, and never writes in dry-run", async () => {
    const { home, cwd } = sandbox();
    const { exec, calls } = recordingExec();
    const dry = await runSetup({
      all: true,
      home,
      cwd,
      env: {},
      exec,
      which: () => null,
      dryRun: true,
    });
    expect(calls).toHaveLength(0);
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(dry.actions.filter((a) => a.status === "planned").length).toBeGreaterThan(3);
    expect(dry.notes.join(" ")).toContain("No API key found");

    const real = await runSetup({
      all: true,
      home,
      cwd,
      env: {},
      exec,
      which: () => null,
      bakeEnv: false,
    });
    const byKey = Object.fromEntries(real.actions.map((a) => [`${a.harness}:${a.kind}`, a]));
    expect(byKey["claude:tool"]?.status).toBe("manual");
    expect(byKey["claude:tool"]?.detail).toContain(
      `claude mcp add --scope user jev -- npx -y ${PINNED} mcp`,
    );
    expect(byKey["pi:tool"]?.status).toBe("manual");
    expect(byKey["codex:tool"]?.status).toBe("installed");
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toContain(
      "[mcp_servers.jev]",
    );
    expect(byKey["opencode:tool"]?.status).toBe("installed");
    expect(
      JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")).mcp.jev
        .environment,
    ).toBeUndefined();
  });

  it("supports project scope, explicit harness lists, custom commands, and already-registered servers", async () => {
    const { home, cwd } = sandbox();
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: Exec = async (command, args) => {
      calls.push({ command, args: [...args] });
      const adds = calls.filter((c) => c.args[1] === "add").length;
      if (args[1] === "add" && adds === 1) {
        return { code: 1, stdout: "MCP server jev already exists", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: { jev: { command: "npx", args: ["-y", `${PACKAGE_NAME}@0.1.0`, "mcp"] } },
      }),
    );
    const report = await runSetup({
      harnesses: ["claude", "codex"],
      scope: "project",
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      command: ["node", "/opt/jev/cli.js", "mcp"],
    });
    const byKey = Object.fromEntries(report.actions.map((a) => [`${a.harness}:${a.kind}`, a]));
    expect(byKey["claude:tool"]?.status).toBe("updated");
    expect(byKey["claude:tool"]?.detail).toContain("was v0.1.0, now node /opt/jev/cli.js mcp");
    expect(calls.map((c) => c.args[1])).toEqual(["add", "remove", "add"]);
    expect(calls[0]?.args.slice(0, 4)).toEqual(["mcp", "add", "--scope", "project"]);
    expect(calls[1]?.args).toEqual(["mcp", "remove", "-s", "project", "jev"]);
    expect(existsSync(join(cwd, ".claude", "skills", "jev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, ".agents", "skills", "jev", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toContain('command = "node"');
    expect(report.harnesses).toEqual(["claude", "codex"]);
  });

  it("scrubs the key from harness CLI output when registration fails", async () => {
    const { home, cwd } = sandbox();
    const { exec } = recordingExec(
      1,
      "error: unrecognized option -e OPENROUTER_API_KEY=sk-or-v1-secret-value\nusage: claude mcp add",
    );
    const report = await runSetup({
      harnesses: ["claude"],
      home,
      cwd,
      env: { OPENROUTER_API_KEY: "sk-or-v1-secret-value" },
      exec,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      skill: false,
    });
    const detail = report.actions[0]?.detail ?? "";
    expect(report.actions[0]?.status).toBe("failed");
    expect(detail).toContain("OPENROUTER_API_KEY=<redacted>");
    expect(detail).not.toContain("secret-value");
  });

  it("writes .mcp.json for a project when claude is not installed and reports failures", async () => {
    const { home, cwd } = sandbox();
    const { exec, calls } = recordingExec(2, "boom");
    const report = await runSetup({
      harnesses: ["claude", "pi"],
      scope: "project",
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "pi" ? "/bin/pi" : null),
      skill: false,
    });
    const byKey = Object.fromEntries(report.actions.map((a) => [`${a.harness}:${a.kind}`, a]));
    expect(byKey["claude:tool"]?.status).toBe("installed");
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(true);
    expect(byKey["pi:tool"]).toMatchObject({ status: "failed", detail: "boom" });
    // pi refuses to edit project-local settings unless the project is approved for the run.
    expect(calls[0]?.args).toEqual(["install", "-l", "--approve", "npm:@french-castle/jev-code"]);
    expect(report.actions.some((a) => a.kind === "skill")).toBe(false);
  });

  it("bakes whichever provider key is active and redacts it from printed commands", async () => {
    const { home, cwd } = sandbox();
    const report = await runSetup({
      harnesses: ["claude", "opencode"],
      home,
      cwd,
      env: { OPENROUTER_API_KEY: "sk-or-v1-secret", JEV_CODE_PROVIDER: "openrouter" },
      exec: recordingExec().exec,
      which: () => null,
    });
    const byKey = Object.fromEntries(report.actions.map((a) => [`${a.harness}:${a.kind}`, a]));
    expect(byKey["claude:tool"]?.detail).toContain(
      "-e 'OPENROUTER_API_KEY=<your key>' -e JEV_CODE_PROVIDER=openrouter",
    );
    expect(byKey["claude:tool"]?.detail).not.toContain("secret");
    const opencode = JSON.parse(
      readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"),
    );
    expect(opencode.mcp.jev.environment).toEqual({
      OPENROUTER_API_KEY: "sk-or-v1-secret",
      JEV_CODE_PROVIDER: "openrouter",
    });
    expect(report.notes.join(" ")).toContain("Using OpenRouter (OPENROUTER_API_KEY");
    expect(report.notes.join(" ")).not.toContain("secret");
  });

  it("re-registers through the harness CLIs when an existing registration differs", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      const verb = args[1];
      const adds = calls.filter((c) => c[1] === "add").length;
      if (verb === "add" && adds === 1)
        return { code: 1, stdout: "", stderr: "MCP server jev already exists" };
      if (verb === "get") {
        const stale = `jev:\n  Scope: User config (available in all your projects)\n  Status: ✓ Connected\n  Type: stdio\n  Command: npx\n  Args: -y ${PACKAGE_NAME}@0.1.0 mcp\n  Environment:\n    TYPESAFE_API_KEY=ts_x\n`;
        return { code: 0, stdout: stale, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["claude"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({ harness: "claude", kind: "tool", status: "updated" });
    expect(report.actions[0]?.detail).toContain("0.1.0");
    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual([
      "mcp get",
      "mcp add",
      "mcp remove",
      "mcp add",
    ]);
    expect(calls[2]).toEqual(["mcp", "remove", "-s", "user", "jev"]);
  });

  it("leaves a registration alone when the harness already runs the same command", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "add") return { code: 1, stdout: "already exists", stderr: "" };
      if (args[1] === "get") {
        return { code: 0, stdout: `jev\n  command: npx\n  args: -y ${PINNED} mcp\n`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["codex"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "codex" ? "/bin/codex" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({
      harness: "codex",
      kind: "tool",
      status: "unchanged",
    });
    expect(calls.map((c) => c[1])).toEqual(["get"]);
  });

  it("reports an update when a CLI overwrites a differing registration without complaint", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "get") {
        const stale = `jev\n  command: npx\n  args: -y ${PACKAGE_NAME}@0.1.0 mcp\n`;
        return { code: 0, stdout: stale, stderr: "" };
      }
      return { code: 0, stdout: "Added global MCP server 'jev'.", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["codex"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "codex" ? "/bin/codex" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({ status: "updated" });
    expect(report.actions[0]?.detail).toContain(`was v0.1.0, now v${VERSION}`);
    expect(calls.map((c) => c[1])).toEqual(["get", "add"]);
  });

  it("never lets a user-scope entry stand in for the project scope being configured", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "get") {
        return {
          code: 0,
          stdout: `jev:\n  Scope: User config\n  Command: npx\n  Args: -y ${PINNED} mcp\n`,
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["claude"],
      scope: "project",
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({ status: "installed" });
    expect(calls.map((c) => c[1])).toEqual(["add"]);
    expect(calls[0]?.slice(0, 4)).toEqual(["mcp", "add", "--scope", "project"]);
  });

  it("never lets a project-scope listing stand in for the user scope being configured", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "get") {
        return {
          code: 0,
          stdout: `jev:\n  Scope: Project config (shared via .mcp.json)\n  Command: npx\n  Args: -y ${PINNED} mcp\n`,
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["claude"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "claude" ? "/bin/claude" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({ status: "installed" });
    expect(calls.map((c) => c[1])).toEqual(["get", "add"]);
  });

  it("says so when the old registration was removed and re-adding failed", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "get") {
        return {
          code: 0,
          stdout: `jev:\n  command: npx\n  args: -y ${PACKAGE_NAME}@0.1.0 mcp\n`,
          stderr: "",
        };
      }
      const adds = calls.filter((c) => c[1] === "add").length;
      if (args[1] === "add" && adds === 1) return { code: 1, stdout: "already exists", stderr: "" };
      if (args[1] === "add") return { code: 1, stdout: "", stderr: "disk full" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["codex"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "codex" ? "/bin/codex" : null),
      skill: false,
    });
    expect(report.actions[0]).toMatchObject({ status: "failed" });
    expect(report.actions[0]?.detail).toContain("removed the previous registration");
    expect(report.actions[0]?.detail).toContain("disk full");
    expect(report.actions[0]?.detail).toContain(`codex mcp add jev -- npx -y ${PINNED} mcp`);
  });

  it("skips the listing fast path when an argument contains whitespace", async () => {
    const { home, cwd } = sandbox();
    const calls: string[][] = [];
    const exec: Exec = async (_command, args) => {
      calls.push([...args]);
      if (args[1] === "get") {
        return {
          code: 0,
          stdout: "jev:\n  command: node\n  args: /opt/my tools/cli.js mcp\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const report = await runSetup({
      harnesses: ["codex"],
      home,
      cwd,
      env: {},
      exec,
      which: (bin) => (bin === "codex" ? "/bin/codex" : null),
      skill: false,
      command: ["node", "/opt/my tools/cli.js", "mcp"],
    });
    expect(report.actions[0]).toMatchObject({ status: "updated" });
    expect(calls.map((c) => c[1])).toEqual(["get", "add"]);
  });

  it("explains itself when nothing is detected", async () => {
    const { home, cwd } = sandbox();
    const report = await runSetup({
      home,
      cwd,
      env: {},
      exec: recordingExec().exec,
      which: () => null,
    });
    expect(report.actions).toHaveLength(0);
    expect(report.notes[0]).toContain("No harness detected");
  });
});

import { CUSTOM_ENV } from "../helpers.js";

describe("custom harness setup", () => {
  it("stores selected settings and excludes unrelated keys across harnesses", async () => {
    const { home, cwd } = sandbox();
    const { exec, calls } = recordingExec();
    const report = await runSetup({
      all: true,
      scope: "project",
      home,
      cwd,
      env: { ...CUSTOM_ENV, TYPESAFE_API_KEY: "unused", JEV_CODE_MAX_RETRIES: "1" },
      exec,
      which: (bin) => (bin === "pi" ? "/bin/pi" : null),
      skill: false,
    });
    expect(report.actions.some((a) => a.status === "failed")).toBe(false);
    const claude = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")).mcpServers.jev.env;
    const opencode = JSON.parse(readFileSync(join(cwd, "opencode.json"), "utf8")).mcp.jev
      .environment;
    expect(claude).toEqual({ ...CUSTOM_ENV, JEV_CODE_MAX_RETRIES: "1" });
    expect(opencode).toEqual(claude);
    const codex = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    expect(codex).toContain(CUSTOM_ENV.JEV_CODE_API_KEY);
    expect(codex).toContain("JEV_CODE_MODEL");
    expect(codex).not.toContain("TYPESAFE_API_KEY");
    expect(calls.some((c) => c.command === "/bin/pi")).toBe(true);
    expect(report.notes.join(" ")).toContain("Example Gateway");
  });

  it("does not store credentials with no-env and redacts manual/failed command output", async () => {
    const { home, cwd } = sandbox();
    const report = await runSetup({
      all: true,
      home,
      cwd,
      env: CUSTOM_ENV,
      skill: false,
      bakeEnv: false,
      which: () => null,
    });
    expect(JSON.stringify(report)).not.toContain(CUSTOM_ENV.JEV_CODE_API_KEY);
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).not.toContain(
      "JEV_CODE_API_KEY",
    );
    const manual = await runSetup({
      harnesses: ["claude"],
      home,
      cwd,
      env: CUSTOM_ENV,
      skill: false,
      which: () => null,
    });
    expect(JSON.stringify(manual)).not.toContain(CUSTOM_ENV.JEV_CODE_API_KEY);
    const failed = await runSetup({
      harnesses: ["claude"],
      home,
      cwd,
      env: CUSTOM_ENV,
      skill: false,
      which: () => "/bin/claude",
      exec: async () => ({ code: 1, stdout: CUSTOM_ENV.JEV_CODE_API_KEY, stderr: "" }),
    });
    expect(JSON.stringify(failed)).not.toContain(CUSTOM_ENV.JEV_CODE_API_KEY);
  });

  it("rejects incomplete custom registration but permits skill-only setup and dry-run reporting", async () => {
    const { home, cwd } = sandbox();
    const options = {
      harnesses: ["opencode" as const],
      home,
      cwd,
      env: { JEV_CODE_PROVIDER: "custom" },
      which: () => null,
    };
    const report = await runSetup({ ...options, skill: false });
    expect(report.actions[0]?.status).toBe("failed");
    expect(report.notes.join(" ")).toContain("JEV_CODE_PROVIDER_NAME");
    expect(existsSync(join(home, ".config", "opencode", "opencode.json"))).toBe(false);
    const dry = await runSetup({ ...options, dryRun: true, skill: false });
    expect(dry.notes.join(" ")).toContain("JEV_CODE_PROVIDER_NAME");
    expect(
      (await runSetup({ ...options, tool: false })).actions.every((a) => a.kind === "skill"),
    ).toBe(true);
  });
});
