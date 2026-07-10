import { newEventId, type RuntimeEventDraft, type ToolEventStatus, type ToolEventType } from "./events.js";

export const RUNTIME_PROTOCOL_VERSION = 1;

export const RUNTIME_PROTOCOL_KINDS = [
  "turn.started",
  "turn.updated",
  "turn.completed",
  "turn.failed",
  "turn.denied",
  "turn.interrupted",
  "assistant.delta",
  "assistant.completed",
  "message.appended",
  "model.output",
  "tool.started",
  "tool.output",
  "tool.completed",
  "tool.failed",
  "tool.denied",
  "tool.interrupted",
  "approval.requested",
  "approval.resolved",
  "diff.created",
  "diff.updated",
] as const;

export type RuntimeProtocolKind = (typeof RUNTIME_PROTOCOL_KINDS)[number];

export const RUNTIME_PROTOCOL_STATUSES = [
  "running",
  "waiting",
  "done",
  "error",
  "denied",
  "interrupted",
] as const;

export type RuntimeProtocolStatus = (typeof RUNTIME_PROTOCOL_STATUSES)[number];

export const RUNTIME_PROTOCOL_VISIBILITY = [
  "chat",
  "timeline",
  "diff",
  "job",
  "sdk",
  "hidden",
] as const;

export type RuntimeProtocolVisibility = (typeof RUNTIME_PROTOCOL_VISIBILITY)[number];

export interface RuntimeProtocolSourceEvent extends RuntimeEventDraft {
  sessionId: string;
  turnId: string;
}

export interface RuntimeProtocolEvent {
  schemaVersion: typeof RUNTIME_PROTOCOL_VERSION;
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  kind: RuntimeProtocolKind;
  legacyType: ToolEventType;
  status: RuntimeProtocolStatus;
  actor: "user" | "assistant" | "runtime" | "tool" | "system";
  tool?: string;
  title: string;
  summary?: string;
  createdAt: number;
  updatedAt?: number;
  visibility: RuntimeProtocolVisibility[];
  payload?: Record<string, unknown>;
}

export interface RuntimeProtocolContext {
  sequence: number;
  createdAt?: number;
}

export function createRuntimeProtocolEvent(
  source: RuntimeProtocolSourceEvent,
  context: RuntimeProtocolContext,
): RuntimeProtocolEvent {
  const status = normalizeProtocolStatus(source.status, source.type);
  const kind = protocolKindFromLegacy(source.type, status);
  const payload = stripProtocolPayload(source.payload);
  return {
    schemaVersion: RUNTIME_PROTOCOL_VERSION,
    id: newEventId("rpe"),
    sessionId: requiredString(source.sessionId, "sessionId"),
    turnId: requiredString(source.turnId, "turnId"),
    sequence: requiredSequence(context.sequence),
    kind,
    legacyType: source.type,
    status,
    actor: actorForSourceEvent(source),
    tool: source.tool,
    title: requiredString(source.title, "title"),
    summary: source.summary,
    createdAt: Number.isFinite(context.createdAt) ? Number(context.createdAt) : Date.now(),
    updatedAt: source.updatedAt,
    visibility: visibilityForKind(kind),
    ...(Object.keys(payload).length ? { payload } : {}),
  };
}

export function protocolKindFromLegacy(type: ToolEventType, status: RuntimeProtocolStatus): RuntimeProtocolKind {
  if (type === "turn:start") return "turn.started";
  if (type === "turn:update") return status === "interrupted" ? "turn.interrupted" : "turn.updated";
  if (type === "turn:done") {
    if (status === "error") return "turn.failed";
    if (status === "denied") return "turn.denied";
    if (status === "interrupted") return "turn.interrupted";
    return "turn.completed";
  }
  if (type === "assistant:delta") return "assistant.delta";
  if (type === "assistant:completed") return "assistant.completed";
  if (type === "message:appended") return "message.appended";
  if (type === "tool:start") return "tool.started";
  if (type === "tool:output") return "tool.output";
  if (type === "tool:done") {
    if (status === "error") return "tool.failed";
    if (status === "denied") return "tool.denied";
    if (status === "interrupted") return "tool.interrupted";
    return "tool.completed";
  }
  if (type === "permission:requested") return "approval.requested";
  if (type === "permission:resolved") return "approval.resolved";
  if (type === "diff:created") return "diff.created";
  if (type === "diff:updated") return "diff.updated";
  return "turn.updated";
}

export function validateRuntimeProtocolEvent(event: unknown): { ok: true } | { ok: false; error: string } {
  if (!event || typeof event !== "object") return { ok: false, error: "event must be an object" };
  const value = event as Partial<RuntimeProtocolEvent>;
  if (value.schemaVersion !== RUNTIME_PROTOCOL_VERSION) return { ok: false, error: "unsupported runtime protocol version" };
  for (const field of ["id", "sessionId", "turnId", "title"] as const) {
    if (typeof value[field] !== "string" || !value[field]?.trim()) return { ok: false, error: `${field} must be a non-empty string` };
  }
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) return { ok: false, error: "sequence must be a positive integer" };
  if (!RUNTIME_PROTOCOL_KINDS.includes(value.kind as RuntimeProtocolKind)) return { ok: false, error: "unknown runtime protocol kind" };
  if (!RUNTIME_PROTOCOL_STATUSES.includes(value.status as RuntimeProtocolStatus)) return { ok: false, error: "unknown runtime protocol status" };
  if (!Number.isFinite(value.createdAt)) return { ok: false, error: "createdAt must be finite" };
  if (!Array.isArray(value.visibility) || !value.visibility.length) return { ok: false, error: "visibility must be a non-empty array" };
  for (const entry of value.visibility) {
    if (!RUNTIME_PROTOCOL_VISIBILITY.includes(entry as RuntimeProtocolVisibility)) return { ok: false, error: "unknown visibility value" };
  }
  if (value.kind === "message.appended") {
    const payload = value.payload;
    if (!payload || typeof payload.messageId !== "string" || !payload.messageId.trim() || !validProtocolMessage(payload.message)) {
      return { ok: false, error: "message.appended requires a valid messageId and message" };
    }
  }
  if (value.kind === "approval.resolved") {
    const payload = value.payload;
    if (!payload || typeof payload.requestId !== "string" || !payload.requestId.trim() || !["allow", "always", "deny"].includes(String(payload.decision))) {
      return { ok: false, error: "approval.resolved requires requestId and a valid decision" };
    }
  }
  return { ok: true };
}

export function isRuntimeProtocolEvent(event: unknown): event is RuntimeProtocolEvent {
  return validateRuntimeProtocolEvent(event).ok;
}

function normalizeProtocolStatus(status: ToolEventStatus | undefined, type: ToolEventType): RuntimeProtocolStatus {
  if (status && RUNTIME_PROTOCOL_STATUSES.includes(status)) return status;
  if (type === "permission:requested") return "waiting";
  if (type === "permission:resolved" || type === "tool:done" || type === "turn:done" || type === "diff:created" || type === "diff:updated") return "done";
  return "running";
}

function actorForSourceEvent(source: RuntimeProtocolSourceEvent): RuntimeProtocolEvent["actor"] {
  const type = source.type;
  if (type === "message:appended") {
    const role = source.payload?.message && typeof source.payload.message === "object"
      ? (source.payload.message as Record<string, unknown>).role
      : undefined;
    if (role === "user" || role === "assistant" || role === "tool" || role === "system") return role;
  }
  if (type.startsWith("assistant:")) return "assistant";
  if (type.startsWith("tool:")) return "tool";
  if (type.startsWith("permission:")) return "system";
  if (type.startsWith("diff:")) return "tool";
  return "runtime";
}

function visibilityForKind(kind: RuntimeProtocolKind): RuntimeProtocolVisibility[] {
  if (kind.startsWith("diff.")) return ["timeline", "diff", "job", "sdk"];
  if (kind === "approval.requested" || kind === "approval.resolved") return ["timeline", "job", "sdk"];
  if (kind === "tool.output") return ["timeline", "sdk"];
  if (kind.startsWith("tool.")) return ["timeline", "job", "sdk"];
  if (kind === "assistant.delta") return ["chat", "sdk"];
  if (kind === "assistant.completed") return ["chat", "timeline", "sdk"];
  if (kind === "message.appended") return ["hidden", "sdk"];
  if (kind === "model.output") return ["chat", "timeline", "sdk"];
  return ["timeline", "job", "sdk"];
}

function stripProtocolPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const { runtimeProtocol: _runtimeProtocol, ...rest } = payload;
  return rest;
}

function validProtocolMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.role !== "system" && message.role !== "user" && message.role !== "assistant" && message.role !== "tool") return false;
  if (message.content !== null && typeof message.content !== "string" && !Array.isArray(message.content)) return false;
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) return false;
  if (message.tool_call_id !== undefined && typeof message.tool_call_id !== "string") return false;
  if (message.name !== undefined && typeof message.name !== "string") return false;
  return true;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function requiredSequence(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("sequence must be a positive integer");
  return Number(value);
}
