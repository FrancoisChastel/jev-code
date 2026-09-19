import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** Run a command without a shell, capturing output. Never throws on non-zero exit. */
export const realExec: Exec = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export type Which = (binary: string) => string | null;

/** Locate an executable on PATH, or null. Windows extensions are checked too. */
export function whichBinary(binary: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = env.PATH ?? env.Path ?? "";
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, binary + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}
