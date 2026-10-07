# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- A System One gateway of your own, documented as what it already was: the proxy case. The key
  goes in `TYPESAFE_API_KEY`, the SDK's generic variable, and the address in `TYPESAFE_BASE_URL`,
  with `TYPESAFE_DEFAULT_MODEL` when the gateway's model id differs; nothing new to configure in
  any harness. `setup` offers "Other System One gateway" when asking which host a pasted key is
  for, then asks for the URL and the model and stores the three variables together.
- OpenAI's Decisions API in its public beta, open to every developer since October 6, 2026.
  The mapping now follows OpenAI's published reference instead of recorded preview traffic; the
  request jev-code sent already matched it, so existing setups keep working unchanged.
- A question the model declines comes back as a refusal on the Decisions API. Tools report it as
  `status: "refused"` with the cautious outcome (`review`, or `uncertain` in `jev_check`)
  instead of `invalid_response`, since retrying will not change it, and `jev_ask` lists declined
  ids under `refused`.
- CI runs the live tests against the Decisions API too when an `OPENAI_API_KEY` secret is set.

### Changed

- `TYPESAFE_BASE_URL` is checked before any request: an absolute `http(s)` URL with no
  credentials, query, or fragment, stopping before `/v1/systemone`, which the client appends.
  A bad value is a configuration problem in `doctor` and `setup`, never echoed in case it embeds
  a secret, instead of a connection error at the first call.
- Score probabilities from the Decisions API are keyed by the level index the API returns,
  falling back to the label.
- `doctor --live` no longer calls a `403` from the Decisions API a preview restriction; it
  quotes OpenAI's message and points at the key's project access to `gpt-6-luna`.

## [0.4.1] - 2026-10-03

### Fixed

- A key's shape no longer decides where it is sent. TypeSafe issues `apikey_...` keys as well as
  `ts_...`, and shapes change, so the variable a key sits in now decides its host; a key that
  looks like another host's only earns a hint in doctor. `TYPESAFE_API_KEY` keeps following
  `TYPESAFE_BASE_URL` and `JEV_CODE_PROVIDER` the way the TypeSafe SDK does, so the OpenRouter and
  Vercel setup guides for the SDK work unchanged; host-specific variables never travel.
- `setup` asks which host a pasted key is for, with its best guess as the default, instead of
  deciding from the key's shape. Both setup prompts now settle when input ends, and a paste
  holding both answers is read as two.
- With `JEV_CODE_PROVIDER=ollama`, a stale `TYPESAFE_BASE_URL` on another known host is refused
  like everywhere else instead of carrying Ollama's key and the payload there.

## [0.4.0] - 2026-10-03

Two new hosts, both opt-in. OpenAI's Decisions API, verified end to end against a stand-in that
speaks the shape recorded from the preview (CLI and OpenCode over MCP), with a live decision from
a preview account the one thing not yet confirmed. And Ollama's local decision models, which need
no key at all.

### Added

- Ollama's decision capability (Ollama 0.35+) as a local, keyless host: `JEV_CODE_PROVIDER=ollama`
  after `ollama pull nimble`; `OLLAMA_HOST` names another server, `OLLAMA_API_KEY` is sent only
  when set. Same System One API, so nothing else changes. `doctor --live` says when the server is
  down or the model is not pulled.
- `JevClient` works without a key for local hosts; no Authorization header is sent then.

- OpenAI's Decisions API (limited preview) as an opt-in host: `OPENAI_API_KEY` plus
  `JEV_CODE_PROVIDER=openai`, model `gpt-6-luna`. Every tool works unchanged; the request and
  response shapes are translated (`src/core/wires.ts`), following traffic recorded by preview
  users and OpenAI's own client in the Codex repository. An ambient `OPENAI_API_KEY` is never
  adopted by itself; doctor and the missing-key error explain how to opt in, and `doctor --live`
  recognises the preview's `403 Decision API is not enabled for this user`.
- Pasting an OpenAI key when `setup` asks stores `JEV_CODE_PROVIDER=openai` alongside it.

## [0.3.0] - 2026-09-29

Upgrades now reach installed agents. Existing installs should run
`npx -y @french-castle/jev-code@latest setup` once; the README's Upgrading section explains why.

### Changed

- Harness configs now launch a pinned command, `npx -y @french-castle/jev-code@<version> mcp`.
  npx keeps the first version it cached for an unpinned name and never checks for a newer one,
  so earlier installs were frozen on whatever they first fetched; run
  `npx -y @french-castle/jev-code@latest setup` once to move to a pinned command. Re-running setup
  replaces an existing registration whose command differs, including through `claude mcp` and
  `codex mcp`, and reports it as `updated`.
- `doctor` shows the pinned version of each registration and says when to re-run setup.
- The README and guides invoke setup and doctor with `@latest`, for the same reason.
- `npm version` runs `scripts/sync-version.mjs`, which keeps the plugin manifest, the skill
  metadata, the plugin `.mcp.json`, and the documented launch commands on the new version.

### Fixed

- Config backups taken within the same second no longer overwrite each other.
- The Codex `config.toml` editor keeps the file's line endings and handles an env sub-table
  declared before its parent.

## [0.2.1] - 2026-09-27

Verified end to end on Claude Code, Codex, Pi, and OpenCode: setup, a real tool call through
each harness, and skill discovery. The first version published to npm.

### Changed

- The npm package is `@french-castle/jev-code`. The `@francoischastel` scope was never
  published to, so nothing installed changes; `npx -y @french-castle/jev-code setup` is the
  install command from now on. The GitHub repository stays at FrancoisChastel/jev-code.
- `@modelcontextprotocol/sdk` 1.30.1. Development tooling moved to TypeScript 7 and the Node 26
  type definitions; the supported Node range is unchanged (20+).
- The OpenCode guide notes that OpenCode prefixes MCP tools with the server name
  (`jev_jev_check`).

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

[Unreleased]: https://github.com/FrancoisChastel/jev-code/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/FrancoisChastel/jev-code/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/FrancoisChastel/jev-code/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/FrancoisChastel/jev-code/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/FrancoisChastel/jev-code/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/FrancoisChastel/jev-code/releases/tag/v0.2.0
[0.1.0]: https://github.com/FrancoisChastel/jev-code/commit/a764d29
