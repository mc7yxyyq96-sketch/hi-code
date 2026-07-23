#!/usr/bin/env node
/**
 * Hi Code Local Gateway (clean-room Wave3).
 * HTTP control plane for sessions, channels, memory hooks, and relay health.
 *
 * Start:
 *   node services/gateway/server.mjs --port 8787 --token dev-token
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createChannelRegistry } from "./channels.mjs";
import { createSessionRouter } from "./session-router.mjs";
import { acceptWebSocket } from "./ws.mjs";
import { createTelegramPoller } from "./telegram-poller.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let port = Number(process.env.HICODE_GATEWAY_PORT || 8787);
  let token = process.env.HICODE_GATEWAY_TOKEN || "";
  let host = process.env.HICODE_GATEWAY_HOST || "127.0.0.1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === "--token" && argv[i + 1]) token = String(argv[++i]);
    else if (argv[i] === "--host" && argv[i + 1]) host = String(argv[++i]);
  }
  if (!token) token = crypto.randomBytes(16).toString("hex");
  return { port, token, host };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { _raw: Buffer.concat(chunks).toString("utf8") };
  }
}

function authorized(req, token) {
  const header = String(req.headers.authorization || "");
  if (header === `Bearer ${token}`) return true;
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams.get("token") === token;
}

export function createGatewayServer({ port, token, host = "127.0.0.1", now = () => Date.now() } = {}) {
  const startedAt = now();
  const channels = createChannelRegistry();
  const sessions = createSessionRouter({ now });
  /** @type {Set<{ send: Function, close: Function }>} */
  const sockets = new Set();
  const state = {
    version: "0.2.0-wave3",
    host,
    port,
    token,
    relay: {
      upstream: process.env.HICODE_MODEL_GATEWAY_URL || "",
      configured: Boolean(process.env.HICODE_MODEL_GATEWAY_URL),
      holdsClientMasterKey: false,
    },
    webhooks: [],
    wsClients: 0,
  };

  function broadcast(event) {
    state.wsClients = sockets.size;
    for (const client of sockets) {
      try { client.send(event); } catch { /* ignore */ }
    }
  }

  const telegram = createTelegramPoller({
    getToken: () => channels.getToken("telegram"),
    onMessage: (message) => {
      const accepted = channels.acceptInbound(message);
      if (!accepted.ok) return;
      const session = sessions.routeInbound(accepted.message);
      broadcast({ type: "channel.inbound", session, message: accepted.message });
    },
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const pathname = url.pathname;

    if (pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "hi-code-gateway",
        version: state.version,
        uptimeMs: now() - startedAt,
      });
    }

    if (!authorized(req, token) && pathname !== "/health") {
      return json(res, 401, { ok: false, error: "unauthorized" });
    }

    if (pathname === "/v1/status" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        version: state.version,
        uptimeMs: now() - startedAt,
        channels: channels.list(),
        sessions: sessions.list(),
        relay: state.relay,
        webhooks: state.webhooks,
      });
    }

    if (pathname === "/v1/sessions" && req.method === "GET") {
      return json(res, 200, { ok: true, sessions: sessions.list() });
    }

    if (pathname === "/v1/sessions" && req.method === "POST") {
      const body = await readBody(req);
      const session = sessions.create({
        channel: body.channel || "desktop",
        externalId: body.externalId || "",
        workspace: body.workspace || "",
        metadata: body.metadata || {},
      });
      return json(res, 201, { ok: true, session });
    }

    if (pathname.startsWith("/v1/sessions/") && req.method === "GET") {
      const id = pathname.slice("/v1/sessions/".length);
      const session = sessions.get(id);
      return session ? json(res, 200, { ok: true, session }) : json(res, 404, { ok: false, error: "not found" });
    }

    if (pathname === "/v1/channels" && req.method === "GET") {
      return json(res, 200, { ok: true, channels: channels.list() });
    }

    if (pathname === "/v1/channels/configure" && req.method === "POST") {
      const body = await readBody(req);
      const result = channels.configure(body.id, body.config || {});
      if (result.ok && body.id === "telegram") {
        if (result.channel?.enabled) telegram.start();
        else telegram.stop();
      }
      return json(res, result.ok ? 200 : 400, { ...result, telegram: telegram.status() });
    }

    if (pathname === "/v1/channels/telegram/start" && req.method === "POST") {
      return json(res, 200, telegram.start());
    }
    if (pathname === "/v1/channels/telegram/stop" && req.method === "POST") {
      return json(res, 200, telegram.stop());
    }

    if (pathname === "/v1/channels/inbound" && req.method === "POST") {
      const body = await readBody(req);
      const accepted = channels.acceptInbound(body);
      if (!accepted.ok) return json(res, 400, accepted);
      const session = sessions.routeInbound(accepted.message);
      return json(res, 200, { ok: true, session, message: accepted.message });
    }

    if (pathname === "/v1/webhooks" && req.method === "GET") {
      return json(res, 200, { ok: true, webhooks: state.webhooks });
    }

    if (pathname === "/v1/webhooks" && req.method === "POST") {
      const body = await readBody(req);
      const hook = {
        id: `hook-${crypto.randomBytes(4).toString("hex")}`,
        url: String(body.url || ""),
        events: Array.isArray(body.events) ? body.events.map(String) : ["session.message"],
        createdAt: now(),
      };
      if (!hook.url) return json(res, 400, { ok: false, error: "url required" });
      state.webhooks.push(hook);
      return json(res, 201, { ok: true, webhook: hook });
    }

    if (pathname === "/v1/relay/health" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        configured: state.relay.configured,
        upstream: state.relay.upstream ? "[configured]" : "",
        holdsClientMasterKey: false,
        note: "Desktop clients should never hold upstream master keys; Gateway/NewAPI owns them.",
      });
    }

    if (pathname === "/v1/control" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        panels: ["channels", "sessions", "memory", "mcp", "webhooks", "relay", "ws"],
        channels: channels.list(),
        sessions: sessions.list().slice(0, 20),
        relay: { configured: state.relay.configured, holdsClientMasterKey: false },
        ws: { clients: sockets.size, path: "/v1/ws" },
        telegram: telegram.status(),
      });
    }

    return json(res, 404, { ok: false, error: "not found" });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname !== "/v1/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const client = acceptWebSocket(req, socket, head, { token });
    if (!client) return;
    sockets.add(client);
    state.wsClients = sockets.size;
    client.send({ type: "hello", version: state.version, at: now() });
    client.onMessage = (data) => {
      if (data?.type === "ping") {
        client.send({ type: "pong", at: now() });
        return;
      }
      if (data?.type === "inbound") {
        const accepted = channels.acceptInbound(data);
        if (!accepted.ok) {
          client.send({ type: "error", error: accepted.error });
          return;
        }
        const session = sessions.routeInbound(accepted.message);
        broadcast({ type: "channel.inbound", session, message: accepted.message });
        return;
      }
      client.send({ type: "ack", received: data?.type || "unknown" });
    };
    socket.on("close", () => {
      sockets.delete(client);
      state.wsClients = sockets.size;
    });
  });

  function listen() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        const info = { ok: true, host, port, token, pid: process.pid, version: state.version };
        const marker = path.join(os.homedir(), ".hicode", "gateway.json");
        try {
          fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
          fs.writeFileSync(marker, JSON.stringify({ ...info, startedAt }, null, 2), { mode: 0o600 });
        } catch { /* ignore */ }
        resolve(info);
      });
    });
  }

  function close() {
    telegram.stop();
    for (const client of sockets) client.close();
    sockets.clear();
    return new Promise((resolve) => server.close(() => resolve({ ok: true })));
  }

  return { server, listen, close, channels, sessions, state, telegram, broadcast };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const gateway = createGatewayServer(opts);
  const info = await gateway.listen();
  console.log(`[hi-code-gateway] listening on http://${info.host}:${info.port}`);
  console.log(`[hi-code-gateway] token ${info.token}`);
  console.log(`[hi-code-gateway] health http://${info.host}:${info.port}/health`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
