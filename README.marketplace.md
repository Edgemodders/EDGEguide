# EDGEguide

**A preview, not published yet.** EDGEguide lets Claude Code show you the EDGE tools for Cyberpunk 2077 modding in your editor, EDGEkit or VS Code: it opens the right view or file, and runs the EDGE extensions' own commands (such as EDGEdeck's **Deploy** or REDcode's **Pack and Install**) while you watch, so you learn where things are.

## Connect Claude Code

EDGEguide runs a local MCP server in your editor at `http://127.0.0.1:41822/mcp`. Add it to Claude Code:

```
claude mcp add --transport http edgeguide http://127.0.0.1:41822/mcp
```

Then in Claude Code run `/mcp`, choose **edgeguide** and **Authenticate**. Your browser shows a code; the editor shows the same code with **Allow** and **Deny**. Allow it only when the codes match.

## What it can do

| Tool | Does | Asks you first |
|---|---|---|
| `ui_state` | Says what is open, and which views and commands of the EDGE tools it can use | No |
| `ui_open` | Shows a view (EDGEdeck's mods, REDcode's project, TweakDB ...), opens a file at a line, or runs a command that changes nothing | No |
| `ui_run` | Runs an EDGE command that may change files or the game folder | Yes, every time |

It runs only the EDGE extensions' own commands that they (or EDGEguide, until they do) list for it, never any other command. It listens only on this PC (`127.0.0.1`) and needs the sign-in you allow.

**EDGEguide: Show Status** says which window answers and who is signed in; **EDGEguide: Sign Out an Assistant...** ends a sign-in.

[Docs](https://edgemodders.github.io/EDGEguide/) · [Source](https://github.com/Edgemodders/EDGEguide) · MIT
