# Codex

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup codex
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (Codex's user-level skills directory; Pi and OpenCode read it too). With `--project`: `.agents/skills/jev/`. |
| Tool | `codex mcp add jev -- npx -y @french-castle/jev-code@0.4.0 mcp`, or a `[mcp_servers.jev]` table appended to `~/.codex/config.toml` when the `codex` binary is not on PATH. |

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
args = ["-y", "@french-castle/jev-code@0.4.0", "mcp"]

[mcp_servers.jev.env]
TYPESAFE_API_KEY = "ts_..."
```

Any provider key works in place of `TYPESAFE_API_KEY`: `OPENROUTER_API_KEY=sk-or-...` routes
through OpenRouter and `AI_GATEWAY_API_KEY=vck_...` through Vercel AI Gateway. OpenAI's Decisions
API (preview) needs both `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` in the environment; a
local Ollama needs only `JEV_CODE_PROVIDER=ollama`.

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a codex`, or copy
`skills/jev/` into `~/.agents/skills/`.

## Verify

```bash
codex mcp list
jev-code doctor
```

Inside Codex, type `$jev` to invoke the skill explicitly, or just describe a task that needs
classification and let it trigger on the description.
