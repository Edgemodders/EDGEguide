// OAuth for EDGEguide's MCP server: an MCP client such as Claude Code connects by asking, and the
// modder allows it in the editor. No token is copied by hand. Ported from REDnode's
// packages/overlay/oauth.js (REDnode 0.40.1, MIT, Edgemodders), with the approval in an editor
// notification instead of the game (design, "G0 decisions").
//
//   GET  /.well-known/oauth-protected-resource      where to sign in (RFC 9728)
//   GET  /.well-known/oauth-authorization-server    the endpoints below (RFC 8414)
//   POST /register     dynamic client registration (RFC 7591): a name and loopback redirects
//   GET  /authorize    a page in the browser: "Approve in your editor, code ABC-1234"; the editor
//                      shows the same code with Allow and Deny
//   GET  /authorize/wait?request=...   the page waits on the answer, then follows the redirect
//   POST /token        authorization_code (PKCE S256 only) or refresh_token
//
// Guards: only loopback redirect URIs; one request waits at a time and lapses after two minutes; a
// code is used once, within a minute. The server checks Host and Origin before it gets here.
// Tokens are kept hashed (SHA-256) in a file shared by every editor on this PC (EDGEkit and VS
// Code), so a connection survives restarts and whichever window listens knows it.
// No vscode import: the tests run it in plain Node.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const REQUEST_MS = 120 * 1000;
const CODE_MS = 60 * 1000;
const ACCESS_S = 24 * 3600;
const REFRESH_MS = 180 * 24 * 3600 * 1000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const random = (n = 32) => crypto.randomBytes(n).toString("base64url");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("base64url");

/** A code to compare in the browser and the editor: three letters and four digits, no look-alikes. */
function shortCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = () => letters[crypto.randomInt(letters.length)];
  return `${pick()}${pick()}${pick()}-${crypto.randomInt(1000, 10000)}`;
}

export function loopbackUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Client {
  name: string;
  redirectUris: string[];
  created: number;
  lastUsed: number;
}
interface Token {
  hash: string;
  client: string;
  kind: "access" | "refresh";
  expires: number;
}
interface Store {
  clients: Record<string, Client>;
  tokens: Token[];
}
interface Pending {
  id: string;
  code: string;
  clientId: string;
  client: { name: string };
  redirectUri: string;
  state: string;
  challenge: string;
  expires: number;
  answer: null | "allowed" | "denied" | "expired";
}

export interface PendingRequest {
  code: string;
  client: string;
  expires: number;
}

export interface OAuthHost {
  /** The file the sign-ins are kept in. */
  file: string;
  log(line: string): void;
  /** A request starts waiting for the modder's answer (with it), or is over (null). */
  onPending(request: PendingRequest | null): void;
  /** The connected clients changed. */
  changed?(): void;
}

export interface OAuth {
  route(req: IncomingMessage, res: ServerResponse, url: URL, base: string): Promise<boolean>;
  check(token: string): { client: string; name: string } | null;
  pending(): PendingRequest | null;
  answer(allow: boolean): boolean;
  clients(): { id: string; name: string; created: number; lastUsed: number }[];
  revoke(id: string): boolean;
  used(clientId: string): void;
}

export function createOAuth(host: OAuthHost): OAuth {
  let store: Store = { clients: {}, tokens: [] };
  const load = () => {
    try {
      store = { clients: {}, tokens: [], ...JSON.parse(fs.readFileSync(host.file, "utf8")) };
    } catch {
      // none yet
    }
  };
  load();
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(host.file), { recursive: true });
      fs.writeFileSync(host.file, JSON.stringify(store, null, 2));
    } catch (err) {
      host.log(`Sign-in: could not save ${host.file}: ${(err as Error).message}`);
    }
  };
  const prune = () => {
    const now = Date.now();
    const before = store.tokens.length + Object.keys(store.clients).length;
    store.tokens = store.tokens.filter((t) => t.expires > now && store.clients[t.client]);
    // A registration that never connected goes after a day, one unused for as long as a refresh
    // token lasts goes too. A revoked one stays: its assistant keeps its client id and signs in
    // with it again.
    const live = new Set(store.tokens.map((t) => t.client));
    for (const [id, c] of Object.entries(store.clients)) {
      if (live.has(id)) continue;
      if (c.lastUsed ? now - c.lastUsed > REFRESH_MS : now - c.created > 24 * 3600 * 1000) delete store.clients[id];
    }
    return store.tokens.length + Object.keys(store.clients).length !== before;
  };
  if (prune()) save();

  let pending: Pending | null = null;
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; expires: number }>();

  function lapse() {
    if (pending && Date.now() > pending.expires && !pending.answer) {
      host.log(`Sign-in: the request of ${pending.client.name} (${pending.code}) lapsed`);
      pending.answer = "expired";
      host.onPending(null);
    }
  }

  function issue(clientId: string) {
    const access = random();
    const refresh = random();
    const now = Date.now();
    store.tokens.push({ hash: sha(access), client: clientId, kind: "access", expires: now + ACCESS_S * 1000 });
    store.tokens.push({ hash: sha(refresh), client: clientId, kind: "refresh", expires: now + REFRESH_MS });
    store.clients[clientId].lastUsed = now;
    prune();
    save();
    host.changed?.();
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_S, refresh_token: refresh };
  }

  // ---------- HTTP ----------

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(JSON.stringify(body));
  const oauthError = (res: ServerResponse, status: number, error: string, description: string) =>
    json(res, status, { error, error_description: description });

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new Error("too large");
      chunks.push(c as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if ((req.headers["content-type"] ?? "").includes("application/json")) return JSON.parse(text || "{}");
    return Object.fromEntries(new URLSearchParams(text));
  }

  function page(res: ServerResponse, status: number, title: string, body: string, script = "") {
    res
      .writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
      })
      .end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c10;color:#e8e6e3;font:16px/1.5 system-ui,sans-serif}
main{max-width:520px;padding:32px;border:1px solid #2b2f3a;border-left:4px solid #fcee0a;background:#12141a}
h1{margin:0 0 12px;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:#fcee0a}
.code{font:700 34px ui-monospace,Consolas,monospace;letter-spacing:.12em;margin:12px 0;color:#5ef6ff}
.dim{color:#9aa0aa;font-size:14px}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`);
  }

  function metadata(base: string) {
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    };
  }

  /** Answers an OAuth request; false when the path is not one of OAuth's. */
  async function route(req: IncomingMessage, res: ServerResponse, url: URL, base: string): Promise<boolean> {
    const p = url.pathname;
    if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") {
      json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], resource_name: "EDGEguide" });
      return true;
    }
    if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/openid-configuration") {
      json(res, 200, metadata(base));
      return true;
    }
    if (p === "/register") {
      if (req.method !== "POST") return json(res, 405, { error: "invalid_request" }), true;
      let b: Record<string, unknown>;
      try {
        b = await readBody(req);
      } catch {
        return oauthError(res, 400, "invalid_client_metadata", "The body is not readable"), true;
      }
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
      if (!uris.length || !uris.every(loopbackUri)) {
        return oauthError(res, 400, "invalid_redirect_uri", "EDGEguide allows only http redirects to localhost, 127.0.0.1 or [::1]"), true;
      }
      const name = String(b.client_name ?? "An MCP client").slice(0, 120);
      const id = `eg_${random(12)}`;
      load(); // another editor may have written since
      store.clients[id] = { name, redirectUris: uris, created: Date.now(), lastUsed: 0 };
      save();
      host.log(`Sign-in: registered "${name}"`);
      json(res, 201, {
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
      return true;
    }
    if (p === "/authorize") {
      const q = url.searchParams;
      const clientId = q.get("client_id") ?? "";
      const redirectUri = q.get("redirect_uri") ?? "";
      // An assistant keeps the client id it was given. If EDGEguide has since forgotten it, take
      // it back with the loopback redirect it asks for: anyone on this PC can register anyway, and
      // the modder still allows each sign-in.
      if (!store.clients[clientId] && /^eg_[A-Za-z0-9_-]{16}$/.test(clientId) && loopbackUri(redirectUri)) {
        store.clients[clientId] = { name: "An MCP client", redirectUris: [redirectUri], created: Date.now(), lastUsed: 0 };
        save();
        host.log(`Sign-in: registered ${clientId} again`);
      }
      const client = store.clients[clientId];
      if (!client) return page(res, 400, "EDGEguide", "<h1>Unknown client</h1><p>EDGEguide does not know this assistant. Remove EDGEguide from your assistant and add it again.</p>"), true;
      if (!client.redirectUris.includes(redirectUri) || !loopbackUri(redirectUri)) {
        return page(res, 400, "EDGEguide", "<h1>Refused</h1><p>That redirect is not one this client registered.</p>"), true;
      }
      if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
        return page(res, 400, "EDGEguide", "<h1>Refused</h1><p>EDGEguide needs the authorization code flow with PKCE (S256).</p>"), true;
      }
      lapse();
      if (pending && !pending.answer) {
        return page(res, 409, "EDGEguide", `<h1>One at a time</h1><p>Another connection (${esc(pending.client.name)}) is waiting for an answer in the editor. Answer it, or wait two minutes, then try again.</p>`), true;
      }
      pending = {
        id: random(16),
        code: shortCode(),
        clientId,
        client: { name: client.name },
        redirectUri,
        state: q.get("state") ?? "",
        challenge: q.get("code_challenge")!,
        expires: Date.now() + REQUEST_MS,
        answer: null,
      };
      host.log(`Sign-in: ${client.name} asks to connect (code ${pending.code})`);
      host.onPending({ code: pending.code, client: client.name, expires: pending.expires });
      page(
        res,
        200,
        "Approve in your editor",
        `<h1>Approve in your editor</h1><p><b>${esc(client.name)}</b> asks to use EDGEguide, which shows you the EDGE tools in EDGEkit or VS Code.</p>
<p>The editor shows this code with <b>Allow</b> and <b>Deny</b>.</p>
<div class="code">${esc(pending.code)}</div><p class="dim" id="status">Waiting for an answer in the editor...</p>`,
        `(async () => {
  const s = document.getElementById('status');
  for (;;) {
    let r;
    try { r = await (await fetch('/authorize/wait?request=${pending.id}')).json(); } catch { await new Promise((f) => setTimeout(f, 1000)); continue; }
    if (r.status === 'pending') { await new Promise((f) => setTimeout(f, 1000)); continue; }
    if (r.redirect) { s.textContent = r.status === 'allowed' ? 'Allowed. Back to your assistant...' : 'Denied.'; location.href = r.redirect; }
    else s.textContent = r.status === 'expired' ? 'The request lapsed. Connect again from your assistant.' : 'This request is over.';
    return;
  }
})();`,
      );
      return true;
    }
    if (p === "/authorize/wait") {
      lapse();
      const r = pending && url.searchParams.get("request") === pending.id ? pending : null;
      if (!r) return json(res, 200, { status: "over" }), true;
      if (!r.answer) return json(res, 200, { status: "pending" }), true;
      const to = new URL(r.redirectUri);
      if (r.answer === "allowed") {
        const code = random();
        codes.set(code, { clientId: r.clientId, redirectUri: r.redirectUri, challenge: r.challenge, expires: Date.now() + CODE_MS });
        to.searchParams.set("code", code);
      } else {
        to.searchParams.set("error", "access_denied");
      }
      if (r.state) to.searchParams.set("state", r.state);
      const status = r.answer;
      pending = null; // the redirect goes out once
      json(res, 200, status === "expired" ? { status } : { status, redirect: to.href });
      return true;
    }
    if (p === "/token") {
      if (req.method !== "POST") return json(res, 405, { error: "invalid_request" }), true;
      let b: Record<string, unknown>;
      try {
        b = await readBody(req);
      } catch {
        return oauthError(res, 400, "invalid_request", "The body is not readable"), true;
      }
      if (b.grant_type === "authorization_code") {
        const c = codes.get(String(b.code ?? ""));
        codes.delete(String(b.code ?? ""));
        if (!c || c.expires < Date.now()) return oauthError(res, 400, "invalid_grant", "The code is unknown, used or lapsed"), true;
        if (b.client_id && b.client_id !== c.clientId) return oauthError(res, 400, "invalid_grant", "The code belongs to another client"), true;
        if (b.redirect_uri && b.redirect_uri !== c.redirectUri) return oauthError(res, 400, "invalid_grant", "The redirect does not match"), true;
        const verifier = String(b.code_verifier ?? "");
        if (!verifier || sha(verifier) !== c.challenge) return oauthError(res, 400, "invalid_grant", "The code verifier does not match"), true;
        if (!store.clients[c.clientId]) return oauthError(res, 400, "invalid_client", "The client was revoked"), true;
        host.log(`Sign-in: ${store.clients[c.clientId].name} is connected`);
        json(res, 200, issue(c.clientId));
        return true;
      }
      if (b.grant_type === "refresh_token") {
        load();
        prune();
        const hash = sha(String(b.refresh_token ?? ""));
        const t = store.tokens.find((x) => x.kind === "refresh" && x.hash === hash);
        if (!t || (b.client_id && b.client_id !== t.client)) return oauthError(res, 400, "invalid_grant", "The refresh token is unknown, lapsed or revoked"), true;
        store.tokens = store.tokens.filter((x) => x !== t); // rotated: each refresh token works once
        json(res, 200, issue(t.client));
        return true;
      }
      return oauthError(res, 400, "unsupported_grant_type", "EDGEguide takes authorization_code and refresh_token"), true;
    }
    return false;
  }

  return {
    route,
    /** The client for a valid access token, or null. Reads the file again on a miss, as another editor may have signed it in. */
    check(token) {
      if (!token) return null;
      const hash = sha(token);
      const find = () => store.tokens.find((x) => x.kind === "access" && x.hash === hash);
      let t = find();
      if (!t) {
        load();
        t = find();
      }
      if (!t || t.expires < Date.now() || !store.clients[t.client]) return null;
      return { client: t.client, name: store.clients[t.client].name };
    },
    pending() {
      lapse();
      return pending && !pending.answer ? { code: pending.code, client: pending.client.name, expires: pending.expires } : null;
    },
    answer(allow) {
      lapse();
      if (!pending || pending.answer) return false;
      pending.answer = allow ? "allowed" : "denied";
      host.log(`Sign-in: the modder ${allow ? "allowed" : "denied"} ${pending.client.name} (${pending.code})`);
      host.onPending(null);
      return true;
    },
    clients() {
      prune();
      const live = new Set(store.tokens.map((t) => t.client));
      return Object.entries(store.clients)
        .filter(([id]) => live.has(id))
        .map(([id, c]) => ({ id, name: c.name, created: c.created, lastUsed: c.lastUsed }));
    },
    revoke(id) {
      load();
      const c = store.clients[id];
      if (!c) return false;
      store.tokens = store.tokens.filter((t) => t.client !== id);
      for (const [code, x] of codes) if (x.clientId === id) codes.delete(code);
      save();
      host.changed?.();
      host.log(`Sign-in: signed out ${c.name}`);
      return true;
    },
    used(clientId) {
      const c = store.clients[clientId];
      if (c) c.lastUsed = Date.now();
    },
  };
}
