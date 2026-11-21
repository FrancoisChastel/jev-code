# Harnesses

`jev-code setup` installs the skill and registers the tool in every harness it detects. These
pages cover what it does in each one, how to do it by hand, and where the files go.

| Harness | How the tool is wired | Page |
| --- | --- | --- |
| Claude Code | MCP server, via `claude mcp add` | [Claude Code](claude-code.md) |
| Codex | MCP server, via `codex mcp add` or `~/.codex/config.toml` | [Codex](codex.md) |
| Pi | Native extension, via `pi install` | [Pi](pi.md) |
| OpenCode | MCP server, in `opencode.json` | [OpenCode](opencode.md) |
