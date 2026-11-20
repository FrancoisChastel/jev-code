# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Security

- A key containing whitespace or a control character (a pasted line break, say) is refused
  before any request. Node's HTTP stack would otherwise reject the header and quote it, key
  included, in an error that reached the agent. The client also removes the key from every error
  it raises.
- `setup --project` no longer writes the key into `.mcp.json` or `opencode.json`, files meant to
  be committed. It writes `${TYPESAFE_API_KEY}` (Claude Code) or `{env:TYPESAFE_API_KEY}`
  (OpenCode), which the harness expands from your shell. Export the key before starting the
  agent. Running it again over a file written by an earlier version replaces the key with the
  reference and tells you to rotate the key and delete the backup, which still holds it.
- Config files that setup writes itself with a key, and every backup, are readable by their owner
  only (0600; new directories 0700; macOS and Linux). A backup never overwrites an existing file.
- Redirects are no longer followed, so a 3xx answer cannot forward the payload to another
  origin. Answers over 1 MiB are refused, the timeout covers reading the answer, and server text
  quoted in errors is cut short and kept on one line.
- TypeSafe, OpenRouter, Vercel AI Gateway, and OpenAI are reached over https only; an `http://`
  URL naming one of them is refused. Plain http stays available for a gateway of your own and for
  Ollama, and `doctor` notes when a key would cross a network that way.
- `OLLAMA_HOST` is checked like `TYPESAFE_BASE_URL` (no credentials, query, or fragment, and not a
  known host), and a bare IPv6 address such as `::1` works. A hostname with a trailing dot
  (`api.openai.com.`) counts as the host it names.

### Fixed

- `setup` reports a harness CLI that cannot be started (a `.cmd` shim on Windows, say) as a
  failed step instead of crashing.

## [0.5.1] - 2026-11-19

Dependency floors without known advisories, and a gateway path that checks before it stores.
Nothing to change before upgrading. Setup now sends one check request to a gateway you
configure through it, and `doctor` names such a gateway by its host instead of "TypeSafe".

### Security

- The runtime dependencies now require versions without known advisories: `zod` ^4.6.7 (memory
  exhaustion while validating oversized constrained collections, GHSA-mrhx-c7xc-m3w5, which is
  how tool inputs are checked) and `@modelcontextprotocol/sdk` ^1.32.2 (four advisories in its
  HTTP transports, tasks, and bearer auth; jev-code serves over stdio only, so they did not apply
  here, but an install no longer reports them).

### Changed

- Development dependencies updated: Biome 2.6, Pi 1.5, the OpenCode plugin 1.19, Vitest 5.1.
  Biome's new Markdown formatter is turned off so the docs keep their hand-wrapped layout.
- The release workflow no longer publishes to npm; maintainers publish by hand from the tag once
  it passes, as every published version so far was. It still runs the checks, verifies the tag,
  and creates the GitHub release. The unused provenance setting is gone from `publishConfig`.

### Fixed

Three rough edges on the "System One gateway of your own" path, reported in #26 for one such
gateway and true of every one:

- Setup checks a gateway before storing its key: it sends the one-question request `doctor
  --live` uses, with the model it is about to store, and asks before storing a key the gateway
  did not answer. It used to store whatever it was given, so a model id the gateway does not
  serve only showed up as an error on the first tool call. Its model prompt also offers the
  model an empty answer really leads to, which `JEV_CODE_PROVIDER` can change.
- `doctor`, `setup`, and the server log name a base URL on no known host as "System One gateway
  at <host>" instead of the host whose defaults it borrows ("TypeSafe").
- `jev_ask`'s `model` input told agents "Default: jev-latest", which is wrong on every host but
  TypeSafe and OpenRouter. It now says to omit it for the host's default.

The tools reference, the skill, and the README also say that the default thresholds were chosen
against Jev, and to spot-check them on another model.

## [0.5.0] - 2026-10-07

OpenAI's Decisions API, now in public beta for every developer, and a System One gateway of your
own as a first-class setup path. One change to check before upgrading: `TYPESAFE_BASE_URL` is now
validated, so a value carrying credentials, a query string, or a trailing `/v1/systemone` is
refused before any request instead of being sent.

### Added

- A System One gateway of your own, documented as what it already was: the proxy case. The key
  goes in `TYPESAFE_API_KEY`, the SDK's generic variable, and the address in `TYPESAFE_BASE_URL`,
  with `TYPESAFE_DEFAULT_MODEL` when the gateway's model id differs; nothing new to configure in
  any harness. `setup` offers "Other System One gateway" when asking which host a pasted key is
  for, then asks for the URL and the model and stores the three variables together.
- OpenAI's Decisions API in its public beta, open to every developer since October 6, 2026.
  The mapping now follows OpenAI's published reference instead of recorded preview traffic; the
  request jev-code sent already matched it, so existing setups keep working unchanged. All five
  tools and the live test suite were run against `gpt-6-luna` before this release.
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

### Fixed

- `npm run test:e2e` found no tests to run, because the test config excluded the live suite for
  every run, so the CI live job could never have exercised a host. The suite is now excluded
  only when `JEV_CODE_E2E` is unset.

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

[Unreleased]: https://github.com/FrancoisChastel/jev-code/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/FrancoisChastel/jev-code/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/FrancoisChastel/jev-code/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/FrancoisChastel/jev-code/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/FrancoisChastel/jev-code/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/FrancoisChastel/jev-code/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/FrancoisChastel/jev-code/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/FrancoisChastel/jev-code/releases/tag/v0.2.0
[0.1.0]: https://github.com/FrancoisChastel/jev-code/commit/a764d29
