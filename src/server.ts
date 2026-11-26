// EDGEguide's MCP server: Streamable HTTP on 127.0.0.1:41822/mcp, stateless, JSON responses, as
// REDnode's (packages/overlay/mcp.js). Every request must name this server in Host, and a browser's
// Origin must be the server too, so a web page cannot reach it (DNS rebinding included). /mcp needs
// a Bearer token from the OAuth sign-in (oauth.ts).
//
// One editor window listens (design, "G0 decisions"): the port is fixed, so the first window to
// start takes it and the others try again every 10 s, taking over when that window closes.
// No vscode import: the tests run it in plain Node.

import * as http from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuth } from "./oauth";

export const DefaultPort = 41822;
const RetryMs = 10 * 1000;

export interface Who {
  /** The signed-in client's name, such as "Claude Code (plugin:edge:edgeguide)". */
  name: string;
  client: string;
}

export interface ServerHost {
  port: number;
  /** How often a window that waits for the port tries again; 10 s unless a test sets it. */
  retryMs?: number;
  oauth: OAuth;
  log(line: string): void;
  /** A new MCP server with EDGEguide's tools, one per request (stateless). */
  build(who: Who): McpServer;
  /** Listening started or stopped, or the port is held by another window or program. */
  changed?(state: ServerState): void;
}

export type ServerState = { listening: true; port: number } | { listening: false; port: number; waiting: boolean };

export interface GuideServer {
  start(): void;
  stop(): Promise<void>;
  state(): ServerState;
}

export function createServer(host: ServerHost): GuideServer {
  let server: http.Server | null = null;
  let retry: NodeJS.Timeout | null = null;
  let stopped = true;
  let waiting = false;
  let listening = false;
  const here = [`127.0.0.1:${host.port}`, `localhost:${host.port}`];
  const retryMs = host.retryMs ?? RetryMs;

  const state = (): ServerState => (listening ? { listening: true, port: host.port } : { listening: false, port: host.port, waiting });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin;
    if (!here.includes(req.headers.host ?? "") || (origin && origin !== "null" && !here.some((h) => origin === `http://${h}`))) {
      res.writeHead(403).end();
      return;
    }
    const base = `http://${req.headers.host}`;
    if (await host.oauth.route(req, res, url, base)) return;
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const signedIn = host.oauth.check(token);
    if (!signedIn) {
      res
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` })
        .end(JSON.stringify({ error: "A valid token is required" }));
      return;
    }
    host.oauth.used(signedIn.client);
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end(); // stateless: no server-sent stream, no sessions
      return;
    }
    let body: unknown;
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const mcp = host.build({ name: signedIn.name, client: signedIn.client });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: here,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      host.log(`MCP request failed: ${(err as Error).message}`);
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  function listen() {
    if (stopped) return;
    const s = http.createServer((req, res) => void handle(req, res));
    server = s;
    s.on("error", (err: NodeJS.ErrnoException) => {
      if (server === s) server = null;
      listening = false;
      if (err.code !== "EADDRINUSE") {
        host.log(`Could not listen on port ${host.port}: ${err.message}`);
        host.changed?.(state());
        return;
      }
      if (!waiting) {
        waiting = true;
        host.log(`Port ${host.port} is in use, most likely by EDGEguide in another editor window; trying again every ${retryMs / 1000} s`);
        host.changed?.(state());
      }
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => {
        retry = null;
        if (!stopped && !server) listen();
      }, retryMs);
    });
    s.listen(host.port, "127.0.0.1", () => {
      waiting = false;
      listening = true;
      host.log(`MCP server on http://127.0.0.1:${host.port}/mcp`);
      host.changed?.(state());
    });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      listen();
    },
    async stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      waiting = false;
      const s = server;
      server = null;
      if (!s) return;
      const wasListening = listening;
      listening = false;
      await new Promise<void>((done) => {
        s.close(() => done());
        s.closeAllConnections?.();
      });
      if (wasListening) host.log("MCP server stopped");
    },
    state,
  };
}
