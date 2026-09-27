# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email francois@chastel.co with a
description, reproduction steps, and the version affected. You will get an acknowledgement within
72 hours and a fix or mitigation plan as soon as one is available. Credit is given in the release
notes unless you prefer otherwise.

## What this tool touches

### Outbound traffic

One `POST .../v1/systemone` per tool call, to the host your key belongs to:

- `https://api.typesafe.ai` (TypeSafe)
- `https://openrouter.ai/api` (OpenRouter)
- `https://ai-gateway.vercel.sh/typesafe` (Vercel AI Gateway)
- or `TYPESAFE_BASE_URL` when set, under the proxy rule below.

The payload is what the agent passed to a tool: items, questions, optional context. Through
OpenRouter or Vercel AI Gateway it transits that gateway on its way to TypeSafe. jev-code never
reads files, git state, or session history on its own.

### Credentials

- The key is read from `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY`. Its
  prefix (`ts_`, `sk-or-`, `vck_`) says which host issued it; a key with an unknown prefix
  belongs to the host of the variable it sits in.
- A key is only ever sent to the host that issued it. A base URL on a different known host is
  refused before any request. A base URL on an unrecognised host (a proxy) is honoured for
  TypeSafe keys, and for other keys only together with `JEV_CODE_PROVIDER`, so a key another
  tool exported never follows a stray override.
- Keys are never echoed or logged. `doctor`, `setup`, and the MCP server's one stderr line show
  a masked hint (`sk-o…1234`); printed commands show `<your key>`; a harness CLI's output is
  scrubbed of the key before it is shown.
- `setup` copies the one key in use, and only that one, into harness MCP configurations, because
  some harnesses filter the environment before launching servers; `--no-env` disables that. In a
  terminal, `setup` can take the key from a hidden prompt (`--no-prompt` disables it); a pasted
  key goes to the same places and nowhere else.

### Local writes

`setup` writes the skill directory and, depending on the harness, a JSON or TOML config entry.
Existing config files are backed up beside the original as `<file>.bak-<timestamp>` before
modification; malformed JSON or TOML is left untouched and reported.

### Execution

`setup` runs the harness CLIs (`claude`, `codex`, `pi`) found on PATH with fixed arguments; no
shell is involved.

## Supported versions

Only the latest published minor version receives fixes.
