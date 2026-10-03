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
      "command": ["npx", "-y", "@french-castle/jev-code@0.4.0", "mcp"],
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
