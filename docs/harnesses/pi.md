# Pi

Pi has no MCP client. jev-code is therefore also a [pi package](https://pi.dev/docs/latest/packages):
its `package.json` points pi at `integrations/pi/`, whose extension registers `jev_classify`,
`jev_check`, `jev_score`, `jev_rank`, and `jev_ask` as native tools. The extension imports the
package's own build, so the tool contract is shared with the MCP server and the CLI.

## Automatic

```bash
npx -y @francoischastel/jev-code setup pi            # pi install npm:@francoischastel/jev-code
npx -y @francoischastel/jev-code setup pi --project  # pi install -l ...
```

The skill is copied to `~/.agents/skills/jev/` (or `.agents/skills/jev/`), which pi reads. Run
`/reload` inside pi, or restart it.

## Manual

```bash
pi install npm:@francoischastel/jev-code
npx skills add FrancoisChastel/jev-code --skill jev -a pi
```

To try a local checkout: `npm run build`, then `pi install /absolute/path/to/jev-code` or, for a
single run, `pi -e /absolute/path/to/jev-code/integrations/pi/jev.ts`.

The extension reads `TYPESAFE_API_KEY` from the shell pi runs in; nothing is written into pi's
settings.

## Verify

```bash
pi list
jev-code doctor
```

Inside pi, the tools appear in the `Available tools` section of the system prompt and
`/skill:jev` loads the skill.
