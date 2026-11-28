// The server end to end in plain Node: the guards, the OAuth sign-in as Claude Code does it
// (register, authorize, the modder's answer, token, refresh), then the MCP tools through the SDK's
// own client, with a stand-in for the editor.

import { strict as assert } from "node:assert";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readContracts, type InstalledExtension } from "../src/contract";
import { createOAuth, type OAuth } from "../src/oauth";
import { createServer, type GuideServer } from "../src/server";
import { buildServer, type TourStep, type Ui } from "../src/tools";

const deck: InstalledExtension = {
  id: "edgemodders.edgedeck",
  packageJSON: {
    version: "0.34.2",
    contributes: {
      views: { edgedeck: [{ id: "edgedeck.mods", name: "Mods" }] },
      commands: [
        { command: "edgedeck.deploy", title: "Deploy", icon: "$(rocket)" },
        { command: "edgedeck.openPage", title: "%openPage.title%" },
        { command: "edgedeck.undo" },
        { command: "edgedeck.checkConflicts", title: "Show conflicts", icon: "$(warning)" },
      ],
      // As EDGEdeck 0.34.4 has them.
      menus: {
        "view/title": [
          { command: "edgedeck.deploy", when: "view == edgedeck.mods", group: "navigation@2" },
          { command: "edgedeck.checkConflicts", when: "view == edgedeck.mods", group: "1_more@0" },
        ],
      },
    },
  },
};

// The test reads the answers' fields as they come.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => done(port));
    });
    s.on("error", fail);
  });
}

describe("EDGEguide's server", () => {
  let port: number;
  let base: string;
  let server: GuideServer;
  let oauth: OAuth;
  let dir: string;
  let answer = true;
  const ran: string[] = [];
  const shown: string[] = [];
  const tours: TourStep[][] = [];
  const titles: string[] = [];
  const ui: Ui = {
    contracts: () => readContracts([deck]),
    state: async () => ({ editor: { app: "Test", focused: true }, tabs: [] }),
    focusView: async (v) => void shown.push(v),
    openFile: async (f) => void shown.push(f),
    run: async (c) => void ran.push(c),
    startTour: async (steps, title) => void (tours.push(steps), titles.push(title)),
  };

  before(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "edgeguide-test-"));
    oauth = createOAuth({
      file: path.join(dir, "sign-ins.json"),
      log: () => {},
      onPending: (r) => {
        if (r) setTimeout(() => oauth.answer(answer), 10);
      },
    });
    server = createServer({ port, oauth, log: () => {}, build: () => buildServer(ui, "0.0.1-test") });
    server.start();
    for (let i = 0; i < 50 && !server.state().listening; i++) await new Promise((f) => setTimeout(f, 20));
    assert.ok(server.state().listening);
  });

  after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a request that does not name it, or from another origin", async () => {
    const bad = await fetch(`${base}/mcp`, { method: "POST", headers: { origin: "http://evil.example" } });
    assert.equal(bad.status, 403);
  });

  it("asks for a sign-in on /mcp, pointing at its metadata", async () => {
    const r = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(r.status, 401);
    assert.match(r.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
    const meta = await json(fetch(`${base}/.well-known/oauth-authorization-server`));
    assert.equal(meta.registration_endpoint, `${base}/register`);
  });

  it("refuses a redirect that is not on this PC", async () => {
    const r = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "X", redirect_uris: ["https://evil.example/cb"] }) });
    assert.equal(r.status, 400);
  });

  async function signIn(): Promise<{ access: string; refresh: string; clientId: string } | { denied: true }> {
    const redirect = "http://127.0.0.1:9/callback";
    const reg = await json(fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code (test)", redirect_uris: [redirect] }) }));
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
    const pageText = await (await fetch(`${base}/authorize?${q}`)).text();
    const request = /request=([A-Za-z0-9_-]+)/.exec(pageText)?.[1];
    assert.ok(request, "the page waits on a request");
    let wait: { status: string; redirect?: string };
    for (;;) {
      wait = await json(fetch(`${base}/authorize/wait?request=${request}`));
      if (wait.status !== "pending") break;
      await new Promise((f) => setTimeout(f, 20));
    }
    const to = new URL(wait.redirect!);
    assert.equal(to.searchParams.get("state"), "s1");
    if (to.searchParams.get("error")) return { denied: true };
    const token = await json(fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: to.searchParams.get("code")!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect }) }));
    assert.equal(token.token_type, "Bearer");
    return { access: token.access_token, refresh: token.refresh_token, clientId: reg.client_id };
  }

  it("a denied sign-in redirects with access_denied", async () => {
    answer = false;
    assert.deepEqual(await signIn(), { denied: true });
    answer = true;
  });

  it("signs in, refreshes, and serves the tools", async () => {
    const s = await signIn();
    assert.ok(!("denied" in s));
    const refreshed = await json(fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh }) }));
    assert.ok(refreshed.access_token);
    const reused = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh }) });
    assert.equal(reused.status, 400, "a refresh token works once");

    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${refreshed.access_token}` } } }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["ui_open", "ui_run", "ui_state", "ui_tour"]);
    assert.ok(!tools.find((t) => t.name === "ui_tour")!._meta, "ui_tour does not ask");
    const run = tools.find((t) => t.name === "ui_run")!;
    assert.equal((run._meta as Record<string, unknown>)["anthropic/requiresUserInteraction"], true, "ui_run asks first");
    assert.ok(!tools.find((t) => t.name === "ui_open")!._meta, "ui_open does not ask");

    const state = await client.callTool({ name: "ui_state", arguments: {} });
    const parsed = JSON.parse((state.content as { text: string }[])[0].text);
    assert.equal(parsed.extensions[0].id, "edgemodders.edgedeck");
    assert.deepEqual(parsed.extensions[0].views, ["edgedeck.mods"]);
    assert.ok(parsed.extensions[0].dropped.length > 0, "the default's commands EDGEdeck does not contribute here are listed as dropped");
    const commands = parsed.extensions[0].commands;
    assert.equal(commands["edgedeck.deploy"].button, "Deploy", "the title from package.json");
    assert.equal(commands["edgedeck.openPage"].button, "Opens EDGEdeck's page", "an nls key is not a name: the hint's part before the colon");
    assert.equal(commands["edgedeck.undo"].button, "Undo deploy", "no title: the hint's part before the colon");
    assert.equal(commands["edgedeck.checkConflicts"].where, "the ... menu at the top of the Mods view");
    assert.equal(commands["edgedeck.undo"].where, "the Command Palette (Ctrl+Shift+P)", "in no menu");

    const bad = async (steps: unknown[]) => (await client.callTool({ name: "ui_tour", arguments: { steps } })).isError;
    assert.equal(await bad([]), true, "a tour has a step");
    assert.equal(await bad([{ text: "x", view: "workbench.view.scm" }]), true, "only listed views");
    assert.equal(await bad([{ text: "x", command: "edgedeck.deploy" }]), true, "a tour runs nothing that changes things");
    assert.equal(await bad([{ text: "x", button: "workbench.action.terminal.new" }]), true, "only listed buttons");
    assert.equal(await bad([{ text: "x", view: "edgedeck.mods", command: "edgedeck.checkConflicts" }]), true, "one place per step");
    assert.equal(await bad([{ text: "x", file: "relative.txt" }]), true, "an absolute path");
    assert.equal(await bad([{ text: "x", line: 3 }]), true, "line goes with file");
    assert.equal(tours.length, 0, "no tour started by a bad call");
    const ok = await client.callTool({
      name: "ui_tour",
      arguments: {
        title: " Check for clashes and deploy ",
        steps: [
          { text: " These are your mods. ", view: "edgedeck.mods" },
          { text: "This lists clashes.", command: "edgedeck.checkConflicts" },
          { text: "Press Deploy to put them into the game.", button: "edgedeck.deploy" },
        ],
      },
    });
    assert.ok(!ok.isError);
    assert.match((ok.content as { text: string }[])[0].text, /step 1 of 3/);
    assert.deepEqual(tours, [
      [
        { text: "These are your mods.", view: "edgedeck.mods" },
        { text: "This lists clashes.", command: "edgedeck.checkConflicts" },
        {
          text: "Press Deploy to put them into the game.",
          button: { command: "edgedeck.deploy", title: "Deploy", place: "the rocket button at the top of the Mods view", menu: "view/title", view: "edgedeck.mods" },
        },
      ],
    ]);
    assert.deepEqual(ran, [], "the tour ran nothing on its own");
    await client.callTool({ name: "ui_tour", arguments: { steps: [{ text: "These are the game's own files, from every archive. Open a folder to see inside it.", view: "edgedeck.mods" }] } });
    const question = "So I have a bunch of mods from Nexus and I think two of them fight over the same files, how do I find out and fix it?";
    await client.callTool({ name: "ui_tour", arguments: { title: question, steps: [{ text: "x", view: "edgedeck.mods" }] } });
    assert.deepEqual(
      titles,
      [
        "Check for clashes and deploy",
        "These are the game's own files, from every archive. Open a folder to see inside...",
        "So I have a bunch of mods from Nexus and I think two of them fight over the same...",
      ],
      "no title: the first note; a long one cut at a word",
    );

    await client.callTool({ name: "ui_open", arguments: { view: "edgedeck.mods" } });
    assert.deepEqual(shown, ["edgedeck.mods"]);
    const notListed = await client.callTool({ name: "ui_open", arguments: { view: "workbench.view.scm" } });
    assert.equal(notListed.isError, true);
    const changes = await client.callTool({ name: "ui_open", arguments: { command: "edgedeck.deploy" } });
    assert.equal(changes.isError, true, "a command that changes things goes through ui_run");
    const two = await client.callTool({ name: "ui_open", arguments: { view: "edgedeck.mods", command: "edgedeck.openPage" } });
    assert.equal(two.isError, true);

    await client.callTool({ name: "ui_run", arguments: { command: "edgedeck.deploy" } });
    const foreign = await client.callTool({ name: "ui_run", arguments: { command: "workbench.action.terminal.sendSequence" } });
    assert.equal(foreign.isError, true, "no command outside the contracts");
    assert.deepEqual(ran, ["edgedeck.deploy"]);
    await client.close();

    assert.ok(oauth.revoke(s.clientId));
    const after = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${refreshed.access_token}`, "content-type": "application/json" }, body: "{}" });
    assert.equal(after.status, 401, "signed out");
  });

  it("a second server on the same port waits, and takes over when the first stops", async () => {
    const second = createServer({ port, retryMs: 50, oauth, log: () => {}, build: () => buildServer(ui, "0.0.1-test") });
    second.start();
    await new Promise((f) => setTimeout(f, 100));
    assert.deepEqual(second.state(), { listening: false, port, waiting: true });
    await server.stop(); // the first window closes
    for (let i = 0; i < 50 && !second.state().listening; i++) await new Promise((f) => setTimeout(f, 20));
    assert.deepEqual(second.state(), { listening: true, port });
    const r = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(r.status, 401, "the second one answers");
    await second.stop();
  });
});
