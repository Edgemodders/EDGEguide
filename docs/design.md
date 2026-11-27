---
title: Design
---

# EDGEguide design

**Status: draft 0.3. G0 decided by the owner on 2026-11-25 ([G0 decisions](#g0-decisions)); G1, the skeleton, built on 2026-11-26 ([G1 as built](#g1-as-built)), its hand test partly run on 2026-11-27 (a Deploy that completes is left). No release.** Created on 2026-10-26 from the EDGEkit session, after EDGEchat asked for it in [EDGEkit#6](https://github.com/Edgemodders/EDGEkit/issues/6) and the user decided it is an extension of its own, named EDGEguide.

## What EDGEguide is

An editor extension that lets Claude Code **show** a modder how the EDGE tools work, in the editor itself. Claude opens the right view, selects the item, points at the button with a short note, and runs the tool's own command while the modder watches.

Example: "show me how to put my project into the game". Claude opens REDcode's Project view and points at **Pack and Install** ("this packs your project and installs it"), then runs it after the modder agrees. Next it opens EDGEdeck with the new mod selected and points at **Deploy**.

Today Claude does the work through the EDGE MCP servers (`redcode`, `edgedeck`, `edgemat`, `rednode`), and the modder sees only the result. They never learn where the buttons are.

| | |
|---|---|
| **Is** | A small extension with a local MCP server for the editor's UI. It works in EDGEkit and in VS Code. It is in the EDGEkit extension pack and built into EDGEkit |
| **Is not** | A second way to do the work. The EDGE servers stay the way Claude reads and changes things; EDGEguide only opens, selects, points and runs the tools' own commands. Not a VS Code agent tool (`vscode.lm`): Claude Code does not use those (below) |

## Facts the design rests on

| Fact | Source | What it means here |
|---|---|---|
| Claude Code's VS Code extension gives the model two editor tools only, `getDiagnostics` and `executeCode` (Jupyter cells). Its MCP servers come from its own configuration (`/mcp`, `claude mcp add`, plugins). Nothing reaches tools that extensions register for VS Code's own AI features | [Claude Code in VS Code](https://code.claude.com/docs/en/vs-code), "The built-in IDE MCP server", read 2026-10-26 (EDGEkit#6) | EDGEguide has to be an MCP server Claude Code connects to, added by the EDGEchat plugin |
| Claude Code signs in to a plugin's HTTP server with OAuth | EDGEchat's [tests](https://edgemodders.github.io/EDGEchat/testing.html), "OAuth sign-in for a plugin server" | The sign-in can work as REDnode's does |
| REDnode's server: Streamable HTTP on `127.0.0.1:41820`, OAuth 2.1 with dynamic client registration and PKCE S256, `Host` must name the server, a browser's `Origin` must be the server itself, one sign-in request at a time | [REDnode MCP docs](https://edgemodders.github.io/REDnode/mcp.html), REDnode 0.40.1 | The pattern to copy, with the approval in an editor notification instead of the game. Not port 41820 |
| Every view has a built-in `<view id>.focus` command (`edgedeck.mods.focus`, `redcode.project.focus`); `vscode.open` opens a file | VS Code API at 1.140.0, read in upstream's source 2026-10-26 | `ui_open` works from any extension |
| A tree view's `reveal` is on the `TreeView` its owner created; no command selects an item in another extension's view | VS Code API | `ui_select` needs a small command in each EDGE extension (the contract, below) |
| What is visible and selected inside a view only its owner knows; open editors and tabs are public (`window.tabGroups`) | VS Code API | `ui_state` is partly EDGEguide's own, partly the contract |
| No extension API points at another extension's button. A webview's owner can mark anything inside it | VS Code API | Hints: a notification everywhere; inside a webview through its owner; in EDGEkit, an outline on any toolbar button from EDGEkit's own code |
| `executeCommand` runs any registered command | VS Code API | `ui_run` keeps to an allow-list |
| Each editor window has its own extension host | VS Code | Only one window can listen on the port ([G0 decisions](#g0-decisions)) |

## The tools

| Tool | Does | Asks first |
|---|---|---|
| `ui_open` | Opens a view or page: EDGEdeck's Mods view or page, REDcode's Project view, Game Assets filtered to a path, the TweakDB view on a record, EDGEmat's Find on an item, a file | No |
| `ui_select` | Reveals and selects an item in a view: a mod, a project file, an asset, a record | No |
| `ui_hint` | Shows a short note at a button or menu item, such as "This is **Deploy**: it puts your changes into the game" | No |
| `ui_run` | Runs one of the EDGE extensions' own commands, from their allow-lists | Yes, for every command that changes files or the game folder: `_meta["anthropic/requiresUserInteraction"]: true`, as REDnode and edgedeck-mcp do |
| `ui_state` | What is open and selected, so Claude knows where the modder is | No |

`ui_run` never takes an arbitrary VS Code command.

## The contract with the EDGE extensions

Decided in G0 (2026-11-25): a key in each extension's `package.json`. Each EDGE extension declares what EDGEguide may do, in its own `package.json`, so that it stays the owner of its views and commands:

```json
"edgeguide": {
  "views": ["edgedeck.mods"],
  "reveal": "edgedeck.edgeguide.reveal",
  "state": "edgedeck.edgeguide.state",
  "commands": {
    "edgedeck.deploy": { "changes": true, "hint": "Puts your changes into the game" },
    "edgedeck.openPage": { "changes": false }
  }
}
```

| Part | Meaning |
|---|---|
| `views` | The views EDGEguide may open |
| `reveal` | A command taking `{ view, id }` that reveals and selects an item; returns whether it found it |
| `state` | A command returning what its views show and what is selected |
| `commands` | The allow-list for `ui_run`. `changes: true` makes the tool ask first |

EDGEguide reads it from `vscode.extensions.all`, which lists every installed extension's `package.json` without starting it. An extension without it gets only `ui_open` on its views. The asks go to REDcode, EDGEdeck, EDGEmat and EDGEwave in G2, with the key's final shape from G1.

## Phases

Phases are G0 to G4, so they do not clash with the other repos' phases.

| Phase | Builds | The test proves |
|---|---|---|
| **G0 Decide** | The questions below answered (done 2026-11-25) | - |
| **G1 Skeleton** | The extension, the MCP server and its sign-in, `ui_open`, `ui_run` with the allow-list, `ui_state` from public state. Built 2026-11-26 ([G1 as built](#g1-as-built)) | Claude Code, signed in, opens EDGEdeck's Mods view and runs Deploy after asking |
| **G2 Select** | The contract in the EDGE extensions; `ui_select` and the full `ui_state` | "Show me my mod" selects it in EDGEdeck |
| **G3 Hints** | `ui_hint`: notifications, webview owners, and EDGEkit's toolbar outline | The Pack and Install walk-through, in EDGEkit and in VS Code |
| **G4 Ship** | Published on Open VSX and the Marketplace, in the pack, built into EDGEkit; EDGEchat adds the server and `/edge:setup` checks it | A fresh EDGEkit install, with EDGEchat set up, shows the walk-through |

## G0 decisions

Proposed on 2026-10-26, with EDGEchat's view from the plugin's side; **decided by the owner on 2026-11-25** in the EDGEchat session (EDGEguide has no session of its own yet), as proposed but for the port: 41821 has been REDnode's since 0.57.1 (2026-11-04), for a host run from its repo or by a test (REDnode's `docs/mcp.md`), so EDGEguide takes **41822**, unused in the EDGE repos (checked 2026-11-25).

| Question | Decided | Why |
|---|---|---|
| The port | **41822**, fixed, beside REDnode's 41820 (the game's) and 41821 (REDnode run from its repo or by a test, since 0.57.1). 41821 was proposed on 2026-10-26, before REDnode took it | EDGEchat's plugin entry is then the URL alone, like `rednode`'s: `{ "type": "http", "url": "http://127.0.0.1:41822/mcp" }`. EDGEchat adds it in G4 |
| Sign-in | **OAuth as REDnode 0.40.1**, with the approval in an editor notification. No token option | EDGEchat dropped REDnode's token option in plugin 0.0.13 because copying tokens was the pain; Claude Code's OAuth for a plugin HTTP server is tested |
| Which window | **The focused window, else the last focused one** | Every Claude Code session on the PC connects to the same URL (each window's Claude panel, EDGEkit's, a terminal `claude`), so the connection cannot name a window. A header naming the window (`${VAR}` in an HTTP server's headers) is an unverified idea, and Claude Code has no per-window variable, so not relied on |
| Several windows, one port | The first window to start listens; the others connect to it over a local channel and report focus (`window.state.focused`). The listening window passes each call to the window chosen above | Each window has its own extension host and only one can listen |
| The listening window closes | The others try to listen in turn; one takes over. Claude Code reconnects from `/mcp` without a restart | EDGEchat's ask |
| No editor window open | No extension host runs, so nothing listens: the connection is refused. `/edge:setup` reports that as "no editor open", not as a failure | The server cannot answer when no window runs it; EDGEchat asked for a plain answer |
| `ui_run`'s asking | **`requiresUserInteraction` on every command that changes things**, always. An editor notification may come on top, never instead | The rule REDnode and edgedeck-mcp follow, and the one EDGEchat's safety text relies on |
| The contract | **The `package.json` key above**, not each extension registering itself through an API | EDGEguide can read every installed extension's `package.json` without starting it; registering through an API needs each extension already running. The EDGE extensions' sessions still shape the key's fields in G2 |
| Where hints draw in EDGEkit | **A command in EDGEkit's app, `edgekit.pointAt`**, which EDGEguide calls when it exists, and a notification otherwise | EDGEkit's side: asked of EDGEkit in G3 |

## G1 as built

Built on 2026-11-26 in the EDGEkit session (the owner asked to start building), version 0.0.1, not published. 11 tests pass (`npm test`): the Host and Origin guards, the whole OAuth sign-in as Claude Code does it (register, authorize, the modder's answer, token, refresh used once, denial, sign-out), the three tools through the MCP SDK's own client, and a second window taking the port over when the first closes. The hand test in the editor (the G1 row above) ran on 2026-11-27, all but a completed Deploy (below).

| Part | File | As built |
|---|---|---|
| The server | `src/server.ts` | Streamable HTTP on `127.0.0.1:41822/mcp`, stateless, as REDnode's. Every request's `Host` must name it and a browser's `Origin` must be it. The first window to start listens; the others try again every 10 s and take over when it closes |
| The sign-in | `src/oauth.ts` | REDnode's `oauth.js` (0.40.1) ported, with a modal editor notification: "*client* asks to use EDGEguide ... Allow only if your browser shows the code *ABC-1234*", Allow or Deny. Kept hashed in `%APPDATA%\Edgemodders\EDGEguide\sign-ins.json`, one file for every editor on the PC, so a sign-in made with EDGEkit's window works when VS Code's answers |
| The tools | `src/tools.ts` | `ui_state`, `ui_open`, `ui_run`, with instructions for the assistant |
| The contract | `src/contract.ts` | Read from every installed extension's `package.json` (the `edgeguide` key), else EDGEguide's starting contract for EDGEdeck, REDcode and EDGEwave (`Defaults`) |
| The editor side | `src/extension.ts` | Views through `<view>.focus`, files through `vscode.open` or at a line, commands through `executeCommand` with no argument (answering after 20 s if the command still runs, such as one waiting for the modder's input). A status bar item, **EDGEguide: Show Status**, **Sign Out an Assistant...** and **Show Log** |

Settled while building:

| Question | As built | Why |
|---|---|---|
| Asking for each command that changes things | **`ui_run` asks for every command**; commands with `changes: false` go through `ui_open`, which does not ask | `requiresUserInteraction` is a tool's `_meta`, the same for every call, so one tool cannot ask for some commands and not others. Two tools keep the rule: nothing that changes things runs without asking |
| An extension listing commands that are not its own | **Dropped.** A contract keeps only the views and commands its extension contributes in its own `package.json`; `ui_state` names what was dropped | Any installed extension can write an `edgeguide` key, so without this one could put a VS Code command such as the terminal's on the allow-list |
| A command entry with no `changes` | **Counts as a change** | A mistake then asks rather than not |
| The EDGE extensions before G2 | **A starting contract inside EDGEguide**, replaced whole by an extension's own key | G1's test needs EDGEdeck's Deploy on the allow-list, and EDGEguide does not change the other repos. Only commands that work with no argument: a tree item's commands take the item, so they wait for G2's `reveal` |
| Which window answers | **The window that listens, for now.** Calls going to the focused window, through a local channel from the other windows ([G0 decisions](#g0-decisions)), are still to build, before G4 | One window is enough for G1's test |

The G1 hand test: install `edgeguide-0.0.1.vsix` (`npm run package`) in EDGEkit or VS Code; `claude mcp add --transport http --scope user edgeguide http://127.0.0.1:41822/mcp`; in Claude Code, `/mcp`, **edgeguide**, **Authenticate**, compare the codes and **Allow**; ask Claude to show EDGEdeck's mods, then to deploy: Claude Code asks before `ui_run`, and EDGEdeck deploys.

**Run on 2026-11-27, partly** (by script in EDGEweb's session, at the owner's go; EDGEkit 1.143.2 on a scratch profile, EDGEdeck 0.34.2 with a scratch library and a fake game folder, Claude Code 2.1.332, `--scope local`):

| Step | Seen |
|---|---|
| The status bar | "EDGEguide" with the compass; "this window answers" |
| Sign-in | `/mcp` needed sign-in; the browser and the editor's modal showed the same code; Allow; "Signed in and connected to edgeguide" |
| Show EDGEdeck's mods | `ui_state`, then `ui_open` with `edgedeck.mods`: the Mods view opened. Claude Code asked before both, because it ran in its manual permission mode, which asks before an MCP tool's first call whatever the tool says. EDGEguide asks for neither. Not tried in auto mode |
| Deploy | Claude Code asked before `ui_run` (`edgedeck.deploy`), with only Yes and No. No: nothing ran. Yes: EDGEdeck's Deploy started and stopped at its own question, because the game was running ("Quit the game first"); Cancel. After 20 s Claude said the deploy had not finished and might be waiting on the modder, as built |
| Sign-out | **Sign Out an Assistant...** listed Claude Code and signed it out. Its registration stays in `sign-ins.json` with no tokens, as built (it signs in with the same id again), and the list no longer shows it |

Left: one Deploy that completes, with the game closed. Found: Claude Code with EDGEchat also has the `edgedeck` server's `edgedeck_deploy`, so a plain "deploy" may go there rather than through `ui_run`; the test named EDGEguide in each ask. Which one Claude picks (EDGEguide when the modder wants to watch it in the editor) is for G2, with EDGEchat.
