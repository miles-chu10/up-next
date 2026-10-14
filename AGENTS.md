# AGENTS.md

Up Next is a Claude Code mod (a function-hooks plugin). The plugin folder is this repo's root, and it is what the Claude plugin directory installs.

## Layout

- `.claude-plugin/plugin.json`: manifest and settings. `hooks/hooks.json` names the one module.
- `hooks/register.tsx`: hooks and the card. Any function that is passed `$` must be declared at the top level of the file (the validator cannot follow nested ones).
- `hooks/advice.ts`: the advisor prompt, reply parsing, the risk filter and text cleaning. Plain functions.
- `hooks/facts.ts`: what the turn's tool calls did, for grounding.
- `tests/`: run with `claude plugin test .`

## Checks

```bash
claude plugin validate .
claude plugin test .
```

Type-check with `tsc -p .` once the engine has laid `.claude-plugin/types/` (it does when it loads the mod from this folder). `tsconfig.json` only extends that folder's config.

## Rules

- Nothing is sent to the model or the prompt unless the person presses Run or Enter. Do not add automatic submission.
- No network calls, no files written, nothing stored across sessions. If that changes, update the README's "What it reads, runs and sends" in the same commit.
- Keep the README accurate: the directory shows it as the listing, and it is checked against what the code does.
- Raise `version` in `plugin.json` with every release.
