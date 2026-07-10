import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../dist/runtime.js";
import { RuntimeEventBus } from "../dist/runtime-event-sink.js";
import { deleteSession } from "../dist/session-store.js";
import { readRuntimeProtocolEvents } from "../dist/runtime-event-store.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

function profile(model) {
  return {
    profiles: {
      default: {
        name: "default",
        baseURL: "http://runtime-concurrency.test/v1",
        apiKey: "test-only",
        model,
        contextWindow: 8192,
        temperature: 0,
      },
    },
    defaultProfile: "default",
    roleModels: {},
    councilMembers: [],
    councilSynthesizer: "default",
    compactThreshold: 0.75,
    reasoningLevel: "medium",
    sandbox: false,
    mcpServers: {},
  };
}

function streamResponse(parts, delayMs) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const part of parts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

console.log("\n[runtime-concurrency] protocol-native assistant output");

const originalFetch = globalThis.fetch;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-runtime-concurrency-"));
const bus = new RuntimeEventBus();
const allEvents = [];
const unsubscribeAll = bus.subscribe((event) => allEvents.push(event));
const runtimeA = createRuntime({
  cfg: profile("model-alpha"),
  cwd: tmp,
  mode: "default",
  systemPrompt: "test alpha",
  ask: async () => "n",
  eventSink: bus,
  legacyAssistantOutput: false,
});
const runtimeB = createRuntime({
  cfg: profile("model-beta"),
  cwd: tmp,
  mode: "default",
  systemPrompt: "test beta",
  ask: async () => "n",
  eventSink: bus,
  legacyAssistantOutput: false,
});
const eventsA = [];
const eventsB = [];
const unsubscribeA = bus.subscribe((event) => eventsA.push(event), { sessionId: runtimeA.sessionId });
const unsubscribeB = bus.subscribe((event) => eventsB.push(event), { sessionId: runtimeB.sessionId });

globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(String(init?.body || "{}"));
  const prompt = request.messages?.findLast?.((message) => message.role === "user")?.content || "";
  if (String(prompt).includes("alpha")) return streamResponse(["alpha-", "only"], 8);
  if (String(prompt).includes("beta")) return streamResponse(["beta-", "only"], 3);
  throw new Error(`unexpected prompt: ${String(prompt)}`);
};

try {
  await Promise.all([
    runtimeA.handleInput("answer alpha"),
    runtimeB.handleInput("answer beta"),
  ]);

  const deltasA = eventsA.filter((event) => event.type === "assistant:delta");
  const deltasB = eventsB.filter((event) => event.type === "assistant:delta");
  const completedA = eventsA.find((event) => event.type === "assistant:completed");
  const completedB = eventsB.find((event) => event.type === "assistant:completed");

  check(
    "two sessions interleave globally during real async streaming",
    allEvents.some((event, index) => index > 0 && event.sessionId !== allEvents[index - 1].sessionId),
    JSON.stringify(allEvents.map((event) => [event.sessionId, event.type])),
  );
  check(
    "alpha subscriber receives only alpha session events",
    eventsA.length > 0 && eventsA.every((event) => event.sessionId === runtimeA.sessionId),
    JSON.stringify(eventsA),
  );
  check(
    "beta subscriber receives only beta session events",
    eventsB.length > 0 && eventsB.every((event) => event.sessionId === runtimeB.sessionId),
    JSON.stringify(eventsB),
  );
  check(
    "alpha deltas preserve order without beta text",
    deltasA.map((event) => event.payload?.delta).join("") === "alpha-only" &&
      deltasA.every((event) => !String(event.payload?.delta).includes("beta")),
    JSON.stringify(deltasA),
  );
  check(
    "beta deltas preserve order without alpha text",
    deltasB.map((event) => event.payload?.delta).join("") === "beta-only" &&
      deltasB.every((event) => !String(event.payload?.delta).includes("alpha")),
    JSON.stringify(deltasB),
  );
  check(
    "completed events carry the full assistant message",
    completedA?.payload?.content === "alpha-only" &&
      completedB?.payload?.content === "beta-only" &&
      completedA.status === "done" &&
      completedB.status === "done",
    JSON.stringify({ completedA, completedB }),
  );
  check(
    "every delivered event has the matching protocol envelope",
    [...eventsA, ...eventsB].every(
      (event) => event.id === event.payload?.runtimeProtocol?.id && event.sessionId === event.payload?.runtimeProtocol?.sessionId,
    ),
  );
  check(
    "session transcripts retain their own assistant response",
    runtimeA.session.messages.some((message) => message.role === "assistant" && message.content === "alpha-only") &&
      runtimeB.session.messages.some((message) => message.role === "assistant" && message.content === "beta-only"),
  );
  const storedA = readRuntimeProtocolEvents(runtimeA.sessionId);
  const storedB = readRuntimeProtocolEvents(runtimeB.sessionId);
  check(
    "assistant completions are durable in each append-only event store",
    storedA.some((event) => event.kind === "assistant.completed" && event.payload?.content === "alpha-only") &&
      storedB.some((event) => event.kind === "assistant.completed" && event.payload?.content === "beta-only") &&
      storedA.every((event) => event.sessionId === runtimeA.sessionId) &&
      storedB.every((event) => event.sessionId === runtimeB.sessionId),
    JSON.stringify({ storedA, storedB }),
  );
} finally {
  globalThis.fetch = originalFetch;
  unsubscribeA();
  unsubscribeB();
  unsubscribeAll();
  runtimeA.shutdown();
  runtimeB.shutdown();
  deleteSession(runtimeA.sessionId);
  deleteSession(runtimeB.sessionId);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
