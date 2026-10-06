# OpenCode

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup opencode            # ~/.config/opencode/opencode.json
npx -y @french-castle/jev-code@latest setup opencode --project  # ./opencode.json
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (OpenCode reads it, as do Codex and Pi). With `--project`: `.agents/skills/jev/`. |
| Tool | `mcp.jev` entry in `opencode.json`. The existing file is backed up as `opencode.json.bak-<timestamp>` before it is modified. |

The registered command pins the version setup installed. Re-running setup
(`npx -y @french-castle/jev-code@latest setup`) replaces the entry with the new pin and reports it
as `updated`; `doctor` shows the pinned version.

## Manual

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jev": {
      "type": "local",
      "command": ["npx", "-y", "@french-castle/jev-code@0.4.1", "mcp"],
      "enabled": true,
      "environment": { "TYPESAFE_API_KEY": "<your key>" }
    }
  }
}
```

Any provider key works in place of `TYPESAFE_API_KEY`: `OPENROUTER_API_KEY` routes through
OpenRouter and `AI_GATEWAY_API_KEY` through Vercel AI Gateway (the variable decides the host).
OpenAI's Decisions API (preview) needs both `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` in the
environment; a local Ollama needs only `JEV_CODE_PROVIDER=ollama`.

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a opencode`, or copy
`skills/jev/` into `~/.config/opencode/skills/`.

## Native custom tool (optional)

If you would rather not spawn an MCP server, `integrations/opencode/jev.ts` defines the same five
tools with OpenCode's `tool()` helper. Copy it to `.opencode/tools/jev.ts` (project) or
`~/.config/opencode/tools/jev.ts` (global), and add the package to the matching `package.json`
(`npm install @french-castle/jev-code`). The named exports become `jev_classify`, `jev_check`,
and so on.

## Verify

```bash
opencode mcp list
jev-code doctor
```

`opencode mcp list` should show `jev connected`. OpenCode prefixes MCP tools with the server
name, so inside a session the tools appear as `jev_jev_classify`, `jev_jev_check`, and so on.

## Custom provider

```bash
npx -y @french-castle/jev-code@latest setup opencode --provider custom
```

Enter a display name, HTTP(S) API base URL without `/v1/systemone`, manual provider model ID,
and hidden key. The gateway must implement the existing System One protocol. Alternatively,
export `JEV_CODE_PROVIDER=custom`, `JEV_CODE_PROVIDER_NAME`, `JEV_CODE_BASE_URL`,
`JEV_CODE_API_KEY`, and `JEV_CODE_MODEL` before setup. Custom retries default to zero; optional
`JEV_CODE_MAX_RETRIES` and `JEV_CODE_TIMEOUT_MS` overrides follow the selected configuration.

Setup carries the selected custom variables into the harness server environment using its
existing configuration mechanism. `--no-env` omits the key; ensure `JEV_CODE_API_KEY` reaches
the server from the launching environment. No unrelated provider key is copied. Pi and the
direct CLI require the variables in their launching shell rather than this harness config.

Use `--no-prompt` for complete environment-based setup. Incomplete custom settings prevent
registration, and `--dry-run` never prompts or writes. Restart the agent after setup and run
`jev-code doctor` to inspect configuration offline. See [custom-provider setup](../../README.md#custom-system-one-providers)
for URL examples and provider-specific key-variable mapping.
