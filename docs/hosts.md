# Hosts and gateways

Every tool call goes to one host. The [README](../README.md#configuration) shows how to set each
one up. This page covers how they differ and what a gateway of your own needs.

## Supported hosts

| Host | Model | Where the payload goes | Chosen by |
| --- | --- | --- | --- |
| TypeSafe | Jev | TypeSafe | `TYPESAFE_API_KEY` |
| OpenRouter | Jev | OpenRouter, then TypeSafe | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | Jev | Vercel, then TypeSafe | `AI_GATEWAY_API_KEY` |
| OpenAI Decisions API | GPT-6 Luna | OpenAI | `OPENAI_API_KEY` and `JEV_CODE_PROVIDER=openai` |
| Azure OpenAI Decisions API | GPT-6 Luna | your Azure OpenAI resource | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and `JEV_CODE_PROVIDER=azure` |
| Microsoft Foundry | Microsoft-Decision-1.1 | your Foundry resource | `AZURE_API_KEY`, `AZURE_ENDPOINT`, and `JEV_CODE_PROVIDER=foundry` |
| Gemini Decisions API | Gemini Decision 1 | Google | `GEMINI_API_KEY` and `JEV_CODE_PROVIDER=gemini` |
| Perplexity Decisions API | PPLX Decider | Perplexity | `PERPLEXITY_API_KEY` and `JEV_CODE_PROVIDER=perplexity` |
| Cloudflare Workers AI | `clef-flash`, `clef` | Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `JEV_CODE_PROVIDER=cloudflare` |
| Ollama | `nimble`, `tev1`, `clef`, `clef-flash` | your machine, or the server `OLLAMA_HOST` names | `JEV_CODE_PROVIDER=ollama` |
| Your own gateway | whatever it serves | that gateway | `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` |

- **Same behaviour on the Jev hosts.** The first three serve the same model behind the same
  System One API, so the tools behave the same. Only the account you pay through changes.
- **Other models, other calibration.** Every host below the Jev rows answers the same question
  types with its own model. The default thresholds were chosen against Jev's calibration, so
  spot-check a few results there before relying on `auto` and `yes`/`no`.
- **Opt-in, always.** Those hosts run another company's model, and their keys are set in many
  shells for other reasons, so an exported key alone never sends anything there:
  `JEV_CODE_PROVIDER` names the host. `TYPESAFE_API_KEY` never follows that override to them.
- **One host per call.** jev-code sends the payload to that host and nowhere else. It never
  falls back to another host.

Endpoints, headers, and request ids per host are in [HTTP requests](http.md).

## Other companies' decision APIs

jev-code translates each tool call into the host's request shape and the answer back, so the
payloads you send and the results you get are the same on every host. What differs:

**Azure OpenAI Decisions API.** OpenAI's Decisions API, served from your own Azure OpenAI
resource ([Microsoft Learn](https://learn.microsoft.com/azure/foundry/openai/how-to/decisions)).

- `AZURE_OPENAI_ENDPOINT` is the resource endpoint, `https://<resource>.openai.azure.com`. The
  forms the SDK examples use, ending in `/openai` or `/openai/v1`, work too.
- The key goes in an `api-key` header. Entra ID tokens are not supported.
- The model field names your deployment. Set `TYPESAFE_DEFAULT_MODEL` if yours is not called
  `gpt-6-luna`.
- Everything the [README](../README.md#openai-decisions-api-public-beta) says about OpenAI applies,
  including refusals.

**Microsoft Foundry (Microsoft-Decision-1.1).** Microsoft's own decision model, deployed in a
Foundry resource ([Microsoft Learn](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)).

- It speaks the System One request shape at
  `<AZURE_ENDPOINT>/providers/microsoft/v1/systemone`. `AZURE_ENDPOINT` is the resource
  endpoint from the deployment page, as in Microsoft's guide.
- The key goes in an `api-key` header.
- The model field names your deployment (`Microsoft-Decision-1.1` by default).

**Gemini Decisions API.** Google's Gemini Decision 1 on the Gemini Developer API (`v1beta`).

- It keeps System One's map of questions and its type names. jev-code sends the state as `input`
  (JSON state as its text), yes/no criteria as `true_description` and `false_description`, and
  reads usage from `total_input_tokens`.
- The key goes in an `x-goog-api-key` header.
- Google rejects the whole request with `400` when its safety filters trip, rather than declining
  one question.

**Perplexity Decisions API.** The System One request shape at
`https://api.perplexity.ai/v1/decisions`, with a Bearer key.

- Models are `pplx-decider-latest` (the default) and `pplx-decider-flash-latest`, or a pinned
  version.
- Score questions take at most 10 levels there.

**Cloudflare Workers AI (Clef).** Cloudflare's Clef models through the Workers AI REST API, at
`https://api.cloudflare.com/client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/ai/run/@cf/cloudflare/<model>`.

- It takes the System One body, and jev-code unwraps the `result` envelope Cloudflare puts
  around every answer.
- The token is a Workers AI API token, sent as a Bearer key.
- The model is `clef-flash` (the default) or `clef`. It is part of the URL, so
  `TYPESAFE_DEFAULT_MODEL` must be a plain model id.
- Up to 64 questions per request, and a 24,576-token context.

Every one of these is reached over https only. A plain `http://` URL for any of them is refused,
for any host under `azure.com` too.

## Your own gateway

Any server that speaks the System One API works without a row in jev-code's host table. It needs:

- `POST <base URL>/v1/systemone`, taking and returning the same JSON shapes as TypeSafe;
- a bearer key in `Authorization`, which jev-code always sends to a gateway;
- the model id you configure, or `jev-latest`.

Configure it with the TypeSafe SDK's own variables:

```bash
export TYPESAFE_API_KEY=...                            # the gateway's key
export TYPESAFE_BASE_URL=https://gateway.example/api  # /v1/systemone is appended
export TYPESAFE_DEFAULT_MODEL=vendor/model            # when it does not serve jev-latest
npx -y @french-castle/jev-code@latest doctor --live
```

`setup` does the same when you choose "Other System One gateway" for a pasted key. It checks the
gateway with one request, using the model it is about to store, and asks before keeping a key
the gateway did not answer.

**Plain http.** An on-prem gateway may use plain `http`, for example
`TYPESAFE_BASE_URL=http://10.0.0.12:8080`. The key then crosses the network unencrypted, so
`doctor` warns unless the gateway runs on this machine. The known hosts are always reached over
`https`.

### Example: a third-party System One gateway

A hosted service that advertises System One compatibility is configured the same way. Here, for
a service whose keys start with `nace_sk_` and whose model is `drex-latest`:

```bash
export TYPESAFE_API_KEY=nace_sk_...
export TYPESAFE_BASE_URL=https://console.nace.ai
export TYPESAFE_DEFAULT_MODEL=drex-latest
```

jev-code does not test third-party gateways and makes no claims about their models.

- **Check it works:** run `doctor --live` once.
- **Check it serves what the tools expect:** results depend on the gateway following the System
  One response shapes exactly. For example, `jev_ask` reads score legends as objects.
- **Check the model:** spot-check its calibration before relying on the default thresholds.

### Proxies

A proxy in front of a known host is the same setting: `TYPESAFE_BASE_URL` points at the proxy and
`TYPESAFE_API_KEY` follows it. To send another host's key through a proxy, `JEV_CODE_PROVIDER`
must name that host, for example `JEV_CODE_PROVIDER=openrouter`. That way a key that another tool
exported never follows a stray override.
