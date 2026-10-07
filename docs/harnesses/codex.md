# Codex

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup codex
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (Codex's user-level skills directory; Pi and OpenCode read it too). With `--project`: `.agents/skills/jev/`. |
| Tool | `codex mcp add jev -- npx -y @french-castle/jev-code@0.5.0 mcp`, or a `[mcp_servers.jev]` table appended to `~/.codex/config.toml` when the `codex` binary is not on PATH. |

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
args = ["-y", "@french-castle/jev-code@0.5.0", "mcp"]

[mcp_servers.jev.env]
TYPESAFE_API_KEY = "<your key>"
```

Any provider key works in place of `TYPESAFE_API_KEY`: `OPENROUTER_API_KEY` routes through
OpenRouter and `AI_GATEWAY_API_KEY` through Vercel AI Gateway (the variable decides the host).
OpenAI's Decisions API needs both `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` in the
environment; a local Ollama needs only `JEV_CODE_PROVIDER=ollama`. A System One gateway of your
own takes `TYPESAFE_API_KEY` plus `TYPESAFE_BASE_URL`, as the
[README](../../README.md#your-own-gateway) explains.

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a codex`, or copy
`skills/jev/` into `~/.agents/skills/`.

## Verify

```bash
codex mcp list
jev-code doctor
```

Inside Codex, type `$jev` to invoke the skill explicitly, or just describe a task that needs
classification and let it trigger on the description.
