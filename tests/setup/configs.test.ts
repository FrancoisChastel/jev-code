import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexTomlBlock,
  codexTomlHasServer,
  defaultServerCommand,
  jsonHasMcpEntry,
  piSettingsHasPackage,
  readJsonFile,
  serverEnvFromProcess,
  toSpec,
  upsertCodexToml,
  upsertMcpServersJson,
  upsertOpencodeMcp,
} from "../../src/setup/configs.js";

const spec = toSpec(defaultServerCommand("@francoischastel/jev-code"), {
  TYPESAFE_API_KEY: "ts_x",
});

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "jev-code-"));
}

describe("config editors", () => {
  it("builds the server spec and environment", () => {
    expect(spec).toEqual({
      command: "npx",
      args: ["-y", "@francoischastel/jev-code", "mcp"],
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
      command: ["npx", "-y", "@francoischastel/jev-code", "mcp"],
      enabled: true,
      environment: { TYPESAFE_API_KEY: "ts_x" },
    });
    expect(upsertOpencodeMcp(path, spec)).toEqual({ changed: false });
    expect(upsertOpencodeMcp(path, { ...spec, env: {} }, { dryRun: true })).toEqual({
      changed: true,
      planned: true,
    });
    expect(jsonHasMcpEntry(path, "mcp")).toBe(true);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toHaveLength(1);
  });

  it("creates a fresh mcpServers file and refuses to touch malformed JSON", () => {
    const dir = tmp();
    const path = join(dir, ".mcp.json");
    expect(upsertMcpServersJson(path, { ...spec, env: {} })).toEqual({ changed: true });
    expect(readJsonFile(path)).toEqual({
      mcpServers: { jev: { command: "npx", args: ["-y", "@francoischastel/jev-code", "mcp"] } },
    });
    expect(jsonHasMcpEntry(path, "mcpServers")).toBe(true);
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
      '[mcp_servers.jev]\ncommand = "npx"\nargs = ["-y", "@francoischastel/jev-code", "mcp"]\n\n[mcp_servers.jev.env]\nTYPESAFE_API_KEY = "ts_x"\n',
    );
    expect(upsertCodexToml(path, spec)).toEqual({ changed: false });
    expect(codexTomlHasServer(path)).toBe(true);
    expect(codexTomlBlock({ ...spec, env: {} })).not.toContain(".env]");
    const fresh = join(dir, "fresh.toml");
    expect(upsertCodexToml(fresh, spec, { dryRun: true })).toEqual({
      changed: true,
      planned: true,
    });
    expect(codexTomlHasServer(fresh)).toBe(false);
  });

  it("detects the pi package in settings", () => {
    const dir = tmp();
    const path = join(dir, "settings.json");
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    writeFileSync(
      path,
      JSON.stringify({ packages: ["npm:other", { source: "npm:@francoischastel/jev-code" }] }),
    );
    expect(piSettingsHasPackage(path, "jev-code")).toBe(true);
    writeFileSync(path, "nope");
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    const pkgDir = join(dir, "checkout");
    mkdirSync(pkgDir);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@francoischastel/jev-code" }),
    );
    writeFileSync(path, JSON.stringify({ packages: ["./checkout"] }));
    expect(piSettingsHasPackage(path, "jev-code")).toBe(false);
    expect(piSettingsHasPackage(path, "jev-code", "@francoischastel/jev-code")).toBe(true);
    expect(piSettingsHasPackage(path, "jev-code", "@other/pkg")).toBe(false);
  });
});
