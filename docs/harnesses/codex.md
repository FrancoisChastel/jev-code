# Codex

## Automatic

```bash
npx -y @francoischastel/jev-code setup codex
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (Codex's user-level skills directory; Pi and OpenCode read it too). With `--project`: `.agents/skills/jev/`. |
| Tool | `codex mcp add jev -- npx -y @francoischastel/jev-code mcp`, or a `[mcp_servers.jev]` table appended to `~/.codex/config.toml` when the `codex` binary is not on PATH. |

Codex keeps MCP servers in its user configuration, so `--project` still registers the tool at user
level and only the skill moves into the repository.

## Manual

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.jev]
command = "npx"
args = ["-y", "@francoischastel/jev-code", "mcp"]

[mcp_servers.jev.env]
TYPESAFE_API_KEY = "ts_..."
```

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a codex`, or copy
`skills/jev/` into `~/.agents/skills/`.

## Verify

```bash
codex mcp list
jev-code doctor
```

Inside Codex, type `$jev` to invoke the skill explicitly, or just describe a task that needs
classification and let it trigger on the description.
