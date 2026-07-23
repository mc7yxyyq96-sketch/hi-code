import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { createGatewayServer } from "../services/gateway/server.mjs";
import { createChannelRegistry } from "../services/gateway/channels.mjs";
import { createSessionRouter } from "../services/gateway/session-router.mjs";
import { createTelegramPoller } from "../services/gateway/telegram-poller.mjs";

const channels = createChannelRegistry();
assert.equal(channels.list().some((c) => c.id === "telegram"), true);
assert.equal(channels.list().some((c) => c.id === "discord"), true);
const configured = channels.configure("telegram", { botToken: "x:y" });
assert.equal(configured.ok, true);
assert.equal(configured.channel.enabled, true);
assert.equal(configured.channel.config.botTokenSet, true);
assert.equal(configured.channel.config._token, undefined);

const router = createSessionRouter({ now: () => 1000 });
const a = router.routeInbound({ channel: "telegram", externalId: "chat-1", text: "hi" });
const b = router.routeInbound({ channel: "telegram", externalId: "chat-1", text: "again" });
assert.equal(a.id, b.id);
assert.equal(b.messageCount, 2);

const gateway = createGatewayServer({ port: 0, token: "test-token", host: "127.0.0.1" });
const info = await gateway.listen();
assert.equal(info.ok, true);
const address = gateway.server.address();
const port = typeof address === "object" ? address.port : info.port;

const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
assert.equal(health.ok, true);

const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/status`).then((r) => r.json());
assert.equal(unauthorized.ok, false);

const status = await fetch(`http://127.0.0.1:${port}/v1/status`, {
  headers: { authorization: "Bearer test-token" },
}).then((r) => r.json());
assert.equal(status.ok, true);
assert.equal(status.relay.holdsClientMasterKey, false);

const inbound = await fetch(`http://127.0.0.1:${port}/v1/channels/inbound`, {
  method: "POST",
  headers: { authorization: "Bearer test-token", "content-type": "application/json" },
  body: JSON.stringify({ channel: "desktop", externalId: "u1", text: "hello gateway" }),
}).then((r) => r.json());
assert.equal(inbound.ok, true);
assert.ok(inbound.session.id);

// Telegram poller with mocked fetch
let calls = 0;
const poller = createTelegramPoller({
  getToken: () => "123:abc",
  intervalMs: 10_000,
  fetchImpl: async () => {
    calls += 1;
    return {
      json: async () => ({
        ok: true,
        result: calls === 1
          ? [{ update_id: 7, message: { text: "ping", chat: { id: 42 }, from: { username: "u" } } }]
          : [],
      }),
    };
  },
  onMessage: (msg) => {
    assert.equal(msg.channel, "telegram");
    assert.equal(msg.externalId, "42");
    assert.equal(msg.text, "ping");
  },
});
await poller.tick();
assert.equal(calls, 1);

// WebSocket upgrade succeeds with token
await new Promise((resolve, reject) => {
  const key = crypto.randomBytes(16).toString("base64");
  const req = http.request({
    hostname: "127.0.0.1",
    port,
    path: `/v1/ws?token=test-token`,
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": key,
    },
  });
  const timer = setTimeout(() => reject(new Error("ws upgrade timeout")), 3000);
  req.on("upgrade", (_res, socket) => {
    clearTimeout(timer);
    assert.ok(socket);
    socket.destroy();
    resolve();
  });
  req.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
  req.end();
});

const control = await fetch(`http://127.0.0.1:${port}/v1/control`, {
  headers: { authorization: "Bearer test-token" },
}).then((r) => r.json());
assert.equal(control.ok, true);
assert.equal(control.ws.path, "/v1/ws");

await gateway.close();
console.log("gateway-tests: ok");
