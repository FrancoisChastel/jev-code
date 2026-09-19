# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email francois@chastel.co with a
description, reproduction steps, and the version affected. You will get an acknowledgement within
72 hours and a fix or mitigation plan as soon as one is available. Credit is given in the release
notes unless you prefer otherwise.

## What this tool touches

- **Outbound traffic:** only `POST https://api.typesafe.ai/v1/systemone` (or `TYPESAFE_BASE_URL`),
  carrying the payload the agent passed to a tool: items, questions, optional context. jev-code
  never reads files, git state, or session history on its own.
- **Credentials:** `TYPESAFE_API_KEY` is read from the environment. `jev-code setup` copies it into
  harness MCP configurations when it is set, because some harnesses filter the environment before
  launching servers; `--no-env` disables that. The key is never logged; `doctor` shows a masked hint.
- **Local writes:** `setup` writes the skill directory and, depending on the harness, a JSON or
  TOML config entry. Existing config files are backed up beside the original before modification;
  malformed files are left untouched.
- **Execution:** `setup` runs the harness CLIs (`claude`, `codex`, `pi`) found on PATH with fixed
  arguments; no shell is involved.

## Supported versions

Only the latest published minor version receives fixes.
