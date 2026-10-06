# Codex

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup codex
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (Codex's user-level skills directory; Pi and OpenCode read it too). With `--project`: `.agents/skills/jev/`. |
| Tool | `codex mcp add jev -- npx -y @french-castle/jev-code@0.4.1 mcp`, or a `[mcp_servers.jev]` table appended to `~/.codex/config.toml` when the `codex` binary is not on PATH. |

Codex keeps MCP servers in its user configuration, so `--project` still registers the tool at user
level and only the skill moves into the repository.

The registered command pins the version setup installed. Re-running setup
(`npx -y @french-castle/jev-code@latest setup`) replaces the entry with the new pin and reports it
as `updated`; `doctor` shows the pinned version.

## Manual

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.jev]
command = "npx"
args = ["-y", "@french-castle/jev-code@0.4.1", "mcp"]

[mcp_servers.jev.env]
TYPESAFE_API_KEY = "<your key>"
```

Any provider key works in place of `TYPESAFE_API_KEY`: `OPENROUTER_API_KEY` routes through
OpenRouter and `AI_GATEWAY_API_KEY` through Vercel AI Gateway (the variable decides the host).
OpenAI's Decisions API (preview) needs both `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` in the
environment; a local Ollama needs only `JEV_CODE_PROVIDER=ollama`.

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a codex`, or copy
`skills/jev/` into `~/.agents/skills/`.

## Verify

```bash
codex mcp list
jev-code doctor
```

Inside Codex, type `$jev` to invoke the skill explicitly, or just describe a task that needs
classification and let it trigger on the description.

## Custom provider

```bash
npx -y @french-castle/jev-code@latest setup codex --provider custom
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
