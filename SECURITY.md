# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email francois@chastel.co with a
description, reproduction steps, and the version affected. You will get an acknowledgement within
72 hours and a fix or mitigation plan as soon as one is available. Credit is given in the release
notes unless you prefer otherwise.

## What this tool touches

- **Outbound traffic:** one `POST .../v1/systemone` per tool call, to the host your key belongs
  to: `https://api.typesafe.ai` (TypeSafe), `https://openrouter.ai/api` (OpenRouter), or
  `https://ai-gateway.vercel.sh/typesafe` (Vercel AI Gateway), or `TYPESAFE_BASE_URL` when set.
  The payload is what the agent passed to a tool: items, questions, optional context. Through a
  gateway, that payload transits the gateway on its way to TypeSafe. jev-code never reads files,
  git state, or session history on its own.
- **Credentials:** the key is read from `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or
  `AI_GATEWAY_API_KEY`. A key is only ever sent to the host that issued it, judged by its prefix;
  a key and a base URL on different known hosts are refused before any request. A base URL on an
  unrecognised host (a proxy) is honoured for TypeSafe keys, and for other keys only together
  with `JEV_CODE_PROVIDER`. `setup` and `doctor` print the host in use, and the MCP server logs
  it to stderr once, where harnesses keep their server logs. `jev-code setup` copies the
  one key in use into harness MCP configurations, because some harnesses filter the environment
  before launching servers; `--no-env` disables that. In a terminal, `setup` can also take the key
  from a hidden prompt. Keys are never echoed or logged; `doctor` shows a masked hint only.
- **Local writes:** `setup` writes the skill directory and, depending on the harness, a JSON or
  TOML config entry. Existing config files are backed up beside the original before modification;
  malformed files are left untouched.
- **Execution:** `setup` runs the harness CLIs (`claude`, `codex`, `pi`) found on PATH with fixed
  arguments; no shell is involved.

## Supported versions

Only the latest published minor version receives fixes.
