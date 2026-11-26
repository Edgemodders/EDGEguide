// EDGEguide: lets Claude Code show a modder the EDGE tools in the editor (design.md). The extension
// runs the MCP server (server.ts) with its sign-in (oauth.ts) and gives the tools (tools.ts) the
// editor: views, files, commands and what is open.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { readContracts } from "./contract";
import { createOAuth, type OAuth, type PendingRequest } from "./oauth";
import { createServer, DefaultPort, type GuideServer, type ServerState } from "./server";
import { buildServer, type Ui } from "./tools";

/** How long ui_run and ui_open wait for a command before answering that it still runs. */
const CommandWaitMs = 20 * 1000;

let server: GuideServer | undefined;

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
};

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("EDGEguide");
  context.subscriptions.push(log);
  const say = (line: string) => log.appendLine(`${new Date().toISOString()} ${line}`);
  const version = String(context.extension.packageJSON.version ?? "0.0.0");

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
}
