# Claude Code

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup claude            # user profile
npx -y @french-castle/jev-code@latest setup claude --project  # this repository only
```

What it does:

| Piece | User scope | Project scope |
| --- | --- | --- |
| Skill | `~/.claude/skills/jev/` | `.claude/skills/jev/` |
| Tool | `claude mcp add --scope user jev -- npx -y @french-castle/jev-code@0.4.1 mcp` | `claude mcp add --scope project ...`, which writes `.mcp.json` |

If the `claude` binary is not on PATH, project scope writes `.mcp.json` directly and user scope
prints the command to run. The command pins the version setup installed; re-running setup
(`npx -y @french-castle/jev-code@latest setup claude`) replaces the registration with the new pin.

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
claude mcp add --scope user jev -e TYPESAFE_API_KEY=<your key> -- npx -y @french-castle/jev-code@0.4.1 mcp
```

or add it to a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jev": {
      "command": "npx",
      "args": ["-y", "@french-castle/jev-code@0.4.1", "mcp"],
      "env": { "TYPESAFE_API_KEY": "<your key>" }
    }
  }
}
```

Any provider key works in place of `TYPESAFE_API_KEY`: `OPENROUTER_API_KEY` routes through
OpenRouter and `AI_GATEWAY_API_KEY` through Vercel AI Gateway (the variable decides the host).
OpenAI's Decisions API (preview) needs both `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` in the
environment; a local Ollama needs only `JEV_CODE_PROVIDER=ollama`.

Install the skill with `npx skills add FrancoisChastel/jev-code --skill jev -a claude-code`, or
copy `skills/jev/` into `~/.claude/skills/`.

## Verify

```bash
claude mcp get jev
jev-code doctor
```

Inside a session, `/mcp` lists the server and `/jev` loads the skill.
