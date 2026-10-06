import { existsSync } from "node:fs";
import { join } from "node:path";
import { JevClient } from "../core/client.js";
import { describeConfig, ENV } from "../core/config.js";
import { errorMessage, JevApiError, JevConnectionError } from "../core/errors.js";
import { PROVIDERS } from "../core/providers.js";
import {
  codexTomlServerCommand,
  mcpEntryCommand,
  parseMcpListing,
  pinnedVersion,
  piSettingsHasPackage,
} from "../setup/configs.js";
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
  if (config.problem) {
    ok = false;
    lines.push(`  ${"configuration".padEnd(22)} PROBLEM: ${config.problem}`);
  } else if (!config.hasApiKey) {
    ok = false;
    lines.push(`  ${"API key".padEnd(22)} NOT SET  → export one of these, then run doctor again:`);
    for (const provider of PROVIDERS) {
      const optIn = provider.keyless
        ? `  (no key: set ${ENV.provider}=${provider.name})`
        : provider.explicitOnly
          ? `  (also set ${ENV.provider}=${provider.name})`
          : "";
      const variable = provider.keyless ? `${provider.hostEnv ?? ""} (optional)` : provider.keyEnv;
      lines.push(
        `  ${"".padEnd(22)}   ${variable.padEnd(20)} ${provider.label.padEnd(20)} ${provider.keysUrl}${optIn}`,
      );
    }
  } else {
    const key = config.keyEnv ? `${config.keyEnv} ${config.apiKeyHint}` : "no key";
    lines.push(`  ${"provider".padEnd(22)} ${config.providerLabel} (${key})`);
  }
  lines.push(`  ${"base URL".padEnd(22)} ${config.baseUrl}`);
  lines.push(`  ${"model".padEnd(22)} ${config.model}`);
  lines.push(`  ${"retries".padEnd(22)} ${config.maxRetries}`);
  for (const note of config.notes) lines.push(`  ${"note".padEnd(22)} ${note}`);
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
  lines.push(`Harnesses${" ".repeat(11)}binary        skill                           tool`);
  for (const row of rows) {
    // A trailing space keeps a long skill path (outside $HOME) apart from the tool column.
    lines.push(
      `  ${row.label.padEnd(18)}${row.binary.padEnd(14)}${row.skill.padEnd(31)} ${row.tool}`,
    );
  }
  lines.push("");

  if (options.live) {
    if (config.problem) {
      lines.push("Live check: skipped, fix the configuration problem above first.");
    } else if (!config.hasApiKey) {
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
        lines.push(
          `Live check: ok in ${ms} ms via ${config.providerLabel} (${response.model}${tokens}).`,
        );
      } catch (error) {
        ok = false;
        const notEnabled =
          config.provider === "openai" &&
          error instanceof JevApiError &&
          error.status === 403 &&
          /not enabled/i.test(error.message);
        const ollamaDown = config.provider === "ollama" && error instanceof JevConnectionError;
        const ollamaNoModel =
          config.provider === "ollama" && error instanceof JevApiError && error.status === 404;
        lines.push(
          notEnabled
            ? "Live check: FAILED: OpenAI's Decisions API is not enabled for this account; it is in limited preview. Use TypeSafe, OpenRouter, or Vercel AI Gateway meanwhile."
            : ollamaDown
              ? `Live check: FAILED: no Ollama server at ${config.baseUrl}. Start Ollama (0.35 or later), or point OLLAMA_HOST at it.`
              : ollamaNoModel
                ? `Live check: FAILED: Ollama has no model named ${config.model}. Run \`ollama pull ${config.model}\`.`
                : `Live check: FAILED after ${Date.now() - started} ms: ${errorMessage(error)}`,
        );
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

/** How a registered launch command relates to this version, for the harness table. */
function pinNote(command: readonly string[] | undefined): string {
  if (!command) return "";
  const pin = pinnedVersion(command, PACKAGE_NAME);
  if (pin === VERSION) return ` v${VERSION}`;
  if (pin) return ` v${pin}, run setup to move to v${VERSION}`;
  if (command.includes(PACKAGE_NAME)) return ` unpinned, run setup to pin v${VERSION}`;
  return " (custom command)";
}

async function toolStatus(
  harness: Harness,
  binary: string | null,
  options: DoctorOptions,
): Promise<string> {
  switch (harness) {
    case "claude": {
      const project = mcpEntryCommand(join(options.cwd, ".mcp.json"), "mcpServers");
      if (project) return `registered (project .mcp.json)${pinNote(project)}`;
      if (!binary) return "unknown (claude not on PATH)";
      const result = await options.exec(binary, ["mcp", "get", "jev"], {
        cwd: options.cwd,
        env: options.env,
      });
      if (result.code !== 0) return "not registered";
      return `registered${pinNote(parseMcpListing(result.stdout))}`;
    }
    case "codex": {
      const command = codexTomlServerCommand(join(options.home, ".codex", "config.toml"));
      return command ? `registered${pinNote(command)}` : "not registered";
    }
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
      const command =
        mcpEntryCommand(join(options.cwd, "opencode.json"), "mcp") ??
        mcpEntryCommand(join(options.home, ".config", "opencode", "opencode.json"), "mcp");
      return command ? `registered${pinNote(command)}` : "not registered";
    }
  }
}

function shorten(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
