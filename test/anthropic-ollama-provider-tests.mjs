import http from "node:http";

import { normalizeModelTransportProtocol } from "../dist/config.js";
import { createRuntime } from "../dist/runtime.js";
import { deleteSession } from "../dist/session-store.js";
import {
  ModelProviderRegistry,
  completeModelProfile,
  createAnthropicMessagesAdapter,
  createModelProfileAdapter,
  createOllamaChatAdapter,
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

function writeAnthropicEvent(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

function writeNdjson(res, value) {
  res.write(`${JSON.stringify(value)}\n`);
}

function anthropicMessage(content, stopReason = "end_turn", usage = { input_tokens: 7, output_tokens: 3 }) {
  return {
    id: "msg-fixture",
    type: "message",
    role: "assistant",
    model: "claude-fixture",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  };
}

const requests = [];
const openResponses = new Set();
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  requests.push({
    url: req.url,
    body,
    authorization: req.headers.authorization,
    anthropicKey: req.headers["x-api-key"],
    anthropicVersion: req.headers["anthropic-version"],
  });

  if (req.url === "/anthropic/v1/messages") {
    const serialized = JSON.stringify(body.messages || []);
    if (serialized.includes("authentication failure")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "Authorization: Bearer anthropic-provider-secret" } }));
      return;
    }
    if (body.stream === false) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(anthropicMessage([{ type: "text", text: "anthropic summary" }])));
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    if (serialized.includes("abort anthropic")) {
      openResponses.add(res);
      writeAnthropicEvent(res, "message_start", { message: anthropicMessage([], null, { input_tokens: 4, output_tokens: 1 }) });
      writeAnthropicEvent(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      writeAnthropicEvent(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: "partial" } });
      req.once("close", () => openResponses.delete(res));
      return;
    }
    if (serialized.includes("bad anthropic tool sequence")) {
      writeAnthropicEvent(res, "message_start", { message: anthropicMessage([], null, { input_tokens: 4, output_tokens: 1 }) });
      writeAnthropicEvent(res, "content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: "{}" } });
      writeAnthropicEvent(res, "message_stop", {});
      res.end();
      return;
    }

    const hasToolResult = body.messages?.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "tool_result" && part.tool_use_id === "toolu-fixture-1"));
    writeAnthropicEvent(res, "message_start", {
      message: anthropicMessage([], null, { input_tokens: hasToolResult ? 20 : 12, output_tokens: 1 }),
    });
    writeAnthropicEvent(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    writeAnthropicEvent(res, "content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text: hasToolResult ? "anthropic complete" : "anthropic " },
    });
    writeAnthropicEvent(res, "content_block_stop", { index: 0 });
    if (!hasToolResult) {
      writeAnthropicEvent(res, "content_block_start", {
        index: 1,
        content_block: { type: "tool_use", id: "toolu-fixture-1", name: "read_file", input: {} },
      });
      writeAnthropicEvent(res, "content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "{\"path\":" } });
      writeAnthropicEvent(res, "content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "\"README.md\"}" } });
      writeAnthropicEvent(res, "content_block_stop", { index: 1 });
    }
    writeAnthropicEvent(res, "message_delta", {
      delta: { stop_reason: hasToolResult ? "end_turn" : "tool_use", stop_sequence: null },
      usage: { output_tokens: hasToolResult ? 5 : 8 },
    });
    writeAnthropicEvent(res, "message_stop", {});
    res.end();
    return;
  }

  if (req.url === "/ollama/api/chat") {
    const serialized = JSON.stringify(body.messages || []);
    if (serialized.includes("ollama stream failure")) {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      writeNdjson(res, { error: "Authorization: Bearer ollama-provider-secret" });
      res.end();
      return;
    }
    if (body.stream === false) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "qwen-fixture",
        message: { role: "assistant", content: "ollama summary" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 9,
        eval_count: 2,
      }));
      return;
    }

    res.writeHead(200, { "content-type": "application/x-ndjson" });
    if (serialized.includes("abort ollama")) {
      openResponses.add(res);
      writeNdjson(res, { model: "qwen-fixture", message: { role: "assistant", content: "partial" }, done: false });
      req.once("close", () => openResponses.delete(res));
      return;
    }
    if (serialized.includes("bad ollama terminal")) {
      writeNdjson(res, { model: "qwen-fixture", message: { role: "assistant", content: "unterminated" }, done: false });
      res.end();
      return;
    }

    const lastMessage = body.messages?.at(-1);
    const hasToolResult = lastMessage?.role === "tool" && lastMessage.tool_name === "read_file";
    writeNdjson(res, {
      model: "qwen-fixture",
      message: {
        role: "assistant",
        content: hasToolResult ? "ollama complete" : "ollama ",
        thinking: "raw reasoning must stay private",
      },
      done: false,
    });
    if (!hasToolResult) {
      writeNdjson(res, {
        model: "qwen-fixture",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ type: "function", function: { index: 0, name: "read_file", arguments: { path: "README.md" } } }],
        },
        done: false,
      });
    }
    writeNdjson(res, {
      model: "qwen-fixture",
      message: { role: "assistant", content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: hasToolResult ? 24 : 18,
      eval_count: hasToolResult ? 4 : 6,
    });
    res.end();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "unknown fixture route" }));
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const tool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a workspace file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
};

try {
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const anthropicProfile = {
    name: "anthropic",
    baseURL: `${origin}/anthropic/v1`,
    apiKey: "sk-ant-local-secret",
    model: "claude-fixture",
    contextWindow: 200000,
    temperature: 0.2,
    protocol: "anthropic_messages",
  };
  const ollamaProfile = {
    name: "ollama",
    baseURL: `${origin}/ollama`,
    apiKey: "sk-no-key-required",
    model: "qwen-fixture",
    contextWindow: 32768,
    temperature: 0.2,
    protocol: "ollama_chat",
  };

  console.log("\n[anthropic-ollama] explicit routing and capability truth");
  check("Anthropic protocol validates", normalizeModelTransportProtocol("anthropic_messages") === "anthropic_messages");
  check("Ollama protocol validates", normalizeModelTransportProtocol("ollama_chat") === "ollama_chat");
  const anthropicAdapter = createAnthropicMessagesAdapter(anthropicProfile);
  const ollamaAdapter = createOllamaChatAdapter(ollamaProfile);
  check("Anthropic adapter routes to Messages", createModelProfileAdapter(anthropicProfile).descriptor.protocol === "anthropic.messages");
  check("Ollama adapter routes to native chat", createModelProfileAdapter(ollamaProfile).descriptor.protocol === "ollama.chat");
  check("legacy default remains Chat Completions", createModelProfileAdapter({ ...ollamaProfile, protocol: undefined }).descriptor.protocol === "openai.chat.completions");
  check("Anthropic descriptor never exposes credentials", !JSON.stringify(anthropicAdapter.descriptor).includes(anthropicProfile.apiKey));
  check("Ollama descriptor never exposes credentials", !JSON.stringify(ollamaAdapter.descriptor).includes(ollamaProfile.apiKey));
  check("raw reasoning is not advertised as a summary", anthropicAdapter.descriptor.capabilities["reasoning.summary"]?.support === "unsupported" && ollamaAdapter.descriptor.capabilities["reasoning.summary"]?.support === "unsupported");
  for (const [id, adapter] of [["anthropic-messages", anthropicAdapter], ["ollama-chat", ollamaAdapter]]) {
    const before = requests.length;
    const registry = new ModelProviderRegistry();
    registry.register(adapter);
    let caught;
    try {
      await registry.run(id, {
        messages: [{ role: "user", content: "reasoning summary" }],
        tools: [],
        requirements: { capabilities: ["reasoning.summary"] },
      });
    } catch (error) {
      caught = error;
    }
    check(`${id} rejects unsupported reasoning summaries before network`, caught?.code === "provider_capability_unsupported" && requests.length === before, caught?.code || "no error");
  }

  console.log("\n[anthropic-ollama] Anthropic Messages wire contract");
  const anthropicEvents = [];
  const anthropicTurn = await streamModelProfile(
    anthropicProfile,
    [
      { role: "system", content: "Be precise." },
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }, { type: "text", text: "Inspect this image." }] },
      { role: "assistant", content: "Reading.", tool_calls: [{ id: "prior-anthropic", type: "function", function: { name: "read_file", arguments: "{\"path\":\"old.txt\"}" } }] },
      { role: "tool", tool_call_id: "prior-anthropic", content: "old contents" },
      { role: "user", content: "Continue." },
    ],
    [tool],
    { onProviderEvent(event) { anthropicEvents.push(event); } },
  );
  const anthropicRequest = requests.find((request) => request.url === "/anthropic/v1/messages" && request.body.stream === true && JSON.stringify(request.body.messages).includes("Continue."));
  check("Anthropic request uses required headers", anthropicRequest?.anthropicKey === anthropicProfile.apiKey && anthropicRequest?.anthropicVersion === "2023-06-01");
  check("Anthropic system prompt is outside messages", anthropicRequest?.body.system === "Be precise." && !anthropicRequest.body.messages.some((message) => message.role === "system"));
  const anthropicImage = anthropicRequest?.body.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []).find((part) => part.type === "image");
  check("Anthropic data image becomes base64 source", anthropicImage?.source?.type === "base64" && anthropicImage.source.media_type === "image/png" && anthropicImage.source.data === "AA==");
  check("Anthropic prior call becomes tool_use", anthropicRequest?.body.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "tool_use" && part.id === "prior-anthropic")));
  check("Anthropic tool result preserves tool_use_id", anthropicRequest?.body.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "tool_result" && part.tool_use_id === "prior-anthropic")));
  check("Anthropic tools use input_schema", anthropicRequest?.body.tools?.[0]?.name === "read_file" && anthropicRequest.body.tools[0].input_schema?.type === "object");
  check("Anthropic text and tool call normalize", anthropicTurn.content === "anthropic " && anthropicTurn.tool_calls[0]?.id === "toolu-fixture-1" && anthropicTurn.tool_calls[0]?.function.arguments === "{\"path\":\"README.md\"}");
  check("Anthropic usage combines message_start and message_delta", anthropicTurn.usage?.prompt_tokens === 12 && anthropicTurn.usage?.completion_tokens === 8);
  check("Anthropic tool lifecycle completes exactly once", anthropicEvents.filter((event) => event.type === "tool.call.completed").length === 1 && anthropicEvents.at(-1)?.type === "response.completed");
  check("Anthropic events never expose the API key", !JSON.stringify(anthropicEvents).includes(anthropicProfile.apiKey));

  const anthropicSummary = await completeModelProfile(anthropicProfile, [{ role: "user", content: "Summarize Anthropic." }]);
  check("Anthropic non-streaming completion works", anthropicSummary === "anthropic summary");

  console.log("\n[anthropic-ollama] Ollama native wire contract");
  const ollamaEvents = [];
  const ollamaTurn = await streamModelProfile(
    ollamaProfile,
    [
      { role: "system", content: "Be concise." },
      { role: "user", content: [{ type: "text", text: "Inspect." }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQ==" } }] },
      { role: "assistant", content: "Reading.", tool_calls: [{ id: "prior-ollama", type: "function", function: { name: "read_file", arguments: "{\"path\":\"old.txt\"}" } }] },
      { role: "tool", tool_call_id: "prior-ollama", content: "old contents" },
      { role: "user", content: "Continue." },
    ],
    [tool],
    { onProviderEvent(event) { ollamaEvents.push(event); } },
  );
  const ollamaRequest = requests.find((request) => request.url === "/ollama/api/chat" && request.body.stream === true && JSON.stringify(request.body.messages).includes("Continue."));
  check("Ollama request uses native endpoint without placeholder auth", ollamaRequest && !ollamaRequest.authorization);
  check("Ollama disables raw thinking by default", ollamaRequest?.body.think === false);
  const ollamaImageMessage = ollamaRequest?.body.messages.find((message) => Array.isArray(message.images));
  check("Ollama data image becomes base64 images entry", ollamaImageMessage?.images?.[0] === "AQ==");
  check("Ollama prior assistant call keeps function shape", ollamaRequest?.body.messages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.function?.name === "read_file"));
  check("Ollama tool result resolves call id to tool_name", ollamaRequest?.body.messages.some((message) => message.role === "tool" && message.tool_name === "read_file"));
  check("Ollama text and tool call normalize", ollamaTurn.content === "ollama " && ollamaTurn.tool_calls[0]?.function.arguments === "{\"path\":\"README.md\"}");
  check("Ollama usage normalizes", ollamaTurn.usage?.prompt_tokens === 18 && ollamaTurn.usage?.completion_tokens === 6);
  check("raw Ollama thinking never enters chat or provider events", !ollamaTurn.content.includes("raw reasoning") && !JSON.stringify(ollamaEvents).includes("raw reasoning"));
  check("Ollama tool lifecycle completes exactly once", ollamaEvents.filter((event) => event.type === "tool.call.completed").length === 1 && ollamaEvents.at(-1)?.type === "response.completed");
  const ollamaSummary = await completeModelProfile(ollamaProfile, [{ role: "user", content: "Summarize Ollama." }]);
  check("Ollama non-streaming completion works", ollamaSummary === "ollama summary");

  console.log("\n[anthropic-ollama] interruption and failure semantics");
  for (const [profile, prompt] of [[anthropicProfile, "abort anthropic"], [ollamaProfile, "abort ollama"]]) {
    const controller = new AbortController();
    const events = [];
    const interrupted = await streamModelProfile(profile, [{ role: "user", content: prompt }], [], {
      onText() { controller.abort(); },
      onProviderEvent(event) { events.push(event); },
    }, controller.signal);
    check(`${profile.name} cancellation returns interrupted`, interrupted.aborted === true && events.at(-1)?.type === "response.interrupted");
    check(`${profile.name} cancellation never false-completes`, !events.some((event) => event.type === "response.completed"));
  }

  for (const [profile, id, prompt, expectedCode] of [
    [anthropicProfile, "anthropic-messages", "authentication failure", "provider_authentication_failed"],
    [anthropicProfile, "anthropic-messages", "bad anthropic tool sequence", "provider_tool_sequence_invalid"],
    [ollamaProfile, "ollama-chat", "ollama stream failure", "provider_stream_error"],
    [ollamaProfile, "ollama-chat", "bad ollama terminal", "provider_stream_incomplete"],
  ]) {
    const registry = new ModelProviderRegistry();
    registry.register(createModelProfileAdapter(profile));
    let caught;
    try {
      await registry.run(id, { messages: [{ role: "user", content: prompt }], tools: [] });
    } catch (error) {
      caught = error;
    }
    check(`${prompt} rejects with normalized code`, caught?.code === expectedCode, caught?.code || "no error");
    check(`${prompt} ends failed, never complete`, caught?.events?.at(-1)?.type === "response.failed" && !caught?.events?.some((event) => event.type === "response.completed"));
    check(`${prompt} errors redact provider credentials`, !JSON.stringify(caught).includes("provider-secret"));
  }

  console.log("\n[anthropic-ollama] shared Runtime tool loops");
  for (const [profile, finalText, requestMatches] of [
    [anthropicProfile, "anthropic complete", (request) => request.url === "/anthropic/v1/messages" && request.body.messages?.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "tool_result" && part.tool_use_id === "toolu-fixture-1"))],
    [ollamaProfile, "ollama complete", (request) => request.url === "/ollama/api/chat" && request.body.messages?.some((message) => message.role === "tool" && message.tool_name === "read_file")],
  ]) {
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
      const protocolEvents = runtimeEvents.map((event) => event.payload?.runtimeProtocol).filter(Boolean);
      check(`${profile.name} completes a real two-request Runtime loop`, runtime.session.messages.some((message) => message.role === "tool") && runtime.session.messages.at(-1)?.content === finalText);
      check(`${profile.name} sends the correlated tool result`, requests.some(requestMatches));
      check(`${profile.name} Runtime Protocol records two model requests`, protocolEvents.filter((event) => event.kind === "model.requested").length === 2);
      check(`${profile.name} Runtime Protocol records tool completion and usage`, protocolEvents.some((event) => event.kind === "model.tool_call.completed") && protocolEvents.some((event) => event.kind === "usage.updated"));
    } finally {
      runtime.shutdown();
      deleteSession(runtime.sessionId);
    }
  }

  console.log("\n[anthropic-ollama] endpoint security");
  for (const [factory, profile] of [
    [createAnthropicMessagesAdapter, { ...anthropicProfile, baseURL: "http://models.example.com/v1" }],
    [createOllamaChatAdapter, { ...ollamaProfile, baseURL: "http://models.example.com" }],
  ]) {
    let code = "";
    try { factory(profile); } catch (error) { code = error?.code || ""; }
    check(`${profile.name} remote endpoints require HTTPS`, code === "provider_endpoint_insecure", code);
  }
} finally {
  for (const response of openResponses) response.destroy();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
