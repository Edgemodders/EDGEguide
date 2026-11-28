// The tour in the editor (design, "Tours"): the EDGEguide panel shows one step's note with Back,
// Next and Close, and each step opens its place. VS Code hides an extension's toast after 10 s, so
// the note lives in a panel that stays. In a file, the note also sits at its line.

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { TourStep } from "./tools";

export interface TourState {
  /** The step showing, from 1; 0 before the first. */
  at: number;
  of: number;
  status: "showing" | "done" | "closed";
  text?: string;
}

export const TourViewId = "edgeguide.tour";

export class Tour implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private steps: TourStep[] = [];
  private at = 0;
  private status: TourState["status"] | undefined;
  private problem: string | undefined;
  private readonly note = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    after: { margin: "0 0 0 2em", color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" },
  });

  /** show opens a step's place (a view, a file at a line, a command that changes nothing). */
  constructor(
    private readonly show: (step: TourStep) => Promise<void>,
    private readonly say: (line: string) => void,
  ) {}

  dispose() {
    this.note.dispose();
  }

  state(): TourState | null {
    if (!this.status) return null;
    const step = this.steps[this.at];
    return { at: this.status === "showing" ? this.at + 1 : 0, of: this.steps.length, status: this.status, ...(this.status === "showing" && step ? { text: step.text } : {}) };
  }

  async start(steps: TourStep[]) {
    this.steps = steps;
    this.status = "showing";
    this.say(`tour: ${steps.length} steps`);
    // Open the panel first, so the step's own place can take the focus after it.
    await vscode.commands.executeCommand(`${TourViewId}.focus`);
    await this.go(0);
  }

  private async go(i: number) {
    if (this.status !== "showing" || i < 0) return;
    if (i >= this.steps.length) return this.end("done");
    this.at = i;
    this.clearNote();
    const step = this.steps[i];
    this.problem = undefined;
    try {
      await this.show(step);
      if (step.file && step.line) this.noteAt(step.file, step.line, step.text);
    } catch (err) {
      this.problem = (err as Error).message || String(err);
      this.say(`tour step ${i + 1}: ${this.problem}`);
    }
    this.post();
  }

  private end(status: "done" | "closed") {
    this.status = status;
    this.clearNote();
    this.say(`tour ${status} at step ${this.at + 1} of ${this.steps.length}`);
    this.post();
  }

  private noteAt(file: string, line: number, text: string) {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.toLowerCase() === vscode.Uri.file(file).fsPath.toLowerCase());
    if (!editor) return;
    const at = Math.min(line, editor.document.lineCount) - 1;
    editor.setDecorations(this.note, [{ range: new vscode.Range(at, 0, at, 0), renderOptions: { after: { contentText: `◀ ${text}` } } }]);
  }

  private clearNote() {
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.note, []);
  }

  private post() {
    const step = this.steps[this.at];
    void this.view?.webview.postMessage({
      type: "step",
      status: this.status ?? "none",
      at: this.at + 1,
      of: this.steps.length,
      text: step?.text ?? "",
      button: step?.button?.title,
      place: step?.button?.place,
      problem: this.problem,
    });
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = page(view.webview.cspSource);
    view.webview.onDidReceiveMessage((m: { type?: string }) => {
      if (m.type === "ready") this.post();
      else if (m.type === "next") void this.go(this.at + 1);
      else if (m.type === "back") void this.go(this.at - 1);
      else if (m.type === "close") this.end("closed");
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }
}

/** The panel's page. Claude's text goes in with textContent only, never as HTML. */
function page(cspSource: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px 14px; margin: 0; }
  #count { font-size: 0.85em; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.05em; }
  #text { font-size: 1.15em; line-height: 1.45; margin: 6px 0 8px; max-width: 60em; }
  #button { margin: 0 0 10px; }
  #button b { padding: 1px 8px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  #problem { color: var(--vscode-errorForeground); margin: 0 0 8px; }
  .row { display: flex; gap: 8px; }
  button { font-family: inherit; font-size: 1em; padding: 4px 14px; border: none; border-radius: 2px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.4; cursor: default; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div id="tour" hidden>
  <div id="count"></div>
  <p id="text"></p>
  <p id="button" hidden>Look for <b></b><span id="place"></span></p>
  <p id="problem" hidden></p>
  <div class="row">
    <button id="back" class="secondary">Back</button>
    <button id="next">Next</button>
    <button id="close" class="secondary">Close</button>
  </div>
</div>
<p id="idle">Ask Claude how to do something in the EDGE tools, and the steps show here.</p>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  for (const id of ["back", "next", "close"]) $(id).addEventListener("click", () => vscode.postMessage({ type: id }));
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.type !== "step") return;
    const showing = m.status === "showing";
    $("tour").hidden = !showing;
    $("idle").hidden = showing;
    if (m.status === "done") $("idle").textContent = "That's all the steps. Ask Claude if you want to see more.";
    else if (m.status === "closed") $("idle").textContent = "Tour closed. Ask Claude any time to show you something.";
    if (!showing) return;
    $("count").textContent = "Step " + m.at + " of " + m.of;
    $("text").textContent = m.text;
    $("button").hidden = !m.button;
    $("button").querySelector("b").textContent = m.button || "";
    $("place").textContent = m.place ? ": " + m.place : "";
    $("problem").hidden = !m.problem;
    $("problem").textContent = m.problem ? "Couldn't open this step's place: " + m.problem : "";
    $("back").disabled = m.at <= 1;
    $("next").textContent = m.at >= m.of ? "Done" : "Next";
  });
  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
