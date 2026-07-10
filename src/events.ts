export type ToolEventStatus = "running" | "waiting" | "done" | "error" | "denied" | "interrupted";

export const RUNTIME_EVENT_TYPES = [
  "turn:start",
  "turn:update",
  "turn:done",
  "assistant:delta",
  "assistant:completed",
  "message:appended",
  "tool:start",
  "tool:output",
  "tool:done",
  "permission:requested",
  "permission:resolved",
  "diff:created",
  "diff:updated",
] as const;

export type ToolEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export type AssistantDeltaPayload = Record<string, unknown> & {
  messageId: string;
  delta: string;
  model?: string;
  step?: number;
};

export type AssistantCompletedPayload = Record<string, unknown> & {
  messageId: string;
  content: string;
  model?: string;
  step?: number;
  finishReason?: "completed" | "interrupted" | "error";
};

export type RuntimeMessageAppendedPayload = Record<string, unknown> & {
  messageId: string;
  message: {
    role: "system" | "user" | "assistant" | "tool";
    content: unknown;
    tool_calls?: unknown[];
    tool_call_id?: string;
    name?: string;
  };
};

export type DiffStatus = "pending" | "accepted" | "rejected" | "undone";

export type DiffTool = "write_file" | "edit_file" | "undo";

export interface DiffEntry {
  id: string;
  sessionId: string;
  turnId: string;
  path: string;
  absPath: string;
  before: string | null;
  after: string;
  status: DiffStatus;
  tool: DiffTool;
  createdAt: number;
  updatedAt?: number;
}

export interface ToolEvent {
  id: string;
  sessionId: string;
  turnId: string;
  type: ToolEventType;
  tool?: string;
  title: string;
  summary?: string;
  status?: ToolEventStatus;
  path?: string;
  diffId?: string;
  createdAt: number;
  updatedAt?: number;
  payload?: Record<string, unknown>;
}

export type RuntimeEventDraft = Omit<
  Partial<ToolEvent>,
  "id" | "createdAt" | "type" | "title"
> & {
  type: ToolEventType;
  title: string;
  payload?: Record<string, unknown>;
};

export type RuntimeEventEnvelope = ToolEvent;

export interface RuntimeEventSink {
  emit(event: RuntimeEventEnvelope): string | void;
}

export function newEventId(prefix = "evt"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newDiffId(): string {
  return newEventId("diff");
}
