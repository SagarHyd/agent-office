# agent-office

A Claude Code mod that shows who is working, live, right above the prompt, and
lets you switch between nine animated desktop themes without restarting.

- **Clawd and the workers.** Clawd (Claude), Codex and Antigravity are animated
  characters in a strip above the prompt. Each has clearly different looks for
  working, done, failed, idle and asleep; Clawd also thinks, orchestrates, cheers
  and worries. Under each: its model, a live timer, and the time and tokens of
  its last job.
- **Background work, at a glance.** Next to the characters, a list of everything
  still running in the background: worker jobs, background shell commands and
  subagents, each with a timer. What just finished stays for ten seconds with
  ✓, ✗ or ■ stopped.
- **Live themes.** Nine desktop themes, switched instantly with `/theme`: Akatsuki
  Night, Gotham Night, Interstellar, Matrix Mode, New Year Eve, Northern Lights,
  Rainy Cafe, Rainy Window and Stark Lab. Your choice is remembered.
- **`/office`** opens a larger pane with the scene, your Claude usage, and the
  last result of each worker.

This is an unofficial, personal project, not made or endorsed by Anthropic.

## Install

At the prompt of a terminal session:

```
/plugin install agent-office --marketplace SagarHyd/agent-office
```

From a shell:

```bash
claude plugin install agent-office --marketplace SagarHyd/agent-office
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box,
then Plugins, Add marketplace with `SagarHyd/agent-office`, then Add plugin.

## Themes

| Command | What it does |
|---|---|
| `/theme` | Opens a picker with a button for each theme |
| `/theme <name>` | Switches straight away, e.g. `/theme rainy` or `/theme matrix-mode` |
| `/theme none` | Back to the app's own look |

The themes draw in the Claude desktop and mobile apps. If you already have one of
these themes installed as its own plugin, turn that plugin off, so only one of
them sets the look.

## Codex and Antigravity

The characters react to the Codex CLI (`codex exec`) and the Antigravity CLI
(`agy -p`) when Claude runs them, in the foreground or in the background. For the
model, tokens and task of every run, start workers through the wrapper in
`tools/run-worker.ps1` (Windows PowerShell 5.1 or later), from your project folder:

```powershell
powershell -File tools\run-worker.ps1 -Worker codex -Task 'Write ... Save it to out\result.js'
powershell -File tools\run-worker.ps1 -Worker agy -Task 'Summarise ... Save it to out\notes.md' [-Model <model>]
```

It logs each run to `out\worker-status.json`, which the strip reads.

## Credits

Five themes and the shared theme engine are by Hamza Zafar (MIT), Rainy Window by
Ishu Agrawal (MIT), and the scene art of Rainy Cafe, Northern Lights and New Year
Eve by Melvin Dave Vivas (Apache 2.0). See [NOTICE](NOTICE) for details and
[LICENSES](LICENSES) for the license texts. The rest is MIT, see [LICENSE](LICENSE).
