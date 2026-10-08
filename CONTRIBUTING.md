# Contributing

Thanks for helping make Jev easier to use inside coding agents. Issues and pull requests are
welcome; small, focused changes are the easiest to review.

## Setup

```bash
git clone https://github.com/FrancoisChastel/jev-code && cd jev-code
npm install
npm run check
```

`npm run check` runs everything CI runs: Biome (lint and format), TypeScript, the skill validator,
the unit tests with coverage thresholds, the build, and a stdio smoke test of the MCP server.

Useful during development:

| Command | Purpose |
| --- | --- |
| `npm test` / `npm run test:watch` | Unit tests; no API key needed, the API is faked. |
| `npm run test:e2e` | A few live calls; needs a provider key (`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY`). |
| `npm run lint:fix` | Apply Biome fixes. |
| `node dist/cli.js setup --dry-run` | See what setup would do on this machine. |
| `node dist/cli.js setup claude --command "node $PWD/dist/cli.js mcp"` | Register your local build in Claude Code. |
| `pi -e $PWD/integrations/pi/jev.ts` | Load the Pi extension from the checkout for one run. |

## Where things live

```
src/core/          API client, providers (hosts that serve Jev), config, errors, limits
src/tools/         the five tools: schema + description + run() each, shared by every adapter
src/mcp/           MCP server (Claude Code, Codex, OpenCode)
src/setup/         harness detection, skill install, config editing
src/cli/           command-line interface
integrations/pi/   native Pi extension
integrations/opencode/  optional native OpenCode tool
skills/jev/        the skill and its reference files (what the agent reads)
tests/             vitest; e2e/ is skipped without a key
docs/harnesses/    per-harness manual setup
```

Adding a tool means one file in `src/tools/`, an entry in `src/tools/index.ts`, a TypeBox schema
in `integrations/pi/jev.ts`, a section in `skills/jev/references/tools.md`, and tests.

Adding a host that speaks the System One API (`POST /v1/systemone`, same shapes) is one row in
`src/core/providers.ts`, a row in the README configuration table, and a test in
`tests/core/config.test.ts`. A host with a different envelope needs a transport branch in
`src/core/client.ts`; open an issue first.

`.mcp.json` at the repository root is the Claude Code *plugin* MCP declaration (it launches the
published package). Claude Code also reads it as project-scope config when you open this
repository, so it will ask whether to enable a `jev` server; decline it, or register your local
build instead with `node dist/cli.js setup claude --project --command "node $PWD/dist/cli.js mcp"`.

## Conventions

- TypeScript, ESM, Node 20+. No new runtime dependencies without a reason in the PR.
- Validate inputs before making a request; never send a request that the API will reject for a
  reason we could have caught.
- Tools return data plus a decision; policy thresholds are parameters with documented defaults.
- Keep `SKILL.md` under 200 lines and put detail in `references/`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`. Breaking changes get a `!`.

## Pull requests

1. Open an issue first for anything larger than a fix, so the approach can be agreed.
2. Add or update tests; coverage thresholds are enforced.
3. Update `CHANGELOG.md` under *Unreleased*.
4. Make sure `npm run check` passes.

## Releasing (maintainers)

1. Run `npm version X.Y.Z --no-git-tag-version`. It bumps `package.json` and the lockfile and
   runs `scripts/sync-version.mjs`, which updates the plugin manifest, the skill metadata, the
   plugin `.mcp.json`, and the pinned launch commands in the README and guides. Move the changelog
   entries under a new heading, then commit as `chore: release vX.Y.Z`.
2. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The release workflow runs the checks on the tagged commit, verifies the tag matches
   `package.json`, and creates the GitHub release from the changelog. It does not publish to npm.
4. Once it passes, publish by hand from a clean checkout of the tag, logged in to npm with publish
   rights for `@french-castle`:

   ```bash
   git switch --detach vX.Y.Z && npm ci && npm publish
   ```

   `prepublishOnly` runs `npm run check` first, so a failing build never reaches npm. When a
   host's mapping changed, run its live tests before publishing, for example
   `OPENAI_API_KEY=... JEV_CODE_PROVIDER=openai npm run test:e2e`.
