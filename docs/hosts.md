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
| Ollama | `nimble`, `tev1`, `clef`, `clef-flash` | your machine, or the server `OLLAMA_HOST` names | `JEV_CODE_PROVIDER=ollama` |
| Your own gateway | whatever it serves | that gateway | `TYPESAFE_API_KEY` and `TYPESAFE_BASE_URL` |

- **Same behaviour on the Jev hosts.** The first three serve the same model behind the same
  System One API, so the tools behave the same. Only the account you pay through changes.
- **Other models, other calibration.** OpenAI and Ollama answer the same question types with
  their own models. The default thresholds were chosen against Jev's calibration, so spot-check
  a few results there before relying on `auto` and `yes`/`no`.
- **One host per call.** jev-code sends the payload to that host and nowhere else. It never
  falls back to another host.

Endpoints, headers, and request ids per host are in [HTTP requests](http.md).

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
