import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Which } from "./exec.js";

export type Harness = "claude" | "codex" | "pi" | "opencode";

export const HARNESSES: readonly Harness[] = ["claude", "codex", "pi", "opencode"];

export const HARNESS_LABEL: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
};

const ALIASES: Record<string, Harness> = {
  claude: "claude",
  "claude-code": "claude",
  claudecode: "claude",
  codex: "codex",
  "codex-cli": "codex",
  pi: "pi",
  "pi-agent": "pi",
  opencode: "opencode",
  "open-code": "opencode",
};

export function parseHarness(name: string): Harness | undefined {
  return ALIASES[name.trim().toLowerCase()];
}

export interface HarnessPaths {
  binary: string;
  /** Directory whose presence suggests the harness is installed. */
  configDir: string;
  userSkillsDir: string;
  projectSkillsDir: string;
}

/**
 * Where each harness reads skills. Codex, Pi, and OpenCode all read the shared
 * `.agents/skills` location, so one copy serves the three of them.
 */
export function harnessPaths(harness: Harness, home: string, cwd: string): HarnessPaths {
  switch (harness) {
    case "claude":
      return {
        binary: "claude",
        configDir: join(home, ".claude"),
        userSkillsDir: join(home, ".claude", "skills"),
        projectSkillsDir: join(cwd, ".claude", "skills"),
      };
    case "codex":
      return {
        binary: "codex",
        configDir: join(home, ".codex"),
        userSkillsDir: join(home, ".agents", "skills"),
        projectSkillsDir: join(cwd, ".agents", "skills"),
      };
    case "pi":
      return {
        binary: "pi",
        configDir: join(home, ".pi", "agent"),
        userSkillsDir: join(home, ".agents", "skills"),
        projectSkillsDir: join(cwd, ".agents", "skills"),
      };
    case "opencode":
      return {
        binary: "opencode",
        configDir: join(home, ".config", "opencode"),
        userSkillsDir: join(home, ".agents", "skills"),
        projectSkillsDir: join(cwd, ".agents", "skills"),
      };
  }
}

export interface HarnessDetection {
  harness: Harness;
  label: string;
  binary: string | null;
  configDirExists: boolean;
  detected: boolean;
}

export function detectHarnesses(options: {
  home: string;
  cwd: string;
  which: Which;
  exists?: (path: string) => boolean;
}): HarnessDetection[] {
  const exists = options.exists ?? existsSync;
  return HARNESSES.map((harness) => {
    const paths = harnessPaths(harness, options.home, options.cwd);
    const binary = options.which(paths.binary);
    const configDirExists = exists(paths.configDir);
    return {
      harness,
      label: HARNESS_LABEL[harness],
      binary,
      configDirExists,
      detected: binary !== null || configDirExists,
    };
  });
}
