export interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Flags that consume the next token as their value. Everything else is boolean. */
const VALUE_FLAGS = new Set(["input", "json", "command", "pi-source"]);

/** Tiny argv parser: `--key value`, `--key=value`, `--flag`, `--no-flag`, `-h`, `-v`. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "-v") {
      flags.version = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (body.startsWith("no-")) {
        flags[body.slice(3)] = false;
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error(`--${body} requires a value.`);
        }
        flags[body] = next;
        i += 1;
        continue;
      }
      flags[body] = true;
      continue;
    }
    if (command === undefined) command = token;
    else positionals.push(token);
  }
  return { command, positionals, flags };
}

export function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(flags: ParsedArgs["flags"], name: string, fallback: boolean): boolean {
  const value = flags[name];
  return typeof value === "boolean" ? value : fallback;
}
