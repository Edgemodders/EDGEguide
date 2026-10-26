---
title: Design
---

# EDGEguide design

**Status: draft 0.1, G0 (decide). Nothing is built.** Created on 2026-10-26 from the EDGEkit session, after EDGEchat asked for it in [EDGEkit#6](https://github.com/Edgemodders/EDGEkit/issues/6) and the user decided it is an extension of its own, named EDGEguide.

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
| Each editor window has its own extension host | VS Code | Only one window can listen on the port (G0 question) |

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

Proposed, for G0. Each EDGE extension declares what EDGEguide may do, in its own `package.json`, so that it stays the owner of its views and commands:

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

EDGEguide reads it from `vscode.extensions.all`. An extension without it gets only `ui_open` on its views. Asks go to REDcode, EDGEdeck, EDGEmat and EDGEwave once the contract is settled.

## Phases

Phases are G0 to G4, so they do not clash with the other repos' phases.

| Phase | Builds | The test proves |
|---|---|---|
| **G0 Decide** | The questions below answered | - |
| **G1 Skeleton** | The extension, the MCP server and its sign-in, `ui_open`, `ui_run` with the allow-list, `ui_state` from public state | Claude Code, signed in, opens EDGEdeck's Mods view and runs Deploy after asking |
| **G2 Select** | The contract in the EDGE extensions; `ui_select` and the full `ui_state` | "Show me my mod" selects it in EDGEdeck |
| **G3 Hints** | `ui_hint`: notifications, webview owners, and EDGEkit's toolbar outline | The Pack and Install walk-through, in EDGEkit and in VS Code |
| **G4 Ship** | Published on Open VSX and the Marketplace, in the pack, built into EDGEkit; EDGEchat adds the server and `/edge:setup` checks it | A fresh EDGEkit install, with EDGEchat set up, shows the walk-through |

## G0 questions

| Question | Options |
|---|---|
| The port | A fixed port, not REDnode's 41820, so EDGEchat's plugin can name the URL |
| Several windows | Each window has its own extension host, and only one can listen. The first window owns the port and passes requests to the window the modder is in, or each window tries in turn and the focused one takes over. To test |
| Sign-in | OAuth as REDnode (approval in an editor notification), or a token the plugin asks for once |
| The contract | The `package.json` key above, or each extension registers itself at start through EDGEguide's exported API |
| `ui_run`'s asking | The client's prompt (`requiresUserInteraction`) only, or also a notification in the editor |
| Where hints draw in EDGEkit | A command in EDGEkit's app (`edgekit.pointAt`), which EDGEguide calls when it exists |
