import { homedir } from "node:os";
import { join } from "node:path";
import { ENV } from "../core/config.js";
import { PACKAGE_NAME } from "../version.js";
import {
  defaultServerCommand,
  type McpServerSpec,
  serverEnvFromProcess,
  toSpec,
  upsertCodexToml,
  upsertMcpServersJson,
  upsertOpencodeMcp,
  type WriteOutcome,
} from "./configs.js";
import { type Exec, realExec, type Which, whichBinary } from "./exec.js";
import {
  detectHarnesses,
  HARNESS_LABEL,
  HARNESSES,
  type Harness,
  harnessPaths,
} from "./harnesses.js";
import { installSkill } from "./skills.js";

export type SetupScope = "user" | "project";

export interface SetupOptions {
  /** Harnesses to configure. Default: every harness detected on this machine. */
  harnesses?: Harness[];
  /** Configure all four harnesses whether or not they are detected. */
  all?: boolean;
  scope?: SetupScope;
  home?: string;
  cwd?: string;
  dryRun?: boolean;
  /** Install the skill (default true). */
  skill?: boolean;
  /** Register the tool (default true). */
  tool?: boolean;
  /** Copy TYPESAFE_API_KEY from the environment into harness configs (default true). */
  bakeEnv?: boolean;
  /** MCP server command. Default: `npx -y <package> mcp`. */
  command?: string[];
  /** Package spec handed to `pi install`. Default: `npm:<package>`. */
  piSource?: string;
  env?: NodeJS.ProcessEnv;
  exec?: Exec;
  which?: Which;
}

export type ActionStatus = "installed" | "updated" | "unchanged" | "planned" | "manual" | "failed";

export interface SetupAction {
  harness: Harness;
  kind: "skill" | "tool";
  status: ActionStatus;
  detail: string;
}

export interface SetupReport {
  scope: SetupScope;
  dryRun: boolean;
  harnesses: Harness[];
  actions: SetupAction[];
  notes: string[];
}

interface Resolved {
  scope: SetupScope;
  home: string;
  cwd: string;
  dryRun: boolean;
  skill: boolean;
  tool: boolean;
  bakeEnv: boolean;
  command: string[];
  piSource: string;
  env: NodeJS.ProcessEnv;
  exec: Exec;
  which: Which;
  spec: McpServerSpec;
}

/** Install the Jev skill and register the Jev tool in local coding agents. */
export async function runSetup(options: SetupOptions = {}): Promise<SetupReport> {
  const env = options.env ?? process.env;
  const which = options.which ?? ((binary) => whichBinary(binary, env));
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const command = options.command ?? defaultServerCommand(PACKAGE_NAME);
  const bakeEnv = options.bakeEnv ?? true;
  const resolved: Resolved = {
    scope: options.scope ?? "user",
    home,
    cwd,
    dryRun: options.dryRun ?? false,
    skill: options.skill ?? true,
    tool: options.tool ?? true,
    bakeEnv,
    command,
    piSource: options.piSource ?? `npm:${PACKAGE_NAME}`,
    env,
    exec: options.exec ?? realExec,
    which,
    spec: toSpec(command, serverEnvFromProcess(env, { includeApiKey: bakeEnv })),
  };

  const harnesses = options.all
    ? [...HARNESSES]
    : options.harnesses && options.harnesses.length > 0
      ? options.harnesses
      : detectHarnesses({ home, cwd, which })
          .filter((detection) => detection.detected)
          .map((detection) => detection.harness);

  const actions: SetupAction[] = [];
  const notes: string[] = [];
  const installedSkillDirs = new Map<string, Harness>();

  for (const harness of harnesses) {
    if (resolved.skill) actions.push(skillAction(harness, resolved, installedSkillDirs));
    if (resolved.tool) actions.push(await toolAction(harness, resolved));
  }

  if (harnesses.length === 0) {
    notes.push(
      "No harness detected. Pass names explicitly, e.g. `jev-code setup claude codex pi opencode`, or `--all`.",
    );
  }
  if (resolved.tool) {
    if (!env[ENV.apiKey]?.trim()) {
      notes.push(
        `${ENV.apiKey} is not set in this shell, so it was not written into any config. The tool reads it from the environment at runtime: export it before starting your agent.`,
      );
    } else if (bakeEnv) {
      notes.push(
        `${ENV.apiKey} was copied into the harness configs that store server environments, so the tool works even when a harness filters the shell environment. Re-run with --no-env to skip that.`,
      );
    }
  }
  return { scope: resolved.scope, dryRun: resolved.dryRun, harnesses, actions, notes };
}

function skillAction(
  harness: Harness,
  resolved: Resolved,
  installedSkillDirs: Map<string, Harness>,
): SetupAction {
  const paths = harnessPaths(harness, resolved.home, resolved.cwd);
  const skillsDir = resolved.scope === "user" ? paths.userSkillsDir : paths.projectSkillsDir;
  const sharedWith = installedSkillDirs.get(skillsDir);
  if (sharedWith) {
    return {
      harness,
      kind: "skill",
      status: "unchanged",
      detail: `${join(skillsDir, "jev")} (shared with ${HARNESS_LABEL[sharedWith]})`,
    };
  }
  try {
    const result = installSkill(skillsDir, { dryRun: resolved.dryRun });
    installedSkillDirs.set(skillsDir, harness);
    return { harness, kind: "skill", status: result.status, detail: result.path };
  } catch (error) {
    return { harness, kind: "skill", status: "failed", detail: (error as Error).message };
  }
}

async function toolAction(harness: Harness, resolved: Resolved): Promise<SetupAction> {
  switch (harness) {
    case "claude":
      return claudeTool(resolved);
    case "codex":
      return codexTool(resolved);
    case "pi":
      return piTool(resolved);
    case "opencode":
      return opencodeTool(resolved);
  }
}

function fromOutcome(harness: Harness, outcome: WriteOutcome, path: string): SetupAction {
  if (!outcome.changed) return { harness, kind: "tool", status: "unchanged", detail: path };
  if (outcome.planned) return { harness, kind: "tool", status: "planned", detail: path };
  const backup = outcome.backup ? ` (backup: ${outcome.backup})` : "";
  return { harness, kind: "tool", status: "installed", detail: `${path}${backup}` };
}

function envArgs(flag: string, env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => [flag, `${key}=${value}`]);
}

function shellQuote(args: readonly string[]): string {
  return args
    .map((arg) => (/^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`))
    .join(" ");
}

function redactedCommand(args: readonly string[]): string {
  return shellQuote(args.map((arg) => arg.replace(/^(TYPESAFE_API_KEY=).+$/, "$1<your key>")));
}

async function claudeTool(resolved: Resolved): Promise<SetupAction> {
  const harness: Harness = "claude";
  const { spec } = resolved;
  const args = [
    "mcp",
    "add",
    "--scope",
    resolved.scope,
    "jev",
    ...envArgs("-e", spec.env),
    "--",
    spec.command,
    ...spec.args,
  ];
  const binary = resolved.which("claude");
  if (!binary) {
    if (resolved.scope === "project") {
      const path = join(resolved.cwd, ".mcp.json");
      return fromOutcome(
        harness,
        upsertMcpServersJson(path, spec, { dryRun: resolved.dryRun }),
        path,
      );
    }
    return {
      harness,
      kind: "tool",
      status: "manual",
      detail: `\`claude\` not found on PATH. Run: claude ${redactedCommand(args)}`,
    };
  }
  if (resolved.dryRun) {
    return { harness, kind: "tool", status: "planned", detail: `claude ${redactedCommand(args)}` };
  }
  const result = await resolved.exec(binary, args, { cwd: resolved.cwd, env: resolved.env });
  if (result.code === 0) {
    return {
      harness,
      kind: "tool",
      status: "installed",
      detail: `registered via claude mcp add (${resolved.scope} scope)`,
    };
  }
  const output = `${result.stdout}${result.stderr}`;
  if (/already exists/i.test(output)) {
    return {
      harness,
      kind: "tool",
      status: "unchanged",
      detail: "already registered; run `claude mcp remove jev` first to replace it",
    };
  }
  return {
    harness,
    kind: "tool",
    status: "failed",
    detail: output.trim() || `claude exited with ${result.code}`,
  };
}

async function codexTool(resolved: Resolved): Promise<SetupAction> {
  const harness: Harness = "codex";
  const { spec } = resolved;
  const configPath = join(resolved.home, ".codex", "config.toml");
  const binary = resolved.which("codex");
  const args = [
    "mcp",
    "add",
    "jev",
    ...envArgs("--env", spec.env),
    "--",
    spec.command,
    ...spec.args,
  ];
  if (!binary) {
    return fromOutcome(
      harness,
      upsertCodexToml(configPath, spec, { dryRun: resolved.dryRun }),
      configPath,
    );
  }
  if (resolved.dryRun) {
    return { harness, kind: "tool", status: "planned", detail: `codex ${redactedCommand(args)}` };
  }
  const result = await resolved.exec(binary, args, { cwd: resolved.cwd, env: resolved.env });
  if (result.code === 0) {
    return {
      harness,
      kind: "tool",
      status: "installed",
      detail: `registered via codex mcp add (${configPath})`,
    };
  }
  const output = `${result.stdout}${result.stderr}`;
  if (/already/i.test(output)) {
    return {
      harness,
      kind: "tool",
      status: "unchanged",
      detail: "already registered; run `codex mcp remove jev` first to replace it",
    };
  }
  return {
    harness,
    kind: "tool",
    status: "failed",
    detail: output.trim() || `codex exited with ${result.code}`,
  };
}

async function piTool(resolved: Resolved): Promise<SetupAction> {
  const harness: Harness = "pi";
  const args = ["install", ...(resolved.scope === "project" ? ["-l"] : []), resolved.piSource];
  const binary = resolved.which("pi");
  if (!binary) {
    return {
      harness,
      kind: "tool",
      status: "manual",
      detail: `\`pi\` not found on PATH. Run: pi ${shellQuote(args)}`,
    };
  }
  if (resolved.dryRun) {
    return { harness, kind: "tool", status: "planned", detail: `pi ${shellQuote(args)}` };
  }
  const result = await resolved.exec(binary, args, { cwd: resolved.cwd, env: resolved.env });
  if (result.code === 0) {
    return {
      harness,
      kind: "tool",
      status: "installed",
      detail: `pi ${shellQuote(args)} (run /reload inside pi)`,
    };
  }
  return {
    harness,
    kind: "tool",
    status: "failed",
    detail: `${result.stdout}${result.stderr}`.trim() || `pi exited with ${result.code}`,
  };
}

async function opencodeTool(resolved: Resolved): Promise<SetupAction> {
  const harness: Harness = "opencode";
  const configPath =
    resolved.scope === "user"
      ? join(resolved.home, ".config", "opencode", "opencode.json")
      : join(resolved.cwd, "opencode.json");
  return fromOutcome(
    harness,
    upsertOpencodeMcp(configPath, resolved.spec, { dryRun: resolved.dryRun }),
    configPath,
  );
}

export * from "./configs.js";
export { type Exec, type ExecResult, realExec, type Which, whichBinary } from "./exec.js";
export {
  detectHarnesses,
  HARNESS_LABEL,
  HARNESSES,
  type Harness,
  type HarnessDetection,
  harnessPaths,
  parseHarness,
} from "./harnesses.js";
export {
  bundledSkillDir,
  installSkill,
  listFiles,
  SKILL_NAME,
  type SkillInstallStatus,
} from "./skills.js";
