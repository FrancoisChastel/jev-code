# jev-code: notes for coding agents working on this repository

jev-code exposes TypeSafe's Jev model as a classifier tool for coding agents (Claude Code, Codex,
Pi, OpenCode) plus a skill that teaches agents when to use it. TypeScript, ESM, Node 20+.

## Commands

- `npm run check` before calling work done: lint, typecheck, skill validation, tests with
  coverage thresholds, build, MCP smoke test.
- `npm test` for the fast loop. The API is faked in tests; never require a real key in unit tests.
- `npm run build` writes `dist/`; `integrations/pi/jev.ts` imports from it, so build before
  typechecking integrations.

## Layout and rules

- `src/tools/` is the single source of truth for each tool (zod schema, description, `run`).
  Adapters in `src/mcp/`, `src/cli/`, `integrations/pi/`, `integrations/opencode/` must not add
  behaviour of their own.
- Validate locally before sending a request; surface the caller's own field path in errors.
- Tool outputs carry data plus a decision (`auto`/`review`, `yes`/`no`/`uncertain`); thresholds
  are parameters with documented defaults in the tool file and in `skills/jev/references/tools.md`.
- `skills/jev/SKILL.md` stays under 200 lines; detail goes to `skills/jev/references/`.
- Keep `README.md`, `docs/harnesses/*.md`, and the skill references in sync when a tool's
  contract or a setup path changes.
- No new runtime dependencies without discussion. Biome formats the code; run `npm run lint:fix`.
- Conventional Commits.
