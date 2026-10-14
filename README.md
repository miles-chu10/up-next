# Up Next

After every Claude Code turn, **Up Next recommends the one step worth taking next**: checked against what the turn actually did, never risky, and sent in one click.

It is advice, not a guess at what you will type.

- **Verify first.** If Claude edited files and no passing test, type check or build has run since, the first step is to check them. Up Next sees this from the tool calls themselves, not from Claude's own summary.
- **Safe by construction.** Steps that push, deploy, publish, merge, delete, send or spend are dropped, and it never widens the task you set. You decide those.
- **One step, ready to send.** One recommendation, never a menu. It is written to be sent exactly as it stands (a step with a placeholder like `[paste]` is dropped), and it is always something Claude can do: when the best next move is yours alone, such as trying the result yourself or making a decision, Up Next stays quiet.
- **One click.** On the desktop app, Run sends the step as your own message (or runs it, if it is a skill or slash command). Edit opens it for changes first.

```
 VERIFY  run the tests you just wrote
 the change is unverified
 [Run] [Edit] [Dismiss]
```

## Using it

| Where | What you get |
| --- | --- |
| Desktop app (Code tab) | The card above, in the band above the message box, and the step as dim ghost text in the message box. Edit puts the step in a field in the card for changes (the app doesn't let mods write into its message box). |
| Terminal | The top step as dim ghost text in the message box (Tab takes it, then Enter sends) and its reason in the status line. Set `row` to `always` to get the card here too. |
| VS Code chat panel, `claude -p`, the Agent SDK | Mods draw nothing here, so Up Next does not work out advice after a turn (nobody could see it). `/next` works it out on demand and replies with the steps as text; send the one you want yourself. |
| Anywhere it draws | `/next` shows the card in the transcript, or works out advice on demand if there is none. |

The step is tagged **VERIFY**, **UNBLOCK**, **ADVANCE** or **SKILL** (a slash command from your session). A step you dismiss is not suggested again this session.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `minAnswerChars` | 80 | Skip advice after answers shorter than this. |
| `showReason` | on | Show why the step is worth doing, under the step and in the status line. |
| `groundAdvice` | on | Note which files were edited and which checks ran or failed this turn, and tell the advisor. |
| `suggestSkills` | on | Tell the advisor which skills and slash commands the session has. A step naming one the session lacks is dropped. |
| `row` | auto | `auto` draws the card where ghost text cannot show (the desktop app), `always` also in the terminal, `off` never. `/next` works either way. |

## What it reads, runs and sends

- **Reads:** the answer that just ended, and, while a turn runs, the inputs of Edit, Write, NotebookEdit and Bash calls and whether they failed (file paths and shell commands, kept in memory for that turn only). It also reads the session's list of slash commands and skills and which surfaces are attached.
- **Sends:** one request to the session's own model after each qualifying turn in a terminal or desktop session, or when you run `/next`, through Claude Code's cache-sharing fork, so it costs about one short reply. That request continues your session, so the model sees the conversation it already has, plus the advisor instructions, the observed facts and the skills list. Nothing goes anywhere else: no network calls, no files written, nothing stored between sessions.
- **Acts:** only when you press Run (or press Enter in the editor). It never submits on its own.

## Install

```text
/plugin install up-next --marketplace miles-chu10/up-next
```

Answer `y` to add the marketplace, then pick a scope. From a shell, `claude plugin install up-next --marketplace miles-chu10/up-next` does the same (Claude Code 2.1.292 or later). In the desktop app's Code tab, install it from a terminal like that, or add the marketplace and then use **+ > Plugins > Add plugin**. A user-scope install is shared by the terminal, the desktop app and VS Code on the same computer. If a session is already open, run `/reload-plugins`.

Or try it from a clone:

```bash
claude --plugin-dir ./up-next
```

Once it is listed in the community directory:

```bash
claude plugin marketplace add anthropics/claude-plugins-community
claude plugin install up-next@claude-community
```

## Compatibility

Claude Code only: the terminal and the desktop app's Code tab. It does nothing in claude.ai chat or Cowork. Requires Claude Code 2.1.287 or later, and was tested with 2.1.299; the mods API can change between releases.

Up Next replaces the built-in prompt suggestions (they are dropped where they pass through the plugin), so turn the desktop app's own Prompt suggestions off if both still appear. Do not run it beside another next-prompt suggester such as `next-steps`: each would draw its own suggestions and spend its own model call.

## Credits

The idea of giving the advisor your session's skills, and the approach to cleaning model output before it reaches the screen, follow Anthropic's [next-steps](https://github.com/anthropics/claude-plugins-community/tree/main/next-steps) plugin (MIT, by Thariq Shihipar). Up Next's code is its own.

## License

MIT. See [LICENSE](LICENSE).
