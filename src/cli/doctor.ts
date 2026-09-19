import { existsSync } from "node:fs";
import { join } from "node:path";
import { JevClient } from "../core/client.js";
import { CONSOLE_KEYS_URL, describeConfig, ENV } from "../core/config.js";
import { errorMessage } from "../core/errors.js";
import { codexTomlHasServer, jsonHasMcpEntry, piSettingsHasPackage } from "../setup/configs.js";
import type { Exec, Which } from "../setup/exec.js";
import { detectHarnesses, type Harness, harnessPaths } from "../setup/harnesses.js";
import { SKILL_NAME } from "../setup/skills.js";
import { PACKAGE_NAME, VERSION } from "../version.js";

export interface DoctorOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  cwd: string;
  exec: Exec;
  which: Which;
  live: boolean;
  fetch?: JevClient["systemOne"] extends never
    ? never
    : ConstructorParameters<typeof JevClient>[0]["fetch"];
}

export interface DoctorReport {
  ok: boolean;
  lines: string[];
}

interface HarnessRow {
  label: string;
  binary: string;
  skill: string;
  tool: string;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const lines: string[] = [];
  let ok = true;
  const config = describeConfig(options.env);

  lines.push(
    `jev-code ${VERSION} · node ${process.version} · ${process.platform} ${process.arch}`,
    "",
  );
  lines.push("Configuration");
  if (config.hasApiKey) {
    lines.push(`  ${ENV.apiKey.padEnd(22)} set (${config.apiKeyHint})`);
  } else {
    ok = false;
    lines.push(
      `  ${ENV.apiKey.padEnd(22)} NOT SET  → create one at ${CONSOLE_KEYS_URL} and export it`,
    );
  }
  lines.push(`  ${ENV.baseUrl.padEnd(22)} ${config.baseUrl}`);
  lines.push(`  ${"model".padEnd(22)} ${config.model}`);
  lines.push("");

  const rows = await Promise.all(
    detectHarnesses({ home: options.home, cwd: options.cwd, which: options.which }).map(
      async (detection): Promise<HarnessRow> => {
        const paths = harnessPaths(detection.harness, options.home, options.cwd);
        const userSkill = join(paths.userSkillsDir, SKILL_NAME);
        const projectSkill = join(paths.projectSkillsDir, SKILL_NAME);
        const skill = existsSync(userSkill)
          ? shorten(userSkill, options.home)
          : existsSync(projectSkill)
            ? shorten(projectSkill, options.home)
            : "missing";
        return {
          label: detection.label,
          binary: detection.binary
            ? "found"
            : detection.configDirExists
              ? "config only"
              : "not found",
          skill,
          tool: await toolStatus(detection.harness, detection.binary, options),
        };
      },
    ),
  );
  lines.push(`Harnesses${" ".repeat(11)}binary        skill                          tool`);
  for (const row of rows) {
    lines.push(
      `  ${row.label.padEnd(18)}${row.binary.padEnd(14)}${row.skill.padEnd(31)}${row.tool}`,
    );
  }
  lines.push("");

  if (options.live) {
    if (!config.hasApiKey) {
      lines.push("Live check: skipped, no API key.");
    } else {
      const started = Date.now();
      try {
        const client = JevClient.fromEnv(options.env, {
          userAgent: `${PACKAGE_NAME}/${VERSION} doctor`,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        });
        const response = await client.systemOne({
          state: "ping",
          questions: { alive: { type: "noul", instructions: "Is this a single short word?" } },
        });
        const ms = Date.now() - started;
        const tokens = response.usage ? `, ${response.usage.input_tokens} input tokens` : "";
        lines.push(`Live check: ok in ${ms} ms (${response.model}${tokens}).`);
      } catch (error) {
        ok = false;
        lines.push(`Live check: FAILED after ${Date.now() - started} ms: ${errorMessage(error)}`);
      }
    }
    lines.push("");
  }

  if (!ok) lines.push("Fix the items marked above, then run `jev-code doctor --live` again.");
  else
    lines.push(
      options.live ? "All good." : "Run `jev-code doctor --live` to confirm the API key works.",
    );
  return { ok, lines };
}

async function toolStatus(
  harness: Harness,
  binary: string | null,
  options: DoctorOptions,
): Promise<string> {
  switch (harness) {
    case "claude": {
      if (jsonHasMcpEntry(join(options.cwd, ".mcp.json"), "mcpServers"))
        return "registered (project .mcp.json)";
      if (!binary) return "unknown (claude not on PATH)";
      const result = await options.exec(binary, ["mcp", "get", "jev"], {
        cwd: options.cwd,
        env: options.env,
      });
      return result.code === 0 ? "registered" : "not registered";
    }
    case "codex":
      return codexTomlHasServer(join(options.home, ".codex", "config.toml"))
        ? "registered"
        : "not registered";
    case "pi": {
      const user = piSettingsHasPackage(
        join(options.home, ".pi", "agent", "settings.json"),
        "jev-code",
        PACKAGE_NAME,
      );
      const project = piSettingsHasPackage(
        join(options.cwd, ".pi", "settings.json"),
        "jev-code",
        PACKAGE_NAME,
      );
      return user || project ? "installed (pi package)" : "not installed";
    }
    case "opencode": {
      const user = jsonHasMcpEntry(
        join(options.home, ".config", "opencode", "opencode.json"),
        "mcp",
      );
      const project = jsonHasMcpEntry(join(options.cwd, "opencode.json"), "mcp");
      return user || project ? "registered" : "not registered";
    }
  }
}

function shorten(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
