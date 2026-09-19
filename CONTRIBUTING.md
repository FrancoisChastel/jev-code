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
| `npm run test:e2e` | A few live calls; needs `TYPESAFE_API_KEY`. |
| `npm run lint:fix` | Apply Biome fixes. |
| `node dist/cli.js setup --dry-run` | See what setup would do on this machine. |
| `node dist/cli.js setup claude --command "node $PWD/dist/cli.js mcp"` | Register your local build in Claude Code. |
| `pi -e $PWD/integrations/pi/jev.ts` | Load the Pi extension from the checkout for one run. |

## Where things live

```
src/core/          API client, config, errors, limits
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

1. Update the version in `package.json` and `skills/jev/SKILL.md` metadata, move the changelog
   entries under a new heading, commit as `chore: release vX.Y.Z`.
2. Tag: `git tag vX.Y.Z && git push --tags`.
3. The release workflow publishes to npm with provenance and creates the GitHub release. It needs
   an `NPM_TOKEN` repository secret with publish rights for `@francoischastel`.
