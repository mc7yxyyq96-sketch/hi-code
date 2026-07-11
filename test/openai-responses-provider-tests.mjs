import http from "node:http";

import { normalizeModelTransportProtocol } from "../dist/config.js";
import { createRuntime } from "../dist/runtime.js";
import { deleteSession } from "../dist/session-store.js";
import {
  ModelProviderRegistry,
  completeModelProfile,
  createModelProfileAdapter,
  createOpenAIResponsesAdapter,
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

function writeSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function completedResponse({ output = [], usage = undefined } = {}) {
  return {
    id: "resp-local",
    object: "response",
    status: "completed",
    output,
    error: null,
    incomplete_details: null,
    usage,
  };
}

function textMessage(text) {
  return {
    id: "msg-local",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

const requests = [];
const openResponses = new Set();
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  requests.push({ url: req.url, body, authorization: req.headers.authorization });
  const serializedInput = JSON.stringify(body.input || []);

  if (req.url?.endsWith("/chat/completions")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "legacy ok" } }] })}\n\ndata: [DONE]\n\n`);
    return;
  }

  if (body.stream === false) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(completedResponse({
      output: [textMessage("compact summary")],
      usage: {
        input_tokens: 11,
        output_tokens: 3,
        total_tokens: 14,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    })));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  if (serializedInput.includes("abort response")) {
    openResponses.add(res);
    writeSse(res, {
      type: "response.output_text.delta",
      item_id: "msg-abort",
      output_index: 0,
      content_index: 0,
      delta: "partial",
      sequence_number: 1,
    });
    req.once("close", () => openResponses.delete(res));
    return;
  }

  if (serializedInput.includes("incomplete response")) {
    writeSse(res, {
      type: "response.incomplete",
      response: {
        id: "resp-incomplete",
        status: "incomplete",
        error: null,
        incomplete_details: { reason: "max_output_tokens" },
        output: [textMessage("partial answer")],
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      },
      sequence_number: 2,
    });
    res.end();
    return;
  }

  if (serializedInput.includes("out of order tool event")) {
    writeSse(res, {
      type: "response.function_call_arguments.delta",
      item_id: "fc-unannounced",
      output_index: 0,
      delta: "{}",
      sequence_number: 1,
    });
    res.end();
    return;
  }

  if (serializedInput.includes("failed response")) {
    writeSse(res, {
      type: "response.failed",
      response: {
        id: "resp-failed",
        status: "failed",
        error: { code: "server_error", message: "Authorization: Bearer provider-secret-token" },
        incomplete_details: null,
        output: [],
        usage: null,
      },
      sequence_number: 2,
    });
    res.end();
    return;
  }

  const hasCurrentToolResult = body.input?.some((item) => item.type === "function_call_output" && item.call_id === "call-response");
  if (hasCurrentToolResult) {
    writeSse(res, {
      type: "response.output_text.delta",
      item_id: "msg-runtime-complete",
      output_index: 0,
      content_index: 0,
      delta: "runtime complete",
      sequence_number: 1,
    });
    writeSse(res, {
      type: "response.completed",
      response: completedResponse({
        output: [textMessage("runtime complete")],
        usage: { input_tokens: 44, output_tokens: 4, total_tokens: 48 },
      }),
      sequence_number: 2,
    });
    res.end();
    return;
  }

  writeSse(res, {
    type: "response.output_text.delta",
    item_id: "msg-response",
    output_index: 0,
    content_index: 0,
    delta: "hello ",
    sequence_number: 1,
  });
  writeSse(res, {
    type: "response.output_item.added",
    output_index: 1,
    item: {
      id: "fc-item-1",
      type: "function_call",
      call_id: "call-response",
      name: "read_file",
      arguments: "",
      status: "in_progress",
    },
    sequence_number: 2,
  });
  writeSse(res, {
    type: "response.function_call_arguments.delta",
    item_id: "fc-item-1",
    output_index: 1,
    delta: "{\"path\":",
    sequence_number: 3,
  });
  writeSse(res, {
    type: "response.function_call_arguments.delta",
    item_id: "fc-item-1",
    output_index: 1,
    delta: "\"README.md\"}",
    sequence_number: 4,
  });
  writeSse(res, {
    type: "response.function_call_arguments.done",
    item_id: "fc-item-1",
    output_index: 1,
    name: "read_file",
    arguments: "{\"path\":\"README.md\"}",
    sequence_number: 5,
  });
  writeSse(res, {
    type: "response.output_item.done",
    output_index: 1,
    item: {
      id: "fc-item-1",
      type: "function_call",
      call_id: "call-response",
      name: "read_file",
      arguments: "{\"path\":\"README.md\"}",
      status: "completed",
    },
    sequence_number: 6,
  });
  writeSse(res, {
    type: "response.completed",
    response: completedResponse({
      output: [
        textMessage("hello "),
        {
          id: "fc-item-1",
          type: "function_call",
          call_id: "call-response",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
          status: "completed",
        },
      ],
      usage: {
        input_tokens: 31,
        output_tokens: 9,
        total_tokens: 40,
        input_tokens_details: { cached_tokens: 5 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    }),
    sequence_number: 7,
  });
  res.end();
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  const baseProfile = {
    name: "openai-responses",
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "sk-local-responses-secret",
    model: "gpt-fixture",
    contextWindow: 128000,
    temperature: 0.2,
  };
  const profile = { ...baseProfile, protocol: "responses" };

  console.log("\n[openai-responses] explicit protocol selection");
  check("missing protocol keeps Chat Completions compatibility", normalizeModelTransportProtocol(undefined) === "chat_completions");
  check("explicit Responses protocol validates", normalizeModelTransportProtocol("responses") === "responses");
  let invalidProtocolCode = "";
  try {
    createModelProfileAdapter({ ...baseProfile, protocol: "unknown-wire-protocol" });
  } catch (error) {
    invalidProtocolCode = error?.code || "";
  }
  check("unknown protocol is rejected", invalidProtocolCode === "provider_protocol_invalid", invalidProtocolCode);
  let insecureEndpointCode = "";
  try {
    createOpenAIResponsesAdapter({ ...profile, baseURL: "http://models.example.com/v1" });
  } catch (error) {
    insecureEndpointCode = error?.code || "";
  }
  check("non-loopback Responses endpoint requires HTTPS", insecureEndpointCode === "provider_endpoint_insecure", insecureEndpointCode);
  check("default adapter remains Chat Completions", createModelProfileAdapter(baseProfile).descriptor.protocol === "openai.chat.completions");
  const responsesAdapter = createOpenAIResponsesAdapter(profile);
  check("Responses adapter advertises its actual wire protocol", responsesAdapter.descriptor.protocol === "openai.responses");
  check("Responses adapter declares image and tool streaming support", responsesAdapter.descriptor.capabilities["input.image"]?.support === "supported" && responsesAdapter.descriptor.capabilities["tool.streaming"]?.support === "supported");
  check("Responses descriptor does not contain credentials", !JSON.stringify(responsesAdapter.descriptor).includes(profile.apiKey));

  console.log("\n[openai-responses] request conversion and real SSE stream");
  const events = [];
  let streamedText = "";
  const turn = await streamModelProfile(
    profile,
    [
      { role: "system", content: "Be precise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
        ],
      },
      {
        role: "assistant",
        content: "I will inspect the prior file.",
        tool_calls: [{ id: "call-prior", type: "function", function: { name: "read_file", arguments: "{\"path\":\"old.txt\"}" } }],
      },
      { role: "tool", tool_call_id: "call-prior", content: "old contents" },
      { role: "user", content: "Continue with README.md." },
    ],
    [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }],
    {
      onText(delta) { streamedText += delta; },
      onProviderEvent(event) { events.push(event); },
    },
  );

  const streamRequest = requests.find((request) => request.url === "/v1/responses" && request.body.stream === true && JSON.stringify(request.body.input).includes("Continue with README.md."));
  check("Responses stream uses the configured endpoint and bearer credential", streamRequest?.authorization === `Bearer ${profile.apiKey}`);
  check("Responses request disables provider-side storage", streamRequest?.body.store === false);
  check("function schemas use the Responses flat shape", streamRequest?.body.tools?.[0]?.type === "function" && streamRequest.body.tools[0].name === "read_file" && !streamRequest.body.tools[0].function);
  const inputItems = streamRequest?.body.input || [];
  const imagePart = inputItems.flatMap((item) => item.content || []).find((part) => part.type === "input_image");
  check("image input is converted to input_image", imagePart?.image_url === "data:image/png;base64,AA==");
  check("prior assistant tool call preserves call_id", inputItems.some((item) => item.type === "function_call" && item.call_id === "call-prior" && item.name === "read_file"));
  check("prior tool result becomes function_call_output", inputItems.some((item) => item.type === "function_call_output" && item.call_id === "call-prior" && item.output === "old contents"));
  check("text deltas are preserved", streamedText === "hello " && turn.content === "hello ");
  check("tool call preserves call_id and exact arguments", turn.tool_calls.length === 1 && turn.tool_calls[0].id === "call-response" && turn.tool_calls[0].function.arguments === "{\"path\":\"README.md\"}");
  check("tool completion is emitted exactly once", events.filter((event) => event.type === "tool.call.completed").length === 1);
  check("Responses usage details normalize without loss", turn.usage?.prompt_tokens === 31 && turn.usage?.completion_tokens === 9 && events.some((event) => event.type === "usage.updated" && event.usage.cachedInputTokens === 5 && event.usage.reasoningTokens === 2));
  check("successful stream has one provider terminal event", events.filter((event) => event.type.startsWith("response.")).length === 1 && events.at(-1)?.type === "response.completed");
  check("provider events never expose the API key", !JSON.stringify(events).includes(profile.apiKey));

  console.log("\n[openai-responses] non-streaming compatibility");
  const summary = await completeModelProfile(profile, [{ role: "user", content: "Summarize." }], 0.1);
  check("non-streaming Responses path returns output text", summary === "compact summary");
  check("non-streaming path uses Responses rather than Chat Completions", requests.some((request) => request.url === "/v1/responses" && request.body.stream === false));

  console.log("\n[openai-responses] interruption and failure semantics");
  const abortController = new AbortController();
  const abortEvents = [];
  const interrupted = await streamModelProfile(
    profile,
    [{ role: "user", content: "abort response" }],
    [],
    {
      onText() { abortController.abort(); },
      onProviderEvent(event) { abortEvents.push(event); },
    },
    abortController.signal,
  );
  check("caller cancellation returns an interrupted turn", interrupted.aborted === true);
  check("cancellation never emits false completion", abortEvents.at(-1)?.type === "response.interrupted" && !abortEvents.some((event) => event.type === "response.completed"));

  for (const [prompt, expectedCode, expectedCategory] of [
    ["incomplete response", "provider_response_incomplete", "context_length"],
    ["failed response", "server_error", "provider"],
    ["out of order tool event", "provider_tool_sequence_invalid", "provider"],
  ]) {
    const registry = new ModelProviderRegistry();
    registry.register(createOpenAIResponsesAdapter(profile));
    let caught;
    try {
      await registry.run("openai-responses", { messages: [{ role: "user", content: prompt }], tools: [] });
    } catch (error) {
      caught = error;
    }
    check(`${prompt} rejects with normalized code`, caught?.code === expectedCode, caught?.code || "no error");
    check(`${prompt} preserves normalized category`, caught?.category === expectedCategory, caught?.category || "no category");
    check(`${prompt} ends as failed rather than completed`, caught?.events?.at(-1)?.type === "response.failed" && !caught?.events?.some((event) => event.type === "response.completed"));
    check(`${prompt} error details are credential-safe`, !JSON.stringify(caught).includes("provider-secret-token"));
  }

  console.log("\n[openai-responses] shared runtime tool loop");
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
    check("Runtime completes a real two-request Responses tool loop", runtime.session.messages.some((message) => message.role === "tool") && runtime.session.messages.at(-1)?.content === "runtime complete");
    check("Runtime sends tool output back with the same Responses call_id", requests.some((request) => request.url === "/v1/responses" && request.body.input?.some((item) => item.type === "function_call_output" && item.call_id === "call-response")));
    check("Runtime Protocol records both Responses requests", protocolEvents.filter((event) => event.kind === "model.requested").length === 2);
    check("Runtime Protocol preserves Responses tool correlation", protocolEvents.some((event) => event.kind === "model.tool_call.completed" && event.payload?.callId === "call-response" && event.payload?.name === "read_file"));
    check("Runtime Protocol receives Responses usage", protocolEvents.some((event) => event.kind === "usage.updated" && event.payload?.usage?.totalTokens === 48));
  } finally {
    runtime.shutdown();
    deleteSession(runtime.sessionId);
  }

  console.log("\n[openai-responses] legacy endpoint remains available");
  const legacyTurn = await streamModelProfile(baseProfile, [{ role: "user", content: "legacy" }], [], {});
  check("profiles without protocol still call Chat Completions", legacyTurn.content === "legacy ok" && requests.some((request) => request.url === "/v1/chat/completions"));
} finally {
  for (const response of openResponses) response.destroy();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
