# EDGEguide: notes for Claude sessions

EDGEguide is an editor extension (`edgemodders.edgeguide`) with a local MCP server, so that Claude Code can show a modder the EDGE tools in the editor: open a view, select an item, point at a button, run the tool's own command. It works in EDGEkit and VS Code, and Claude Code reaches it through the EDGEchat plugin. Read [docs/design.md](docs/design.md) first.

## Status and next step

- Scaffold created 2026-10-26 from the EDGEkit session (asked by EDGEchat in EDGEkit#6; the user decided an extension of its own, named EDGEguide, and created the repo): README, license, docs site (HUD layout, design draft 0.1), Pages workflow, brand sources and images (`tools/brand/render.ps1`). No extension code yet.
- **Next: G0**, the questions at the end of the design (port, several windows, sign-in, the contract with the EDGE extensions). Then G1, the skeleton.

## Conventions

- Same as the sibling repos: commit straight to `main` in small commits and push; plain, short sentences; tables for facts; mark anything unverified.
- **Git identity:** per repo, `CyberbuildsAI` with the GitHub no-reply email (`340969962+CyberbuildsAI@users.noreply.github.com`), plus `credential.https://github.com.username CyberbuildsAI`. Push with `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never timeout 120 git push`. Never change the global identity.
- **Do not change the other EDGE repos from here.** Needs go to their sessions (through the user) or as issues: the contract to REDcode, EDGEdeck, EDGEmat and EDGEwave; the toolbar outline to EDGEkit; the server entry to EDGEchat.
- **Safety:** `ui_run` runs only commands an EDGE extension lists for it, never an arbitrary command; every command that changes files or the game folder asks first, through the server's `requiresUserInteraction` flag. The server listens only on `127.0.0.1`, checks `Host` and `Origin`, and needs a sign-in.
- **Trademarks:** EDGEguide says what it is (for EDGEkit and VS Code, for Cyberpunk 2077) and never implies endorsement by Microsoft, Anthropic or CD PROJEKT RED.
- **Docs site:** `docs/` is published by GitHub Pages through `.github/workflows/pages.yml` (Settings > Pages > Source: GitHub Actions). `docs/index.md` is the landing page (document ledger and roadmap status); add every page to `nav` in `docs/_config.yml`. Brand images come from `tools/brand/render.ps1`.
