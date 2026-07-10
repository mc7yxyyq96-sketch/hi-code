import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

function sseResponse(parts) {
  const body = parts.map((part) => `data: ${JSON.stringify({ choices: [{ delta: part }] })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function protocolEvent({ sessionId, turnId, sequence, id, kind, legacyType, status, title, payload = {}, actor = "runtime", tool, visibility = ["timeline", "job", "sdk"] }) {
  return { schemaVersion: 1, id, sessionId, turnId, sequence, kind, legacyType, status, actor, ...(tool ? { tool } : {}), title, createdAt: 1000 + sequence, visibility, payload };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-runtime-store-integration-"));
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;

const [{ createRuntime }, sessionStore, runtimeEventStore, runtimeStores, recovery] = await Promise.all([
  import("../dist/runtime.js"),
  import("../dist/session-store.js"),
  import("../dist/runtime-event-store.js"),
  import("../dist/runtime-stores.js"),
  import("../dist/recovery.js"),
]);

const workspace = path.join(tmp, "workspace");
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "runtime-store-fixture", version: "1.0.0" }));

const cfg = {
  profiles: {
    default: {
      name: "default",
      baseURL: "http://runtime-store.test/v1",
      apiKey: "fixture-key",
      model: "fixture-model",
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

const requests = [];
const previousFetch = globalThis.fetch;
let modelCall = 0;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  requests.push(body.messages);
  modelCall++;
  if (modelCall === 1) {
    return sseResponse([{
      tool_calls: [{
        index: 0,
        id: "call-read-package",
        type: "function",
        function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" },
      }],
    }]);
  }
  if (modelCall === 2) return sseResponse([{ content: "The fixture package is runtime-store-fixture." }]);
  return sseResponse([{ content: "Continuation retained the prior tool context." }]);
};

try {
  console.log("\n[runtime-store-integration] real runtime persistence");
  const runtime = createRuntime({
    cfg,
    cwd: workspace,
    mode: "default",
    systemPrompt: "Inspect files safely.",
    ask: async () => "n",
    legacyAssistantOutput: false,
  });
  await runtime.handleInput("Inspect package.json and report its package name.");
  const sessionId = runtime.sessionId;
  runtime.shutdown();

  const initialEvents = runtimeEventStore.readRuntimeProtocolEvents(sessionId);
  const initialTyped = new runtimeStores.FileRuntimeStore().loadSession(sessionId);
  check("runtime emits durable message.appended records", initialEvents.filter((event) => event.kind === "message.appended").length === 5, initialEvents.map((event) => event.kind).join(","));
  check(
    "typed snapshot preserves assistant tool call and tool result",
    initialTyped?.contextComplete === true &&
      initialTyped.messages.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "call-read-package") &&
      initialTyped.messages.some((message) => message.role === "tool" && message.tool_call_id === "call-read-package" && String(message.content).includes("runtime-store-fixture")),
    JSON.stringify(initialTyped),
  );

  let sequence = initialEvents.at(-1).sequence;
  runtimeEventStore.appendRuntimeProtocolEvent(protocolEvent({
    sessionId,
    turnId: `${sessionId}-turn-review`,
    sequence: ++sequence,
    id: "rpe-approval-fixture",
    kind: "approval.requested",
    legacyType: "permission:requested",
    status: "waiting",
    title: "Approval required",
    payload: { action: "review generated diff" },
    actor: "system",
  }));
  runtimeEventStore.appendRuntimeProtocolEvent(protocolEvent({
    sessionId,
    turnId: `${sessionId}-turn-review`,
    sequence: ++sequence,
    id: "rpe-diff-fixture",
    kind: "diff.created",
    legacyType: "diff:created",
    status: "done",
    title: "Changed package.json",
    payload: { diff: { id: "diff-fixture", path: "package.json", status: "pending" } },
    actor: "tool",
    visibility: ["timeline", "diff", "job", "sdk"],
  }));

  console.log("\n[runtime-store-integration] event-only reconstruction");
  fs.unlinkSync(path.join(sessionStore.SESSIONS_DIR, `${sessionId}.json`));
  new runtimeStores.FileRuntimeStore().deleteSession(sessionId);
  const rebuilt = sessionStore.loadSession(sessionId);
  const rebuiltAgain = sessionStore.loadSession(sessionId);
  const typedAfterImport = new runtimeStores.FileRuntimeStore();
  const rebuiltMessages = typedAfterImport.messages.list(sessionId).records;
  const recent = sessionStore.listSessions(workspace).find((item) => item.id === sessionId);
  check(
    "session rebuilds without legacy JSON or typed cache",
    rebuilt?.source === "runtime-store" && rebuilt.messages.length === 4 && rebuilt.messages[1].tool_calls?.[0]?.function.name === "read_file" && rebuilt.messages[2].role === "tool",
    JSON.stringify(rebuilt),
  );
  check("repeated event import is idempotent", rebuiltAgain?.messages.length === 4 && rebuiltMessages.length === 5, JSON.stringify(rebuiltMessages));
  check("event-only session is resumable in recent sessions", recent?.source === "runtime-store" && recent.replayOnly === false, JSON.stringify(recent));

  const transcript = typedAfterImport.loadTranscript(sessionId);
  check(
    "tool approval and diff transcript survives legacy deletion",
    transcript.events.some((event) => event.kind === "tool.completed") &&
      transcript.events.some((event) => event.kind === "approval.requested") &&
      transcript.events.some((event) => event.kind === "diff.created"),
    transcript.events.map((event) => event.kind).join(","),
  );

  console.log("\n[runtime-store-integration] continuation from reconstructed context");
  const resumed = createRuntime({
    cfg,
    cwd: workspace,
    mode: "default",
    systemPrompt: "Inspect files safely.",
    ask: async () => "n",
    restored: rebuilt,
    legacyAssistantOutput: false,
  });
  await resumed.handleInput("Continue from the prior result.");
  resumed.shutdown();
  const continuationRequest = requests.at(-1);
  check(
    "continued model request contains restored tool context",
    continuationRequest.some((message) => message.role === "assistant" && message.tool_calls?.[0]?.id === "call-read-package") &&
      continuationRequest.some((message) => message.role === "tool" && message.tool_call_id === "call-read-package"),
    JSON.stringify(continuationRequest),
  );

  console.log("\n[runtime-store-integration] crash-window precedence");
  const crashSessionId = "crash-window-session";
  sessionStore.saveSession(crashSessionId, workspace, "fixture-model", {
    system: { role: "system", content: "Crash recovery policy" },
    messages: [{ role: "user", content: "Persisted before the response" }],
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  });
  const crashMessages = [
    { id: "rpe-crash-system", role: "system", content: "Crash recovery policy" },
    { id: "rpe-crash-user", role: "user", content: "Persisted before the response" },
    { id: "rpe-crash-assistant", role: "assistant", content: "Recovered after the last legacy save" },
  ];
  for (let index = 0; index < crashMessages.length; index++) {
    const item = crashMessages[index];
    runtimeEventStore.appendRuntimeProtocolEvent(protocolEvent({
      sessionId: crashSessionId,
      turnId: `${crashSessionId}-turn-1`,
      sequence: index + 1,
      id: item.id,
      kind: "message.appended",
      legacyType: "message:appended",
      status: "done",
      title: `${item.role} message persisted`,
      payload: {
        messageId: `msg-${item.role}`,
        message: { role: item.role, content: item.content },
        runtimeContext: { cwd: workspace, model: "fixture-model" },
      },
      actor: item.role,
      visibility: ["hidden", "sdk"],
    }));
  }
  const legacyCrashFile = path.join(tmp, ".hicode", "sessions", `${crashSessionId}.json`);
  const recoveredWithLegacyPresent = sessionStore.loadSession(crashSessionId);
  check(
    "new complete event context wins over a stale legacy snapshot",
    fs.existsSync(legacyCrashFile) &&
      recoveredWithLegacyPresent?.source === "runtime-store" &&
      recoveredWithLegacyPresent.messages.some((message) => message.role === "assistant" && message.content === "Recovered after the last legacy save"),
    JSON.stringify(recoveredWithLegacyPresent),
  );
  sessionStore.deleteSession(crashSessionId);

  console.log("\n[runtime-store-integration] conflicting migration fallback");
  const conflictSessionId = "legacy-conflict-session";
  const conflictStore = new runtimeStores.FileRuntimeStore();
  conflictStore.events.append(protocolEvent({
    sessionId: conflictSessionId,
    turnId: `${conflictSessionId}-turn-1`,
    sequence: 1,
    id: "rpe-typed-conflict",
    kind: "turn.started",
    legacyType: "turn:start",
    status: "running",
    title: "Typed event",
  }));
  const legacyConflict = protocolEvent({
    sessionId: conflictSessionId,
    turnId: `${conflictSessionId}-turn-1`,
    sequence: 1,
    id: "rpe-legacy-conflict",
    kind: "turn.started",
    legacyType: "turn:start",
    status: "running",
    title: "Legacy source event",
  });
  const legacyConflictFile = runtimeEventStore.runtimeProtocolEventPath(conflictSessionId);
  fs.mkdirSync(path.dirname(legacyConflictFile), { recursive: true });
  fs.writeFileSync(legacyConflictFile, `${JSON.stringify(legacyConflict)}\n`);
  const conflictRead = runtimeEventStore.readRuntimeProtocolEvents(conflictSessionId);
  check(
    "failed typed import returns the complete legacy event source",
    conflictRead.length === 1 && conflictRead[0].id === legacyConflict.id,
    JSON.stringify(conflictRead),
  );
  sessionStore.deleteSession(conflictSessionId);

  console.log("\n[runtime-store-integration] interrupted turn recovery");
  const running = protocolEvent({
    sessionId: "crashed-thread",
    turnId: "crashed-thread-turn-1",
    sequence: 1,
    id: "rpe-running-only",
    kind: "turn.started",
    legacyType: "turn:start",
    status: "running",
    title: "Interrupted by process loss",
    payload: { retryInput: "resume this work" },
  });
  const recoverable = recovery.recoverableTasksFromProtocolEvents([running]);
  check("unterminated running turn becomes recoverable interrupted work", recoverable.length === 1 && recoverable[0].status === "interrupted" && recoverable[0].retryInput === "resume this work", JSON.stringify(recoverable));

  const durableCrashEvents = [
    running,
    protocolEvent({
      sessionId: "crashed-thread",
      turnId: "crashed-thread-turn-1",
      sequence: 2,
      id: "rpe-partial-output",
      kind: "assistant.delta",
      legacyType: "assistant:delta",
      status: "running",
      actor: "assistant",
      title: "Assistant output",
      visibility: ["chat", "sdk"],
      payload: { delta: "durable partial output" },
    }),
  ];
  for (const event of durableCrashEvents) {
    const appended = runtimeEventStore.appendRuntimeProtocolEvent(event);
    check(`durable crash fixture appends ${event.id}`, appended.ok, JSON.stringify(appended));
  }

  const approvalSession = "approval-crash-thread";
  const approvalCrashEvents = [
    protocolEvent({ sessionId: approvalSession, turnId: `${approvalSession}-turn-1`, sequence: 1, id: "approval-turn-start", kind: "turn.started", legacyType: "turn:start", status: "running", title: "Approval crash", payload: { retryInput: "write configuration" } }),
    protocolEvent({ sessionId: approvalSession, turnId: `${approvalSession}-turn-1`, sequence: 2, id: "approval-tool-start", kind: "tool.started", legacyType: "tool:start", status: "running", title: "Write configuration", actor: "tool", payload: {}, }),
    protocolEvent({ sessionId: approvalSession, turnId: `${approvalSession}-turn-1`, sequence: 3, id: "approval-pending", kind: "approval.requested", legacyType: "permission:requested", status: "waiting", title: "Permission required", payload: { approvalId: "approval-pending", action: "write configuration" } }),
  ];
  for (const event of approvalCrashEvents) runtimeEventStore.appendRuntimeProtocolEvent(event);

  const toolSession = "tool-crash-thread";
  const toolCrashEvents = [
    protocolEvent({ sessionId: toolSession, turnId: `${toolSession}-turn-1`, sequence: 1, id: "tool-turn-start", kind: "turn.started", legacyType: "turn:start", status: "running", title: "Tool crash", payload: { retryInput: "run build" } }),
    protocolEvent({ sessionId: toolSession, turnId: `${toolSession}-turn-1`, sequence: 2, id: "unknown-tool-start", kind: "tool.started", legacyType: "tool:start", status: "running", title: "Run build", actor: "tool", tool: "bash", payload: {} }),
  ];
  for (const event of toolCrashEvents) runtimeEventStore.appendRuntimeProtocolEvent(event);

  const durableRecovery = recovery.readRecoverableTasksFromRuntimeStore(10);
  const streamedTask = durableRecovery.find((task) => task.sessionId === "crashed-thread");
  const approvalTask = durableRecovery.find((task) => task.sessionId === approvalSession);
  const toolTask = durableRecovery.find((task) => task.sessionId === toolSession);
  check("durable stream crash preserves partial output and safe retry", streamedTask?.recoveryAction === "retry_turn" && streamedTask.canRetry && streamedTask.partialAssistantText === "durable partial output", JSON.stringify(streamedTask));
  check("durable approval crash requires a new decision", approvalTask?.recoveryAction === "retry_with_approval" && approvalTask.requiresApproval && approvalTask.pendingApproval?.requestId === "approval-pending", JSON.stringify(approvalTask));
  check("durable tool crash blocks automatic replay", toolTask?.recoveryAction === "inspect_tool" && toolTask.canRetry === false && toolTask.pendingTool?.tool === "bash", JSON.stringify(toolTask));

  runtimeEventStore.deleteRuntimeProtocolEvents("crashed-thread");
  runtimeEventStore.deleteRuntimeProtocolEvents(approvalSession);
  runtimeEventStore.deleteRuntimeProtocolEvents(toolSession);

  sessionStore.deleteSession(sessionId);
} finally {
  globalThis.fetch = previousFetch;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
