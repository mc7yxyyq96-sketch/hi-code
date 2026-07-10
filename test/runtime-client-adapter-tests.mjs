import { RuntimeEventBus } from "../dist/runtime-event-sink.js";
import {
  connectAssistantOutput,
  connectAssistantTextOutput,
} from "../dist/runtime-client-adapters.js";

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

function event(type, overrides = {}) {
  const completed = type === "assistant:completed";
  return {
    id: `${type}-${Math.random()}`,
    sessionId: "session-a",
    turnId: "turn-a",
    type,
    title: completed ? "Assistant response complete" : "Assistant response",
    status: completed ? "done" : "running",
    createdAt: Date.now(),
    payload: completed
      ? { messageId: "message-a", content: "hello", finishReason: "completed" }
      : { messageId: "message-a", delta: "hello" },
    ...overrides,
  };
}

console.log("\n[runtime-client-adapter] text projection");

const bus = new RuntimeEventBus();
let output = "";
const disconnect = connectAssistantTextOutput(bus, {
  write: (text) => { output += text; },
  prefix: ({ label }) => `<${label || "assistant"}>`,
  suffix: () => "</assistant>",
  filter: { sessionId: "session-a" },
});

bus.emit(event("assistant:delta", { payload: { messageId: "message-a", delta: "hel", label: "coder" } }));
bus.emit(event("assistant:delta", { payload: { messageId: "message-a", delta: "lo", label: "coder" } }));
bus.emit(event("assistant:completed", { payload: { messageId: "message-a", content: "hello", label: "coder", finishReason: "completed" } }));

check("delta stream renders one prefix and no duplicate completion", output === "<coder>hello</assistant>", output);

bus.emit(event("assistant:completed", {
  id: "completed-only",
  payload: { messageId: "message-b", content: "fallback", finishReason: "completed" },
}));
check("completed-only providers still render their content", output.endsWith("<assistant>fallback</assistant>"), output);

const beforeOtherSession = output;
bus.emit(event("assistant:delta", {
  id: "other-session",
  sessionId: "session-b",
  payload: { messageId: "message-c", delta: "must-not-render" },
}));
check("session filter blocks foreign output", output === beforeOtherSession, output);

disconnect();
bus.emit(event("assistant:delta", { id: "after-disconnect", payload: { messageId: "message-d", delta: "ignored" } }));
check("disconnect stops text projection", output === beforeOtherSession, output);

console.log("\n[runtime-client-adapter] structured projection");

const structuredBus = new RuntimeEventBus();
const starts = [];
const deltas = [];
const completions = [];
const disconnectStructured = connectAssistantOutput(structuredBus, {
  onStart: (message) => starts.push(message),
  onDelta: (message) => deltas.push(message),
  onCompleted: (message) => completions.push(message),
});
structuredBus.emit(event("assistant:delta", {
  payload: { messageId: "message-z", delta: "partial", model: "model-z", sequence: 1 },
}));
structuredBus.emit(event("assistant:completed", {
  status: "interrupted",
  payload: { messageId: "message-z", content: "partial", finishReason: "interrupted" },
}));

check("structured adapter exposes model and sequence", starts[0]?.model === "model-z" && deltas[0]?.sequence === 1);
check(
  "interrupted completion reports prior deltas without replaying content",
  completions[0]?.status === "interrupted" && completions[0]?.hadDeltas === true && completions[0]?.content === "partial",
  JSON.stringify(completions),
);
disconnectStructured();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
