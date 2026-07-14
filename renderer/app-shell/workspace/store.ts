import {
  normalizeConversationMessage,
  normalizeWorkspaceSession,
  type ConversationMessage,
  type ConversationStatus,
  type WorkspaceActionName,
  type WorkspaceDiff,
  type WorkspaceDrawer,
  type WorkspaceRecoveryTask,
  type WorkspaceSession,
  type WorkspaceSnapshot,
  type WorkspaceTimelineEvent,
} from "./contracts.ts";

export interface WorkspaceStore {
  getSnapshot(): WorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  setSessions(sessions: readonly WorkspaceSession[], activeSessionId?: string | null): void;
  setSessionFilter(filter: string): void;
  setConversation(messages: readonly ConversationMessage[], sessionId?: string | null, activeAssistantMessageId?: string | null): void;
  clearConversation(sessionId?: string | null): void;
  appendMessage(message: ConversationMessage): string;
  startAssistantMessage(id?: string): string;
  appendAssistantDelta(delta: string): string;
  finishAssistantMessage(status: ConversationStatus, fallbackText?: string): void;
  setTimeline(events: readonly WorkspaceTimelineEvent[]): void;
  setRecoveryTasks(tasks: readonly WorkspaceRecoveryTask[]): void;
  setDiffs(diffs: readonly WorkspaceDiff[], selectedDiffId?: string | null, showArchivedDiffs?: boolean): void;
  setDrawer(drawer: WorkspaceDrawer): void;
  setAvailableActions(actions: readonly WorkspaceActionName[]): void;
  setActionError(message: string): void;
  getConversationMessages(): ConversationMessage[];
}

const initialSnapshot: WorkspaceSnapshot = Object.freeze({
  sessions: Object.freeze([]),
  activeSessionId: null,
  sessionFilter: "",
  messages: Object.freeze([]),
  conversationSessionId: null,
  conversationEpoch: 0,
  activeAssistantMessageId: null,
  timeline: Object.freeze([]),
  recoveryTasks: Object.freeze([]),
  diffs: Object.freeze([]),
  selectedDiffId: null,
  showArchivedDiffs: false,
  drawer: "none",
  availableActions: Object.freeze([]),
  actionError: "",
});

export function createWorkspaceStore(): WorkspaceStore {
  let snapshot = initialSnapshot;
  let sequence = 0;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<WorkspaceSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  };

  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

  const appendMessage = (value: ConversationMessage) => {
    const message = Object.freeze(normalizeConversationMessage(value));
    publish({ messages: Object.freeze([...snapshot.messages, message]) });
    return message.id;
  };

  const startAssistantMessage = (value?: string) => {
    const id = String(value || nextId("assistant"));
    appendMessage({ id, role: "assistant", text: "", status: "pending", attachments: [] });
    publish({ activeAssistantMessageId: id });
    return id;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSessions(sessions, activeSessionId = snapshot.activeSessionId) {
      publish({
        sessions: Object.freeze(sessions.map((item) => Object.freeze(normalizeWorkspaceSession(item)))),
        activeSessionId: activeSessionId ? String(activeSessionId) : null,
      });
    },
    setSessionFilter(filter) {
      publish({ sessionFilter: String(filter || "") });
    },
    setConversation(messages, sessionId = snapshot.conversationSessionId, activeAssistantMessageId = null) {
      publish({
        messages: Object.freeze(messages.map((item) => Object.freeze(normalizeConversationMessage(item)))),
        conversationSessionId: sessionId ? String(sessionId) : null,
        conversationEpoch: snapshot.conversationEpoch + 1,
        activeAssistantMessageId: activeAssistantMessageId ? String(activeAssistantMessageId) : null,
      });
    },
    clearConversation(sessionId = null) {
      publish({
        messages: Object.freeze([]),
        conversationSessionId: sessionId ? String(sessionId) : null,
        conversationEpoch: snapshot.conversationEpoch + 1,
        activeAssistantMessageId: null,
      });
    },
    appendMessage,
    startAssistantMessage,
    appendAssistantDelta(delta) {
      const id = snapshot.activeAssistantMessageId || startAssistantMessage();
      const messages = snapshot.messages.map((message) => message.id === id
        ? Object.freeze({ ...message, text: `${message.text}${String(delta || "")}`, status: "streaming" as const })
        : message);
      publish({ messages: Object.freeze(messages) });
      return id;
    },
    finishAssistantMessage(status, fallbackText = "") {
      const id = snapshot.activeAssistantMessageId;
      if (!id) return;
      const messages = snapshot.messages.map((message) => message.id === id
        ? Object.freeze({ ...message, text: message.text || String(fallbackText || ""), status })
        : message);
      publish({ messages: Object.freeze(messages), activeAssistantMessageId: null });
    },
    setTimeline(events) {
      publish({ timeline: Object.freeze(events.map((event) => Object.freeze({ ...event, payload: event.payload ? Object.freeze({ ...event.payload }) : undefined }))) });
    },
    setRecoveryTasks(tasks) {
      publish({ recoveryTasks: Object.freeze(tasks.map((task) => Object.freeze({ ...task }))) });
    },
    setDiffs(diffs, selectedDiffId = snapshot.selectedDiffId, showArchivedDiffs = snapshot.showArchivedDiffs) {
      publish({
        diffs: Object.freeze(diffs.map((diff) => Object.freeze({ ...diff }))),
        selectedDiffId: selectedDiffId ? String(selectedDiffId) : null,
        showArchivedDiffs: Boolean(showArchivedDiffs),
      });
    },
    setDrawer(drawer) {
      if (!(["none", "timeline", "inspector"] as const).includes(drawer)) throw new Error(`Unsupported workspace drawer '${drawer}'`);
      publish({ drawer });
    },
    setAvailableActions(actions) {
      publish({ availableActions: Object.freeze([...new Set(actions)].sort()) });
    },
    setActionError(message) {
      publish({ actionError: String(message || "") });
    },
    getConversationMessages() {
      return snapshot.messages.map((message) => ({ ...message, attachments: message.attachments.map((attachment) => ({ ...attachment })) }));
    },
  };
}
