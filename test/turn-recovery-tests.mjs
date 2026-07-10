import {
  buildRecoveryPlan,
  reduceTurnState,
  reduceTurnStates,
} from "../dist/turn-state-machine.js";
import {
  recoverableTasksFromEvents,
  recoverableTasksFromProtocolEvents,
} from "../dist/recovery.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

let sequence = 0;
function event(kind, options = {}) {
  sequence += 1;
  const status = options.status || defaultStatus(kind);
  return {
    schemaVersion: 1,
    id: options.id || `event-${sequence}`,
    sessionId: options.sessionId || "session-recovery",
    turnId: options.turnId || "turn-recovery",
    sequence,
    kind,
    legacyType: legacyType(kind),
    status,
    actor: kind.startsWith("tool.") ? "tool" : kind.startsWith("assistant.") ? "assistant" : "runtime",
    tool: options.tool,
    title: options.title || kind,
    summary: options.summary,
    createdAt: 1_000 + sequence,
    visibility: ["timeline"],
    ...(options.payload ? { payload: options.payload } : {}),
  };
}

function turnStart(overrides = {}) {
  return event("turn.started", {
    id: overrides.id || "turn-start",
    title: overrides.title || "Run checks",
    sessionId: overrides.sessionId,
    turnId: overrides.turnId,
    payload: { retryInput: overrides.retryInput || "run checks" },
  });
}

console.log("\n[turn-recovery] conservative state reduction");

sequence = 0;
let events = [turnStart(), event("assistant.delta", { payload: { delta: "partial answer" } })];
let state = reduceTurnState(events);
check(
  "streaming interruption preserves output and allows model-only retry",
  state?.state === "streaming" && state.recoveryAction === "retry_turn" && state.canRetry && state.partialAssistantText === "partial answer",
  JSON.stringify(state),
);

sequence = 0;
events = [turnStart(), event("assistant.completed", { status: "done", payload: { content: "complete answer" } })];
state = reduceTurnState(events);
check(
  "completed assistant output without turn terminal requires review",
  state?.recoveryAction === "review_output" && !state.canRetry && state.partialAssistantText === "complete answer",
  JSON.stringify(state),
);
check("recovery planner exposes the same deterministic disposition", buildRecoveryPlan(events)?.recoveryAction === "review_output");

sequence = 0;
events = [
  turnStart(),
  event("assistant.completed", { status: "done", payload: { content: "answer survived" } }),
  event("turn.failed", { status: "error" }),
];
state = reduceTurnState(events);
check(
  "completed answer followed by failed terminal is reviewed instead of duplicated",
  state?.state === "interrupted" && state.recoveryAction === "review_output" && !state.canRetry,
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-write", tool: "write_file" }),
  event("approval.requested", { id: "approval-1", tool: "write_file", payload: { approvalId: "approval-1", action: "write a.txt" } }),
];
state = reduceTurnState(events);
check(
  "unanswered approval requires a new human decision",
  state?.state === "waiting_approval" && state.recoveryAction === "retry_with_approval" && state.requiresApproval && state.pendingApproval?.requestId === "approval-1",
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-write", tool: "write_file" }),
  event("approval.requested", { id: "approval-2", tool: "write_file", payload: { approvalId: "approval-2", action: "write a.txt" } }),
  event("approval.resolved", { tool: "write_file", status: "denied", payload: { requestId: "approval-2", decision: "deny" } }),
  event("tool.denied", { tool: "write_file", status: "denied", payload: { parentId: "tool-write" } }),
  event("turn.denied", { status: "denied" }),
];
state = reduceTurnState(events);
check(
  "denied approval is retryable only through fresh approval",
  state?.state === "denied" && state.recoveryAction === "retry_with_approval" && state.canRetry && state.requiresApproval,
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-bash", tool: "bash", summary: "npm test" }),
  event("approval.requested", { id: "approval-3", tool: "bash", payload: { approvalId: "approval-3", action: "npm test" } }),
  event("approval.resolved", { tool: "bash", status: "done", payload: { requestId: "approval-3", decision: "allow" } }),
];
state = reduceTurnState(events);
check(
  "approved tool with no terminal event blocks automatic retry",
  state?.state === "tool_running" && state.recoveryAction === "inspect_tool" && !state.canRetry && state.activeTool?.tool === "bash",
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-bash", tool: "bash" }),
  event("tool.completed", { tool: "bash", status: "done", payload: { parentId: "tool-bash" } }),
  event("turn.failed", { status: "error" }),
];
state = reduceTurnState(events);
check(
  "failed turn after side-effecting tool blocks automatic retry",
  state?.state === "failed" && state.recoveryAction === "inspect_tool" && !state.canRetry && state.completedRiskyTools.includes("bash"),
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-write", tool: "write_file" }),
  event("approval.requested", { id: "legacy-approval", tool: "write_file", payload: { approvalId: "legacy-approval", action: "write a.txt" } }),
  event("tool.completed", { tool: "write_file", status: "done", payload: { parentId: "tool-write" } }),
  event("turn.failed", { status: "error" }),
];
state = reduceTurnState(events);
check(
  "completed side effect outranks a missing legacy approval resolution",
  state?.recoveryAction === "inspect_tool" && !state.canRetry && state.completedRiskyTools.includes("write_file"),
  JSON.stringify(state),
);

sequence = 0;
events = [
  turnStart(),
  event("tool.started", { id: "tool-read", tool: "read_file" }),
  event("tool.completed", { tool: "read_file", status: "done", payload: { parentId: "tool-read" } }),
  event("turn.failed", { status: "error" }),
];
state = reduceTurnState(events);
check(
  "failed turn after read-only tool can retry",
  state?.state === "failed" && state.recoveryAction === "retry_turn" && state.canRetry,
  JSON.stringify(state),
);

sequence = 0;
events = [turnStart(), event("turn.completed", { status: "done" })];
state = reduceTurnState(events);
check("completed turn needs no recovery", state?.state === "completed" && state.recoveryAction === "none" && !state.canRetry, JSON.stringify(state));

console.log("\n[turn-recovery] durable recovery records");

sequence = 0;
const first = [turnStart({ turnId: "turn-first" }), event("assistant.delta", { turnId: "turn-first", payload: { delta: "first partial" } })];
const second = [turnStart({ turnId: "turn-second", retryInput: "second task" }), event("turn.completed", { turnId: "turn-second", status: "done" })];
const states = reduceTurnStates([...second, ...first]);
check("multiple turns reduce independently", states.length === 2 && states.some((item) => item.turnId === "turn-first" && item.recoveryAction === "retry_turn"), JSON.stringify(states));

const tasks = recoverableTasksFromProtocolEvents([...second, ...first]);
check(
  "protocol recovery excludes completed turns and carries partial output",
  tasks.length === 1 && tasks[0].turnId === "turn-first" && tasks[0].partialAssistantText === "first partial" && tasks[0].canRetry,
  JSON.stringify(tasks),
);

const legacy = recoverableTasksFromEvents([
  { id: "legacy-turn", sessionId: "legacy-session", turnId: "legacy-turn", type: "turn:start", title: "Legacy", createdAt: 10, payload: { retryInput: "legacy task" } },
  { id: "legacy-done", sessionId: "legacy-session", turnId: "legacy-turn", type: "turn:done", status: "error", createdAt: 20, payload: { parentId: "legacy-turn" } },
]);
check(
  "legacy failures without side-effect evidence require inspection",
  legacy.length === 1 && legacy[0].recoveryAction === "inspect_tool" && legacy[0].canRetry === false,
  JSON.stringify(legacy),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);

function defaultStatus(kind) {
  if (kind.endsWith(".completed")) return "done";
  if (kind.endsWith(".failed")) return "error";
  if (kind.endsWith(".denied")) return "denied";
  if (kind.endsWith(".interrupted")) return "interrupted";
  if (kind === "approval.requested") return "waiting";
  return "running";
}

function legacyType(kind) {
  if (kind === "turn.started") return "turn:start";
  if (kind.startsWith("turn.")) return "turn:done";
  if (kind === "assistant.delta") return "assistant:delta";
  if (kind === "assistant.completed") return "assistant:completed";
  if (kind === "approval.requested") return "permission:requested";
  if (kind === "approval.resolved") return "permission:resolved";
  if (kind === "tool.started") return "tool:start";
  return "tool:done";
}
