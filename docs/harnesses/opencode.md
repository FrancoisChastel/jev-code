# OpenCode

## Automatic

```bash
npx -y @francoischastel/jev-code setup opencode            # ~/.config/opencode/opencode.json
npx -y @francoischastel/jev-code setup opencode --project  # ./opencode.json
```

What it does:

| Piece | Location |
| --- | --- |
| Skill | `~/.agents/skills/jev/` (OpenCode reads it, as do Codex and Pi). With `--project`: `.agents/skills/jev/`. |
| Tool | `mcp.jev` entry in `opencode.json`. The existing file is backed up as `opencode.json.bak-<timestamp>` before it is modified. |

## Manual

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jev": {
      "type": "local",
      "command": ["npx", "-y", "@francoischastel/jev-code", "mcp"],
      "enabled": true,
      "environment": { "TYPESAFE_API_KEY": "ts_..." }
    }
  }
}
```

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a opencode`, or copy
`skills/jev/` into `~/.config/opencode/skills/`.

## Native custom tool (optional)

If you would rather not spawn an MCP server, `integrations/opencode/jev.ts` defines the same five
tools with OpenCode's `tool()` helper. Copy it to `.opencode/tools/jev.ts` (project) or
`~/.config/opencode/tools/jev.ts` (global), and add the package to the matching `package.json`
(`npm install @francoischastel/jev-code`). The named exports become `jev_classify`, `jev_check`,
and so on.

## Verify

```bash
opencode mcp list
jev-code doctor
```
