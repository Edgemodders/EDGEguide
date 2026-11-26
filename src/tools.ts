// EDGEguide's MCP tools (design, "The tools"). G1: ui_state, ui_open and ui_run. The editor side is
// behind Ui, so the tests can stand in for it; extension.ts gives the real one.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findCommand, findView, type ExtensionContract } from "./contract";

export interface Ui {
  /** The contracts of the installed extensions, read now. */
  contracts(): ExtensionContract[];
  /** What is open: the window, workspace, editors, tabs. Public state only (G1). */
  state(): Promise<Record<string, unknown>>;
  /** Shows a view (its built-in <view>.focus command). */
  focusView(view: string): Promise<void>;
  /** Opens a file, at a line when given. Throws when it is not a file. */
  openFile(file: string, line?: number): Promise<void>;
  /** Runs a command with no arguments and returns what it returned. */
  run(command: string): Promise<unknown>;
}

// Claude Code asks the modder before every call of a tool with this flag, in every permission mode.
// It is set per tool, not per call, so ui_run asks for every command; commands that change nothing
// can go through ui_open instead.
const AskFirst = { "anthropic/requiresUserInteraction": true };

export const Instructions = `EDGEguide shows the modder the EDGE tools in their editor (EDGEkit or VS Code): it opens views and files, and runs the EDGE extensions' own commands while the modder watches, so they learn where things are.
Use it to show, not to do the work: the EDGE servers (redcode, edgedeck, edgemat, edgewave, rednode) stay the way to read and change things.
- ui_state: what the editor has open, and for each EDGE extension the views EDGEguide can open and the commands it can run. Look first.
- ui_open: shows a view (such as edgedeck.mods or redcode.project), opens a file at a line, or runs a command that changes nothing (such as edgedeck.openPage).
- ui_run: runs an EDGE command that may change files or the game folder (such as edgedeck.deploy or redcode.packAndInstall). The modder is asked before every call. Say what it will do first.
Calls go to the editor window that runs EDGEguide's server: the first one opened.`;

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

async function guard(fn: () => Promise<ReturnType<typeof text>>) {
  try {
    return await fn();
  } catch (err) {
    return text((err as Error).message || String(err), true);
  }
}

/** A list of the commands, for a tool's description. */
function listed(contracts: ExtensionContract[], changes: boolean) {
  const ids = contracts.flatMap((c) => Object.entries(c.commands).filter(([, r]) => r.changes === changes).map(([id]) => id));
  return ids.length ? ids.join(", ") : "none (no EDGE extension installed lists any)";
}

export function buildServer(ui: Ui, version: string): McpServer {
  const server = new McpServer({ name: "edgeguide", version }, { instructions: Instructions });
  const contracts = ui.contracts();

  server.registerTool(
    "ui_state",
    {
      title: "What the editor shows",
      description:
        "What is open in the editor window EDGEguide answers from: the workspace folders, the active editor and its selection, the open tabs, and for each EDGE extension installed its version, the views ui_open can show and the commands ui_open and ui_run can run (with a note on each). Which item a view has selected is not known yet (it comes with each extension's own state command).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const now = ui.contracts();
        return text({
          ...(await ui.state()),
          extensions: now.map((c) => ({
            id: c.extension,
            version: c.version,
            contract: c.source,
            views: c.views,
            commands: c.commands,
            ...(c.dropped.length ? { dropped: c.dropped } : {}),
          })),
        });
      }),
  );

  server.registerTool(
    "ui_open",
    {
      title: "Open in the editor",
      description: `Shows the modder something in the editor. Give exactly one of: view (a view id an EDGE extension lists, such as edgedeck.mods, redcode.project or redcode.tweakdb), file (an absolute path, with line to go to a line), or command (one that changes nothing: ${listed(contracts, false)}). Changes nothing, so it does not ask.`,
      inputSchema: {
        view: z.string().optional().describe("A view id from ui_state"),
        file: z.string().optional().describe("An absolute path to a file"),
        line: z.number().int().positive().optional().describe("With file: the line to show (1 is the first)"),
        command: z.string().optional().describe("A command id that changes nothing, from ui_state"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ view, file, line, command }) =>
      guard(async () => {
        const given = [view, file, command].filter((x) => x !== undefined).length;
        if (given !== 1) return text("Give exactly one of view, file or command.", true);
        const now = ui.contracts();
        if (view !== undefined) {
          const owner = findView(now, view);
          if (!owner) return text(`No installed EDGE extension lists the view ${view}. ui_state lists the views.`, true);
          await ui.focusView(view);
          return text(`Showed ${view} (${owner.extension}).`);
        }
        if (file !== undefined) {
          await ui.openFile(file, line);
          return text(`Opened ${file}${line ? ` at line ${line}` : ""}.`);
        }
        const found = findCommand(now, command!);
        if (!found) return text(`No installed EDGE extension lists the command ${command}. ui_state lists them.`, true);
        if (found.rule.changes) return text(`${command} may change files or the game folder, so it goes through ui_run, which asks the modder first.`, true);
        await ui.run(command!);
        return text(`Ran ${command} (${found.contract.extension}).`);
      }),
  );

  server.registerTool(
    "ui_run",
    {
      title: "Run an EDGE command",
      description: `Runs one of the EDGE extensions' own commands in the editor, as if the modder chose it, while they watch: ${listed(contracts, true)}. These may change files or the game folder, so the modder is asked before every call: say first what it will do. Commands that change nothing go through ui_open. Never any other command.`,
      inputSchema: { command: z.string().describe("A command id from ui_state") },
      annotations: { destructiveHint: true },
      _meta: AskFirst,
    },
    ({ command }) =>
      guard(async () => {
        const found = findCommand(ui.contracts(), command);
        if (!found) return text(`No installed EDGE extension lists the command ${command}. ui_state lists them; EDGEguide runs no other command.`, true);
        const result = await ui.run(command);
        return text(`Ran ${command} (${found.contract.extension})${result === undefined ? "." : `: ${JSON.stringify(result)}`}`);
      }),
  );

  return server;
}
