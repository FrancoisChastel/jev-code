import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexTomlBlock,
  codexTomlHasServer,
  codexTomlServerCommand,
  defaultServerCommand,
  jsonHasMcpEntry,
  listingScope,
  mcpEntryCommand,
  parseMcpListing,
  pinnedVersion,
  piSettingsHasPackage,
  readJsonFile,
  serverEnvFromProcess,
  toSpec,
  upsertCodexToml,
  upsertMcpServersJson,
  upsertOpencodeMcp,
  writeFileWithBackup,
} from "../../src/setup/configs.js";

const PKG = "@french-castle/jev-code";
const spec = toSpec(defaultServerCommand(PKG), { TYPESAFE_API_KEY: "ts_x" });
const pinned = toSpec(defaultServerCommand(PKG, "0.9.0"), { TYPESAFE_API_KEY: "ts_x" });

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jev-code-"));
}

describe("config editors", () => {
  it("pins the launch command to a version and reads the pin back", () => {
    expect(defaultServerCommand(PKG, "0.9.0")).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    expect(pinnedVersion(defaultServerCommand(PKG, "0.9.0"), PKG)).toBe("0.9.0");
    expect(pinnedVersion(defaultServerCommand(PKG), PKG)).toBeUndefined();
    expect(pinnedVersion(["node", "/opt/jev/dist/cli.js", "mcp"], PKG)).toBeUndefined();
  });

  it("builds the server spec and environment", () => {
    expect(spec).toEqual({
      command: "npx",
      args: ["-y", "@french-castle/jev-code", "mcp"],
      env: { TYPESAFE_API_KEY: "ts_x" },
    });
    expect(
      serverEnvFromProcess(
        { TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "u", OTHER: "x" },
        { includeApiKey: true },
      ),
    ).toEqual({ TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "u" });
    expect(serverEnvFromProcess({ TYPESAFE_API_KEY: "k" }, { includeApiKey: false })).toEqual({});
    expect(() => toSpec([], {})).toThrow(/must not be empty/);
  });

  it("bakes only the active provider key, plus JEV_CODE_PROVIDER when it is set", () => {
    const both = { TYPESAFE_API_KEY: "ts_a", OPENROUTER_API_KEY: "sk-or-b" };
    expect(serverEnvFromProcess(both, { includeApiKey: true })).toEqual({
      TYPESAFE_API_KEY: "ts_a",
    });
    expect(
      serverEnvFromProcess({ ...both, JEV_CODE_PROVIDER: "openrouter" }, { includeApiKey: true }),
    ).toEqual({ OPENROUTER_API_KEY: "sk-or-b", JEV_CODE_PROVIDER: "openrouter" });
    expect(
      serverEnvFromProcess({ OPENROUTER_API_KEY: "sk-or-b" }, { includeApiKey: false }),
    ).toEqual({});
    expect(
      serverEnvFromProcess(
        { TYPESAFE_API_KEY: "ts_a", TYPESAFE_BASE_URL: "https://openrouter.ai/api" },
        { includeApiKey: true },
      ),
    ).toEqual({ TYPESAFE_BASE_URL: "https://openrouter.ai/api" });
  });

  it("upserts the OpenCode entry, keeps other keys, backs up, and is idempotent", () => {
    const dir = tmp();
    const path = join(dir, "opencode.json");
    writeFileSync(
      path,
      JSON.stringify({ model: "x", mcp: { other: { type: "remote", url: "u" } } }),
    );
    const first = upsertOpencodeMcp(path, spec);
    expect(first.changed).toBe(true);
    expect(first.backup).toMatch(/opencode\.json\.bak-/);
    const written = readJsonFile(path);
    expect(written.model).toBe("x");
    expect(written.$schema).toBe("https://opencode.ai/config.json");
    expect((written.mcp as Record<string, unknown>).other).toEqual({ type: "remote", url: "u" });
    expect((written.mcp as Record<string, unknown>).jev).toEqual({
      type: "local",
      command: ["npx", "-y", "@french-castle/jev-code", "mcp"],
      enabled: true,
      environment: { TYPESAFE_API_KEY: "ts_x" },
    });
    expect(upsertOpencodeMcp(path, spec)).toEqual({ changed: false });
    expect(upsertOpencodeMcp(path, { ...spec, env: {} }, { dryRun: true })).toEqual({
      changed: true,
      planned: true,
      updated: true,
    });
    expect(jsonHasMcpEntry(path, "mcp")).toBe(true);
    expect(mcpEntryCommand(path, "mcp")).toEqual(["npx", "-y", PKG, "mcp"]);
    // Re-running setup with a newer pin replaces the entry and reports an update.
    const repin = upsertOpencodeMcp(path, pinned);
    expect(repin).toMatchObject({ changed: true, updated: true });
    expect(mcpEntryCommand(path, "mcp")).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toHaveLength(2);
  });

  it("creates a fresh mcpServers file and refuses to touch malformed JSON", () => {
    const dir = tmp();
    const path = join(dir, ".mcp.json");
    expect(upsertMcpServersJson(path, { ...spec, env: {} })).toEqual({ changed: true });
    expect(readJsonFile(path)).toEqual({
      mcpServers: { jev: { command: "npx", args: ["-y", "@french-castle/jev-code", "mcp"] } },
    });
    expect(jsonHasMcpEntry(path, "mcpServers")).toBe(true);
    expect(mcpEntryCommand(path, "mcpServers")).toEqual(["npx", "-y", PKG, "mcp"]);
    expect(upsertMcpServersJson(path, { ...pinned, env: {} })).toMatchObject({
      changed: true,
      updated: true,
    });
    expect(mcpEntryCommand(path, "mcpServers")).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    expect(mcpEntryCommand(join(dir, "missing.json"), "mcpServers")).toBeUndefined();
    writeFileSync(path, "{ not json");
    expect(() => upsertMcpServersJson(path, spec)).toThrow(/not valid JSON/);
    expect(jsonHasMcpEntry(path, "mcpServers")).toBe(false);
    writeFileSync(path, "[]");
    expect(() => readJsonFile(path)).toThrow(/JSON object/);
  });

  it("appends a Codex TOML table once", () => {
    const dir = tmp();
    const path = join(dir, "config.toml");
    writeFileSync(path, 'model = "gpt"\n[mcp_servers.other]\ncommand = "x"\n');
    expect(upsertCodexToml(path, spec).changed).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('model = "gpt"');
    expect(text).toContain(
      '[mcp_servers.jev]\ncommand = "npx"\nargs = ["-y", "@french-castle/jev-code", "mcp"]\n\n[mcp_servers.jev.env]\nTYPESAFE_API_KEY = "ts_x"\n',
    );
    expect(upsertCodexToml(path, spec)).toEqual({ changed: false });
    expect(codexTomlHasServer(path)).toBe(true);
    expect(codexTomlServerCommand(path)).toEqual(["npx", "-y", PKG, "mcp"]);
    expect(codexTomlBlock({ ...spec, env: {} })).not.toContain(".env]");
    const fresh = join(dir, "fresh.toml");
    expect(upsertCodexToml(fresh, spec, { dryRun: true })).toEqual({
      changed: true,
      planned: true,
    });
    expect(codexTomlHasServer(fresh)).toBe(false);
  });

  it("replaces an existing Codex table when the command changes and leaves its neighbours alone", () => {
    const dir = tmp();
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `model = "gpt"

${codexTomlBlock(spec)}
[mcp_servers.other]
command = "x"
args = []
`,
    );
    expect(upsertCodexToml(path, pinned, { dryRun: true })).toEqual({
      changed: true,
      planned: true,
      updated: true,
    });
    expect(codexTomlServerCommand(path)).toEqual(["npx", "-y", PKG, "mcp"]);
    const outcome = upsertCodexToml(path, pinned);
    expect(outcome).toMatchObject({ changed: true, updated: true });
    const text = readFileSync(path, "utf8");
    expect(text).toContain('model = "gpt"');
    expect(text).toContain(`args = ["-y", "${PKG}@0.9.0", "mcp"]`);
    expect(text).toContain('TYPESAFE_API_KEY = "ts_x"');
    expect(text).toContain('[mcp_servers.other]\ncommand = "x"\nargs = []\n');
    expect(text.match(/\[mcp_servers\.jev\]/g)).toHaveLength(1);
    expect(codexTomlServerCommand(path)).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    expect(upsertCodexToml(path, pinned)).toEqual({ changed: false });
    expect(codexTomlServerCommand(join(dir, "none.toml"))).toBeUndefined();
  });

  it("keeps CRLF files on CRLF and stays idempotent", () => {
    const dir = tmp();
    const path = join(dir, "config.toml");
    const crlf = (text: string) => text.replace(/\n/g, "\r\n");
    writeFileSync(
      path,
      crlf(`model = "gpt"\n\n${codexTomlBlock(spec)}\n[mcp_servers.other]\ncommand = "x"\n`),
    );
    expect(upsertCodexToml(path, pinned)).toMatchObject({ changed: true, updated: true });
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).toContain(`args = ["-y", "${PKG}@0.9.0", "mcp"]`);
    expect(text).toContain("[mcp_servers.other]");
    expect(upsertCodexToml(path, pinned)).toEqual({ changed: false });
    expect(codexTomlServerCommand(path)).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    const fresh = join(dir, "fresh.toml");
    writeFileSync(fresh, crlf('model = "gpt"\n'));
    upsertCodexToml(fresh, spec);
    expect(readFileSync(fresh, "utf8")).not.toMatch(/[^\r]\n/);
  });

  it("folds an env sub-table declared before its parent into the replaced span", () => {
    const dir = tmp();
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      `[mcp_servers.jev.env]\nTYPESAFE_API_KEY = "old"\n\n[mcp_servers.jev]\ncommand = "npx"\nargs = ["-y", "${PKG}", "mcp"]\n\n[other]\nk = 1\n`,
    );
    expect(upsertCodexToml(path, pinned)).toMatchObject({ changed: true, updated: true });
    const text = readFileSync(path, "utf8");
    expect(text.match(/\[mcp_servers\.jev\.env\]/g)).toHaveLength(1);
    expect(text.match(/\[mcp_servers\.jev\]/g)).toHaveLength(1);
    expect(text).toContain('TYPESAFE_API_KEY = "ts_x"');
    expect(text).not.toContain('"old"');
    expect(text).toContain("[other]\nk = 1\n");
  });

  it("parses a realistic claude mcp get listing, and reads its scope", () => {
    const listing = `jev:\n  Scope: Project config (shared via .mcp.json)\n  Status: ⏸ Pending approval\n  Type: stdio\n  Command: npx\n  Args: -y ${PKG}@0.9.0 mcp\n  Environment:\n    TYPESAFE_API_KEY=ts_x\n`;
    expect(parseMcpListing(listing)).toEqual(["npx", "-y", `${PKG}@0.9.0`, "mcp"]);
    expect(listingScope(listing)).toBe("Project config (shared via .mcp.json)");
    expect(parseMcpListing("jev\n  command: node\n  args: -\n")).toEqual(["node"]);
    expect(parseMcpListing("nothing here")).toBeUndefined();
    expect(listingScope("no scope line")).toBeUndefined();
  });

  it("gives two backups taken in the same second distinct names", () => {
    const dir = tmp();
    const path = join(dir, "f.json");
    writeFileSync(path, "1");
    const first = writeFileWithBackup(path, "2");
    const second = writeFileWithBackup(path, "3");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toHaveLength(2);
  });

  it("carries a keyless host's server variable into the harness config", () => {
    expect(
      serverEnvFromProcess(
        { JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "gpu-box" },
        { includeApiKey: true },
      ),
    ).toEqual({ JEV_CODE_PROVIDER: "ollama", OLLAMA_HOST: "gpu-box" });
  });

  it("detects the pi package in settings", () => {
    const dir = tmp();
    const path = join(dir, "settings.json");
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    writeFileSync(
      path,
      JSON.stringify({ packages: ["npm:other", { source: "npm:@french-castle/jev-code" }] }),
    );
    expect(piSettingsHasPackage(path, "jev-code")).toBe(true);
    writeFileSync(path, "nope");
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    const pkgDir = join(dir, "checkout");
    mkdirSync(pkgDir);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@french-castle/jev-code" }),
    );
    writeFileSync(path, JSON.stringify({ packages: ["./checkout"] }));
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    expect(piSettingsHasPackage(path, "jev-code", "@french-castle/jev-code")).toBe(true);
    expect(piSettingsHasPackage(path, "jev-code", "@other/pkg")).toBe(false);
  });
});
