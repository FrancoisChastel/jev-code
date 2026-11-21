# HTTP requests

What jev-code puts on the wire. One tool call sends one `POST`, plus retries. jev-code makes no
other requests: no telemetry, no update checks, nothing at startup. `doctor` makes a request only
with `--live`, and `setup` only when it checks a gateway you chose. The harness configs launch the
server through `npx`, which may ask the npm registry for the pinned version; that request is
npm's, not jev-code's.

## Endpoints

The host comes from the variable your key sits in; see [Configuration](configuration.md).

| Host | Request | Request id read from |
| --- | --- | --- |
| TypeSafe | `POST https://api.typesafe.ai/v1/systemone` | `x-typesafe-request-id` |
| OpenRouter | `POST https://openrouter.ai/api/v1/systemone` | `x-typesafe-request-id` |
| Vercel AI Gateway | `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `x-vercel-id` |
| OpenAI Decisions API | `POST https://api.openai.com/v1/decisions` | `x-request-id` |
| Azure OpenAI Decisions API | `POST <AZURE_OPENAI_ENDPOINT>/openai/v1/decisions` | `apim-request-id` |
| Microsoft Foundry | `POST <AZURE_ENDPOINT>/providers/microsoft/v1/systemone` | `apim-request-id` |
| Gemini Decisions API | `POST https://generativelanguage.googleapis.com/v1beta/decisions` | `x-typesafe-request-id` (Google sends none that jev-code reads) |
| Perplexity Decisions API | `POST https://api.perplexity.ai/v1/decisions` | `x-request-id` |
| Cloudflare Workers AI | `POST https://api.cloudflare.com/client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/ai/run/@cf/cloudflare/<model>` | `cf-ray` |
| Ollama | `POST http://localhost:11434/v1/systemone`, or the server `OLLAMA_HOST` names | `x-typesafe-request-id` |
| Your own gateway | `POST <TYPESAFE_BASE_URL>/v1/systemone` | that of the host whose key is used |

`TYPESAFE_BASE_URL` replaces the host's base URL, and the account variables, and keeps its path:
with `JEV_CODE_PROVIDER=openai` the request goes to `<TYPESAFE_BASE_URL>/v1/decisions`. Trailing
slashes are dropped before the path is appended.

## Headers

Every request carries these headers, in this order:

| Header | Value | When |
| --- | --- | --- |
| `Authorization` | `Bearer <key>` | Only when a key is set. Ollama without `OLLAMA_API_KEY` gets none. Azure OpenAI and Foundry get `api-key: <key>` instead, and Gemini `x-goog-api-key: <key>`. |
| `Content-Type` | `application/json` | Always. |
| `Accept` | `application/json` | Always. |
| `User-Agent` | see below | Always. |

OpenRouter also gets its optional app attribution:

| Header | Value |
| --- | --- |
| `HTTP-Referer` | `https://github.com/FrancoisChastel/jev-code` |
| `X-Title` | `jev-code` |

The fixed headers are set last, so neither a host's extra headers nor a library caller's can
replace the key header, `Content-Type`, `Accept`, or `User-Agent`. Beyond these, a request
carries only the transport headers Node's `fetch` always adds, such as `Host`, `Content-Length`,
and `Accept-Encoding`. No cookies are sent.

### User-Agent

The User-Agent names the package, its version, and the entry point, so a host can tell jev-code
traffic apart:

| Entry point | User-Agent |
| --- | --- |
| MCP server (`jev-code mcp`, what harness configs launch) | `@french-castle/jev-code/<version> mcp` |
| CLI tool commands (`classify`, `check`, `score`, `rank`, `ask`) | `@french-castle/jev-code/<version> cli` |
| `jev-code doctor --live` | `@french-castle/jev-code/<version> doctor` |
| `jev-code setup`, checking a gateway | `@french-castle/jev-code/<version> setup` |
| Pi extension | `jev-code pi-extension` |
| OpenCode custom tool | `jev-code opencode-tool` |
| The library's `JevClient`, when the caller sets none | `jev-code` |

Every value starts with `@french-castle/jev-code` or `jev-code`, so a host can tell jev-code
traffic apart by matching either.

## Body

System One hosts (TypeSafe, OpenRouter, Vercel AI Gateway, Ollama, your own gateway) receive the
tool's request as is, with the model added:

```json
{ "model": "jev-latest", "state": "…", "questions": { "q1": { "type": "noul", "instructions": "…" } } }
```

Perplexity, Microsoft Foundry, and Cloudflare's Clef take the same body at their own paths.
A `model` passed to a tool replaces the default one. OpenAI's and Azure OpenAI's Decisions API
take another shape (`model`, `input`, and a `questions` array), and Gemini renames a few fields;
jev-code translates both, as [Hosts and gateways](hosts.md#other-companies-decision-apis)
describes. The body holds only what the
agent passed to the tool. jev-code adds nothing from your repository, files, or session.

`doctor --live` and the setup check send one fixed question: state `ping`, question
`{"alive": {"type": "noul", "instructions": "Is this a single short word?"}}`.

## Timeouts and retries

| Setting | Default | Variable |
| --- | --- | --- |
| Timeout per attempt | 30 000 ms | `JEV_CODE_TIMEOUT_MS` |
| Retries after the first attempt | 2 | `JEV_CODE_MAX_RETRIES` |

- **Retried:** status 408, 425, 429, 500, 502, 503, 504, and 529, plus timeouts and connection
  errors.
- **Not retried:** every other status, including 400, 401, 403, 404, and 422. A key or a request
  that is wrong stays wrong.
- **Delay:** a `retry-after-ms` header (milliseconds) or `retry-after` header (seconds) is
  honoured, up to 30 s. Without one, the delay is 500 ms doubling per retry, capped at 8 s, minus
  up to 25% random jitter.
- **Fail fast:** setup's gateway check makes no retries, so a dead gateway answers quickly.
- **Cancelled calls:** a call the harness cancels is aborted in flight and not retried.

## Limits and redirects

- **Redirects:** never followed. A `3xx` answer is an error, so the payload cannot be sent on
  to another origin. Point `TYPESAFE_BASE_URL` at the final URL instead.
- **Response size:** capped at 1 MiB. The body is read within the same per-attempt timeout as
  the headers.
- **Server text:** error text from the host is cut to 300 characters, with control characters
  stripped, before it reaches the agent.
- **Plain http:** the known hosts are reached over `https` only. A `TYPESAFE_BASE_URL` with
  `http://` on one of their hostnames is refused, and a hostname with a trailing dot, such as
  `api.openai.com.`, counts as the known host. Plain `http` is accepted only for an on-prem
  System One gateway (`TYPESAFE_BASE_URL` on another host) and for Ollama. `doctor` warns when a
  key would travel over plain `http` to a host other than this machine.
- **Request size:** checked before sending. A serialised request over 120 000 characters is
  refused locally. Item texts are cut to 4 000 characters, and the per-tool counts (64 items,
  250 classes, and so on) are in the [tool reference](../skills/jev/references/tools.md).

## Errors

| Error | Meaning | Message starts with |
| --- | --- | --- |
| `JevConfigError` | Configuration that cannot be used: no key, a malformed override, keys that disagree. Nothing was sent. | the variable at fault |
| `JevValidationError` | A tool input that cannot be sent. Nothing was sent. | the field path in your input |
| `JevApiError` | The host answered with a non-2xx status. A 2xx body without answers is one too, reported as `… returned a body without answers.` | `Jev API error <status>:`, with `(request <id>)` before the colon when the host sent one |
| `JevTimeoutError` | An attempt exceeded the timeout, after the retries. | `Jev request timed out after <ms> ms.` |
| `JevConnectionError` | The request never reached the host, or the connection dropped. | `Could not reach <url>:` |

The message in a `JevApiError` is the host's own: it is taken from `message`, `error`, or
`detail`, up to two levels deep. TypeSafe nests it under `detail`, OpenRouter under `error`, and
Vercel puts it at the top level. Without one, the start of the body is used. The CLI exits with
2 for usage and configuration problems and 1 for API failures. The MCP server returns the
message as a tool error, `<tool> failed: <message>`, so the agent sees it.

Keys never appear in messages. A key is removed from every error message and from the error
body kept on a `JevApiError`, so it cannot leak through a host or a runtime that echoes it. Where
a key is shown at all (`doctor`, `setup`, the MCP server's one stderr line), it is masked to its
first and last four characters, for example `sk-o…1234`. The hardening behind this page's limits
and redaction is in [#32](https://github.com/FrancoisChastel/jev-code/pull/32).
