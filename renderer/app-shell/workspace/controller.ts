import type {
  ConversationMessage,
  ConversationStatus,
  WorkspaceActionName,
  WorkspaceActions,
  WorkspaceDiff,
  WorkspaceDrawer,
  WorkspaceRecoveryTask,
  WorkspaceSession,
  WorkspaceSnapshot,
  WorkspaceTimelineEvent,
} from "./contracts.ts";
import type { WorkspaceStore } from "./store.ts";

export class WorkspaceActionUnavailableError extends Error {
  constructor(action: WorkspaceActionName) {
    super(`Workspace action '${action}' is unavailable because its production handler is not registered`);
    this.name = "WorkspaceActionUnavailableError";
  }
}

export class WorkspaceController {
  readonly #store: WorkspaceStore;
  #actions: Partial<WorkspaceActions> = {};

  constructor(store: WorkspaceStore) {
    this.#store = store;
  }

  configureActions(actions: Partial<WorkspaceActions>) {
    const next = { ...this.#actions };
    for (const [name, action] of Object.entries(actions || {})) {
      if (typeof action !== "function") continue;
      (next as Record<string, unknown>)[name] = action;
    }
    this.#actions = next;
    this.#store.setAvailableActions(Object.keys(next) as WorkspaceActionName[]);
    this.#store.setActionError("");
  }

  hasAction(name: WorkspaceActionName) {
    return typeof this.#actions[name] === "function";
  }

  async run(name: WorkspaceActionName, ...args: unknown[]) {
    const action = this.#actions[name] as ((...values: unknown[]) => unknown | Promise<unknown>) | undefined;
    if (!action) {
      const error = new WorkspaceActionUnavailableError(name);
      this.#store.setActionError(error.message);
      throw error;
    }
    try {
      const result = await action(...args);
      this.#store.setActionError("");
      return result;
    } catch (error) {
      this.#store.setActionError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

export interface WorkspaceBridge {
  configureActions(actions: Partial<WorkspaceActions>): void;
  getSnapshot(): WorkspaceSnapshot;
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
  getConversationMessages(): ConversationMessage[];
}

export function createWorkspaceBridge(store: WorkspaceStore, controller: WorkspaceController): WorkspaceBridge {
  return Object.freeze({
    configureActions: (actions: Partial<WorkspaceActions>) => controller.configureActions(actions),
    getSnapshot: () => store.getSnapshot(),
    setSessions: (sessions: readonly WorkspaceSession[], activeSessionId?: string | null) => store.setSessions(sessions, activeSessionId),
    setSessionFilter: (filter: string) => store.setSessionFilter(filter),
    setConversation: (messages: readonly ConversationMessage[], sessionId?: string | null, activeAssistantMessageId?: string | null) => store.setConversation(messages, sessionId, activeAssistantMessageId),
    clearConversation: (sessionId?: string | null) => store.clearConversation(sessionId),
    appendMessage: (message: ConversationMessage) => store.appendMessage(message),
    startAssistantMessage: (id?: string) => store.startAssistantMessage(id),
    appendAssistantDelta: (delta: string) => store.appendAssistantDelta(delta),
    finishAssistantMessage: (status: ConversationStatus, fallbackText?: string) => store.finishAssistantMessage(status, fallbackText),
    setTimeline: (events: readonly WorkspaceTimelineEvent[]) => store.setTimeline(events),
    setRecoveryTasks: (tasks: readonly WorkspaceRecoveryTask[]) => store.setRecoveryTasks(tasks),
    setDiffs: (diffs: readonly WorkspaceDiff[], selectedDiffId?: string | null, showArchivedDiffs?: boolean) => store.setDiffs(diffs, selectedDiffId, showArchivedDiffs),
    setDrawer: (drawer: WorkspaceDrawer) => store.setDrawer(drawer),
    getConversationMessages: () => store.getConversationMessages(),
  });
}
