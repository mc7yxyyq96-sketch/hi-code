import http from "node:http";

import { createRuntime } from "../dist/runtime.js";
import { deleteSession } from "../dist/session-store.js";
import {
  MODEL_PROVIDER_SCHEMA_VERSION,
  ModelProviderRegistry,
  completeModelProfile,
  createLegacyOpenAICompatibleAdapter,
  deriveModelProviderRequirements,
  migrateLegacyModelProfile,
  normalizeModelProviderError,
  streamModelProfile,
} from "../dist/model-provider.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    fail++;
  }
}

async function rejectsCode(name, fn, code) {
  try {
    await fn();
    check(name, false, "expected rejection");
  } catch (error) {
    check(name, error?.code === code, `${error?.code || "no-code"}: ${error?.message || error}`);
  }
}

function capability(support, reason) {
  return { support, ...(reason ? { reason } : {}) };
}

console.log("\n[model-provider] capability negotiation");

let limitedRuns = 0;
const limitedRegistry = new ModelProviderRegistry();
limitedRegistry.register({
  id: "limited-model",
  name: "Limited Model",
  version: "1.0.0",
  capabilities: {
    "input.text": capability("supported"),
    "input.image": capability("unsupported", "text-only fixture"),
    "tool.calling": capability("unsupported", "tools disabled"),
    "tool.streaming": capability("unsupported", "tools disabled"),
    "reasoning.summary": capability("unsupported"),
    "output.structured": capability("unsupported"),
    usage: capability("supported"),
    interruption: capability("supported"),
  },
  limits: { contextTokens: 1024, outputTokens: 256 },
  async run() {
    limitedRuns++;
    return { content: "should not run", toolCalls: [], finishReason: "stop", aborted: false };
  },
});

const textNegotiation = limitedRegistry.negotiate("limited-model", {
  capabilities: ["input.text"],
  contextTokens: 512,
  outputTokens: 128,
});
check("supported request negotiates", textNegotiation.ok && textNegotiation.warnings.length === 0);

await rejectsCode(
  "unsupported image rejects before adapter request",
  () => limitedRegistry.run("limited-model", {
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }],
    tools: [],
  }),
  "provider_capability_unsupported",
);
check("unsupported request never enters adapter", limitedRuns === 0, String(limitedRuns));

await rejectsCode(
  "context limit rejects before adapter request",
  () => limitedRegistry.run("limited-model", {
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    requirements: { contextTokens: 2048 },
  }),
  "provider_context_limit_exceeded",
);
check("context rejection never enters adapter", limitedRuns === 0, String(limitedRuns));

const derived = deriveModelProviderRequirements(
  [{ role: "user", content: [{ type: "text", text: "inspect" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }],
  [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
  { requireInterruption: true },
);
check(
  "requirements derive image, tools, streaming, and interruption",
  ["input.text", "input.image", "tool.calling", "tool.streaming", "interruption"].every((item) => derived.capabilities.includes(item)),
  JSON.stringify(derived),
);

console.log("\n[model-provider] event semantics");

const semanticRegistry = new ModelProviderRegistry();
semanticRegistry.register({
  id: "semantic-model",
  name: "Semantic Model",
  version: "1.0.0",
  capabilities: {
    "input.text": capability("supported"),
    "input.image": capability("unsupported"),
    "tool.calling": capability("supported"),
    "tool.streaming": capability("supported"),
    "reasoning.summary": capability("unsupported"),
    "output.structured": capability("unsupported"),
    usage: capability("supported"),
    interruption: capability("supported"),
  },
  limits: { contextTokens: 8192, outputTokens: 2048 },
  async run(_request, sink) {
    sink.emit({ type: "text.delta", delta: "hello" });
    sink.emit({ type: "tool.call.started", callId: "call-1", name: "read_file", index: 0 });
    sink.emit({ type: "tool.call.delta", callId: "call-1", argumentsDelta: "{\"path\":", index: 0 });
    sink.emit({ type: "tool.call.delta", callId: "call-1", argumentsDelta: "\"README.md\"}", index: 0 });
    sink.emit({
      type: "tool.call.completed",
      call: { id: "call-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" } },
      index: 0,
    });
    sink.emit({ type: "usage.updated", usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } });
    return {
      content: "hello",
      toolCalls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" } }],
      usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
      finishReason: "tool_calls",
      aborted: false,
    };
  },
});

const semanticEvents = [];
const semanticRun = await semanticRegistry.run("semantic-model", {
  messages: [{ role: "user", content: "read the file" }],
  tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
}, (event) => semanticEvents.push(event));

check(
  "provider event order preserves request, text, tool, usage, and terminal semantics",
  semanticEvents.map((event) => event.type).join(",") === [
    "request.started",
    "text.delta",
    "tool.call.started",
    "tool.call.delta",
    "tool.call.delta",
    "tool.call.completed",
    "usage.updated",
    "response.completed",
  ].join(","),
  semanticEvents.map((event) => event.type).join(","),
);
check("provider events have contiguous sequence", semanticEvents.every((event, index) => event.sequence === index + 1));
check("completed tool arguments remain exact", semanticRun.toolCalls[0]?.function.arguments === "{\"path\":\"README.md\"}");
check("normalized usage remains exact", semanticRun.usage?.totalTokens === 13 && semanticEvents.at(-2)?.usage?.inputTokens === 10);

const invalidRegistry = new ModelProviderRegistry();
invalidRegistry.register({
  id: "invalid-events",
  name: "Invalid Events",
  version: "1.0.0",
  capabilities: { "input.text": capability("supported") },
  async run(_request, sink) {
    sink.emit({ type: "tool.call.delta", callId: "missing-start", argumentsDelta: "{}", index: 0 });
    return { content: "", toolCalls: [], finishReason: "stop", aborted: false };
  },
});
await rejectsCode(
  "invalid provider event sequence is rejected",
  () => invalidRegistry.run("invalid-events", { messages: [{ role: "user", content: "hello" }], tools: [] }),
  "provider_event_invalid",
);

const incompleteRegistry = new ModelProviderRegistry();
incompleteRegistry.register({
  id: "incomplete-events",
  name: "Incomplete Events",
  version: "1.0.0",
  capabilities: {
    "input.text": capability("supported"),
    "tool.calling": capability("supported"),
    "tool.streaming": capability("supported"),
  },
  async run(_request, sink) {
    sink.emit({ type: "tool.call.started", callId: "call-open", name: "read_file", index: 0 });
    return {
      content: "",
      toolCalls: [{ id: "call-open", type: "function", function: { name: "read_file", arguments: "{}" } }],
      finishReason: "tool_calls",
      aborted: false,
    };
  },
});
await rejectsCode(
  "provider result rejects an uncompleted tool call",
  () => incompleteRegistry.run("incomplete-events", {
    messages: [{ role: "user", content: "read" }],
    tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
  }),
  "provider_event_invalid",
);

const normalizedError = normalizeModelProviderError(new Error("Authorization: Bearer secret-token apiKey=sk-live-secret request timed out"));
check("normalized provider error classifies timeout as retriable", normalizedError.category === "timeout" && normalizedError.retriable === true);
check("normalized provider error redacts credentials", !JSON.stringify(normalizedError).includes("secret-token") && !JSON.stringify(normalizedError).includes("sk-live-secret"));

const lateIdProfile = {
  name: "late-id",
  baseURL: "http://127.0.0.1:9/v1",
  apiKey: "unused",
  model: "late-id-model",
  contextWindow: 8192,
  temperature: 0,
};
const lateIdAdapter = createLegacyOpenAICompatibleAdapter(lateIdProfile, {
  async stream(_profile, _messages, _tools, handlers) {
    handlers.onToolCallDelta?.({ index: 0, nameDelta: "read_", argumentsDelta: "{" });
    handlers.onToolCallDelta?.({ index: 0, id: "provider-late-id", nameDelta: "file", argumentsDelta: "}" });
    return {
      content: "",
      tool_calls: [{ id: "provider-late-id", type: "function", function: { name: "read_file", arguments: "{}" } }],
      aborted: false,
    };
  },
});
const lateIdRegistry = new ModelProviderRegistry();
lateIdRegistry.register(lateIdAdapter);
const lateIdEvents = [];
const lateIdResult = await lateIdRegistry.run(lateIdAdapter.descriptor.id, {
  runId: "late-run",
  messages: [{ role: "user", content: "read" }],
  tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
}, (event) => lateIdEvents.push(event));
check("late provider tool IDs keep stable event correlation", lateIdResult.toolCalls[0]?.id === "call_late-run_0" && lateIdEvents.filter((event) => event.type.startsWith("tool.call.")).every((event) => (event.callId || event.call?.id) === "call_late-run_0"));

console.log("\n[model-provider] legacy profile migration and real transport");

const requests = [];
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  requests.push({ url: req.url, body, authorization: req.headers.authorization });

  if (body.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "compact summary" } }] }));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const hasToolResult = body.messages?.some((message) => message.role === "tool");
  const events = hasToolResult
    ? [
        { choices: [{ delta: { content: "runtime complete" } }] },
        { choices: [], usage: { prompt_tokens: 34, completion_tokens: 4, total_tokens: 38 } },
      ]
    : [
        { choices: [{ delta: { content: "hello " } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-local", type: "function", function: { name: "read_", arguments: "{\"path\":" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: "\"README.md\"}" } }] } }] },
        { choices: [], usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 } },
      ];
  for (const item of events) res.write(`data: ${JSON.stringify(item)}\n\n`);
  res.end("data: [DONE]\n\n");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  const profile = {
    name: "legacy-coder",
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "sk-local-secret",
    model: "fixture-model",
    contextWindow: 32768,
    temperature: 0.2,
  };
  const migration = migrateLegacyModelProfile(profile);
  check("legacy profile migrates to schema v2 compatibility adapter", migration.schemaVersion === MODEL_PROVIDER_SCHEMA_VERSION && migration.adapterId === "legacy-openai-compatible");
  check("migration keeps the original persisted profile untouched", migration.profile === profile && profile.baseURL.endsWith("/v1"));

  const adapter = createLegacyOpenAICompatibleAdapter(profile);
  check("compatibility descriptor never contains API key", !JSON.stringify(adapter.descriptor).includes(profile.apiKey));
  check("legacy image capability is explicit conditional support", adapter.descriptor.capabilities["input.image"]?.support === "conditional");

  const nestedSecretRegistry = new ModelProviderRegistry();
  const nestedDescriptor = nestedSecretRegistry.register({
    id: "nested-secrets",
    name: "Nested Secrets",
    version: "1.0.0",
    capabilities: { "input.text": capability("supported") },
    metadata: { values: [{ GITHUB_TOKEN: "token-in-array", note: "apiKey=sk-nested-secret" }] },
    async run() { return { content: "ok", toolCalls: [], finishReason: "stop", aborted: false }; },
  });
  check("nested descriptor metadata is recursively redacted", !JSON.stringify(nestedDescriptor).includes("token-in-array") && !JSON.stringify(nestedDescriptor).includes("sk-nested-secret"));

  const liveEvents = [];
  let liveText = "";
  const turn = await streamModelProfile(
    profile,
    [{ role: "user", content: "hello" }],
    [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
    {
      onText(delta) { liveText += delta; },
      onProviderEvent(event) { liveEvents.push(event); },
    },
  );
  check("real local SSE streams through compatibility adapter", liveText === "hello " && turn.content === "hello ");
  check("real local SSE preserves assembled tool call", turn.tool_calls[0]?.function.name === "read_file" && turn.tool_calls[0]?.function.arguments === "{\"path\":\"README.md\"}");
  check("real local SSE normalizes usage", turn.usage?.prompt_tokens === 21 && turn.usage?.completion_tokens === 7);
  check("real provider events terminate once", liveEvents.filter((event) => event.type.startsWith("response.")).length === 1 && liveEvents.at(-1)?.type === "response.completed");
  check("provider events do not contain API key", !JSON.stringify(liveEvents).includes(profile.apiKey));

  const summary = await completeModelProfile(profile, [{ role: "user", content: "summarize" }], 0.1);
  check("non-streaming model path uses compatibility adapter", summary === "compact summary");
  check("legacy transport requests preserve configured endpoint and credential", requests.length === 2 && requests.every((request) => request.url === "/v1/chat/completions" && request.authorization === `Bearer ${profile.apiKey}`));

  console.log("\n[model-provider] shared runtime integration");

  const runtimeEvents = [];
  const runtime = createRuntime({
    cfg: {
      profiles: { default: profile },
      defaultProfile: "default",
      roleModels: {},
      councilMembers: [],
      councilSynthesizer: "default",
      compactThreshold: 0.75,
      reasoningLevel: "medium",
      sandbox: false,
      mcpServers: {},
    },
    cwd: process.cwd(),
    mode: "default",
    systemPrompt: "Use read_file when asked to inspect README.md.",
    ask: async () => "n",
    legacyAssistantOutput: false,
    persistRuntimeEvents: false,
    emitEvent(event) { runtimeEvents.push(event); },
  });
  try {
    await runtime.handleInput("Inspect README.md");
    const protocol = runtimeEvents.map((event) => event.payload?.runtimeProtocol).filter(Boolean);
    const kinds = protocol.map((event) => event.kind);
    check("agent runtime uses provider facade through a real two-step tool loop", requests.length === 4 && runtime.session.messages.some((message) => message.role === "tool"));
    check("runtime protocol records model request", kinds.filter((kind) => kind === "model.requested").length === 2, kinds.join(","));
    check("runtime protocol records streamed provider tool lifecycle", ["model.tool_call.started", "model.tool_call.delta", "model.tool_call.completed"].every((kind) => kinds.includes(kind)), kinds.join(","));
    check("runtime protocol records normalized usage", protocol.some((event) => event.kind === "usage.updated" && event.payload?.usage?.totalTokens === 28));
    check("provider tool correlation survives into runtime protocol", protocol.some((event) => event.kind === "model.tool_call.completed" && event.payload?.callId === "call-local" && event.payload?.name === "read_file"));
    check("provider argument deltas stay hidden from presentation clients", protocol.filter((event) => event.kind === "model.tool_call.delta").every((event) => event.visibility.includes("hidden") && !event.visibility.includes("chat")));
    check("assistant text remains on the existing chat event path", protocol.some((event) => event.kind === "assistant.completed" && event.payload?.content === "runtime complete"));
    check("provider runtime events never contain API key", !JSON.stringify(runtimeEvents).includes(profile.apiKey));
  } finally {
    runtime.shutdown();
    deleteSession(runtime.sessionId);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
