# Configuration

jev-code reads its configuration from environment variables only. It reads no config file of its
own. The [README](../README.md#configuration) explains the choices; this page is the exact
reference.

## Variables

### Keys

| Variable | Host it is sent to | Notes |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe, or the host `TYPESAFE_BASE_URL` or `JEV_CODE_PROVIDER` names | The TypeSafe SDK's generic variable. It may follow an override to OpenRouter or Vercel AI Gateway, which serve Jev, as the SDK's does. It never goes to an opt-in host. |
| `OPENROUTER_API_KEY` | OpenRouter only | |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway only | |
| `OPENAI_API_KEY` | OpenAI Decisions API only | Read only with `JEV_CODE_PROVIDER=openai`; ignored otherwise, even when it is the only key. |
| `AZURE_OPENAI_API_KEY` | your Azure OpenAI resource only | Read only with `JEV_CODE_PROVIDER=azure`. Sent in an `api-key` header. |
| `AZURE_API_KEY` | your Microsoft Foundry resource only | Read only with `JEV_CODE_PROVIDER=foundry`. Sent in an `api-key` header. |
| `GEMINI_API_KEY` | Gemini Decisions API only | Read only with `JEV_CODE_PROVIDER=gemini`. Sent in an `x-goog-api-key` header. |
| `PERPLEXITY_API_KEY` | Perplexity Decisions API only | Read only with `JEV_CODE_PROVIDER=perplexity`. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI only | Read only with `JEV_CODE_PROVIDER=cloudflare`. A Workers AI API token. |
| `OLLAMA_API_KEY` | Ollama only | Optional. Sent only with `JEV_CODE_PROVIDER=ollama`, for a server that wants one. |

Values are trimmed. An empty variable counts as unset.

### Settings

| Variable | Default | Accepted values |
| --- | --- | --- |
| `JEV_CODE_PROVIDER` | chosen from the keys | `typesafe`, `openrouter`, `vercel`, `openai`, `azure`, `foundry`, `gemini`, `perplexity`, `cloudflare`, `ollama`, case-insensitive. Anything else is an error. |
| `AZURE_OPENAI_ENDPOINT` | none; required for `azure` | Your Azure OpenAI resource, `https://<resource>.openai.azure.com`. A trailing `/openai` or `/openai/v1` is accepted. https only. |
| `AZURE_ENDPOINT` | none; required for `foundry` | Your Foundry resource endpoint, such as `https://<resource>.services.ai.azure.com`. A trailing `/providers/microsoft/v1/systemone` is accepted. https only. |
| `CLOUDFLARE_ACCOUNT_ID` | none; required for `cloudflare` | Your account id, 32 hexadecimal characters. |
| `TYPESAFE_BASE_URL` | the host's own URL | An absolute `http(s)` URL with no credentials, query, or fragment, stopping before the endpoint path. See [the rules](#base-url-rules). |
| `TYPESAFE_DEFAULT_MODEL` | the host's default | Any model id the host serves. The defaults are `jev-latest` on TypeSafe and OpenRouter, `typesafe-ai/jev` on Vercel AI Gateway, `gpt-6-luna` on OpenAI and Azure OpenAI, `Microsoft-Decision-1.1` on Foundry, `gemini-decision-1` on Gemini, `pplx-decider-latest` on Perplexity, `clef-flash` on Cloudflare, and `nimble` on Ollama. On Azure OpenAI and Foundry it is your deployment name. On Cloudflare it goes into the URL, so it must be a plain id. |
| `OLLAMA_HOST` | `localhost:11434` | Ollama's notation: a URL, `host:port`, or a bare host. A value without a scheme gets `http://`, and a bare host gets port `11434`. Read only with `JEV_CODE_PROVIDER=ollama`; `TYPESAFE_BASE_URL` wins when both are set. |
| `JEV_CODE_TIMEOUT_MS` | `30000` | A non-negative integer: the timeout for each attempt, in milliseconds. |
| `JEV_CODE_MAX_RETRIES` | `2` | A non-negative integer: retries after the first attempt. See [HTTP requests](http.md#timeouts-and-retries). |

## How the host and key are chosen

The variable a key sits in decides its host. The key's shape never does. The steps, in order:

1. If `JEV_CODE_PROVIDER` and a `TYPESAFE_BASE_URL` on a known host name two different hosts,
   jev-code stops with an error.
2. `JEV_CODE_PROVIDER=ollama` selects Ollama, with no key unless `OLLAMA_API_KEY` is set.
3. If `JEV_CODE_PROVIDER` or a `TYPESAFE_BASE_URL` on a known host names a host, that host's own
   variable is used. Failing that, `TYPESAFE_API_KEY` is used, if the host serves Jev
   (OpenRouter, Vercel AI Gateway). If neither is set, jev-code stops with an error. A key for another host is never
   used instead.
4. Otherwise, the first key that is set wins, in this order: `TYPESAFE_API_KEY`,
   `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`. `doctor` notes when more than one is set.
5. With no usable key, jev-code stops with an error that lists the variables to export.

The keys of opt-in hosts (OpenAI, Azure OpenAI, Foundry, Gemini, Perplexity, Cloudflare) take
part only when `JEV_CODE_PROVIDER` names their host. Without it, `doctor` and the missing-key
error say the key is set and how to opt in. Azure OpenAI, Foundry, and Cloudflare also need
their account variable; without it, jev-code stops with an error naming it.

### Base URL rules

`TYPESAFE_BASE_URL` is checked before any request. Validation errors never echo the value, since
it may contain a secret. It must:

- be an absolute `http` or `https` URL;
- carry no `user:password@`, query (`?`), or fragment (`#`);
- stop before `/v1/systemone`, which the client appends.

What it points at decides what follows it:

- **A known host** (TypeSafe, OpenRouter, Vercel AI Gateway, OpenAI, Gemini, Perplexity,
  Cloudflare) selects that host, as `JEV_CODE_PROVIDER` would. Known hosts, and every host under
  `azure.com`, are reached over `https` only.
- **Any other host** is a proxy, or a System One gateway of your own. `TYPESAFE_API_KEY`
  follows it. A host-specific key follows it only when `JEV_CODE_PROVIDER` names the key's host,
  so a key another tool exported never goes to a stranger. `doctor` and `setup` name such a host
  "System One gateway at <host>". Plain `http` is accepted here, for an on-prem gateway.

`OLLAMA_HOST` is validated the same way.

## What setup writes

Some harnesses filter the environment before they start a server, so `setup` copies these
variables into the harness's MCP configuration when they are set:

- the one key in use, and no other;
- `JEV_CODE_PROVIDER`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, and `OLLAMA_HOST`.

Pi reads the shell it runs in, so nothing is written for it.

`--no-env` leaves the key out, and the server then reads it from the environment at runtime.
With `--project`, the key itself never goes into a file in the repository. Claude Code's
`.mcp.json` gets a reference such as `${TYPESAFE_API_KEY}`, and OpenCode's `opencode.json` gets
one such as `{env:TYPESAFE_API_KEY}`, naming the variable in use. The harness fills it from its
own environment, so export the key in the shell that starts the harness.

Files that jev-code writes itself are readable by you only (mode 0600). These are
`opencode.json`, `.mcp.json` when the `claude` CLI is absent, and Codex's `config.toml` when the
`codex` CLI is absent. So is every backup setup makes, and directories it creates for a key are
mode 0700. Files written by `claude mcp add` or `codex mcp add` keep the permissions those CLIs
give them. Those two commands also receive the key as an argument while they run; `--no-env`
avoids both. File modes apply on macOS and Linux and have no effect on Windows. The details are
in [#32](https://github.com/FrancoisChastel/jev-code/pull/32).

`TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` are the names the official TypeSafe SDKs read, so one
export serves jev-code and your own code.
