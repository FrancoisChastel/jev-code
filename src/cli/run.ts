import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { JevClient } from "../core/client.js";
import { errorMessage, JevConfigError, JevValidationError } from "../core/errors.js";
import { serveStdio } from "../mcp/server.js";
import { type Exec, realExec, type Which, whichBinary } from "../setup/exec.js";
import { type Harness, parseHarness } from "../setup/harnesses.js";
import { runSetup, type SetupAction, type SetupReport } from "../setup/index.js";
import { bundledSkillDir } from "../setup/skills.js";
import { findTool, TOOL_NAMES } from "../tools/index.js";
import { PACKAGE_NAME, VERSION } from "../version.js";
import { flagBool, flagString, parseArgs } from "./args.js";
import { runDoctor } from "./doctor.js";
import { helpText } from "./help.js";

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  cwd: string;
  home: string;
  exec: Exec;
  which: Which;
  /** Runs the MCP stdio server; injectable so tests do not take over the process pipes. */
  serve: () => Promise<void>;
  fetch?: ConstructorParameters<typeof JevClient>[0]["fetch"];
}

export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

const TOOL_COMMANDS = new Set(["classify", "check", "score", "rank", "ask"]);

function defaultIO(): CliIO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    exec: realExec,
    which: (binary) => whichBinary(binary),
    serve: () => serveStdio(),
  };
}

/** Entry point shared by the bin and the tests. Returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliIO> = {},
): Promise<number> {
  const io: CliIO = { ...defaultIO(), ...overrides };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.stderr(`error: ${errorMessage(error)}\n`);
    return EXIT.usage;
  }
  const { command, positionals, flags } = parsed;

  if (flags.version === true || command === "version") {
    io.stdout(`${PACKAGE_NAME} ${VERSION}\n`);
    return EXIT.ok;
  }
  if (flags.help === true || command === undefined || command === "help") {
    io.stdout(helpText());
    return EXIT.ok;
  }

  try {
    switch (command) {
      case "mcp":
        await io.serve();
        return EXIT.ok;
      case "skill":
        io.stdout(`${bundledSkillDir()}\n`);
        return EXIT.ok;
      case "setup":
        return await setupCommand(positionals, flags, io);
      case "doctor": {
        const report = await runDoctor({
          env: io.env,
          home: io.home,
          cwd: io.cwd,
          exec: io.exec,
          which: io.which,
          live: flagBool(flags, "live", false),
          ...(io.fetch ? { fetch: io.fetch } : {}),
        });
        io.stdout(`${report.lines.join("\n")}\n`);
        return report.ok ? EXIT.ok : EXIT.failure;
      }
      default:
        if (TOOL_COMMANDS.has(command)) return await toolCommand(command, flags, io);
        io.stderr(`error: unknown command "${command}". Run \`jev-code help\`.\n`);
        return EXIT.usage;
    }
  } catch (error) {
    io.stderr(`error: ${errorMessage(error)}\n`);
    return error instanceof JevConfigError || error instanceof JevValidationError
      ? EXIT.usage
      : EXIT.failure;
  }
}

async function toolCommand(
  command: string,
  flags: ReturnType<typeof parseArgs>["flags"],
  io: CliIO,
): Promise<number> {
  const tool = findTool(command);
  if (!tool) {
    io.stderr(`error: no tool for "${command}". Tools: ${TOOL_NAMES.join(", ")}.\n`);
    return EXIT.usage;
  }
  const payloadText = await readPayload(flags, io);
  if (payloadText === undefined) {
    io.stderr(
      `error: no input. Pass --input <file>, --json '<payload>', or pipe JSON on stdin. Run \`jev-code help\` for the payload shape.\n`,
    );
    return EXIT.usage;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    io.stderr(`error: payload is not valid JSON: ${errorMessage(error)}\n`);
    return EXIT.usage;
  }
  const client = JevClient.fromEnv(io.env, {
    userAgent: `${PACKAGE_NAME}/${VERSION} cli`,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  const result = await tool.run(client, payload);
  const pretty = flagBool(flags, "pretty", io.stdoutIsTTY);
  io.stdout(`${pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`);
  return EXIT.ok;
}

async function readPayload(
  flags: ReturnType<typeof parseArgs>["flags"],
  io: CliIO,
): Promise<string | undefined> {
  const inline = flagString(flags, "json");
  if (inline !== undefined) return inline;
  const input = flagString(flags, "input");
  if (input !== undefined && input !== "-") return readFileSync(input, "utf8");
  if (input === "-" || !io.stdinIsTTY) {
    const text = await io.readStdin();
    return text.trim() === "" ? undefined : text;
  }
  return undefined;
}

async function setupCommand(
  positionals: string[],
  flags: ReturnType<typeof parseArgs>["flags"],
  io: CliIO,
): Promise<number> {
  const harnesses: Harness[] = [];
  for (const name of positionals) {
    const harness = parseHarness(name);
    if (!harness) {
      io.stderr(`error: unknown harness "${name}". Use claude, codex, pi, or opencode.\n`);
      return EXIT.usage;
    }
    if (!harnesses.includes(harness)) harnesses.push(harness);
  }
  const commandFlag = flagString(flags, "command");
  const report = await runSetup({
    harnesses,
    all: flagBool(flags, "all", false),
    scope: flagBool(flags, "project", false) ? "project" : "user",
    dryRun: flagBool(flags, "dry-run", false),
    skill: flagBool(flags, "skill", true),
    tool: flagBool(flags, "tool", true),
    bakeEnv: flagBool(flags, "env", true),
    ...(commandFlag ? { command: commandFlag.split(/\s+/).filter(Boolean) } : {}),
    ...(flagString(flags, "pi-source")
      ? { piSource: flagString(flags, "pi-source") as string }
      : {}),
    env: io.env,
    home: io.home,
    cwd: io.cwd,
    exec: io.exec,
    which: io.which,
  });
  io.stdout(formatSetupReport(report, io.home));
  return report.actions.some((action) => action.status === "failed") ? EXIT.failure : EXIT.ok;
}

const STATUS_LABEL: Record<SetupAction["status"], string> = {
  installed: "installed",
  updated: "updated",
  unchanged: "unchanged",
  planned: "would do",
  manual: "manual",
  failed: "FAILED",
};

export function formatSetupReport(report: SetupReport, home: string): string {
  const lines: string[] = [];
  lines.push(`jev-code setup (${report.scope} scope${report.dryRun ? ", dry run" : ""})`, "");
  const byHarness = new Map<Harness, SetupAction[]>();
  for (const action of report.actions) {
    const list = byHarness.get(action.harness) ?? [];
    list.push(action);
    byHarness.set(action.harness, list);
  }
  for (const [harness, actions] of byHarness) {
    lines.push(`  ${labelOf(harness)}`);
    for (const action of actions) {
      const detail = action.detail.startsWith(home)
        ? `~${action.detail.slice(home.length)}`
        : action.detail;
      lines.push(
        `    ${action.kind.padEnd(6)} ${STATUS_LABEL[action.status].padEnd(10)} ${detail}`,
      );
    }
  }
  if (report.notes.length) {
    lines.push("", "Notes");
    for (const note of report.notes) lines.push(`  - ${note}`);
  }
  lines.push("");
  if (report.dryRun) lines.push("Dry run: nothing was written.");
  else if (report.actions.length)
    lines.push(
      "Restart your agent (or /reload inside pi) to pick up the tool. Verify with `jev-code doctor`.",
    );
  return `${lines.join("\n")}\n`;
}

function labelOf(harness: Harness): string {
  switch (harness) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "pi":
      return "Pi";
    case "opencode":
      return "OpenCode";
  }
}
