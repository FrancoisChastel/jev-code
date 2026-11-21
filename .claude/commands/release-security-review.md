---
description: Security review of everything since the last release tag; ends in PASS or BLOCK
argument-hint: "[base ref, default: the latest v* tag]"
---

Run the pre-release security review for jev-code. This is a gate: a release with an open
HIGH or CRITICAL finding does not ship. The same checklist is in CONTRIBUTING.md under
"Security review", so a human or another agent can follow it without this command.

## Scope

1. Base ref: `$ARGUMENTS` if given, else `git describe --tags --abbrev=0 --match 'v*'`.
2. Read `git log --oneline <base>..HEAD` and `git diff <base>..HEAD`. Review the diff, and
   read the surrounding code wherever a changed line touches a guarantee below. An unchanged
   guarantee only needs re-checking when the diff touches its code path.
3. Read SECURITY.md first. It is the contract: every claim there must still be true at HEAD.
   A change that makes a claim false is a finding, even when the behaviour is intended; then
   SECURITY.md must change in the same release.

Do not run anything that sends a network request or needs an API key. Unit tests are fine
with a scrubbed environment: `env -i PATH="$PATH" HOME="$HOME" npm test`.

## Checklist

Credentials
- A key is only ever sent to the host its variable belongs to (`src/core/config.ts`,
  `src/core/providers.ts`); host-specific keys never follow `TYPESAFE_BASE_URL` to another
  known host or to a proxy without `JEV_CODE_PROVIDER`.
- A key goes over `https:` only. The exceptions are an on-prem System One gateway and Ollama,
  which may use plain `http:`. Nothing else may.
- A key never appears in an error message, a log line, stderr, an MCP tool result, a printed
  command, a thrown `Error`, or a file the user might commit. Look for new string
  interpolation of headers, URLs, env values or caught errors.
- Files setup writes that hold a key are readable by the user only (0600), and so are their
  backups. Project-scope files (`.mcp.json`, `opencode.json`) never contain a key value.

Network (`src/core/client.ts`)
- No redirect is followed. Response bodies are size-capped and read under the timeout.
  Server-supplied text that reaches the agent is length-capped and stripped of control
  characters.
- Outbound hosts match the list in SECURITY.md; a new host is a finding until it is listed.

Inputs and execution
- Tool inputs stay validated by zod with bounds before any request (`src/tools/`).
- `setup` writes only where SECURITY.md says. It spawns harness CLIs without a shell and with
  fixed arguments (`src/setup/exec.ts`); no user-controlled value reaches a shell.

Supply chain
- Runtime dependencies: any new or changed entry in `dependencies` needs a reason, and
  `npm audit --omit=dev` must be clean.
- `npm run check:package` passes: nothing outside the allowlist ships.
- Workflows (`.github/workflows/`): actions pinned to full SHAs, least-privilege
  `permissions`, no `${{ }}` of untrusted input inside `run:`, no secrets exposed to
  `pull_request` from forks. npm publishing stays manual: no `npm publish`, `id-token` or npm
  token in any workflow.

## Report

Output a table: severity (CRITICAL, HIGH, MEDIUM, LOW), `file:line`, the finding, a concrete
failure scenario, and a minimal fix. Keep verified issues (you traced the path) separate from
hardening suggestions. List the SECURITY.md claims you re-checked and whether they hold.

End with exactly one line: `PASS` when there is no open HIGH or CRITICAL finding, otherwise
`BLOCK: <the findings that block>`. Paste the report into the release PR.
