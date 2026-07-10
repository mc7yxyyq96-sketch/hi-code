import { RuntimeEventBus } from "../dist/runtime-event-sink.js";
import {
  createRuntimeProtocolEvent,
  validateRuntimeProtocolEvent,
} from "../dist/runtime-protocol.js";

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

function event(overrides = {}) {
  return {
    id: "event-1",
    sessionId: "session-a",
    turnId: "turn-a",
    type: "assistant:delta",
    title: "Assistant response",
    summary: "hello",
    status: "running",
    createdAt: 100,
    payload: { messageId: "message-a", delta: "hello" },
    ...overrides,
  };
}

console.log("\n[runtime-event-sink] subscriptions");

const listenerErrors = [];
const bus = new RuntimeEventBus({
  onListenerError: (error, failedEvent) => listenerErrors.push({ error, failedEvent }),
});
const allEvents = [];
const sessionEvents = [];
const completedEvents = [];
const unsubscribeAll = bus.subscribe((value) => allEvents.push(value));
bus.subscribe((value) => sessionEvents.push(value), { sessionId: "session-a" });
bus.subscribe((value) => completedEvents.push(value), { types: ["assistant:completed"] });
bus.subscribe(() => {
  throw new Error("subscriber failure");
});

const firstId = bus.emit(event());
bus.emit(event({
  id: "event-2",
  sessionId: "session-b",
  turnId: "turn-b",
  type: "assistant:completed",
  status: "done",
  payload: { messageId: "message-b", content: "done", finishReason: "completed" },
}));

check("emit returns the materialized event id", firstId === "event-1");
check("unfiltered subscriber receives both events", allEvents.length === 2, JSON.stringify(allEvents));
check("session filter prevents cross-session delivery", sessionEvents.length === 1 && sessionEvents[0].sessionId === "session-a");
check("type filter receives only matching event", completedEvents.length === 1 && completedEvents[0].id === "event-2");
check("one listener failure does not stop other listeners", listenerErrors.length === 2 && allEvents.length === 2);
check("delivered event and payload are immutable", Object.isFrozen(allEvents[0]) && Object.isFrozen(allEvents[0].payload));

unsubscribeAll();
bus.emit(event({ id: "event-3" }));
check("unsubscribe is idempotent and stops delivery", allEvents.length === 2);
unsubscribeAll();

let invalidRejected = false;
try {
  bus.emit(event({ id: "", sessionId: "" }));
} catch (error) {
  invalidRejected = error instanceof TypeError;
}
check("invalid materialized events are rejected", invalidRejected);

console.log("\n[runtime-event-sink] assistant protocol mapping");

const deltaProtocol = createRuntimeProtocolEvent(
  {
    type: "assistant:delta",
    title: "Assistant response",
    status: "running",
    sessionId: "session-a",
    turnId: "turn-a",
    payload: { messageId: "message-a", delta: "hello" },
  },
  { sequence: 1, createdAt: 100 },
);
const completedProtocol = createRuntimeProtocolEvent(
  {
    type: "assistant:completed",
    title: "Assistant response complete",
    status: "done",
    sessionId: "session-a",
    turnId: "turn-a",
    payload: { messageId: "message-a", content: "hello", finishReason: "completed" },
  },
  { sequence: 2, createdAt: 101 },
);

check(
  "assistant delta maps to a chat-visible assistant protocol event",
  deltaProtocol.kind === "assistant.delta" &&
    deltaProtocol.actor === "assistant" &&
    deltaProtocol.visibility.includes("chat") &&
    validateRuntimeProtocolEvent(deltaProtocol).ok,
  JSON.stringify(deltaProtocol),
);
check(
  "assistant completion maps to a durable assistant protocol event",
  completedProtocol.kind === "assistant.completed" &&
    completedProtocol.status === "done" &&
    completedProtocol.actor === "assistant" &&
    validateRuntimeProtocolEvent(completedProtocol).ok,
  JSON.stringify(completedProtocol),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
