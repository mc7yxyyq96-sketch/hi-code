import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../dist/runtime.js";
import {
  createRuntimeProtocolEvent,
  isRuntimeProtocolEvent,
  protocolKindFromLegacy,
  validateRuntimeProtocolEvent,
} from "../dist/runtime-protocol.js";
import {
  deleteRuntimeProtocolEvents,
  readRuntimeProtocolEvents,
  replayRuntimeProtocolEvents,
  runtimeProtocolEventPath,
} from "../dist/runtime-event-store.js";
import {
  listSessions,
  replaySessionMessages,
} from "../dist/session-store.js";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

console.log("\n[runtime-protocol] schema helpers");

const envelope = createRuntimeProtocolEvent(
  {
    type: "turn:start",
    title: "Agent turn",
    status: "running",
    sessionId: "session-a",
    turnId: "session-a-turn-1",
    payload: { retryInput: "run tests" },
  },
  { sequence: 1, createdAt: 100 },
);

check("protocol event validates", validateRuntimeProtocolEvent(envelope).ok, JSON.stringify(envelope));
check("protocol event keeps stable version", envelope.schemaVersion === 1);
check("turn start maps to turn.started", envelope.kind === "turn.started", JSON.stringify(envelope));
check("validation rejects malformed event", validateRuntimeProtocolEvent({ ...envelope, sequence: 0 }).ok === false);
check("kind mapper distinguishes failed turns", protocolKindFromLegacy("turn:done", "error") === "turn.failed");
check("type guard accepts valid protocol event", isRuntimeProtocolEvent(envelope));

console.log("\n[runtime-protocol] runtime integration");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-runtime-protocol-"));
const cfg = {
  profiles: {
    default: {
      name: "default",
      baseURL: "http://127.0.0.1:9",
      apiKey: "x",
      model: "mock",
      contextWindow: 8192,
      temperature: 0,
    },
  },
  defaultProfile: "default",
  roleModels: {},
  councilMembers: [],
  councilSynthesizer: "default",
  compactThreshold: 0.75,
  sandbox: false,
  mcpServers: {},
};
const events = [];
const runtime = createRuntime({
  cfg,
  cwd: tmp,
  mode: "default",
  systemPrompt: "test",
  ask: async () => "n",
  emitEvent: (event) => {
    events.push(event);
    return `event-${events.length}`;
  },
});

await runtime.handleInput("!touch should-not-run.txt");

const protocolEvents = events.map((event) => event.payload?.runtimeProtocol).filter(Boolean);
const replay = replayRuntimeProtocolEvents(runtime.sessionId);

check("runtime emits protocol envelope on every event", protocolEvents.length === events.length, JSON.stringify(events));
check(
  "runtime protocol sequence is monotonic",
  protocolEvents.every((event, index) => event.sequence === index + 1),
  JSON.stringify(protocolEvents),
);
check(
  "runtime protocol carries active session id",
  protocolEvents.every((event) => event.sessionId === runtime.sessionId),
  JSON.stringify(protocolEvents),
);
check(
  "runtime protocol validates emitted events",
  protocolEvents.every((event) => validateRuntimeProtocolEvent(event).ok),
  JSON.stringify(protocolEvents),
);
check(
  "permission request maps to approval kind",
  protocolEvents.some((event) => event.kind === "approval.requested" && event.status === "waiting"),
  JSON.stringify(protocolEvents),
);
check(
  "denied turn maps to turn.denied",
  protocolEvents.some((event) => event.kind === "turn.denied" && event.status === "denied"),
  JSON.stringify(protocolEvents),
);
check("runtime protocol events are appended to durable store", replay.eventCount === protocolEvents.length, JSON.stringify(replay));
check("runtime replay keeps event order", replay.firstSequence === 1 && replay.lastSequence === protocolEvents.length, JSON.stringify(replay));
check(
  "runtime store reads valid protocol events",
  readRuntimeProtocolEvents(runtime.sessionId).every((event) => validateRuntimeProtocolEvent(event).ok),
);
const eventOnlySession = listSessions(tmp).find((session) => session.id === runtime.sessionId);
check("event-only runtime session appears in recent sessions", eventOnlySession?.replayOnly === true && eventOnlySession?.eventCount === protocolEvents.length, JSON.stringify(eventOnlySession));
const replayMessages = replaySessionMessages(runtime.sessionId);
check(
  "event-only runtime session replays user input",
  replayMessages.some((message) => message.role === "user" && message.text.includes("touch should-not-run.txt")),
  JSON.stringify(replayMessages),
);
check(
  "event-only runtime session explains replay-only recovery",
  replayMessages.some((message) => message.role === "assistant" && message.text.includes("事件回放")),
  JSON.stringify(replayMessages),
);
let invalidPathRejected = false;
try {
  runtimeProtocolEventPath("../bad-session");
} catch {
  invalidPathRejected = true;
}
check("runtime event store rejects path escape ids", invalidPathRejected);
check("runtime did not execute denied command", !fs.existsSync(path.join(tmp, "should-not-run.txt")));
deleteRuntimeProtocolEvents(runtime.sessionId);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
