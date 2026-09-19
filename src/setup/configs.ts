import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ENV } from "../core/config.js";

/** How to launch the MCP server, plus the environment to hand it. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const MCP_SERVER_KEY = "jev";

/** `npx -y <package> mcp` works anywhere Node is installed, without a global install. */
export function defaultServerCommand(packageName: string): string[] {
  return ["npx", "-y", packageName, "mcp"];
}

export function toSpec(command: readonly string[], env: Record<string, string>): McpServerSpec {
  const [head, ...rest] = command;
  if (!head) throw new Error("The MCP server command must not be empty.");
  return { command: head, args: rest, env };
}

/** The TypeSafe variables worth carrying into a harness config, when set. */
export function serverEnvFromProcess(
  env: NodeJS.ProcessEnv,
  options: { includeApiKey: boolean },
): Record<string, string> {
  const out: Record<string, string> = {};
  const names = options.includeApiKey
    ? [ENV.apiKey, ENV.baseUrl, ENV.model]
    : [ENV.baseUrl, ENV.model];
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
    backup = `${path}.bak-${timestamp()}`;
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
  if (options.dryRun) return { changed: true, planned: true };
  const next = {
    ...(config.$schema ? {} : { $schema: "https://opencode.ai/config.json" }),
    ...config,
    mcp: { ...mcp, [MCP_SERVER_KEY]: entry },
  };
  const backup = writeFileWithBackup(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, ...(backup ? { backup } : {}) };
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
  if (options.dryRun) return { changed: true, planned: true };
  const next = { ...config, mcpServers: { ...servers, [MCP_SERVER_KEY]: entry } };
  const backup = writeFileWithBackup(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, ...(backup ? { backup } : {}) };
}

const CODEX_TABLE = new RegExp(`^\\[mcp_servers\\.${MCP_SERVER_KEY}\\]\\s*$`, "m");

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

/** Codex (fallback when the `codex` CLI is unavailable): append a table unless one exists. */
export function upsertCodexToml(
  configPath: string,
  spec: McpServerSpec,
  options: { dryRun?: boolean } = {},
): WriteOutcome {
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (CODEX_TABLE.test(existing)) return { changed: false };
  if (options.dryRun) return { changed: true, planned: true };
  const separator =
    existing === "" || existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  const backup = writeFileWithBackup(configPath, `${existing}${separator}${codexTomlBlock(spec)}`);
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
