import assert from "node:assert/strict";
import { createGatewayServer } from "../services/gateway/server.mjs";
import { createChannelRegistry } from "../services/gateway/channels.mjs";
import { createSessionRouter } from "../services/gateway/session-router.mjs";

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

await gateway.close();
console.log("gateway-tests: ok");
