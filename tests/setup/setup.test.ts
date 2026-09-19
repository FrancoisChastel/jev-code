import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "../../src/setup/exec.js";
import { detectHarnesses, harnessPaths, parseHarness } from "../../src/setup/harnesses.js";
import { runSetup } from "../../src/setup/index.js";
import { installSkill, listFiles } from "../../src/setup/skills.js";

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
      "mcp add",
      "mcp add",
      "install npm:@francoischastel/jev-code",
    ]);
    expect(calls[0]?.args).toEqual([
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
      "@francoischastel/jev-code",
      "mcp",
    ]);
    expect(calls[1]?.args).toEqual([
      "mcp",
      "add",
      "jev",
      "--env",
      "TYPESAFE_API_KEY=ts_secret",
      "--",
      "npx",
      "-y",
      "@francoischastel/jev-code",
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
    expect(dry.notes.join(" ")).toContain("TYPESAFE_API_KEY is not set");

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
      "claude mcp add --scope user jev -- npx -y @francoischastel/jev-code mcp",
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
    const { exec, calls } = recordingExec(1, "MCP server jev already exists");
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
    expect(byKey["claude:tool"]?.status).toBe("unchanged");
    expect(calls[0]?.args.slice(0, 4)).toEqual(["mcp", "add", "--scope", "project"]);
    expect(existsSync(join(cwd, ".claude", "skills", "jev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, ".agents", "skills", "jev", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toContain('command = "node"');
    expect(report.harnesses).toEqual(["claude", "codex"]);
  });

  it("writes .mcp.json for a project when claude is not installed and reports failures", async () => {
    const { home, cwd } = sandbox();
    const { exec } = recordingExec(2, "boom");
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
    expect(report.actions.some((a) => a.kind === "skill")).toBe(false);
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
