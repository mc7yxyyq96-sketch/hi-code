import assert from "node:assert/strict";
import http from "node:http";

import {
  callMcpToolDetailed,
  cancelMcpRequest,
  initMcp,
  mcpLifecycleStatus,
  mcpToolSchemas,
  reconnectMcpServer,
  shutdownMcp,
} from "../dist/mcp.js";
import {
  createMcpAuthProvider,
  createOAuthAuthorizationRequest,
  exchangeOAuthAuthorizationCode,
} from "../dist/mcp-auth.js";
import { normalizeMcpError, redactMcpText } from "../dist/mcp-protocol.js";
import { StreamableHttpMcpTransport, validateMcpHttpEndpoint } from "../dist/mcp-transport.js";
import { prepareConfigForSecretPersistence } from "../dist/secret-references.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error?.stack || error}`);
    failed++;
  }
}

function createProtocolServer() {
  const state = {
    sessionSequence: 0,
    eventSequence: 0,
    deletes: 0,
    cancellations: [],
    requests: [],
    streams: new Map(),
    queued: new Map(),
  };

  function emit(sessionId, message) {
    const payload = `id: event-${++state.eventSequence}\ndata: ${JSON.stringify(message)}\n\n`;
    const stream = state.streams.get(sessionId);
    if (stream && !stream.writableEnded) stream.write(payload);
    else state.queued.set(sessionId, [...(state.queued.get(sessionId) || []), payload]);
  }

  const server = http.createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    const sessionId = request.headers["mcp-session-id"];
    if (request.method === "GET") {
      if (typeof sessionId !== "string") {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.flushHeaders();
      state.streams.set(sessionId, response);
      for (const payload of state.queued.get(sessionId) || []) response.write(payload);
      state.queued.delete(sessionId);
      request.on("close", () => {
        if (state.streams.get(sessionId) === response) state.streams.delete(sessionId);
      });
      return;
    }
    if (request.method === "DELETE") {
      state.deletes++;
      response.writeHead(204).end();
      if (typeof sessionId === "string") {
        state.streams.get(sessionId)?.end();
        state.streams.delete(sessionId);
      }
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }

    const body = await readJson(request);
    state.requests.push({ body, headers: { ...request.headers } });
    if (body.method === "initialize") {
      const nextSession = `session-${++state.sessionSequence}`;
      response.writeHead(202, { "mcp-session-id": nextSession }).end();
      emit(nextSession, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: true }, logging: {} },
          serverInfo: { name: "hicode-test-mcp", version: "1.0.0" },
        },
      });
      return;
    }
    if (body.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    if (body.method === "notifications/cancelled") {
      state.cancellations.push(body.params);
      response.writeHead(202).end();
      return;
    }
    if (body.method === "tools/list") {
      sendJson(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [{
            name: "echo",
            description: "Returns bounded text from the protocol test server",
            inputSchema: { type: "object", properties: { text: { type: "string" }, mode: { type: "string" } } },
          }],
        },
      });
      return;
    }
    if (body.method === "tools/call") {
      const mode = body.params?.arguments?.mode;
      if (mode === "hold") {
        response.writeHead(202).end();
        return;
      }
      if (mode === "stream") {
        response.writeHead(202).end();
        const token = body.params?._meta?.progressToken;
        setTimeout(() => emit(sessionId, {
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: token, progress: 0.5, message: "halfway" },
        }), 10);
        setTimeout(() => emit(sessionId, {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "stream complete" }], structuredContent: { completed: true } },
        }), 25);
        return;
      }
      if (mode === "error") {
        sendJson(response, { jsonrpc: "2.0", id: body.id, error: { code: -32010, message: "fixture failure" } });
        return;
      }
      sendJson(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: String(body.params?.arguments?.text || "") }] },
      });
      return;
    }
    response.writeHead(202).end();
  });

  return { server, state };
}

console.log("\n[mcp-connection] Streamable HTTP protocol");
const protocol = createProtocolServer();
await listen(protocol.server);
const address = protocol.server.address();
const endpoint = `http://127.0.0.1:${address.port}/mcp`;

await test("initializes an asynchronous Streamable HTTP session and discovers tools", async () => {
  const [result] = await initMcp({
    remote: {
      transport: "streamable-http",
      url: endpoint,
      timeoutMs: 400,
      reconnect: { maxAttempts: 1, baseDelayMs: 20 },
      auth: { type: "none" },
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.transport, "streamable-http");
  assert.equal(result.protocolVersion, "2025-11-25");
  assert.equal(result.sessionId, "session-1");
  assert.deepEqual(mcpToolSchemas().map((tool) => tool.function.name), ["mcp__remote__echo"]);
  const lifecycle = mcpLifecycleStatus()[0];
  assert.equal(lifecycle.state, "ready");
  assert.deepEqual(lifecycle.capabilities.tools, { listChanged: true });
});

await test("sends session and negotiated protocol headers after initialization", () => {
  const listRequest = protocol.state.requests.find((item) => item.body.method === "tools/list");
  assert.equal(listRequest.headers["mcp-session-id"], "session-1");
  assert.equal(listRequest.headers["mcp-protocol-version"], "2025-11-25");
});

await test("returns direct tool results", async () => {
  const result = await callMcpToolDetailed("mcp__remote__echo", { text: "hello" });
  assert.equal(result.text, "hello");
  assert.equal(result.isError, false);
});

await test("streams progress before the final tool result", async () => {
  const progress = [];
  const result = await callMcpToolDetailed("mcp__remote__echo", { mode: "stream" }, { onProgress: (item) => progress.push(item) });
  assert.equal(result.text, "stream complete");
  assert.deepEqual(result.structuredContent, { completed: true });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].progress, 0.5);
});

await test("normalizes server errors without exposing raw transport objects", async () => {
  await assert.rejects(
    callMcpToolDetailed("mcp__remote__echo", { mode: "error" }),
    (error) => {
      const normalized = normalizeMcpError(error);
      assert.equal(normalized.code, "MCP_SERVER_ERROR");
      assert.equal(normalized.kind, "server");
      assert.equal(normalized.retryable, false);
      return true;
    },
  );
});

await test("cancels an active request and sends notifications/cancelled", async () => {
  const pending = callMcpToolDetailed("mcp__remote__echo", { mode: "hold" });
  await waitFor(() => mcpLifecycleStatus()[0]?.activeCalls.length === 1);
  const callId = mcpLifecycleStatus()[0].activeCalls[0];
  assert.deepEqual(cancelMcpRequest("remote", callId), { ok: true, server: "remote", cancelled: 1 });
  await assert.rejects(pending, (error) => normalizeMcpError(error).code === "MCP_CANCELLED");
  await waitFor(() => protocol.state.cancellations.some((item) => item?.reason === "client cancellation"));
});

await test("times out unanswered requests and reports a retryable timeout", async () => {
  await assert.rejects(
    callMcpToolDetailed("mcp__remote__echo", { mode: "hold" }),
    (error) => {
      const normalized = normalizeMcpError(error);
      assert.equal(normalized.code, "MCP_TIMEOUT");
      assert.equal(normalized.retryable, true);
      return true;
    },
  );
  await waitFor(() => protocol.state.cancellations.some((item) => item?.reason === "request timeout"));
});

await test("reconnects with a new session and closes the old session", async () => {
  const result = await reconnectMcpServer("remote");
  assert.equal(result.ok, true, result.error);
  assert.equal(result.sessionId, "session-2");
  assert.ok(protocol.state.deletes >= 1);
  assert.ok(mcpLifecycleStatus()[0].reconnectCount >= 1);
});

await test("graceful shutdown sends DELETE and clears lifecycle state", async () => {
  const before = protocol.state.deletes;
  await shutdownMcp();
  assert.ok(protocol.state.deletes > before);
  assert.deepEqual(mcpLifecycleStatus(), []);
});

await test("normalizes invalid server construction without rejecting the whole manager", async () => {
  const results = await initMcp({
    invalid: { transport: "streamable-http", url: "http://remote.example.com/mcp", auth: { type: "none" } },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].transport, "streamable-http");
  assert.equal(results[0].normalizedError.code, "MCP_URL_INSECURE");
  await shutdownMcp();
});

console.log("\n[mcp-connection] authentication and secret handling");

await test("rejects insecure remote endpoints and endpoint-embedded state", () => {
  assert.throws(() => validateMcpHttpEndpoint("http://example.com/mcp"), /HTTPS/);
  assert.throws(() => validateMcpHttpEndpoint("https://user:pass@example.com/mcp"), /credentials/);
  assert.throws(() => validateMcpHttpEndpoint("https://example.com/mcp?token=x"), /query/);
  assert.equal(validateMcpHttpEndpoint("http://127.0.0.1:3000/mcp"), "http://127.0.0.1:3000/mcp");
});

await test("cancels oversized Streamable HTTP responses while reading", async () => {
  const oversized = endlessResponse("application/json", 64 * 1024);
  const transport = new StreamableHttpMcpTransport(
    "bounded-http",
    { url: "https://mcp.example.com/endpoint", timeoutMs: 500 },
    createMcpAuthProvider({ type: "none" }),
    {},
    async () => oversized.response,
  );
  await transport.open();
  await assert.rejects(
    transport.request("tools/list"),
    (error) => normalizeMcpError(error).code === "MCP_MESSAGE_TOO_LARGE",
  );
  assert.equal(oversized.state.cancelled, true);
  assert.ok(oversized.state.pulls <= 18, `expected early cancellation, received ${oversized.state.pulls} chunks`);
  await transport.close();
});

await test("cancels rejected HTTP responses without accepting their session id", async () => {
  const rejected = endlessResponse("application/json", 256, {
    status: 401,
    headers: { "mcp-session-id": "untrusted-session" },
  });
  const transport = new StreamableHttpMcpTransport(
    "rejected-http",
    { url: "https://mcp.example.com/endpoint", timeoutMs: 500 },
    createMcpAuthProvider({ type: "none" }),
    {},
    async () => rejected.response,
  );
  await transport.open();
  await assert.rejects(
    transport.request("tools/list"),
    (error) => normalizeMcpError(error).code === "MCP_HTTP_401",
  );
  assert.equal(rejected.state.cancelled, true);
  assert.equal(transport.session().id, undefined);
  await transport.close();
});

await test("refreshes expired OAuth tokens and persists the rotated values", async () => {
  const updates = [];
  const calls = [];
  const provider = createMcpAuthProvider({
    type: "oauth",
    clientId: "desktop-client",
    tokenEndpoint: "http://127.0.0.1/token",
    authorizationEndpoint: "http://127.0.0.1/authorize",
    accessToken: "expired-access",
    refreshToken: "refresh-value",
    expiresAt: "1970-01-01T00:00:00.000Z",
  }, {
    now: () => 1_000_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body || "") });
      return new Response(JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    onTokenUpdate: (update) => updates.push(update),
  });
  const headers = new Headers();
  await provider.authorize(headers, "http://127.0.0.1:3000/mcp");
  assert.equal(headers.get("authorization"), "Bearer rotated-access");
  assert.match(calls[0].body, /grant_type=refresh_token/);
  assert.match(calls[0].body, /resource=http%3A%2F%2F127.0.0.1%3A3000%2Fmcp/);
  assert.equal(updates[0].refreshToken, "rotated-refresh");
  assert.equal(provider.status().state, "ready");
});

await test("cancels oversized OAuth responses while reading", async () => {
  const oversized = endlessResponse("application/json", 64 * 1024);
  const provider = createMcpAuthProvider({
    type: "oauth",
    clientId: "desktop-client",
    tokenEndpoint: "http://127.0.0.1/token",
    authorizationEndpoint: "http://127.0.0.1/authorize",
    accessToken: "expired-access",
    refreshToken: "refresh-value",
    expiresAt: "1970-01-01T00:00:00.000Z",
  }, {
    now: () => 1_000_000,
    fetchImpl: async () => oversized.response,
  });
  await assert.rejects(
    provider.authorize(new Headers(), "http://127.0.0.1:3000/mcp"),
    (error) => normalizeMcpError(error).code === "MCP_OAUTH_RESPONSE_TOO_LARGE",
  );
  assert.equal(oversized.state.cancelled, true);
  assert.ok(oversized.state.pulls <= 10, `expected early OAuth cancellation, received ${oversized.state.pulls} chunks`);
});

await test("cancels failed OAuth token responses before surfacing the error", async () => {
  const rejected = endlessResponse("application/json", 256, { status: 503 });
  const provider = createMcpAuthProvider({
    type: "oauth",
    clientId: "desktop-client",
    tokenEndpoint: "http://127.0.0.1/token",
    authorizationEndpoint: "http://127.0.0.1/authorize",
    accessToken: "expired-access",
    refreshToken: "refresh-value",
    expiresAt: "1970-01-01T00:00:00.000Z",
  }, {
    now: () => 1_000_000,
    fetchImpl: async () => rejected.response,
  });
  await assert.rejects(
    provider.authorize(new Headers(), "http://127.0.0.1:3000/mcp"),
    (error) => normalizeMcpError(error).code === "MCP_OAUTH_TOKEN_FAILED",
  );
  assert.equal(rejected.state.cancelled, true);
});

await test("rejects OAuth authorization metadata with a mismatched issuer", async () => {
  await assert.rejects(
    createOAuthAuthorizationRequest({
      config: { type: "oauth", clientId: "desktop-client", authorizationServer: "https://auth.example.com" },
      resourceUrl: "https://mcp.example.com/endpoint",
      redirectUri: "http://127.0.0.1:4567/callback",
      fetchImpl: async () => new Response(JSON.stringify({
        issuer: "https://other.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    }),
    (error) => normalizeMcpError(error).code === "MCP_OAUTH_ISSUER_MISMATCH",
  );
});

await test("creates PKCE authorization requests and rejects state mismatch", async () => {
  const config = {
    type: "oauth",
    clientId: "desktop-client",
    authorizationEndpoint: "http://127.0.0.1/authorize",
    tokenEndpoint: "http://127.0.0.1/token",
    scopes: ["mcp:tools"],
  };
  const request = await createOAuthAuthorizationRequest({
    config,
    resourceUrl: "http://127.0.0.1:3000/mcp",
    redirectUri: "http://127.0.0.1:4567/callback",
  });
  const authorizationUrl = new URL(request.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.get("resource"), "http://127.0.0.1:3000/mcp");
  await assert.rejects(exchangeOAuthAuthorizationCode({
    config,
    resourceUrl: "http://127.0.0.1:3000/mcp",
    request,
    code: "authorization-code",
    returnedState: "wrong-state",
  }), /state validation failed/);
});

await test("externalizes bearer and OAuth tokens before config persistence", () => {
  const prepared = prepareConfigForSecretPersistence({
    mcpServers: {
      bearer: { transport: "streamable-http", url: "https://mcp.example.com", auth: { type: "bearer", token: "bearer-secret" } },
      oauth: { transport: "streamable-http", url: "https://oauth.example.com", auth: { type: "oauth", clientId: "desktop", accessToken: "access-secret", refreshToken: "refresh-secret" } },
    },
  });
  const persisted = JSON.stringify(prepared.config);
  assert.equal(persisted.includes("bearer-secret"), false);
  assert.equal(persisted.includes("access-secret"), false);
  assert.equal(persisted.includes("refresh-secret"), false);
  assert.equal(prepared.writes.length, 3);
  assert.ok(prepared.writes.every((write) => write.scope === "mcp"));
});

await test("redacts MCP tokens, secrets, passwords, and keys from logs", () => {
  const redacted = redactMcpText("Authorization: Bearer abc123 GITHUB_TOKEN=ghp_test CLIENT_SECRET=s3cret password=hunter2 api_key=key-value");
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("ghp_test"), false);
  assert.equal(redacted.includes("s3cret"), false);
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("key-value"), false);
});

for (const stream of protocol.state.streams.values()) stream.end();
await closeServer(protocol.server);
await shutdownMcp();

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);

function sendJson(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function endlessResponse(contentType, chunkBytes, options = {}) {
  const state = { pulls: 0, cancelled: false };
  const headers = new Headers(options.headers || {});
  headers.set("content-type", contentType);
  const response = new Response(new ReadableStream({
    pull(controller) {
      state.pulls++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
    cancel() {
      state.cancelled = true;
    },
  }), { status: options.status || 200, headers });
  return { response, state };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for protocol state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
