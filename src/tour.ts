// The tour in the editor (design, "Tours"): the EDGEguide panel shows one step's note with Back,
// Next and Close, and each step opens its place. VS Code hides an extension's toast after 10 s, so
// the note lives in a panel that stays. In a file, the note also sits at its line.

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { TourStep } from "./tools";

export interface TourState {
  title: string;
  /** The step showing, from 1; 0 before the first. */
  at: number;
  of: number;
  status: "showing" | "done" | "closed";
  text?: string;
}

export const TourViewId = "edgeguide.tour";

/** A past tour, kept so the modder can replay it. */
interface PastTour {
  title: string;
  steps: TourStep[];
  /** When it was first shown, as an ISO date. */
  when: string;
}

/** How many past tours the panel keeps, newest first. */
export const KeptTours = 10;
const HistoryKey = "edgeguide.tours";

export class Tour implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private steps: TourStep[] = [];
  private title = "";
  private at = 0;
  private status: TourState["status"] | undefined;
  private problem: string | undefined;
  private readonly note = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
    after: { margin: "0 0 0 2em", color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic" },
  });

  /** show opens a step's place (a view, a file at a line, a command that changes nothing); past tours are kept in store. */
  constructor(
    private readonly show: (step: TourStep) => Promise<void>,
    private readonly say: (line: string) => void,
    private readonly store: vscode.Memento,
  ) {}

  private history(): PastTour[] {
    const kept = this.store.get<unknown>(HistoryKey);
    return Array.isArray(kept) ? kept.filter((t): t is PastTour => !!t && typeof t.title === "string" && Array.isArray(t.steps) && t.steps.length > 0) : [];
  }

  dispose() {
    this.note.dispose();
  }

  state(): TourState | null {
    if (!this.status) return null;
    const step = this.steps[this.at];
    return {
      title: this.title,
      at: this.status === "showing" ? this.at + 1 : 0,
      of: this.steps.length,
      status: this.status,
      ...(this.status === "showing" && step ? { text: step.text } : {}),
    };
  }

  /** A new tour from Claude: kept at the top of the past tours, then shown. */
  async start(steps: TourStep[], title: string) {
    const past = [{ title, steps, when: new Date().toISOString() }, ...this.history()].slice(0, KeptTours);
    await this.store.update(HistoryKey, past);
    await this.run(steps, title);
  }

  /** A past tour again, from its Replay button: the list keeps its order. */
  private async replay(i: number) {
    const past = this.history()[i];
    if (past) await this.run(past.steps, past.title);
  }

  private async run(steps: TourStep[], title: string) {
    this.steps = steps;
    this.title = title;
    this.status = "showing";
    this.say(`tour "${title}": ${steps.length} steps`);
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
      title: this.title,
      past: this.history().map((t) => ({ title: t.title, steps: t.steps.length })),
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
    view.webview.onDidReceiveMessage((m: { type?: string; index?: unknown }) => {
      if (m.type === "ready") this.post();
      else if (m.type === "replay" && typeof m.index === "number") void this.replay(m.index);
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
  #title { font-weight: 600; margin-bottom: 2px; }
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
  #past h3 { font-size: 0.85em; font-weight: normal; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.05em; margin: 12px 0 4px; }
  #past ol { margin: 0; padding-left: 1.6em; }
  #past li { margin: 3px 0; }
  #past li span { margin-right: 10px; }
  #past li small { opacity: 0.7; margin-right: 10px; }
  #past button { padding: 1px 10px; font-size: 0.9em; }
</style>
</head>
<body>
<div id="tour" hidden>
  <div id="title"></div>
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
<div id="rest">
  <p id="idle">Ask Claude how to do something in the EDGE tools, and the steps show here.</p>
  <div id="past" hidden>
    <h3>Past tours</h3>
    <ol id="list"></ol>
  </div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  for (const id of ["back", "next", "close"]) $(id).addEventListener("click", () => vscode.postMessage({ type: id }));
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-index]");
    if (b) vscode.postMessage({ type: "replay", index: Number(b.dataset.index) });
  });
  function showPast(past) {
    const list = $("list");
    list.replaceChildren();
    past.forEach((t, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = t.title;
      const n = document.createElement("small");
      n.textContent = t.steps === 1 ? "1 step" : t.steps + " steps";
      const b = document.createElement("button");
      b.className = "secondary";
      b.textContent = "Replay";
      b.dataset.index = String(i);
      b.title = "Show this tour again";
      li.append(name, n, b);
      list.append(li);
    });
    $("past").hidden = past.length === 0;
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.type !== "step") return;
    const showing = m.status === "showing";
    $("tour").hidden = !showing;
    $("rest").hidden = showing;
    if (m.status === "done") $("idle").textContent = "That's all the steps. Ask Claude if you want to see more.";
    else if (m.status === "closed") $("idle").textContent = "Tour closed. Ask Claude any time to show you something.";
    if (!showing) return showPast(m.past || []);
    $("title").textContent = m.title || "";
    $("title").hidden = !m.title;
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
