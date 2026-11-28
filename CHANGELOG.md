# Changelog

## Unreleased

**G1, the skeleton** (0.0.1, not published). An MCP server in the editor on `http://127.0.0.1:41822/mcp` that Claude Code signs in to: your browser shows a code and the editor asks you to Allow or Deny. Three tools: `ui_state` (what is open, and what EDGEguide can open and run), `ui_open` (a view, a file at a line, or a command that changes nothing) and `ui_run` (an EDGE command that may change files or the game folder; Claude Code asks you before every one). It runs only the EDGE extensions' own commands, starting with EDGEdeck's, REDcode's and EDGEwave's. **EDGEguide: Show Status** and **Sign Out an Assistant...** in the Command Palette.

**Tours** (0.0.2, not published). When you ask Claude how to do something in the EDGE tools, it can show you the steps in the editor instead of a long answer: the **EDGEguide: Steps** panel shows one short note at a time with **Back**, **Next** and **Close**, and each step opens the view or file it is about. A step can name the button to press and where it is, such as "the rocket button at the top of the Mods view"; a tour never presses a button for you. In a file, the note also shows at its line.

**Past tours** (0.0.3, not published). When no tour is showing, the Steps panel lists your last 10 tours, numbered, newest first, each with a **Replay** button that shows it again from the first step. The list stays after a restart. Each tour is named by the question you asked, or a short summary of it (0.0.4), and has a **Delete** button that takes it off the list (0.0.5).

**Press it here** (0.0.6, not published). A step about a button or menu item, such as **Save as new loadout...** in the Mods view's ... menu, shows a copy of it in the Steps panel. Pressing it does what choosing it there does; for one that changes something, such as **Deploy**, the editor asks you first and it runs only after OK. A tour can now point at every button and menu item in the EDGE tools' views, not just a few of EDGEdeck's.

