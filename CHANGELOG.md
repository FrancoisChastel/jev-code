# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

- The npm package is `@french-castle/jev-code`. The `@francoischastel` scope was never
  published to, so nothing installed changes; `npx -y @french-castle/jev-code setup` is the
  install command from now on. The GitHub repository stays at FrancoisChastel/jev-code.

### Fixed

- `setup pi --project` passes `--approve` to `pi install -l`, which pi requires before it edits
  a project's `.pi/settings.json`; without it the install failed with "Project is not trusted".
- The MCP server sends the versioned user agent, like the CLI.
- `doctor` keeps a space between a long skill path and the tool column.

## [0.2.0] - 2026-09-27

### Added

- OpenRouter and Vercel AI Gateway as hosts for Jev, next to TypeSafe direct. Export
  `OPENROUTER_API_KEY` or `AI_GATEWAY_API_KEY` and everything else stays the same: the key's
  prefix (`ts_`, `sk-or-`, `vck_`) picks the host whichever variable holds it, and
  `JEV_CODE_PROVIDER` forces one when several keys are set.
- `jev-code setup` asks for an API key (hidden input) when none is set and it runs in a
  terminal; `--no-prompt` disables that.
- `doctor` shows the provider in use, warns when several keys are set, and names the host in
  the live check.
- OpenRouter requests carry the optional `HTTP-Referer` and `X-Title` attribution headers.

### Changed

- The missing-key error now reads "No API key found" and lists the three accepted variables.
- API error messages surface the host's inner message (TypeSafe nests it under `detail`,
  OpenRouter under `error`) instead of a JSON blob.
- `setup` copies only the key in use into harness configs, plus `JEV_CODE_PROVIDER` when set.
- The release workflow creates the GitHub release even when npm publishing is skipped because
  no `NPM_TOKEN` secret is configured, and says so.

### Security

- A key is only ever sent to the host that issued it: a `TYPESAFE_BASE_URL` on a known host
  other than the key's issuer is refused before any request, and a base URL on an unrecognised
  host is honoured for TypeSafe keys only unless `JEV_CODE_PROVIDER` states the intent.
- `setup` scrubs the key from a harness CLI's output when registration fails, and the MCP
  server logs the host in use to stderr once.

## [0.1.0] - 2026-09-19

### Added

- Five tools shared by every harness: `jev_classify`, `jev_check`, `jev_score`, `jev_rank`, `jev_ask`.
- MCP server over stdio for Claude Code, Codex, and OpenCode (`jev-code mcp`).
- Native Pi extension and pi package manifest (`pi install npm:@french-castle/jev-code`).
- Optional OpenCode custom tool (`integrations/opencode/jev.ts`).
- The `jev` skill (Agent Skills spec) with question-design guide, recipes, tool and CLI references,
  and a building-with-TypeSafe guide adapted from TypeSafe's official skill (MIT).
- `jev-code setup` with harness detection, user and project scopes, dry run, config backups.
- `jev-code doctor` with an optional live API check.
- CLI access to every tool (`jev-code classify --input payload.json`).
- Claude Code plugin manifest and marketplace so the repository installs as a plugin.

[Unreleased]: https://github.com/FrancoisChastel/jev-code/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/FrancoisChastel/jev-code/releases/tag/v0.2.0
[0.1.0]: https://github.com/FrancoisChastel/jev-code/commit/a764d29
