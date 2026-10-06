import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { JevClient } from "../core/client.js";
import {
  describeConfig,
  describeProviderInUse,
  ENV,
  isCustomProvider,
  providerNameFromSetting,
  resolveConfig,
} from "../core/config.js";
import { errorMessage, JevConfigError, JevValidationError } from "../core/errors.js";
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  type Provider,
  providerByName,
  providerForKey,
} from "../core/providers.js";
import { serveStdio } from "../mcp/server.js";
import { serverEnvFromProcess } from "../setup/configs.js";
import { type Exec, realExec, type Which, whichBinary } from "../setup/exec.js";
import { type Harness, parseHarness } from "../setup/harnesses.js";
import { runSetup, type SetupAction, type SetupReport } from "../setup/index.js";
import { bundledSkillDir } from "../setup/skills.js";
import { findTool, TOOL_NAMES } from "../tools/index.js";
import { PACKAGE_NAME, VERSION } from "../version.js";
import { flagBool, flagString, parseArgs } from "./args.js";
import { runDoctor } from "./doctor.js";
import { helpText } from "./help.js";
import { readLine, readSecret } from "./prompt.js";

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
  /** Asks for a secret without echoing it; absent means setup never prompts. */
  promptSecret?: (question: string) => Promise<string>;
  /** Asks a visible question; used to confirm which host a pasted key is for. */
  promptLine?: (question: string) => Promise<string>;
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
    promptSecret: (question) => readSecret(question),
    promptLine: (question) => readLine(question),
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
  const dryRun = flagBool(flags, "dry-run", false);
  const tool = flagBool(flags, "tool", true);
  const selector = flagString(flags, "provider");
  if (flags.provider !== undefined && selector === undefined) {
    throw new JevConfigError("--provider requires a provider name.");
  }
  const setupEnv =
    selector !== undefined
      ? { ...io.env, [ENV.provider]: providerNameFromSetting(selector) }
      : io.env;
  const pasted = await promptForKey(flags, { ...io, env: setupEnv }, { tool, dryRun });
  const env = pasted ? { ...setupEnv, ...pasted.env } : setupEnv;
  const report = await runSetup({
    harnesses,
    all: flagBool(flags, "all", false),
    scope: flagBool(flags, "project", false) ? "project" : "user",
    dryRun,
    skill: flagBool(flags, "skill", true),
    tool,
    bakeEnv: flagBool(flags, "env", true),
    ...(commandFlag ? { command: commandFlag.split(/\s+/).filter(Boolean) } : {}),
    ...(flagString(flags, "pi-source")
      ? { piSource: flagString(flags, "pi-source") as string }
      : {}),
    env,
    home: io.home,
    cwd: io.cwd,
    exec: io.exec,
    which: io.which,
  });
  io.stdout(formatSetupReport(report, io.home));
  if (pasted)
    io.stdout(
      pastedKeyAdvice(
        isCustomProvider(env) ? serverEnvFromProcess(env, { includeApiKey: true }) : pasted.env,
        flagBool(flags, "env", true),
      ),
    );
  return report.actions.some((action) => action.status === "failed") ? EXIT.failure : EXIT.ok;
}

const KEY_PROMPT =
  "No API key found. Paste a TypeSafe, OpenRouter, Vercel AI Gateway, OpenAI, or custom-provider key (input is hidden), or press Enter to skip: ";

/**
 * Offer to take the key interactively when setup would otherwise register a tool that
 * cannot work. Only in a terminal, only when no key is set, and never on a dry run. The user
 * says which host the key is for (key shapes are not reliable); the answer picks the variable,
 * and the result is judged like any other configuration, so a conflicting override surfaces.
 */
async function promptForKey(
  flags: ReturnType<typeof parseArgs>["flags"],
  io: CliIO,
  options: { tool: boolean; dryRun: boolean },
): Promise<{ env: Record<string, string> } | undefined> {
  if (!options.tool || options.dryRun || !flagBool(flags, "prompt", true)) return undefined;
  if (!io.stdinIsTTY || !io.promptSecret) return undefined;
  if (isCustomProvider(io.env)) {
    if (!describeConfig(io.env).problem) return undefined;
    return promptCustom(io);
  }
  if (describeConfig(io.env).hasApiKey) return undefined;
  const key = (await io.promptSecret(KEY_PROMPT)).trim();
  if (!key) return undefined;
  const named = providerByName(io.env[ENV.provider] ?? "");
  const suggested = named && !named.keyless ? named : (providerForKey(key) ?? DEFAULT_PROVIDER);
  const provider = await askHost(io, suggested);
  if (provider === "custom")
    return promptCustom({
      ...io,
      env: { ...io.env, [ENV.provider]: "custom", [ENV.customApiKey]: key },
    });
  // A pasted key is a decision, so an opt-in host gets its JEV_CODE_PROVIDER alongside.
  const env: Record<string, string> = {
    [provider.keyEnv]: key,
    ...(provider.explicitOnly ? { [ENV.provider]: provider.name } : {}),
  };
  const using = describeProviderInUse(describeConfig({ ...io.env, ...env }));
  if (using) io.stdout(`${using}\n\n`);
  return { env };
}

/**
 * Key shapes are not reliable, so the host is asked, with the best guess as the default. Only
 * hosts that take a key are offered; a number, a name, or Enter answers.
 */
async function askHost(io: CliIO, suggested: Provider): Promise<Provider | "custom"> {
  const hosts = PROVIDERS.filter((provider) => !provider.keyless);
  if (!io.promptLine) return suggested;
  const menu = [
    ...hosts.map((provider, i) => `[${i + 1}] ${provider.label}`),
    `[${hosts.length + 1}] Custom`,
  ].join("  ");
  const answer = (
    await io.promptLine(
      `Which host is this key for? ${menu}. Number or name, Enter for ${suggested.label}: `,
    )
  )
    .trim()
    .toLowerCase();
  if (!answer) return suggested;
  if (answer === "custom" || answer === String(hosts.length + 1)) return "custom";
  const byNumber = hosts[Number(answer) - 1];
  const byName = hosts.find((p) => p.name === answer || p.label.toLowerCase() === answer);
  const picked = byNumber ?? byName;
  if (!picked) io.stdout(`Did not recognise "${answer}"; using ${suggested.label}.\n`);
  return picked ?? suggested;
}

async function promptCustom(io: CliIO): Promise<{ env: Record<string, string> } | undefined> {
  const env: Record<string, string> = { [ENV.provider]: "custom" };
  const fields = [
    [ENV.providerName, "Provider name: "],
    [
      ENV.customBaseUrl,
      "API base URL (HTTP(S), without /v1/systemone; not a model catalog page): ",
    ],
    [ENV.customModel, "Provider model ID (enter the exact model ID): "],
    [ENV.customApiKey, "API key for this provider (input is hidden): "],
  ] as const;
  for (const [name, question] of fields) {
    const existing = io.env[name];
    if (existing?.trim()) {
      env[name] = existing;
      continue;
    }
    const prompt = name === ENV.customApiKey ? io.promptSecret : io.promptLine;
    if (!prompt) return undefined;
    const answer = (await prompt(question)).trim();
    if (!answer)
      throw new JevConfigError(
        `${name} is required; custom setup cancelled. No tool was registered.`,
      );
    env[name] = answer;
  }
  resolveConfig({ ...io.env, ...env });
  return { env };
}

function shellValue(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function pastedKeyAdvice(env: Record<string, string>, copied: boolean): string {
  const exports = Object.entries(env).map(([name, value]) =>
    /(?:API_KEY|TOKEN)$/.test(name)
      ? `  export ${name}=...`
      : `  export ${name}=${shellValue(value)}`,
  );
  return [
    "",
    copied
      ? "The key went into the harness configs that store server environments."
      : "The key was not copied into any config (--no-env).",
    "Pi and the jev-code CLI read the settings from your",
    `shell instead, so add ${exports.length > 1 ? "these lines" : "this line"} to your shell profile (for example ~/.zshrc), with the`,
    "key you set locally:",
    ...exports,
    "",
  ].join("\n");
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
