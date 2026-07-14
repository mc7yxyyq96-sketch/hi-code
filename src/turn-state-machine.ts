import type { RuntimeProtocolEvent, RuntimeProtocolStatus } from "./runtime-protocol.js";

export type TurnLifecycleState =
  | "running_model"
  | "streaming"
  | "waiting_approval"
  | "tool_running"
  | "completed"
  | "failed"
  | "denied"
  | "interrupted";

export type RecoveryAction =
  | "none"
  | "retry_turn"
  | "retry_with_approval"
  | "review_output"
  | "inspect_tool";

export interface PendingApprovalState {
  requestId: string;
  tool: string;
  action: string;
  path?: string;
  requestedAt: number;
}

export interface ActiveToolState {
  eventId: string;
  tool: string;
  summary: string;
  startedAt: number;
}

export interface RuntimeTurnState {
  sessionId: string;
  turnId: string;
  title: string;
  retryInput: string;
  state: TurnLifecycleState;
  terminalStatus?: RuntimeProtocolStatus;
  recoveryAction: RecoveryAction;
  canRetry: boolean;
  requiresApproval: boolean;
  reason: string;
  partialAssistantText: string;
  partialOutputTruncated: boolean;
  pendingApproval?: PendingApprovalState;
  activeTool?: ActiveToolState;
  completedRiskyTools: string[];
  createdAt: number;
  updatedAt: number;
  durationMs?: number;
  lastSequence: number;
}

const PARTIAL_OUTPUT_LIMIT = 32_768;
const READ_ONLY_TOOLS = new Set(["read_file", "ls", "glob", "grep"]);
const TERMINAL_TURN_KINDS = new Set(["turn.completed", "turn.failed", "turn.denied", "turn.interrupted"]);
const TERMINAL_TOOL_KINDS = new Set(["tool.completed", "tool.failed", "tool.denied", "tool.interrupted"]);

export function reduceTurnStates(events: RuntimeProtocolEvent[]): RuntimeTurnState[] {
  const byTurn = new Map<string, RuntimeProtocolEvent[]>();
  for (const event of events) {
    if (!event?.turnId) continue;
    const group = byTurn.get(event.turnId) ?? [];
    group.push(event);
    byTurn.set(event.turnId, group);
  }
  const states: RuntimeTurnState[] = [];
  for (const group of byTurn.values()) {
    const state = reduceTurnState(group);
    if (state) states.push(state);
  }
  return states.sort((a, b) => b.updatedAt - a.updatedAt || b.lastSequence - a.lastSequence);
}

export function buildRecoveryPlan(events: RuntimeProtocolEvent[]): RuntimeTurnState | undefined {
  return reduceTurnState(events);
}

export function reduceTurnState(events: RuntimeProtocolEvent[]): RuntimeTurnState | undefined {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
  const start = ordered.find((event) => event.kind === "turn.started");
  if (!start) return undefined;

  const approvals = new Map<string, PendingApprovalState>();
  const activeTools = new Map<string, ActiveToolState>();
  const completedRiskyTools = new Set<string>();
  let partialAssistantText = "";
  let partialOutputTruncated = false;
  let assistantCompleted = false;
  let deniedApproval = false;
  let terminal: RuntimeProtocolEvent | undefined;

  for (const event of ordered) {
    if (event.kind === "assistant.delta") {
      const delta = stringValue(event.payload?.delta);
      if (delta) {
        const combined = partialAssistantText + delta;
        partialOutputTruncated = partialOutputTruncated || combined.length > PARTIAL_OUTPUT_LIMIT;
        partialAssistantText = combined.slice(0, PARTIAL_OUTPUT_LIMIT);
      }
      continue;
    }
    if (event.kind === "assistant.completed") {
      assistantCompleted = event.status === "done";
      if (!partialAssistantText) {
        const content = stringValue(event.payload?.content);
        partialOutputTruncated = content.length > PARTIAL_OUTPUT_LIMIT;
        partialAssistantText = content.slice(0, PARTIAL_OUTPUT_LIMIT);
      }
      continue;
    }
    if (event.kind === "approval.requested") {
      const requestId = stringValue(event.payload?.approvalId) || event.id;
      approvals.set(requestId, {
        requestId,
        tool: event.tool || "unknown",
        action: stringValue(event.payload?.action) || event.summary || event.title,
        path: stringValue(event.payload?.path) || undefined,
        requestedAt: event.createdAt,
      });
      continue;
    }
    if (event.kind === "approval.resolved") {
      const requestId = stringValue(event.payload?.requestId) || stringValue(event.payload?.parentId);
      const decision = stringValue(event.payload?.decision);
      const pending = approvals.get(requestId);
      approvals.delete(requestId);
      if (decision === "deny") {
        deniedApproval = true;
        if (pending?.tool) removeLatestToolByName(activeTools, pending.tool);
      }
      continue;
    }
    if (event.kind === "tool.started") {
      activeTools.set(event.id, {
        eventId: event.id,
        tool: event.tool || "unknown",
        summary: event.summary || event.title,
        startedAt: event.createdAt,
      });
      continue;
    }
    if (TERMINAL_TOOL_KINDS.has(event.kind)) {
      const parentId = stringValue(event.payload?.parentId);
      const started = parentId ? activeTools.get(parentId) : latestToolByName(activeTools, event.tool || "unknown");
      if (event.kind === "tool.completed" && isRiskyTool(event.tool || started?.tool || "unknown")) {
        completedRiskyTools.add(event.tool || started?.tool || "unknown");
      }
      if (parentId) activeTools.delete(parentId);
      else if (started) activeTools.delete(started.eventId);
      continue;
    }
    if (TERMINAL_TURN_KINDS.has(event.kind)) terminal = event;
  }

  const pendingApproval = [...approvals.values()].at(-1);
  const activeTool = [...activeTools.values()].at(-1);
  const terminalStatus = terminal?.status;
  const base = {
    sessionId: start.sessionId,
    turnId: start.turnId,
    title: start.title,
    retryInput: stringValue(start.payload?.retryInput) || stringValue(start.payload?.input) || start.summary || "",
    terminalStatus,
    partialAssistantText,
    partialOutputTruncated,
    pendingApproval,
    activeTool,
    completedRiskyTools: [...completedRiskyTools],
    createdAt: start.createdAt,
    updatedAt: Number(terminal?.updatedAt ?? terminal?.createdAt ?? ordered.at(-1)?.updatedAt ?? ordered.at(-1)?.createdAt ?? start.createdAt),
    durationMs: finiteNumber(terminal?.payload?.durationMs),
    lastSequence: ordered.at(-1)?.sequence ?? start.sequence,
  };

  if (terminal?.kind === "turn.completed") {
    return { ...base, state: "completed", recoveryAction: "none", canRetry: false, requiresApproval: false, reason: "turn completed" };
  }
  if (completedRiskyTools.size) {
    return {
      ...base,
      state: terminalState(terminal),
      recoveryAction: "inspect_tool",
      canRetry: false,
      requiresApproval: false,
      reason: `turn already completed side-effecting tool work: ${[...completedRiskyTools].join(", ")}`,
    };
  }
  if (pendingApproval) {
    return {
      ...base,
      state: "waiting_approval",
      recoveryAction: "retry_with_approval",
      canRetry: Boolean(base.retryInput),
      requiresApproval: true,
      reason: "approval was not resolved; retry must request a new human decision",
    };
  }
  if (activeTool) {
    return {
      ...base,
      state: "tool_running",
      recoveryAction: "inspect_tool",
      canRetry: false,
      requiresApproval: false,
      reason: `tool '${activeTool.tool}' has unknown completion or side effects`,
    };
  }
  if (deniedApproval || terminal?.kind === "turn.denied") {
    return {
      ...base,
      state: "denied",
      recoveryAction: "retry_with_approval",
      canRetry: Boolean(base.retryInput),
      requiresApproval: true,
      reason: "the previous approval was denied; retry requires a new decision",
    };
  }
  if (assistantCompleted) {
    return {
      ...base,
      state: "interrupted",
      recoveryAction: "review_output",
      canRetry: false,
      requiresApproval: false,
      reason: "assistant output completed but the turn terminal event is missing",
    };
  }
  const state = terminalState(terminal, partialAssistantText ? "streaming" : "running_model");
  return {
    ...base,
    state,
    recoveryAction: "retry_turn",
    canRetry: Boolean(base.retryInput),
    requiresApproval: false,
    reason: partialAssistantText ? "assistant streaming was interrupted; partial output was preserved" : "turn stopped before a side-effecting tool started",
  };
}

export function isRiskyTool(tool: string): boolean {
  return !READ_ONLY_TOOLS.has(String(tool || "").trim());
}

function terminalState(event: RuntimeProtocolEvent | undefined, fallback: TurnLifecycleState = "interrupted"): TurnLifecycleState {
  if (!event) return fallback;
  if (event.kind === "turn.failed") return "failed";
  if (event.kind === "turn.denied") return "denied";
  if (event.kind === "turn.interrupted") return "interrupted";
  return "completed";
}

function latestToolByName(tools: Map<string, ActiveToolState>, name: string): ActiveToolState | undefined {
  return [...tools.values()].reverse().find((tool) => tool.tool === name);
}

function removeLatestToolByName(tools: Map<string, ActiveToolState>, name: string): void {
  const found = latestToolByName(tools, name);
  if (found) tools.delete(found.eventId);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
