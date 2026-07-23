export type ToolEventStatus = "running" | "waiting" | "done" | "error" | "denied" | "interrupted";

export type ToolEventType =
  | "turn:start"
  | "turn:update"
  | "turn:done"
  | "tool:start"
  | "tool:output"
  | "tool:done"
  | "permission:requested"
  | "diff:created"
  | "diff:updated";

export type DiffStatus = "pending" | "accepted" | "rejected" | "undone";

export type DiffTool = "write_file" | "edit_file" | "apply_patch" | "undo";

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

export type RuntimeEventSink = (event: RuntimeEventDraft) => string | void;

export function newEventId(prefix = "evt"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newDiffId(): string {
  return newEventId("diff");
}
