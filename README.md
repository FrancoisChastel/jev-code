<h1 align="center">jev-code</h1>

<p align="center">
  <strong>Jev, TypeSafe's System One classifier, as a tool inside Claude Code, Codex, Pi, and OpenCode.</strong><br />
  Typed labels, yes/no checks, scores, and rankings with calibrated probabilities, in a few hundred milliseconds.
</p>

<p align="center">
  <a href="https://github.com/FrancoisChastel/jev-code/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FrancoisChastel/jev-code/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@french-castle/jev-code"><img alt="npm" src="https://img.shields.io/npm/v/%40french-castle%2Fjev-code" /></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" />
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

---

Coding agents make small classification decisions all day: which of these 40 CI failures are
real, which files answer this question, does this PR do what its description says, how severe is
each finding. They usually do it by eyeballing, by writing a regex, or by burning a frontier-model
call per item.

[Jev](https://typesafe.ai) is a decision model rather than a text model: you send evidence and typed
questions, it returns typed answers with calibrated probabilities, never prose. **jev-code** turns
that into a first-class tool for four coding agents and ships a skill that teaches the agent when
to reach for it.

```
┌──────────────┐  jev_classify / jev_check / ...  ┌───────────┐  POST /v1/systemone  ┌──────────────┐
│ Claude Code  │ ───── MCP (stdio) ─────────────▶ │           │ ───────────────────▶ │  Jev, hosted │
│ Codex        │ ───── MCP (stdio) ─────────────▶ │  jev-code │                      │  on TypeSafe │
│ OpenCode     │ ───── MCP (stdio) ─────────────▶ │           │ ◀─────────────────── │  OpenRouter  │
│ Pi           │ ───── native extension ────────▶ │           │  typed answers +     │  or Vercel   │
│ any shell    │ ───── jev-code CLI ────────────▶ │           │  probabilities       │  AI Gateway  │
└──────────────┘                                  └───────────┘                      └──────────────┘
```

## What you get

| Piece | What it does |
| --- | --- |
| **Five tools** | `jev_classify`, `jev_check`, `jev_score`, `jev_rank`, `jev_ask`. Same names, same JSON, in every harness. |
| **One skill** | [`skills/jev/SKILL.md`](skills/jev/SKILL.md) tells the agent when a task needs a classifier, how to write good classes and questions, and how to act on the answers. A reference adapted from TypeSafe's official skill covers building Jev into the user's own code. Follows the [Agent Skills](https://agentskills.io) spec. |
| **One-command setup** | `jev-code setup` detects Claude Code, Codex, Pi, and OpenCode on your machine and wires both the skill and the tool into each. |
| **A CLI** | The same tools from bash, so the skill still works in a harness with no tool registered. |

## Quick start

**1. Install into your agents** (Node.js 20+):

```bash
npx -y @french-castle/jev-code@latest setup
```

That detects the harnesses on your machine and, for each one, copies the skill and registers the
tool. When no API key is in your shell, it asks for one right there (hidden input). Any key
works: TypeSafe (`ts_...`), OpenRouter (`sk-or-...`), or Vercel AI Gateway (`vck_...`); the prefix
picks the host, so there is nothing else to configure.

Add harness names to be explicit (`setup claude codex pi opencode`), `--project` to install into
the current repository instead of your user profile, or `--dry-run` to see the plan first.

Prefer to keep the key in your environment? Export it before running `setup`, and it is picked up
without a prompt. This is also what Pi and the CLI read, so `setup` prints the line to add to your
shell profile after you paste a key:

```bash
export TYPESAFE_API_KEY=ts_...        # TypeSafe direct: console.typesafe.ai/keys
export OPENROUTER_API_KEY=sk-or-...   # OpenRouter: already set if you use it elsewhere
export AI_GATEWAY_API_KEY=vck_...     # Vercel AI Gateway
```

**2. Check it works:**

```bash
npx -y @french-castle/jev-code@latest doctor --live
```

**3. Restart your agent** (or `/reload` inside pi) and ask for something that needs a classifier:

> Triage the failing tests in the last CI run: which are flaky, which are real bugs?

The agent loads the `jev` skill, calls `jev_classify` with the failures and a class set, acts on
the `auto` results, and tells you which ones it double-checked by hand.

## What a call looks like

The agent sends raw evidence and its own classes:

```json
{
  "instructions": "Classify each test failure by its most likely root cause.",
  "items": [
    { "id": "test_login_sso", "text": "TimeoutError: SSO callback not received within 10s (attempt 3/3)" },
    { "id": "test_price_rounding", "text": "AssertionError: expected 19.99, got 19.989999999" }
  ],
  "classes": {
    "infrastructure": "Network, database, or runner problems unrelated to the code; likely passes on re-run",
    "assertion_bug": "The code produced a wrong value; deterministic and reproducible",
    "other": "Cannot tell from the excerpt"
  }
}
```

and gets back a label, the full distribution, and a decision it can branch on:

```json
{
  "summary": { "items": 2, "auto": 2, "review": 0, "by_label": { "infrastructure": 1, "assertion_bug": 1 } },
  "results": [
    { "id": "test_login_sso", "label": "infrastructure", "probability": 0.93, "margin": 0.88, "confidence": 0.9, "decision": "auto", "probabilities": { "infrastructure": 0.93, "assertion_bug": 0.05, "other": 0.02 } },
    { "id": "test_price_rounding", "label": "assertion_bug", "probability": 0.97, "margin": 0.95, "confidence": 0.95, "decision": "auto", "probabilities": { "infrastructure": 0.01, "assertion_bug": 0.97, "other": 0.02 } }
  ],
  "thresholds": { "auto_accept": 0.85, "min_margin": 0.5 },
  "model": "jev-latest",
  "usage": { "input_tokens": 310, "output_tokens": 18 }
}
```

More payloads in [`examples/`](examples) and the full contract in
[`skills/jev/references/tools.md`](skills/jev/references/tools.md).

## The tools

| Tool | Ask it when | Comes back with |
| --- | --- | --- |
| `jev_classify` | Many items, one label each from your classes | label, probabilities, margin, `decision: auto \| review` |
| `jev_check` | Yes/no questions about one piece of evidence | probability, `verdict: yes \| no \| uncertain` |
| `jev_score` | Many items on one ordered scale (severity, priority) | score, nearest level, confidence, decision |
| `jev_rank` | Which candidates answer a question | relevance per candidate, sorted, plus `any_relevant` |
| `jev_ask` | Anything else: mixed question types over one state | the raw System One answers |

Every tool validates its input locally (shapes, duplicate ids, request size) before spending a
call, batches every item into one request, and returns decisions computed from thresholds you can
override per call. Policy stays in your hands; Jev supplies the probabilities.

## Per-harness details

<details>
<summary><strong>Claude Code</strong></summary>

`jev-code setup claude` copies the skill to `~/.claude/skills/jev/` and runs
`claude mcp add --scope user jev -- npx -y @french-castle/jev-code@0.3.0 mcp`. The tools appear as
`mcp__jev__jev_classify` and friends; the skill is `/jev`.

Prefer a plugin that updates itself? This repository is also a Claude Code plugin marketplace:

```bash
claude plugin marketplace add FrancoisChastel/jev-code
claude plugin install jev-code@jev-code
```

The plugin bundles the skill (`/jev-code:jev`) and the MCP server. Manual configuration and
project-scope notes: [docs/harnesses/claude-code.md](docs/harnesses/claude-code.md).

</details>

<details>
<summary><strong>Codex</strong></summary>

`jev-code setup codex` copies the skill to `~/.agents/skills/jev/` (Codex's user-level skills
directory, shared with Pi and OpenCode) and runs `codex mcp add jev -- npx -y @french-castle/jev-code@0.3.0 mcp`.
Without the `codex` binary it appends a `[mcp_servers.jev]` table to `~/.codex/config.toml`
instead. Invoke the skill with `$jev`. Details: [docs/harnesses/codex.md](docs/harnesses/codex.md).

</details>

<details>
<summary><strong>Pi</strong></summary>

Pi has no MCP client, so jev-code is also a [pi package](https://pi.dev/docs/latest/packages) whose
extension registers the five tools natively. `jev-code setup pi` runs
`pi install npm:@french-castle/jev-code` and copies the skill to `~/.agents/skills/jev/`. Run
`/reload` inside pi afterwards. Details: [docs/harnesses/pi.md](docs/harnesses/pi.md).

</details>

<details>
<summary><strong>OpenCode</strong></summary>

`jev-code setup opencode` adds a local MCP entry to `~/.config/opencode/opencode.json` (backing the
file up first) and copies the skill to `~/.agents/skills/jev/`, which OpenCode reads. A native
custom-tool variant lives in [`integrations/opencode/jev.ts`](integrations/opencode/jev.ts).
Details: [docs/harnesses/opencode.md](docs/harnesses/opencode.md).

</details>

<details>
<summary><strong>Skill only, any agent</strong></summary>

The skill is a standard Agent Skills directory, so the [skills.sh](https://skills.sh) installer
works for the 70+ agents it supports:

```bash
npx skills add FrancoisChastel/jev-code --skill jev
```

Pair it with the MCP server (`npx -y @french-castle/jev-code@0.3.0 mcp`) in your agent's MCP config,
or let the agent fall back to the CLI.

</details>

## CLI

```bash
jev-code setup [claude|codex|pi|opencode ...] [--project] [--dry-run] [--no-env] [--no-prompt]
jev-code doctor [--live]                     # which host and key are in use, what is installed
jev-code classify --input payload.json      # same JSON as the tool
echo '{"state":"12 passed, 0 failed","checks":{"green":"Did every test pass?"}}' | jev-code check
jev-code rank --input candidates.json --pretty
jev-code mcp                                 # what the harness configs launch
jev-code skill                               # path of the bundled skill
```

Output is JSON on stdout. Exit code 2 means a usage or configuration problem, 1 an API failure.

## Upgrading

Harness configs launch a pinned command, `npx -y @french-castle/jev-code@0.3.0 mcp`, so an agent
starts fast and works offline once that version is cached, and nothing changes under you until
you decide. To upgrade, run setup again with `@latest`: it re-registers the tool with the new pin,
replacing the old entry (also through `claude mcp` and `codex mcp`), and refreshes the copied
skill. `doctor` shows the pinned version of every registration and says when to re-run setup.

```bash
npx -y @french-castle/jev-code@latest setup
```

Installs made with 0.2.1 or earlier launch an unpinned command. npx keeps the first version it
cached for an unpinned name and never looks for a newer one, so those installs do not see updates
on their own. Run the command above once to move them to a pinned command.

## Configuration

One API key is required. The three hosts below all serve Jev behind the same System One API,
so the tools behave identically; only the account you pay through changes.

| Host | Key variable | Key prefix | Default model | Get a key |
| --- | --- | --- | --- | --- |
| TypeSafe (direct) | `TYPESAFE_API_KEY` | `ts_` | `jev-latest` | [console.typesafe.ai/keys](https://console.typesafe.ai/keys) |
| OpenRouter | `OPENROUTER_API_KEY` | `sk-or-` | `jev-latest` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `vck_` | `typesafe-ai/jev` | [AI Gateway API keys](https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys) |

How the host is chosen:

- The key's prefix decides, whichever variable holds it: `TYPESAFE_API_KEY=sk-or-...` goes to
  OpenRouter.
- When several keys are set, the first row in the table wins. `doctor` says which one is in use.
- `JEV_CODE_PROVIDER=openrouter` (or `typesafe`, `vercel`) forces a host.
- A key is only ever sent to the host that issued it; a mismatch is refused before any request.
  The exact rules are in [SECURITY.md](SECURITY.md).

| Variable | Default | Purpose |
| --- | --- | --- |
| `JEV_CODE_PROVIDER` | auto | Force `typesafe`, `openrouter`, or `vercel`. |
| `TYPESAFE_BASE_URL` | per host | Point at a proxy or a compatible endpoint. TypeSafe keys only, unless `JEV_CODE_PROVIDER` is set. |
| `TYPESAFE_DEFAULT_MODEL` | per host | Pin a Jev version: `jev-1.13` on TypeSafe or OpenRouter; Vercel uses `typesafe-ai/jev`. |
| `JEV_CODE_TIMEOUT_MS` | `30000` | Per-attempt timeout. |
| `JEV_CODE_MAX_RETRIES` | `2` | Retries on 429, 5xx, timeouts, and connection errors. |

The `TYPESAFE_*` names match the official TypeSafe SDKs, so one export serves everything.

## Security notes

- Only the payload you pass to a tool leaves your machine, and only to the host your key
  belongs to. Nothing is read from your repository or session on its own.
- Keys are read from the environment, sent only to the host that issued them, and never
  logged. `setup` copies the key in use into harness configs so filtered environments still
  work; `--no-env` skips that.
- Existing config files are backed up before `setup` modifies them.

Hosts, the proxy rule, what `setup` executes, and how to report a vulnerability:
[SECURITY.md](SECURITY.md).

## How it works

`src/tools/` holds the single definition of each tool: a zod schema, a description, and a `run`
function that builds one System One request and maps the answers to decisions. The MCP server
(`src/mcp/`), the Pi extension (`integrations/pi/`), the OpenCode custom tool
(`integrations/opencode/`), and the CLI (`src/cli/`) are thin adapters over that layer, which is
why the payloads and results are identical everywhere. `src/core/providers.ts` is the table of
hosts that serve Jev; adding one that speaks the System One API is a row there. `src/setup/` knows
where each harness reads skills and MCP configuration and prefers each harness's own CLI over
editing files.

## Development

```bash
git clone https://github.com/FrancoisChastel/jev-code && cd jev-code
npm install
npm run check          # lint, typecheck, skill validation, tests with coverage, build, smoke
npm test               # unit tests, no API key needed
TYPESAFE_API_KEY=... npm run test:e2e   # a few live calls; any provider key works
```

Try your local build against a real harness without publishing:

```bash
npm run build
node dist/cli.js setup claude --command "node $PWD/dist/cli.js mcp"
node dist/cli.js setup pi --pi-source "$PWD"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the release process.

## Related

- [typesafe-ai/skills](https://github.com/typesafe-ai/skills): TypeSafe's own skill for *building* products on Jev. jev-code is about using Jev *inside* the coding agent; its [building-with-typesafe reference](skills/jev/references/building-with-typesafe.md) adapts the official skill's guidance (MIT, TypeSafe AI) for that case.
- [jkudish/jev-mcp](https://github.com/jkudish/jev-mcp) and [itsmostafa/typesafe-mcp](https://github.com/itsmostafa/typesafe-mcp): other MCP servers for Jev, with different tool sets.
- [TypeSafe docs](https://docs.typesafe.ai) and the [llms.txt index](https://docs.typesafe.ai/llms.txt).
- Jev on [OpenRouter](https://openrouter.ai/docs/guides/community/typesafe-sdk) and
  [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe), the hosts jev-code
  supports besides TypeSafe. [Cloudflare Workers AI](https://developers.cloudflare.com/ai/models/typesafe/jev/)
  also serves Jev but with a different request envelope; it is not supported yet.

## License

[MIT](LICENSE) © François Chastel. `skills/jev/references/building-with-typesafe.md` adapts the
[TypeSafe agent skill](https://github.com/typesafe-ai/skills), © 2026 TypeSafe AI, MIT. Jev and
TypeSafe are trademarks of TypeSafe AI; this project is not affiliated with TypeSafe.
