import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describeConfig, ENV, isCustomProvider } from "../core/config.js";
import { PROVIDERS } from "../core/providers.js";

/** How to launch the MCP server, plus the environment to hand it. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const MCP_SERVER_KEY = "jev";

/**
 * `npx -y <package>@<version> mcp` works anywhere Node is installed, without a global install.
 * The pin matters: npx keeps the first version it cached for an unpinned name and never checks
 * for a newer one, so an unpinned command silently freezes. A pinned command starts fast and
 * works offline once cached, and re-running setup moves the pin deliberately.
 */
export function defaultServerCommand(packageName: string, version?: string): string[] {
  return ["npx", "-y", version ? `${packageName}@${version}` : packageName, "mcp"];
}

/** The version a launch command pins the package to; undefined when it floats or is custom. */
export function pinnedVersion(command: readonly string[], packageName: string): string | undefined {
  const prefix = `${packageName}@`;
  const spec = command.find((arg) => arg.startsWith(prefix));
  return spec ? spec.slice(prefix.length) : undefined;
}

/**
 * The launch command shown by `claude mcp get jev` or `codex mcp get jev`: a `Command:` line
 * and an `Args:` line (Codex prints them in lower case, and `-` for no args).
 */
/** The `Scope:` line of a `claude mcp get` listing, e.g. "User config" or "Project config". */
export function listingScope(listing: string): string | undefined {
  return /^\s*scope:\s*(.+)$/im.exec(listing)?.[1]?.trim();
}

export function parseMcpListing(listing: string): string[] | undefined {
  const command = /^\s*command:\s*(.+)$/im.exec(listing)?.[1]?.trim();
  if (!command) return undefined;
  const args = /^\s*args:\s*(.*)$/im.exec(listing)?.[1]?.trim() ?? "";
  return [command, ...args.split(/\s+/).filter((arg) => arg && arg !== "-")];
}

export function toSpec(command: readonly string[], env: Record<string, string>): McpServerSpec {
  const [head, ...rest] = command;
  if (!head) throw new Error("The MCP server command must not be empty.");
  return { command: head, args: rest, env };
}

/**
 * The variables worth carrying into a harness config, when set: the one key in use (never
 * the others), the provider choice, and the base URL and model overrides.
 */
export function serverEnvFromProcess(
  env: NodeJS.ProcessEnv,
  options: { includeApiKey: boolean },
): Record<string, string> {
  const out: Record<string, string> = {};
  const names: string[] = [];
  if (options.includeApiKey) {
    const { keyEnv } = describeConfig(env);
    if (keyEnv) names.push(keyEnv);
  }
  names.push(ENV.provider);
  if (isCustomProvider(env)) {
    names.push(ENV.providerName, ENV.customBaseUrl, ENV.customModel, ENV.maxRetries, ENV.timeoutMs);
  } else {
    names.push(ENV.baseUrl, ENV.model);
    for (const provider of PROVIDERS) if (provider.hostEnv) names.push(provider.hostEnv);
  }
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) out[name] = value;
  }
  return out;
}

export interface WriteOutcome {
  changed: boolean;
  backup?: string;
  planned?: boolean;
  /** An existing entry was replaced rather than added. */
  updated?: boolean;
}

/** Read a JSON file, tolerating absence; malformed content is an error, never overwritten. */
export function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON (${(error as Error).message}); fix it or move it aside.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** Back up (when present) and write a file, creating parent directories. */
export function writeFileWithBackup(path: string, content: string): string | undefined {
  let backup: string | undefined;
  if (existsSync(path)) {
    const base = `${path}.bak-${timestamp()}`;
    backup = base;
    for (let n = 1; existsSync(backup); n += 1) backup = `${base}-${n}`;
    copyFileSync(path, backup);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return backup;
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** OpenCode: `{ "mcp": { "jev": { "type": "local", "command": [...], "environment": {...} } } }` */
export function upsertOpencodeMcp(
  configPath: string,
  spec: McpServerSpec,
  options: { dryRun?: boolean } = {},
): WriteOutcome {
  const config = readJsonFile(configPath);
  const entry: Record<string, unknown> = {
    type: "local",
    command: [spec.command, ...spec.args],
    enabled: true,
    ...(Object.keys(spec.env).length ? { environment: spec.env } : {}),
  };
  const mcp = (config.mcp as Record<string, unknown> | undefined) ?? {};
  if (deepEqual(mcp[MCP_SERVER_KEY], entry)) return { changed: false };
  const replaced = MCP_SERVER_KEY in mcp ? { updated: true } : {};
  if (options.dryRun) return { changed: true, planned: true, ...replaced };
  const next = {
    ...(config.$schema ? {} : { $schema: "https://opencode.ai/config.json" }),
    ...config,
    mcp: { ...mcp, [MCP_SERVER_KEY]: entry },
  };
  const backup = writeFileWithBackup(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, ...replaced, ...(backup ? { backup } : {}) };
}

/** The launch command a JSON config registers for the server, or undefined when absent. */
export function mcpEntryCommand(
  configPath: string,
  root: "mcp" | "mcpServers",
): string[] | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const servers = readJsonFile(configPath)[root];
    if (!servers || typeof servers !== "object") return undefined;
    const entry = (servers as Record<string, unknown>)[MCP_SERVER_KEY];
    if (!entry || typeof entry !== "object") return undefined;
    const { command, args } = entry as { command?: unknown; args?: unknown };
    if (Array.isArray(command)) return command.map(String);
    if (typeof command !== "string") return undefined;
    return [command, ...(Array.isArray(args) ? args.map(String) : [])];
  } catch {
    return undefined;
  }
}

/** Claude Code project scope and generic clients: `{ "mcpServers": { "jev": { command, args, env } } }` */
export function upsertMcpServersJson(
  configPath: string,
  spec: McpServerSpec,
  options: { dryRun?: boolean } = {},
): WriteOutcome {
  const config = readJsonFile(configPath);
  const entry: Record<string, unknown> = {
    command: spec.command,
    args: spec.args,
    ...(Object.keys(spec.env).length ? { env: spec.env } : {}),
  };
  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (deepEqual(servers[MCP_SERVER_KEY], entry)) return { changed: false };
  const replaced = MCP_SERVER_KEY in servers ? { updated: true } : {};
  if (options.dryRun) return { changed: true, planned: true, ...replaced };
  const next = { ...config, mcpServers: { ...servers, [MCP_SERVER_KEY]: entry } };
  const backup = writeFileWithBackup(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, ...replaced, ...(backup ? { backup } : {}) };
}

const CODEX_TABLE = new RegExp(`^\\[mcp_servers\\.${MCP_SERVER_KEY}\\]\\s*$`, "m");
const CODEX_ENV_TABLE = `[mcp_servers.${MCP_SERVER_KEY}.env]`;

/** Split on either line ending; callers re-join with the file's own. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Line range of our table and its env sub-table inside a config.toml, when present. TOML lets
 * the env sub-table come first; when it does and nothing else sits between, it is included.
 */
function codexTomlServerRange(
  lines: readonly string[],
): { start: number; end: number } | undefined {
  let start = lines.findIndex((line) => CODEX_TABLE.test(line));
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length) {
    const line = (lines[end] ?? "").trim();
    if (line.startsWith("[") && line !== CODEX_ENV_TABLE) break;
    end += 1;
  }
  const envFirst = lines.findIndex((line) => line.trim() === CODEX_ENV_TABLE);
  if (envFirst !== -1 && envFirst < start) {
    const between = lines.slice(envFirst + 1, start);
    if (!between.some((line) => line.trim().startsWith("["))) start = envFirst;
  }
  return { start, end };
}

/**
 * The launch command our Codex table registers, or undefined when the table is absent. Values
 * are read as JSON literals, which covers what this tool and the codex CLI write (double-quoted
 * strings on one line); a hand-edited table with single quotes or comments reads as absent.
 */
export function codexTomlServerCommand(configPath: string): string[] | undefined {
  if (!existsSync(configPath)) return undefined;
  const lines = splitLines(readFileSync(configPath, "utf8"));
  const range = codexTomlServerRange(lines);
  if (!range) return undefined;
  const block = lines.slice(range.start, range.end).join("\n");
  const command = /^command\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m.exec(block)?.[1];
  const args = /^args\s*=\s*(\[[^\]]*\])\s*$/m.exec(block)?.[1];
  if (!command) return undefined;
  try {
    const parsedArgs = args ? (JSON.parse(args) as unknown[]).map(String) : [];
    return [String(JSON.parse(command)), ...parsedArgs];
  } catch {
    return undefined;
  }
}

/** Render the TOML block Codex expects. Strings are JSON-escaped, which TOML basic strings accept. */
export function codexTomlBlock(spec: McpServerSpec): string {
  const lines = [
    `[mcp_servers.${MCP_SERVER_KEY}]`,
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${spec.args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
  ];
  if (Object.keys(spec.env).length) {
    lines.push("", `[mcp_servers.${MCP_SERVER_KEY}.env]`);
    for (const [key, value] of Object.entries(spec.env)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Codex (fallback when the `codex` CLI is unavailable): append our table, or replace it in
 * place when it exists with a different command, leaving every other table untouched.
 */
export function upsertCodexToml(
  configPath: string,
  spec: McpServerSpec,
  options: { dryRun?: boolean } = {},
): WriteOutcome {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const block = codexTomlBlock(spec);
  const lines = splitLines(existing);
  const range = codexTomlServerRange(lines);
  if (range) {
    const current = lines.slice(range.start, range.end).join("\n");
    if (current.trim() === block.trim()) return { changed: false };
    if (options.dryRun) return { changed: true, planned: true, updated: true };
    const replaced = [...block.trimEnd().split("\n"), ""];
    const next = [...lines.slice(0, range.start), ...replaced, ...lines.slice(range.end)].join(eol);
    const backup = writeFileWithBackup(configPath, next);
    return { changed: true, updated: true, ...(backup ? { backup } : {}) };
  }
  if (options.dryRun) return { changed: true, planned: true };
  const blank = `${eol}${eol}`;
  const separator =
    existing === "" || existing.endsWith(blank) ? "" : existing.endsWith(eol) ? eol : blank;
  const appended = block.split("\n").join(eol);
  const backup = writeFileWithBackup(configPath, `${existing}${separator}${appended}`);
  return { changed: true, ...(backup ? { backup } : {}) };
}

export function codexTomlHasServer(configPath: string): boolean {
  return existsSync(configPath) && CODEX_TABLE.test(readFileSync(configPath, "utf8"));
}

/**
 * Pi records packages in settings.json. Match ours by source substring (npm or git specs),
 * or, for a local path entry, by the package name in its package.json.
 */
export function piSettingsHasPackage(
  settingsPath: string,
  needle: string,
  packageName?: string,
): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = readJsonFile(settingsPath);
    const packages = Array.isArray(settings.packages) ? settings.packages : [];
    return packages.some((entry) => {
      const source = typeof entry === "string" ? entry : (entry as { source?: unknown })?.source;
      if (typeof source !== "string") return false;
      if (source.includes(needle)) return true;
      if (!packageName || /^(npm|git):/.test(source) || /^[a-z]+:\/\//.test(source)) return false;
      return localPackageName(resolve(dirname(settingsPath), source)) === packageName;
    });
  } catch {
    return false;
  }
}

function localPackageName(dir: string): string | undefined {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    return (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
  } catch {
    return undefined;
  }
}

export function jsonHasMcpEntry(configPath: string, root: "mcp" | "mcpServers"): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const config = readJsonFile(configPath);
    const servers = config[root];
    return !!servers && typeof servers === "object" && MCP_SERVER_KEY in (servers as object);
  } catch {
    return false;
  }
}
