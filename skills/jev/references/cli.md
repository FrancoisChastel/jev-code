# CLI fallback

When the `jev_*` tools are not registered in the current harness, the same operations are
available from bash. The CLI reads the API key from the environment (`TYPESAFE_API_KEY`,
`OPENROUTER_API_KEY`, or `AI_GATEWAY_API_KEY`; the variable decides the host).

```bash
jev-code doctor                       # is the key set, which harnesses are wired
jev-code classify --input payload.json
jev-code check    --json '{"state":"...","checks":{"ok":"..."}}'
cat payload.json | jev-code score     # stdin works when piped
jev-code rank --input candidates.json --pretty
jev-code ask --input questions.json
```

Without a global install, prefix with npx: `npx -y @french-castle/jev-code classify ...`.

Payload shapes are identical to the tools; see [tools.md](tools.md). Output is JSON on stdout
(compact when piped, pretty on a terminal or with `--pretty`). Errors go to stderr with exit
code 2 for input or configuration problems and 1 for API failures.

To wire the tools permanently, ask the user to run `jev-code setup` (or
`npx -y @french-castle/jev-code@latest setup`); it installs this skill and registers the tool in
every detected harness.

## Custom provider configuration

Use `jev-code setup --provider custom` in a terminal to enter a display name, API base URL,
manual provider model ID, and hidden key. Complete environment settings bypass prompts:

```bash
export JEV_CODE_PROVIDER=custom
export JEV_CODE_PROVIDER_NAME='My Gateway'
export JEV_CODE_BASE_URL='https://gateway.example/api'
export JEV_CODE_MODEL='vendor/model-id'
export JEV_CODE_API_KEY='<set locally>'
```

The gateway must speak System One. The base must be absolute HTTP(S), without the terminal
`/v1/systemone`, credentials, query, or fragment; the client appends that path, preserving
base prefixes. A model catalog page is not the API base. Use this tool's fixed key variable
regardless of the provider's own environment-variable name, and enter the model ID exactly.

Custom retries default to zero; `JEV_CODE_MAX_RETRIES` explicitly opts into retries.
`JEV_CODE_TIMEOUT_MS` retains the 30000 ms default. Ambient built-in keys are never borrowed;
legacy TypeSafe URL/model overrides are ignored with a note in custom mode.

`--no-prompt`/non-TTY require complete settings, `--dry-run` never prompts or writes,
`--no-tool` permits skill-only setup, and invalid/cancelled custom input does not register a
tool. Setup stores selected settings in supported harness environments; `--no-env` omits the
key. Pi and the CLI read the launching shell. `doctor` is offline; `doctor --live` makes an
explicit provider request. Never print or paste real credentials into chat.
