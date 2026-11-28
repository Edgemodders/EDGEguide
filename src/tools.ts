// EDGEguide's MCP tools (design, "The tools"). G1: ui_state, ui_open and ui_run; then ui_tour. The editor side is
// behind Ui, so the tests can stand in for it; extension.ts gives the real one.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findCommand, findView, type Button, type ExtensionContract } from "./contract";

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
  /** Starts a tour (replacing one that runs) and shows its first step; the modder moves on with Next. */
  startTour(steps: TourStep[], title: string): Promise<void>;
}

/** A tour's step, checked against the contracts: a short note, at most one place to show, a button to look at. */
export interface TourStep {
  text: string;
  view?: string;
  file?: string;
  line?: number;
  /** A command that changes nothing, run when the step shows (such as edgedeck.checkConflicts). */
  command?: string;
  /** The button the note is about: pointed at, never run. */
  button?: Button & { command: string };
}

/** The most steps a tour takes. More than a few is a lesson, not a tour. */
export const MaxTourSteps = 8;

/** The longest title the past tours list shows. */
export const TitleLength = 80;

/** A tour's title on one line, cut at a word near TitleLength characters: Claude's, else the first note. */
export function tourTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= TitleLength) return t;
  // One character more, so a word that ends right at the limit, before a space, is kept.
  const cut = t.slice(0, TitleLength + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut.slice(0, TitleLength)).replace(/[\s.,;:]+$/, "")}...`;
}

// Claude Code asks the modder before every call of a tool with this flag, in every permission mode.
// It is set per tool, not per call, so ui_run asks for every command; commands that change nothing
// can go through ui_open instead.
const AskFirst = { "anthropic/requiresUserInteraction": true };

export const Instructions = `EDGEguide shows the modder the EDGE tools in their editor (EDGEkit or VS Code): it opens views and files, and runs the EDGE extensions' own commands while the modder watches, so they learn where things are.
Use it to show, not to do the work: the EDGE servers (redcode, edgedeck, edgemat, edgewave, rednode) stay the way to read and change things.
When the modder asks how to do something in the EDGE tools, or where something is, show them with ui_tour instead of explaining at length: 2 to 5 steps, each one or two short sentences, at the view, file or button it is about. Title the tour with the modder's question (their words, or a short summary). Then answer in one short line, such as "I've put the steps in the editor: press Next to go on." Do not repeat the steps in the chat. The modder need not know EDGEguide's name: say "the steps in the editor".
- ui_state: what the editor has open, the tour and the step the modder is on, and for each EDGE extension the views EDGEguide can open and the commands it can run, with each command's button name. Look first.
- ui_tour: a short tour in the editor. Each step opens its place and shows its note with Back, Next and Close. A tour changes nothing: for a step that does (such as Deploy), point at its button and let the modder press it.
- ui_open: shows a view (such as edgedeck.mods or redcode.project), opens a file at a line, or runs a command that changes nothing (such as edgedeck.openPage).
- ui_run: runs an EDGE command that may change files or the game folder (such as edgedeck.deploy or redcode.packAndInstall), when the modder asks you to do it. The modder is asked before every call. Say what it will do first.
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
            commands: Object.fromEntries(Object.entries(c.commands).map(([id, rule]) => [id, { ...rule, button: c.buttons[id]?.title, where: c.buttons[id]?.place }])),
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
    "ui_tour",
    {
      title: "Show steps in the editor",
      description: `Shows the modder a short tour in the editor, one step at a time, with Back, Next and Close; it answers at once and the modder moves on with Next (ui_state says where they are). Each step is a note of one or two short sentences, with at most one place to show: a view (from ui_state), a file (an absolute path, with line), or a command that changes nothing (${listed(contracts, false)}), run when the step shows. A step may name the button it is about (button: any command id ui_state lists, such as edgedeck.deploy): the note shows its name and where it is (ui_state's "where"), and the modder presses it; the tour never runs it. A step with a button should also show its view, so the button is on screen. Give it a title: the modder's question, in their words when short, else a short summary of it; the modder replays past tours by it. A new tour replaces the one showing. Changes nothing, so it does not ask. Afterwards answer in one short line; do not repeat the steps.`,
      inputSchema: {
        title: z
          .string()
          .max(300)
          .optional()
          .describe(`The modder's question this tour answers: in their own words when it is short, else a short summary of it, such as: How do I check my mods clash and deploy them? Up to ${TitleLength} characters (longer is cut at a word). The modder replays past tours by it`),
        steps: z
          .array(
            z.object({
              text: z.string().min(1).max(300).describe("One or two short sentences, such as: These are your mods. A tick means the mod is on."),
              view: z.string().optional().describe("A view id from ui_state, shown with this step"),
              file: z.string().optional().describe("An absolute path to a file, shown with this step"),
              line: z.number().int().positive().optional().describe("With file: the line the note sits at (1 is the first)"),
              command: z.string().optional().describe("A command that changes nothing, from ui_state, run when this step shows"),
              button: z.string().optional().describe("The command id of the button this step is about, from ui_state: pointed at, never run"),
            }),
          )
          .min(1)
          .max(MaxTourSteps),
      },
      annotations: { readOnlyHint: true },
    },
    ({ title, steps }) =>
      guard(async () => {
        const now = ui.contracts();
        const checked: TourStep[] = [];
        for (const [i, s] of steps.entries()) {
          const at = `Step ${i + 1}`;
          if ([s.view, s.file, s.command].filter((x) => x !== undefined).length > 1) return text(`${at}: give at most one of view, file or command.`, true);
          if (s.line !== undefined && s.file === undefined) return text(`${at}: line goes with file.`, true);
          if (s.view !== undefined && !findView(now, s.view)) return text(`${at}: no installed EDGE extension lists the view ${s.view}. ui_state lists the views.`, true);
          if (s.file !== undefined && !/^([A-Za-z]:[\\/]|\/)/.test(s.file)) return text(`${at}: ${s.file} is not an absolute path.`, true);
          if (s.command !== undefined) {
            const found = findCommand(now, s.command);
            if (!found) return text(`${at}: no installed EDGE extension lists the command ${s.command}. ui_state lists them.`, true);
            if (found.rule.changes) return text(`${at}: ${s.command} may change files or the game folder, so a tour does not run it. Name it as the step's button instead, and the modder presses it.`, true);
          }
          let button: TourStep["button"];
          if (s.button !== undefined) {
            const found = findCommand(now, s.button);
            if (!found) return text(`${at}: no installed EDGE extension lists the command ${s.button}. ui_state lists them.`, true);
            button = { command: s.button, ...(found.contract.buttons[s.button] ?? { title: s.button, place: "the Command Palette (Ctrl+Shift+P)" }) };
          }
          checked.push({
            text: s.text.trim(),
            ...(s.view !== undefined ? { view: s.view } : {}),
            ...(s.file !== undefined ? { file: s.file, ...(s.line ? { line: s.line } : {}) } : {}),
            ...(s.command !== undefined ? { command: s.command } : {}),
            ...(button ? { button } : {}),
          });
        }
        await ui.startTour(checked, tourTitle(title?.trim() || checked[0].text));
        return text(`The modder sees step 1 of ${checked.length} in the editor and moves on with Next. Answer in one short line; do not repeat the steps.`);
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
