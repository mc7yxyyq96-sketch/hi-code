export const MAX_TRANSCRIPT_ROWS = 160;
export const MAX_TIMELINE_ROWS = 120;

export type WorkspaceDrawer = "none" | "timeline" | "inspector";
export type ConversationRole = "user" | "assistant" | "system";
export type ConversationStatus = "pending" | "streaming" | "complete" | "empty" | "error";

export interface WorkspaceAttachment {
  id?: string;
  name: string;
  kind?: string;
  mimeType?: string;
  size?: number;
}

export interface WorkspaceSession {
  id: string;
  firstPrompt: string;
  updatedAt?: string | number;
  messageCount: number;
  eventCount?: number;
  model?: string;
  cwd?: string;
  replayOnly?: boolean;
  transient?: boolean;
  running?: boolean;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  status: ConversationStatus;
  attachments: WorkspaceAttachment[];
}

export interface WorkspaceTimelineEvent {
  id: string;
  type: string;
  status?: string;
  title?: string;
  tool?: string;
  summary?: string;
  createdAt?: number;
  updatedAt?: number;
  diffId?: string;
  payload?: {
    durationMs?: number;
    retryInput?: string;
    [key: string]: unknown;
  };
}

export interface WorkspaceRecoveryTask {
  id: string;
  sessionId?: string;
  status?: string;
  title?: string;
  summary?: string;
  reason?: string;
  createdAt?: number;
  updatedAt?: number;
  durationMs?: number;
  phase?: string;
  partialAssistantText?: string;
  partialOutputTruncated?: boolean;
  recoveryAction?: string;
  canRetry?: boolean;
}

export interface WorkspaceDiff {
  id: string;
  path: string;
  before: string | null;
  after: string | null;
  status: string;
}

export interface WorkspaceActions {
  openSession(id: string): unknown | Promise<unknown>;
  deleteSession(id: string): unknown | Promise<unknown>;
  retryRecovery(id: string): unknown | Promise<unknown>;
  refreshRecovery(): unknown | Promise<unknown>;
  retryTimeline(id: string): unknown | Promise<unknown>;
  selectDiff(id: string): unknown | Promise<unknown>;
  archiveDiff(): unknown | Promise<unknown>;
  rollbackDiff(): unknown | Promise<unknown>;
  archiveAllDiffs(): unknown | Promise<unknown>;
  rollbackAllDiffs(): unknown | Promise<unknown>;
  toggleDiffHistory(): unknown | Promise<unknown>;
  clearDiffHistory(): unknown | Promise<unknown>;
  requestDiffRevision(comment: import("./review.ts").DiffReviewComment): unknown | Promise<unknown>;
}

export type WorkspaceActionName = keyof WorkspaceActions;

export interface WorkspaceSnapshot {
  sessions: readonly WorkspaceSession[];
  activeSessionId: string | null;
  sessionFilter: string;
  messages: readonly ConversationMessage[];
  conversationSessionId: string | null;
  conversationEpoch: number;
  activeAssistantMessageId: string | null;
  timeline: readonly WorkspaceTimelineEvent[];
  recoveryTasks: readonly WorkspaceRecoveryTask[];
  diffs: readonly WorkspaceDiff[];
  selectedDiffId: string | null;
  showArchivedDiffs: boolean;
  drawer: WorkspaceDrawer;
  availableActions: readonly WorkspaceActionName[];
  actionError: string;
}

export function filterWorkspaceSessions(sessions: readonly WorkspaceSession[], filter: string) {
  const query = String(filter || "").trim().toLowerCase();
  if (!query) return [...sessions];
  return sessions.filter((session) => [session.firstPrompt, session.model, session.cwd]
    .some((value) => String(value || "").toLowerCase().includes(query)));
}

export function normalizeWorkspaceSession(value: WorkspaceSession): WorkspaceSession {
  const id = String(value?.id || "").trim();
  if (!id) throw new Error("Workspace session id is required");
  return {
    id,
    firstPrompt: String(value.firstPrompt || "(空会话)"),
    updatedAt: value.updatedAt,
    messageCount: Math.max(0, Number(value.messageCount) || 0),
    eventCount: value.eventCount === undefined ? undefined : Math.max(0, Number(value.eventCount) || 0),
    model: value.model ? String(value.model) : undefined,
    cwd: value.cwd ? String(value.cwd) : undefined,
    replayOnly: Boolean(value.replayOnly),
    transient: Boolean(value.transient),
    running: Boolean(value.running),
  };
}

export function normalizeConversationMessage(value: ConversationMessage): ConversationMessage {
  const id = String(value?.id || "").trim();
  if (!id) throw new Error("Conversation message id is required");
  if (!(["user", "assistant", "system"] as const).includes(value.role)) throw new Error(`Unsupported conversation role '${String(value.role)}'`);
  return {
    id,
    role: value.role,
    text: String(value.text || ""),
    status: value.status || "complete",
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map((attachment) => ({
          id: attachment.id ? String(attachment.id) : undefined,
          name: String(attachment.name || "attachment"),
          kind: attachment.kind ? String(attachment.kind) : undefined,
          mimeType: attachment.mimeType ? String(attachment.mimeType) : undefined,
          size: attachment.size === undefined ? undefined : Math.max(0, Number(attachment.size) || 0),
        }))
      : [],
  };
}
