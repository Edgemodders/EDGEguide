// EDGEguide: lets Claude Code show a modder the EDGE tools in the editor (design.md). The extension
// runs the MCP server (server.ts) with its sign-in (oauth.ts) and gives the tools (tools.ts) the
// editor: views, files, commands and what is open.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { findCommand, pressAsks, readContracts } from "./contract";
import { createOAuth, type OAuth, type PendingRequest } from "./oauth";
import { createServer, DefaultPort, type GuideServer, type ServerState } from "./server";
import { buildServer, type TourStep, type Ui } from "./tools";
import { Tour, TourViewId } from "./tour";

/** How long ui_run and ui_open wait for a command before answering that it still runs. */
const CommandWaitMs = 20 * 1000;

let server: GuideServer | undefined;
let tour: Tour | undefined;

/** Where the sign-ins are kept: one file for every editor on this PC, EDGEkit and VS Code alike. */
export function signInFile(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "Edgemodders", "EDGEguide", "sign-ins.json");
}

/** A command's result, short enough to hand back to the assistant. */
function summarize(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return value;
  try {
    const s = JSON.stringify(value);
    return s.length > 500 ? `${s.slice(0, 500)}...` : JSON.parse(s);
  } catch {
    return "(a value that is not JSON)";
  }
}

const ui: Ui = {
  contracts: () => readContracts(vscode.extensions.all),

  async state() {
    const editor = vscode.window.activeTextEditor;
    const where = (uri: vscode.Uri) => (uri.scheme === "file" ? uri.fsPath : uri.toString());
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => {
        const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
        return {
          label: tab.label,
          ...(input?.uri ? { file: where(input.uri) } : {}),
          ...(input?.viewType ? { viewType: input.viewType } : {}),
          group: group.viewColumn,
          active: tab.isActive && group.isActive,
          ...(tab.isDirty ? { unsaved: true } : {}),
        };
      }),
    );
    return {
      editor: { app: vscode.env.appName, version: vscode.version, focused: vscode.window.state.focused },
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => where(f.uri)),
      activeEditor: editor
        ? {
            file: where(editor.document.uri),
            language: editor.document.languageId,
            line: editor.selection.active.line + 1,
            ...(editor.selection.isEmpty ? {} : { selectedLines: [editor.selection.start.line + 1, editor.selection.end.line + 1] }),
            ...(editor.document.isDirty ? { unsaved: true } : {}),
          }
        : null,
      tabs,
      tour: tour?.state() ?? null,
    };
  },

  async focusView(view) {
    await vscode.commands.executeCommand(`${view}.focus`);
  },

  async openFile(file, line) {
    if (!path.isAbsolute(file)) throw new Error(`${file} is not an absolute path.`);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new Error(`${file} does not exist.`);
    }
    if (!stat.isFile()) throw new Error(`${file} is not a file.`);
    const uri = vscode.Uri.file(file);
    if (line) {
      const at = new vscode.Range(line - 1, 0, line - 1, 0);
      await vscode.window.showTextDocument(uri, { selection: at, preview: false });
    } else {
      await vscode.commands.executeCommand("vscode.open", uri);
    }
  },

  async run(command) {
    const running = Promise.resolve(vscode.commands.executeCommand(command)).then((r) => ({ done: true as const, r }));
    const later = new Promise<{ done: false }>((done) => setTimeout(() => done({ done: false }), CommandWaitMs));
    const first = await Promise.race([running, later]);
    if (!first.done) return `started; still running after ${CommandWaitMs / 1000} s (it may be waiting for the modder)`;
    return summarize(first.r);
  },

  async startTour(steps, title) {
    if (!tour) throw new Error("The tour panel is not ready yet.");
    await tour.start(steps, title);
  },
};

/**
 * The modder pressed a step's button in the panel: the same as choosing it in its menu. It is checked
 * against the contracts again, and one that may change things asks first (pressAsks), so it runs only
 * after the modder's OK. Never called by Claude: only the panel's button calls it.
 */
async function pressButton(button: NonNullable<TourStep["button"]>) {
  const found = findCommand(ui.contracts(), button.command);
  if (!found) throw new Error(`${button.title} is no longer there: its extension may have been updated or removed.`);
  if (pressAsks(found.rule, button.title)) {
    const what = found.rule.hint ?? `${button.title}. This may change files or the game folder.`;
    const pick = await vscode.window.showWarningMessage(`${button.title}?`, { modal: true, detail: what }, "OK");
    if (pick !== "OK") return;
  }
  void Promise.resolve(vscode.commands.executeCommand(button.command)).catch((err) =>
    vscode.window.showErrorMessage(`${button.title}: ${(err as Error).message || String(err)}`),
  );
}

/** Opens a tour step's place. A command here changes nothing (ui_tour checked it); it is not waited for. */
async function showStep(step: TourStep) {
  if (step.view) await ui.focusView(step.view);
  else if (step.file) await ui.openFile(step.file, step.line);
  else if (step.command) void Promise.resolve(vscode.commands.executeCommand(step.command)).catch(() => undefined);
}

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("EDGEguide");
  context.subscriptions.push(log);
  const say = (line: string) => log.appendLine(`${new Date().toISOString()} ${line}`);
  const version = String(context.extension.packageJSON.version ?? "0.0.0");

  // Past tours are kept for the modder, across windows and restarts (the extension's global state).
  tour = new Tour(showStep, say, context.globalState, pressButton);
  context.subscriptions.push(tour, vscode.window.registerWebviewViewProvider(TourViewId, tour, { webviewOptions: { retainContextWhenHidden: true } }));

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  status.command = "edgeguide.status";
  context.subscriptions.push(status);
  const show = (state: ServerState) => {
    status.text = state.listening ? "$(compass) EDGEguide" : "$(compass) EDGEguide (other window)";
    status.tooltip = state.listening
      ? `EDGEguide's server for Claude Code: http://127.0.0.1:${state.port}/mcp (this window answers)`
      : state.waiting
        ? `Port ${state.port} is in use, most likely by EDGEguide in another window, which answers. This window takes over when it closes.`
        : `EDGEguide's server is not running.`;
    status.show();
  };

  // The modder allows each sign-in here, after checking the code in the browser.
  const ask = async (oauth: OAuth, request: PendingRequest) => {
    const pick = await vscode.window.showInformationMessage(
      `${request.client} asks to use EDGEguide, which lets it show you the EDGE tools here: open views and files, and run the EDGE extensions' commands (it asks before each one that changes something).`,
      { modal: true, detail: `Allow only if your browser shows the code ${request.code}.` },
      "Allow",
      "Deny",
    );
    oauth.answer(pick === "Allow");
  };
  const oauth: OAuth = createOAuth({
    file: signInFile(),
    log: say,
    onPending: (request) => {
      if (request) void ask(oauth, request);
    },
  });

  server = createServer({
    port: DefaultPort,
    oauth,
    log: say,
    build: () => buildServer(ui, version),
    changed: show,
  });
  server.start();
  show(server.state());

  context.subscriptions.push(
    vscode.commands.registerCommand("edgeguide.status", async () => {
      const state = server?.state();
      const clients = oauth.clients();
      const where = state?.listening
        ? `This window answers on http://127.0.0.1:${state.port}/mcp.`
        : `Another window answers on port ${state?.port ?? DefaultPort} (or another program holds it). This one takes over when it closes.`;
      const who = clients.length ? `Signed in: ${clients.map((c) => c.name).join(", ")}.` : "No assistant is signed in yet.";
      const pick = await vscode.window.showInformationMessage(`EDGEguide. ${where} ${who}`, "Show Log", ...(clients.length ? ["Sign Out an Assistant..."] : []));
      if (pick === "Show Log") log.show(true);
      if (pick === "Sign Out an Assistant...") await vscode.commands.executeCommand("edgeguide.signOut");
    }),
    vscode.commands.registerCommand("edgeguide.signOut", async () => {
      const clients = oauth.clients();
      if (!clients.length) {
        void vscode.window.showInformationMessage("EDGEguide: no assistant is signed in.");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        clients.map((c) => ({ label: c.name, description: c.lastUsed ? `last used ${new Date(c.lastUsed).toLocaleString()}` : undefined, id: c.id })),
        { placeHolder: "Sign out which assistant? It asks you again the next time it connects." },
      );
      if (pick && oauth.revoke(pick.id)) void vscode.window.showInformationMessage(`EDGEguide: signed out ${pick.label}.`);
    }),
    vscode.commands.registerCommand("edgeguide.showLog", () => log.show(true)),
    { dispose: () => void server?.stop() },
  );
}

export async function deactivate() {
  await server?.stop();
  server = undefined;
  tour = undefined;
}
