# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Email francois@chastel.co with a
description, reproduction steps, and the version affected. You will get an acknowledgement within
72 hours and a fix or mitigation plan as soon as one is available. Credit is given in the release
notes unless you prefer otherwise.

## What this tool touches

### Outbound traffic

One `POST` per tool call (`.../v1/systemone`, or the host's own decision endpoint), to the host
your key belongs to:

- `https://api.typesafe.ai` (TypeSafe)
- `https://openrouter.ai/api` (OpenRouter)
- `https://ai-gateway.vercel.sh/typesafe` (Vercel AI Gateway)
- `https://api.openai.com` (OpenAI Decisions API), only when `JEV_CODE_PROVIDER=openai`
- your Azure OpenAI resource (`AZURE_OPENAI_ENDPOINT`), only when `JEV_CODE_PROVIDER=azure`
- your Microsoft Foundry resource (`AZURE_ENDPOINT`), only when `JEV_CODE_PROVIDER=foundry`
- `https://generativelanguage.googleapis.com` (Gemini), only when `JEV_CODE_PROVIDER=gemini`
- `https://api.perplexity.ai` (Perplexity), only when `JEV_CODE_PROVIDER=perplexity`
- `https://api.cloudflare.com` under your account (`CLOUDFLARE_ACCOUNT_ID`), only when
  `JEV_CODE_PROVIDER=cloudflare`
- `http://localhost:11434`, or `OLLAMA_HOST` (Ollama), only when `JEV_CODE_PROVIDER=ollama`; no key
  is sent unless `OLLAMA_API_KEY` is set
- or `TYPESAFE_BASE_URL` when set, under the proxy rule below: a proxy, or a System One gateway
  of your own. The value is checked before any request (absolute `http(s)`, no embedded
  credentials, query, or fragment), and so is `OLLAMA_HOST`. A base URL on one of the known hosts
  above while `JEV_CODE_PROVIDER` names another is refused, for Ollama too, and `OLLAMA_HOST`
  may not name a known host.

The known hosts, and every host under `azure.com`, are reached over https only: an `http://` URL
naming one of them is refused, and so is an Azure endpoint that is not https, so their keys never
travel in clear text. Plain http is accepted for a gateway of your own and for
an Ollama server, which may sit on a private network; when a key would cross a network that way
(any host other than localhost or a loopback address), `doctor` and `setup` say so.

### Transport

- Exactly one `POST` per attempt, to the configured URL. Redirects are never followed: a 3xx
  answer is an error, so the payload cannot be forwarded to another origin.
- Each attempt has a timeout (`JEV_CODE_TIMEOUT_MS`, 30 s by default) that covers reading the
  answer as well as connecting. Answers larger than 1 MiB are refused without being buffered.
- Text from the host that ends up in an error the agent reads (its error message and request id)
  is cut to 300 and 100 characters and flattened to one line, so a misbehaving host can neither
  flood the agent's context nor fake structure in it.
- Retries cover 408, 425, 429, 500, 502, 503, 504, 529, and connection failures, with
  exponential backoff (`JEV_CODE_MAX_RETRIES`, 2 by default); `retry-after` is honoured up to
  30 s.

`doctor --live` sends one such request with a fixed one-word payload. So does `setup` when you
choose "Other System One gateway" for a pasted key: it checks the gateway with that key before
storing it, and sends nothing else.

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
  until then doctor and the missing-key error say the key is there and how to opt in. The same
  holds for every other host that runs another company's model: `AZURE_OPENAI_API_KEY`,
  `AZURE_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, and `CLOUDFLARE_API_TOKEN` count only
  when `JEV_CODE_PROVIDER` names their host, and `TYPESAFE_API_KEY` never follows an override
  to one of them.
- `TYPESAFE_API_KEY` is the generic variable the TypeSafe SDK reads, so it follows
  `TYPESAFE_BASE_URL` and `JEV_CODE_PROVIDER` as the SDK does, including to a proxy. A
  host-specific variable (`OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENAI_API_KEY`) is sent
  only to its own host: a base URL on another known host is refused before any request, and a
  proxy needs `JEV_CODE_PROVIDER` to state the intent, so a key another tool exported never
  follows a stray override.
- Keys are never echoed or logged. `doctor`, `setup`, and the MCP server's one stderr line show
  a masked hint (`sk-o…1234`); printed commands show `<your key>`; a harness CLI's output is
  scrubbed of the key before it is shown. A key holding whitespace or a control character is
  refused before any request, without being quoted: an HTTP stack would otherwise reject the
  header and print it. As a last line of defence, the client removes the key's exact value from
  every error message it raises and from the body an API error carries.
- `setup` copies the one key in use, and only that one, into user-level harness MCP
  configurations, because some harnesses filter the environment before launching servers;
  `--no-env` disables that. In a terminal, `setup` can take the key from a hidden prompt
  (`--no-prompt` disables it); a pasted key goes to the same places and nowhere else.
- Project-scope files (`.mcp.json`, `opencode.json`) are meant to be committed, so they never hold
  a key: `setup --project` writes a reference the harness expands at launch (`${TYPESAFE_API_KEY}`
  for Claude Code, `{env:TYPESAFE_API_KEY}` for OpenCode), and the key stays in your shell.
- Registering through `claude mcp add` or `codex mcp add` passes the key as a command-line
  argument for the second that command runs, where another user of the same machine could see it
  in `ps`. On a shared machine, use `--no-env` and export the key instead.

### Local writes

`setup` writes the skill directory and, depending on the harness, a JSON or TOML config entry.
Existing config files are backed up beside the original as `<file>.bak-<timestamp>` before
modification; a backup never overwrites an existing file. A config file that setup writes itself
(`opencode.json`, `.mcp.json` when the `claude` CLI is absent, Codex's `config.toml` when the
`codex` CLI is absent) is made readable by its owner only when it holds a key (mode 0600,
directories it creates 0700), and so is every backup, since a backup keeps the previous key;
delete old backups once you no longer need them. Files that `claude mcp add` and `codex mcp add`
write keep the permissions those CLIs give them. Modes apply on macOS and Linux; Windows ignores
them.

A project file written by 0.5.1 or earlier held the key itself. Running `setup --project` again
replaces it with a reference and says so; if the file was ever committed or shared, rotate the
key, and delete the `.bak-*` backup setup leaves beside it, which still holds the key.
Malformed JSON is left untouched and reported. Codex's TOML is not parsed: setup edits only the
`[mcp_servers.jev]` block, line by line, and leaves the rest of the file as it was.

### Execution

`setup` runs the harness CLIs (`claude`, `codex`, `pi`) found on PATH with fixed arguments; no
shell is involved.

## Supported versions

Only the latest published minor version receives fixes.
