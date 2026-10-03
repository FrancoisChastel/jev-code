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
- `https://api.openai.com` (OpenAI Decisions API), only when `JEV_CODE_PROVIDER=openai`
- `http://localhost:11434`, or `OLLAMA_HOST` (Ollama), only when `JEV_CODE_PROVIDER=ollama`; no key
  is sent unless `OLLAMA_API_KEY` is set
- or `TYPESAFE_BASE_URL` when set, under the proxy rule below. A base URL on one of the known
  hosts above while `JEV_CODE_PROVIDER` names another is refused, for Ollama too.

The payload is what the agent passed to a tool: items, questions, optional context. Through
OpenRouter or Vercel AI Gateway it transits that gateway on its way to TypeSafe. jev-code never
reads files, git state, or session history on its own.

### Credentials

- The key is read from `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY`. The
  variable decides the host; a key's shape never does, because shapes change (TypeSafe issues
  `ts_` and `apikey_` keys). A key that looks like another host's earns a hint in doctor, nothing
  more.
- `OPENAI_API_KEY` is never adopted on its own, even when it is the only key set, because many
  unrelated tools set it. OpenAI's Decisions API is used only with `JEV_CODE_PROVIDER=openai`;
  until then doctor and the missing-key error say the key is there and how to opt in.
- `TYPESAFE_API_KEY` is the generic variable the TypeSafe SDK reads, so it follows
  `TYPESAFE_BASE_URL` and `JEV_CODE_PROVIDER` as the SDK does, including to a proxy. A
  host-specific variable (`OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`) is sent
  only to its own host: a base URL on another known host is refused before any request, and a
  proxy needs `JEV_CODE_PROVIDER` to state the intent, so a key another tool exported never
  follows a stray override.
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
