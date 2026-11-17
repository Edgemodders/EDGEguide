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
- **README at each release (the owner's rule, 2026-11-03; the same in every Edgemodders repo):** before each release run, update README.md's status line so it names the version (`**Status: <version> released on <date>** ...`) and draw the status badge again (the `status` entry in `tools/brand/badges.py`, then `python -I tools/brand/badges.py docs/assets/brand/badges`; the README's `<img alt>` too). `tools/release/readme-check.mjs` is REDnode's file, copied as it is (change it in REDnode, then copy it again). When the first release workflow is written, it runs `node tools/release/readme-check.mjs --version <v>` before building, on release runs only, as REDnode's release.yml does (step "The README says this release"), so a README that does not name the version stops the release. Between releases, keep the status line and the badge current with the phase.

## Dashboard (EDGEweb)

The platform dashboard at https://edgemodders.ai/dashboard.html draws one file in the EDGEweb repo, `docs/assets/dashboard/status.js` (plain JSON after the equals sign, one object per tool under `tools`). The owner and a managing session read it to see every tool's state, so EDGEguide's entry is kept current by the session that works on EDGEguide.

- **When:** in the same piece of work as any change to EDGEguide's status: a phase built or done, a hand test added, run, passed or failed, a release, something EDGEguide starts or stops waiting on, something only the owner can do.
- **How:** in the sibling checkout `../EDGEweb`, `git pull`, edit only EDGEguide's object, set its `checkedBy` to this session and the date, bump the `?v=` on the `status.js` script tag in `docs/dashboard.html`, commit and push to `main` (as `CyberbuildsAI`). Leave `issues`, `lastTag`, `lastTagDate`, `lastCommit` and `commitsSinceTag` alone: EDGEweb's `tools/dashboard/refresh.py` writes those.
- **Words:** phases are `done`, `built, tests pending`, `in progress` or `planned`; tests are `passed`, `not run`, `partly run` or `failed`. The fields are described in EDGEweb's `CLAUDE.md`, under Dashboard.
- **Honest:** never mark a test passed or a phase done that this repo's own docs do not. A test with a step still to run is `partly run`.
