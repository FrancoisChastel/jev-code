import { ENV } from "../core/config.js";
import { PROVIDERS } from "../core/providers.js";
import { PACKAGE_NAME, VERSION } from "../version.js";

function providerLines(): string {
  return PROVIDERS.map((provider) => {
    const optIn = provider.explicitOnly ? ` (opt in: ${ENV.provider}=${provider.name})` : "";
    const variable = provider.keyless ? `${provider.hostEnv ?? ""} (optional)` : provider.keyEnv;
    return `  ${variable.padEnd(23)} ${provider.label.padEnd(20)} ${provider.keysUrl}${optIn}`;
  }).join("\n");
}

export function helpText(): string {
  return `jev-code ${VERSION} · Jev (TypeSafe System One) as a classifier tool for coding agents

Usage
  jev-code <command> [options]

Commands
  setup [harness...]   Install the Jev skill and tool into Claude Code, Codex, Pi, and OpenCode.
                       Harnesses default to the ones detected on this machine. In a terminal,
                       setup asks for an API key when none is set.
  doctor [--live]      Show configuration, detected harnesses, and what is installed.
                       --live sends one tiny request to confirm the API key works.
  mcp                  Run the MCP server on stdio (what harness configs launch).
  classify             Label items against your classes.        JSON in, JSON out.
  check                Batched yes/no checks over one state.    JSON in, JSON out.
  score                Rate items on ordered levels.            JSON in, JSON out.
  rank                 Rank candidates by relevance to a query. JSON in, JSON out.
  ask                  Raw System One call: state + questions.  JSON in, JSON out.
  skill                Print the path of the bundled skill directory.
  version, help

Tool options (classify, check, score, rank, ask)
  --input <file>       Read the JSON payload from a file, or "-" for stdin (default when piped).
  --json <string>      Pass the JSON payload inline.
  --pretty             Pretty-print the JSON result (default when stdout is a terminal).

Setup options
  --project            Install into the current project instead of the user profile.
  --all                Configure all four harnesses, detected or not.
  --dry-run            Print what would change without writing anything.
  --no-skill           Skip the skill; only register the tool.
  --no-tool            Skip the tool; only install the skill.
  --no-env             Do not copy the API key into harness configs.
  --no-prompt          Never ask for an API key.
  --command "<cmd>"    MCP server command (default: npx -y ${PACKAGE_NAME} mcp).
  --pi-source <spec>   Package spec for \`pi install\` (default: npm:${PACKAGE_NAME}).

Environment
  One key is required, in its host's variable; the variable decides, not the key's shape.
  TYPESAFE_API_KEY also follows TYPESAFE_BASE_URL and JEV_CODE_PROVIDER, as the TypeSafe SDK does.
${providerLines()}
  JEV_CODE_PROVIDER       typesafe | openrouter | vercel | openai | ollama. Forces the host; required for openai and ollama.
  TYPESAFE_BASE_URL       A proxy, or a System One gateway of your own; /v1/systemone is appended. Followed by TYPESAFE_API_KEY; other keys need JEV_CODE_PROVIDER.
  TYPESAFE_DEFAULT_MODEL  Override the host's default model (jev-latest; typesafe-ai/jev on Vercel).
  JEV_CODE_TIMEOUT_MS     Default 30000
  JEV_CODE_MAX_RETRIES    Default 2

Examples
  jev-code setup
  jev-code doctor --live
  jev-code classify --input triage.json
  echo '{"state":"tests: 3 passed, 1 failed","checks":{"all_pass":"Did every test pass?"}}' | jev-code check

Docs: https://github.com/FrancoisChastel/jev-code
`;
}
