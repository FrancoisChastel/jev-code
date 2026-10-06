# Pi

Pi has no MCP client. jev-code is therefore also a [pi package](https://pi.dev/docs/latest/packages):
its `package.json` points pi at `integrations/pi/`, whose extension registers `jev_classify`,
`jev_check`, `jev_score`, `jev_rank`, and `jev_ask` as native tools. The extension imports the
package's own build, so the tool contract is shared with the MCP server and the CLI.

## Automatic

```bash
npx -y @french-castle/jev-code@latest setup pi            # pi install npm:@french-castle/jev-code
npx -y @french-castle/jev-code@latest setup pi --project  # pi install -l --approve ...
```

The skill is copied to `~/.agents/skills/jev/` (or `.agents/skills/jev/`), which pi reads. Run
`/reload` inside pi, or restart it.

## Manual

```bash
pi install npm:@french-castle/jev-code
npx skills add FrancoisChastel/jev-code --skill jev -a pi
```

To try a local checkout: `npm run build`, then `pi install /absolute/path/to/jev-code` or, for a
single run, `pi -e /absolute/path/to/jev-code/integrations/pi/jev.ts`. Project scope
(`pi install -l`) needs `--approve`, because pi only edits `.pi/settings.json` for a trusted
project; `setup --project` passes it.

The extension reads the API key (`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or
`AI_GATEWAY_API_KEY`; OpenAI's Decisions API with `OPENAI_API_KEY` plus `JEV_CODE_PROVIDER=openai`;
a local Ollama with just `JEV_CODE_PROVIDER=ollama`) from the shell pi runs in; nothing is written
into pi's settings.

## Verify

```bash
pi list
jev-code doctor
```

Inside pi, the tools appear in the `Available tools` section of the system prompt and
`/skill:jev` loads the skill.

## Custom provider

```bash
npx -y @french-castle/jev-code@latest setup pi --provider custom
```

Enter a display name, HTTP(S) API base URL without `/v1/systemone`, manual provider model ID,
and hidden key. The gateway must implement the existing System One protocol. Alternatively,
export `JEV_CODE_PROVIDER=custom`, `JEV_CODE_PROVIDER_NAME`, `JEV_CODE_BASE_URL`,
`JEV_CODE_API_KEY`, and `JEV_CODE_MODEL` before setup. Custom retries default to zero; optional
`JEV_CODE_MAX_RETRIES` and `JEV_CODE_TIMEOUT_MS` overrides follow the selected configuration.

Pi reads these settings from its launching shell; setup does not store them in Pi settings.
Export the same variables before starting Pi, then restart or `/reload`. The direct CLI also
uses the shell. `--no-env` continues to omit keys from harness server environments; it does not
change Pi's shell-based configuration.

Use `--no-prompt` for complete environment-based setup. Incomplete custom settings prevent
registration, and `--dry-run` never prompts or writes. Restart the agent after setup and run
`jev-code doctor` to inspect configuration offline. See [custom-provider setup](../../README.md#custom-system-one-providers)
for URL examples and provider-specific key-variable mapping.
