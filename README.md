# iTarek Claude Mods

Small mods for [Claude Code](https://claude.com/claude-code). Each mod lives in its own folder, and you install only the ones you want.

An independent project, not made by or affiliated with Anthropic.

| Mod | What it does |
|---|---|
| [prompt-history](#prompt-history) | A side panel of your session's prompts: what you asked, what Claude did, how long it took and when it finished |
| [recap-card](#recap-card) | Ends Claude's messages with a rounded gradient card: Recap, Attention and Next |
| [todo](#todo) | A side panel of your project's `ToDo.md`: each item in its own box, with a button that sets the prompt to work on it |

## Install

These examples install `prompt-history`. For another mod, use its name instead.

At the prompt of a terminal session:

```
/plugin install prompt-history --marketplace iTarek/iTarek-Claude-Mods
```

Answer `y` to add the marketplace, then press Enter to install it for all your sessions.

From a shell:

```bash
claude plugin install prompt-history --marketplace iTarek/iTarek-Claude-Mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `iTarek/iTarek-Claude-Mods`, then **Add plugin**.

To remove it:

```bash
claude plugin uninstall prompt-history@iTarek-Claude-Mods
```

## prompt-history

Every prompt you send becomes a card, newest first:

```
╭───────────────────────────────────╮
│ You asked                         │
│ Add a search icon to the notes app│
│                                   │
│ Done                              │
│ Added a search icon to the tab    │
│ bar that opens the finder.        │
│                                   │
│ ⏱ 4m 12s  ·  Nov 1, 3:42 PM       │
╰───────────────────────────────────╯
```

- **Summaries:** a card shows a short summary of your prompt and of what Claude did.
- **Status:** a card says Working…, Done, Stopped or Failed.
- **Slash commands:** a command like `/review` shows exactly as you typed it, on a light blue card.
- **Background work:** when a background task finishes the job, the same card updates with the final result.
- **Clear:** the **Clear** button empties the finished cards, after asking first.

The panel opens by itself. If you close it, it stays closed for that session until you type `/prompt-history`.

### What it sends and stores

- **One small model call per prompt:** when a prompt finishes, the mod asks Claude Haiku to write the card's summary. The call uses your own Claude Code account, so it counts toward your usage.
- **What that call contains:** your prompt (up to 2,000 characters) and Claude's replies (the last 6,000 characters).
- **No other service:** the mod contacts nothing else.
- **Where cards live:** with the session, up to 100 per session. Other sessions don't see them.
- **One local command:** the mod runs `date +%z` to show times in your time zone.

### Requirements

Built and tested on Claude Code 2.1.309, on a Mac. Older versions may not support mods.

## recap-card

Claude ends its messages with a card, so you never lose track:

- **Recap:** up to 3 lines on what was done or found.
- **Attention:** only for something important, like a failure or a risk to your work. It stands out on its own colored panel, and most messages don't have it.
- **Next:** up to 3 lines on the most useful next move.

Some things to know:

- **How it works:** the mod sends Claude a short instruction with each prompt, asking it to end its message with a short quote of titles and bullets. It then draws that quote as the card.
- **No extra calls:** Claude writes the recap as part of its own message, and the mod contacts no other service.
- **Drawn as an image:** on the desktop app the card is a picture that fills the chat's width, so its text can't be selected. Terminals and VS Code draw a rounded box with the same titles in real text.
- **On the iOS app:** there is no card. The recap shows as a quote with a bar on its left, with the text wrapped.
- **If you remove the mod:** recaps in older messages stay as plain text.

Built and tested on Claude Code 2.1.309, on a Mac.

## todo

Shows your project's `ToDo.md` in a side panel, each item in its own box:

```
╭─────────────────────────────────────────────────────────╮
│ ○ Add a search icon                                     │
│   It opens the finder.                                  │
│                                                         │
│ [ Let's work on this ] [ Explain this ] [ Remove this ] │
╰─────────────────────────────────────────────────────────╯
```

- **Done or not:** an open item has an empty circle, and a done one a circle with a check mark.
- **Let's work on this:** puts the item in your prompt box, after anything you've already typed. Press Enter to send it. Done items don't have this button.
- **Explain this:** works the same way, with a prompt asking Claude to explain the item in plain words without changing anything.
- **Remove this:** also works the same way, with a prompt asking Claude to remove the item from the file. Nothing changes until you press Enter.
- **No file yet:** the panel says so, with a button that asks Claude to create one right away.
- **Which file:** `ToDo.md` in the session's folder, with any capitals (`TODO.md`, `todo.md`).
- **What counts as an item:** a top-level `- [ ]` or `- [x]` checkbox. A file with no checkboxes lists its top-level bullets. Indented checkboxes show as steps inside their item's box.
- **Stays up to date:** it checks the folder every 3 seconds and reads the file only when it changed.
- **Closing it:** it stays closed for that session until you type `/todo`.

The mod makes no model calls of its own. Only the create button sends Claude a prompt, as part of your session.

Built and tested on Claude Code 2.1.309, on a Mac.

## Developing

```bash
claude plugin validate .
claude plugin test prompt-history
```

To add a mod, give it its own folder here and list it in `.claude-plugin/marketplace.json`.

## License

[MIT](LICENSE)
