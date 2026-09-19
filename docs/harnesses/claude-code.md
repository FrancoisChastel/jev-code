# Claude Code

## Automatic

```bash
npx -y @francoischastel/jev-code setup claude            # user profile
npx -y @francoischastel/jev-code setup claude --project  # this repository only
```

What it does:

| Piece | User scope | Project scope |
| --- | --- | --- |
| Skill | `~/.claude/skills/jev/` | `.claude/skills/jev/` |
| Tool | `claude mcp add --scope user jev -- npx -y @francoischastel/jev-code mcp` | `claude mcp add --scope project ...`, which writes `.mcp.json` |

If the `claude` binary is not on PATH, project scope writes `.mcp.json` directly and user scope
prints the command to run.

## As a plugin

The repository doubles as a plugin marketplace, so the skill and the MCP server can be installed
together and updated with `claude plugin update`:

```bash
claude plugin marketplace add FrancoisChastel/jev-code
claude plugin install jev-code@jev-code
```

The skill is then invoked as `/jev-code:jev`, and the tools appear as
`mcp__plugin_jev-code_jev__jev_classify` and so on.

## Manual

Register the server yourself:

```bash
claude mcp add --scope user jev -e TYPESAFE_API_KEY=ts_... -- npx -y @francoischastel/jev-code mcp
```

or add it to a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "@francoischastel/jev-code", "mcp"],
      "env": { "TYPESAFE_API_KEY": "ts_..." }
    }
  }
}
```

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a claude-code`, or
copy `skills/jev/` into `~/.claude/skills/`.

## Verify

```bash
claude mcp get jev
jev-code doctor
```

Inside a session, `/mcp` lists the server and `/jev` loads the skill.
