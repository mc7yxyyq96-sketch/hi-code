import fs from "node:fs";
import path from "node:path";
import {
  listRuntimeProtocolEventSessions,
  readRuntimeProtocolEvents,
} from "./runtime-event-store.js";
import type { RuntimeProtocolEvent } from "./runtime-protocol.js";
import {
  reduceTurnStates,
  type ActiveToolState,
  type PendingApprovalState,
  type RecoveryAction,
  type TurnLifecycleState,
} from "./turn-state-machine.js";

type RecoverableStatus = "error" | "interrupted" | "denied";

export interface RuntimeLogEvent {
  id?: string;
  sessionId?: string;
  turnId?: string;
  type?: string;
  title?: string;
  summary?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  payload?: Record<string, unknown>;
}

export interface RecoverableTask {
  id: string;
  sessionId: string;
  turnId: string;
  title: string;
  summary: string;
  status: RecoverableStatus;
  retryInput: string;
  createdAt: number;
  updatedAt?: number;
  durationMs?: number;
  phase: TurnLifecycleState;
  recoveryAction: RecoveryAction;
  canRetry: boolean;
  requiresApproval: boolean;
  reason: string;
  partialAssistantText?: string;
  partialOutputTruncated?: boolean;
  pendingTool?: ActiveToolState;
  pendingApproval?: PendingApprovalState;
}

interface TurnRecord {
  start?: RuntimeLogEvent;
  done?: RuntimeLogEvent;
}

const RECOVERABLE_STATUSES = new Set<RecoverableStatus>(["error", "interrupted", "denied"]);

export function recoverableTasksFromEvents(events: RuntimeLogEvent[], limit = 10): RecoverableTask[] {
  const records = new Map<string, TurnRecord>();

  for (const event of events) {
    if (!event || !event.type?.startsWith("turn:")) continue;
    const id = event.id;
    if (event.type === "turn:start" && id) {
      const record = records.get(id) ?? {};
      record.start = event;
      records.set(id, record);
      continue;
    }

    if (event.type === "turn:done") {
      const parentId = getString(event.payload?.parentId) || id;
      if (!parentId) continue;
      const record = records.get(parentId) ?? {};
      if (!record.done || eventTime(event) >= eventTime(record.done)) record.done = event;
      records.set(parentId, record);
    }
  }

  const tasks: RecoverableTask[] = [];
  for (const [id, record] of records) {
    const done = record.done;
    const start = record.start;
    const status = done?.status ?? (start ? "interrupted" : undefined);
    if (!isRecoverableStatus(status)) continue;

    const retryInput = getString(start?.payload?.retryInput) || getString(done?.payload?.retryInput);
    if (!retryInput.trim()) continue;

    const createdAt = numberOr(start?.createdAt, done?.createdAt, Date.now());
    const updatedAt = numberOr(done?.updatedAt, done?.createdAt, start?.updatedAt, createdAt);
    const durationMs = getFiniteNumber(done?.payload?.durationMs);
    tasks.push({
      id,
      sessionId: getString(start?.sessionId) || getString(done?.sessionId),
      turnId: getString(start?.turnId) || getString(done?.turnId),
      title: getString(start?.title) || getString(done?.title) || "Recoverable task",
      summary: getString(done?.summary) || getString(start?.summary) || retryInput.slice(0, 80),
      status,
      retryInput,
      createdAt,
      updatedAt,
      phase: status === "denied" ? "denied" : status === "error" ? "failed" : "interrupted",
      recoveryAction: status === "denied" ? "retry_with_approval" : "inspect_tool",
      canRetry: status === "denied",
      requiresApproval: status === "denied",
      reason: status === "denied"
        ? "legacy task was denied; retry must request a new human decision"
        : "legacy task has no durable tool-side-effect evidence; inspect it before retrying",
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  }

  return tasks
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, clampLimit(limit));
}

export function readRecoverableTasksFromLogs(logDir: string, limit = 10): RecoverableTask[] {
  try {
    if (!fs.existsSync(logDir)) return [];
    const files = fs
      .readdirSync(logDir)
      .filter((file) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
      .reverse()
      .slice(0, 14);

    const events: RuntimeLogEvent[] = [];
    for (const file of files.reverse()) {
      const fullPath = path.join(logDir, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      const text = fs.readFileSync(fullPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object") events.push(parsed);
        } catch {
          // Ignore partial writes or hand-edited log lines.
        }
      }
    }
    return recoverableTasksFromEvents(events, limit);
  } catch {
    return [];
  }
}

export function recoverableTasksFromProtocolEvents(events: RuntimeProtocolEvent[], limit = 10): RecoverableTask[] {
  return reduceTurnStates(events)
    .filter((state) => state.recoveryAction !== "none")
    .map((state): RecoverableTask => ({
      id: state.turnId,
      sessionId: state.sessionId,
      turnId: state.turnId,
      title: state.title || "Recoverable task",
      summary: state.reason,
      status: recoverableStatusForState(state.state),
      retryInput: state.retryInput,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      ...(state.durationMs === undefined ? {} : { durationMs: state.durationMs }),
      phase: state.state,
      recoveryAction: state.recoveryAction,
      canRetry: state.canRetry,
      requiresApproval: state.requiresApproval,
      reason: state.reason,
      ...(state.partialAssistantText ? { partialAssistantText: state.partialAssistantText } : {}),
      ...(state.partialOutputTruncated ? { partialOutputTruncated: true } : {}),
      ...(state.activeTool ? { pendingTool: state.activeTool } : {}),
      ...(state.pendingApproval ? { pendingApproval: state.pendingApproval } : {}),
    }))
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, clampLimit(limit));
}

export function readRecoverableTasksFromRuntimeStore(limit = 10): RecoverableTask[] {
  const safeLimit = clampLimit(limit);
  try {
    const tasks: RecoverableTask[] = [];
    for (const session of listRuntimeProtocolEventSessions().slice(0, 100)) {
      try {
        tasks.push(...recoverableTasksFromProtocolEvents(readRuntimeProtocolEvents(session.sessionId), safeLimit));
      } catch {
        // Ignore one unreadable protocol session; other sessions remain recoverable.
      }
    }
    return mergeRecoverableTasks(tasks, safeLimit);
  } catch {
    return [];
  }
}

export function readRecoverableTasks({ logDir, limit = 10 }: { logDir?: string; limit?: number } = {}): RecoverableTask[] {
  const safeLimit = clampLimit(limit);
  const tasks = [
    ...readRecoverableTasksFromRuntimeStore(safeLimit),
    ...(logDir ? readRecoverableTasksFromLogs(logDir, safeLimit) : []),
  ];
  return mergeRecoverableTasks(tasks, safeLimit);
}

export function mergeRecoverableTasks(tasks: RecoverableTask[], limit = 10): RecoverableTask[] {
  const byKey = new Map<string, RecoverableTask>();
  for (const task of tasks) {
    const key = `${task.sessionId || ""}:${task.turnId || task.id}:${task.retryInput}`;
    const previous = byKey.get(key);
    if (!previous || (task.updatedAt || task.createdAt) >= (previous.updatedAt || previous.createdAt)) byKey.set(key, task);
  }
  return [...byKey.values()]
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
    .slice(0, clampLimit(limit));
}

function isRecoverableStatus(status: string | undefined): status is RecoverableStatus {
  return !!status && RECOVERABLE_STATUSES.has(status as RecoverableStatus);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    const numberValue = getFiniteNumber(value);
    if (numberValue !== undefined) return numberValue;
  }
  return Date.now();
}

function eventTime(event: RuntimeLogEvent): number {
  return numberOr(event.updatedAt, event.createdAt, 0);
}

function recoverableStatusForState(state: TurnLifecycleState): RecoverableStatus {
  if (state === "failed") return "error";
  if (state === "denied") return "denied";
  return "interrupted";
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}
