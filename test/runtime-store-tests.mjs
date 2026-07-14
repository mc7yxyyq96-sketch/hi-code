import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FileRuntimeStore,
  RUNTIME_STORE_SCHEMA_VERSION,
} from "../dist/runtime-stores.js";

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

function protocolEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "rpe-store-1",
    sessionId: "thread-store-1",
    turnId: "thread-store-1-turn-1",
    sequence: 1,
    kind: "turn.started",
    legacyType: "turn:start",
    status: "running",
    actor: "runtime",
    title: "Agent turn",
    summary: "Build the typed store",
    createdAt: 100,
    visibility: ["timeline", "job", "sdk"],
    payload: { retryInput: "Build the typed store" },
    ...overrides,
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-runtime-store-"));
const store = new FileRuntimeStore(tmp);

console.log("\n[runtime-stores] complete session snapshot");
const snapshot = {
  id: "thread-store-1",
  cwd: path.join(tmp, "workspace"),
  model: "test-model",
  systemMessage: { role: "system", content: "System policy" },
  createdAt: 100,
  updatedAt: 200,
  firstPrompt: "Build the typed store",
  totalPromptTokens: 42,
  totalCompletionTokens: 17,
  messages: [
    { role: "user", content: "Build the typed store" },
    {
      role: "assistant",
      content: "I will inspect the project.",
      tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" } }],
    },
    { role: "tool", tool_call_id: "call-1", name: "read_file", content: "{\"name\":\"hi-code\"}" },
    { role: "assistant", content: "The project is ready." },
  ],
};
const firstSync = store.syncSession(snapshot);
const secondSync = store.syncSession(snapshot);
const rebuilt = store.loadSession(snapshot.id);
check("snapshot sync succeeds", firstSync.ok && secondSync.ok, JSON.stringify({ firstSync, secondSync }));
check("repeated snapshot sync is idempotent", store.messages.list(snapshot.id).records.length === 5);
check(
  "session rebuild preserves complete model context",
  rebuilt?.contextComplete === true &&
    rebuilt.systemMessage.content === "System policy" &&
    rebuilt.messages.length === snapshot.messages.length &&
    rebuilt.messages[1].tool_calls?.[0]?.function.name === "read_file" &&
    rebuilt.messages[2].tool_call_id === "call-1",
  JSON.stringify(rebuilt),
);
check("thread metadata preserves usage", rebuilt?.totalPromptTokens === 42 && rebuilt?.totalCompletionTokens === 17);

console.log("\n[runtime-stores] event idempotency and diagnostics");
const firstEvent = protocolEvent();
const append = store.events.append(firstEvent);
const duplicate = store.events.append(firstEvent);
const conflict = store.events.append(protocolEvent({ id: "rpe-store-conflict", title: "Conflicting sequence" }));
check("first event append succeeds", append.ok && append.status === "appended", JSON.stringify(append));
check("same event append is a duplicate no-op", duplicate.ok && duplicate.status === "duplicate", JSON.stringify(duplicate));
check("different event at the same sequence is rejected", !conflict.ok && conflict.code === "sequence_conflict", JSON.stringify(conflict));

fs.appendFileSync(store.events.pathFor(snapshot.id), "not-json\n");
const secondEvent = protocolEvent({ id: "rpe-store-2", sequence: 2, kind: "turn.completed", legacyType: "turn:done", status: "done", title: "Turn complete", createdAt: 300 });
const appendAfterCorruption = store.events.append(secondEvent);
const eventRead = store.events.list(snapshot.id);
check("valid events survive a corrupt neighboring line", appendAfterCorruption.ok && eventRead.records.length === 2, JSON.stringify(eventRead));
check("corrupt line produces a bounded diagnostic", eventRead.diagnostics.some((item) => item.code === "invalid_json" && Number.isInteger(item.line)));

console.log("\n[runtime-stores] security and lifecycle");
const threadPath = store.threads.pathFor(snapshot.id);
const messagesPath = store.messages.pathFor(snapshot.id);
check("thread record uses current schema", JSON.parse(fs.readFileSync(threadPath, "utf8")).schemaVersion === RUNTIME_STORE_SCHEMA_VERSION);
if (process.platform !== "win32") {
  check("thread file is owner-only", (fs.statSync(threadPath).mode & 0o777) === 0o600, (fs.statSync(threadPath).mode & 0o777).toString(8));
  check("message file is owner-only", (fs.statSync(messagesPath).mode & 0o777) === 0o600, (fs.statSync(messagesPath).mode & 0o777).toString(8));
}
let unsafeRejected = false;
try {
  store.loadSession("../escape");
} catch (error) {
  unsafeRejected = /invalid runtime store session id/.test(error?.message || "");
}
check("unsafe session id is rejected", unsafeRejected);
check("delete removes typed thread data", store.deleteSession(snapshot.id) === true && !fs.existsSync(path.dirname(threadPath)));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
