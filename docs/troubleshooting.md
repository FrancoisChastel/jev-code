# Troubleshooting

Start with `doctor`. It shows which host and key are in use and what is installed in each
harness. With `--live`, it sends one small request to prove the key works:

```bash
npx -y @french-castle/jev-code@latest doctor --live
```

```
jev-code 0.5.1 · node v22.23.1 · darwin arm64

Configuration
  provider               TypeSafe (TYPESAFE_API_KEY ts_l…cdef)
  base URL               https://api.typesafe.ai
  model                  jev-latest

Harnesses           binary        skill                           tool
  Claude Code       found         ~/.claude/skills/jev            registered v0.5.1
  Codex             found         ~/.codex/skills/jev             registered v0.4.1, run setup to move to v0.5.1
  Pi                not found     missing                         not installed
  OpenCode          not found     missing                         not registered

Live check: ok in 412 ms via TypeSafe (jev-1.13, 57 input tokens).

All good.
```

How to read it:

- **Key hint.** The key appears as its first and last four characters only.
- **`note` lines.** These flag something worth knowing, such as two keys being set at once.
- **`PROBLEM` line.** This is why the configuration cannot be used. Nothing is sent until it is
  fixed.
- **`binary` column.** `found` means the harness CLI is on PATH. `config only` means its config
  directory exists but the CLI is not on PATH.
- **`tool` column.** It shows the version each harness launches. Re-run `setup` when it says so.

## Configuration errors

Nothing is sent when one of these appears.

| Message | Fix |
| --- | --- |
| `No API key found. Export one of …` | Export a key, or run `setup` in a terminal and paste one. If the key is set but the tool still fails, the harness was started before the export, or it filters the environment: restart it, or run `setup`, which copies the key into its config. |
| `OPENAI_API_KEY is set, but OpenAI Decisions API is used only when JEV_CODE_PROVIDER=openai is set.` (or the same for `GEMINI_API_KEY`, `AZURE_OPENAI_API_KEY`, and the other opt-in hosts) | Working as intended. Set `JEV_CODE_PROVIDER` to that host if you mean to use it. |
| `JEV_CODE_PROVIDER must be one of …` | Use one of the names the message lists. |
| `<host> needs AZURE_OPENAI_ENDPOINT (…) as well as …` (or `AZURE_ENDPOINT`, `CLOUDFLARE_ACCOUNT_ID`) | The host lives in your own account. Export its endpoint or account id. |
| `AZURE_ENDPOINT must be an https URL …`, `CLOUDFLARE_ACCOUNT_ID must be your 32-character account id.` | Copy the value from the resource's deployment page or the Cloudflare dashboard. |
| `TYPESAFE_DEFAULT_MODEL must be a Cloudflare Workers AI model id …` | The model goes into Cloudflare's URL. Use `clef-flash` or `clef`. |
| `TYPESAFE_BASE_URL must …` | Use an absolute `http(s)` URL with no `user:password@`, query, or fragment, that stops before `/v1/systemone`. |
| `JEV_CODE_PROVIDER=… but TYPESAFE_BASE_URL points at …` | The two name different hosts. Unset or change one of them. |
| `… but no key is set for <host>: export …` | The host was forced, but its own variable is empty. Export that variable. A key for another host is never sent instead. |
| `TYPESAFE_BASE_URL points at an unrecognised host (…) while the key in use is …` | A host-specific key does not follow a custom base URL. Put the gateway's key in `TYPESAFE_API_KEY`, or set `JEV_CODE_PROVIDER` to the key's host if the URL is a proxy for it. |
| `JEV_CODE_TIMEOUT_MS must be a non-negative integer` (or `JEV_CODE_MAX_RETRIES`) | Use a whole number, such as `60000`. |
| `… points at <host> over plain http; use https://…` | Every known host, and every host under `azure.com`, is reached over https only. Change the scheme. |
| A key refused for its characters | The key contains whitespace or a control character, usually a line break from copying it. Paste it again. The message never shows the key. |

A note such as `TYPESAFE_API_KEY looks like an OpenRouter key (sk-or-…) but is sent to TypeSafe,
as set.` is a hint only. The variable decides where the key goes, so move the key to the variable
the note names.

## API errors

| Message | Likely cause |
| --- | --- |
| `Jev API error 401 …` | The key is wrong, revoked, or belongs to another host. On Cloudflare, the token needs Workers AI permission. |
| `Jev API error 403 …` | The key may not use this model. On OpenAI, `doctor --live` says whether the Decisions API is enabled for the key's project. |
| `Jev API error 404 …` or `422 …` | Often a model id the host does not serve. On your own gateway, set `TYPESAFE_DEFAULT_MODEL`. On Azure OpenAI and Foundry, it must be your deployment name. On Ollama, `doctor --live` names the model to `ollama pull`. |
| `Jev API error 429 …` | Rate limited. jev-code already retried, honouring the host's `retry-after`. Batch items into fewer calls, or raise `JEV_CODE_MAX_RETRIES`. |
| `Jev API error 5xx …` | The host failed. jev-code retried it. Try again later, and include the request id from the message when you report it to the host. |
| `Jev request timed out after … ms.` | Raise `JEV_CODE_TIMEOUT_MS`, or send fewer items per call. |
| `Could not reach <url>: …` | DNS, network, proxy, or TLS trouble, or no Ollama server is running. Check the base URL `doctor` prints. |
| `<url> answered 3xx with a redirect, which jev-code does not follow.` | Point `TYPESAFE_BASE_URL` at the final address. The payload is never resent elsewhere. |

Retries, timeouts, and the limits behind these errors are in [HTTP requests](http.md).

## Harness problems

- **The tool is missing in the agent.** Run `doctor`. If the `tool` column says `not
  registered`, run `setup` for that harness, then restart it. Pi needs `/reload` after an
  install.
- **An old version keeps running.** Installs made with 0.2.1 or earlier launch an unpinned
  command that npx never updates. Run `npx -y @french-castle/jev-code@latest setup` once to move
  to a pinned command; see [Upgrading](../README.md#upgrading).
- **Claude Code asks whether to enable a `jev` server.** A project's `.mcp.json` registers it,
  and Claude Code asks once per project before starting servers that a repository declares.
- **`doctor` notes `… is sent over plain http to <host>.`** The key would travel unencrypted to a
  host other than this machine. Use `https` unless the gateway sits on a network you trust.

Still stuck? Open an issue with the `doctor` output; it never includes the full key. For a
security problem, follow [SECURITY.md](../SECURITY.md) instead.
