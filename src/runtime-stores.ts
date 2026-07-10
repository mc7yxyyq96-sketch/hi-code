import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HICODE_DIR } from "./config.js";
import type { ChatMessage } from "./llm.js";
import {
  type RuntimeProtocolEvent,
  validateRuntimeProtocolEvent,
} from "./runtime-protocol.js";

export const RUNTIME_STORE_SCHEMA_VERSION = 1;
export const RUNTIME_STORE_DIR = path.join(HICODE_DIR, "runtime-store-v2");

export interface RuntimeStoreDiagnostic {
  code: "invalid_json" | "invalid_record" | "io_error";
  message: string;
  path: string;
  line?: number;
}

export interface RuntimeStoreReadResult<T> {
  records: T[];
  diagnostics: RuntimeStoreDiagnostic[];
}

export type RuntimeStoreWriteResult =
  | { ok: true; status: "appended" | "duplicate" | "updated"; path: string }
  | { ok: false; code: "id_conflict" | "sequence_conflict" | "invalid_record" | "io_error"; error: string };

export type RuntimeMessageSource = "session-snapshot" | "legacy-session" | "runtime-event";

export interface RuntimeMessageRecord {
  schemaVersion: typeof RUNTIME_STORE_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  sequence: number;
  role: ChatMessage["role"];
  message: ChatMessage;
  createdAt: number;
  source: RuntimeMessageSource;
  turnId?: string;
  sourceEventId?: string;
}

export interface RuntimeThreadRecord {
  schemaVersion: typeof RUNTIME_STORE_SCHEMA_VERSION;
  id: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  firstPrompt: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  messageIds: string[];
  contextComplete: boolean;
  lastEventSequence: number;
  state: "active" | "completed" | "interrupted" | "unknown";
  recoverableTurnIds: string[];
  migrationSources: Record<string, string>;
}

export interface RuntimeSessionSnapshot {
  id: string;
  cwd: string;
  model: string;
  systemMessage: ChatMessage;
  createdAt: number;
  updatedAt: number;
  firstPrompt: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  messages: ChatMessage[];
}

export interface ReconstructedRuntimeSession {
  id: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  firstPrompt: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  systemMessage: ChatMessage;
  messages: ChatMessage[];
  contextComplete: boolean;
  diagnostics: RuntimeStoreDiagnostic[];
}

export interface RuntimeStoreSyncResult {
  ok: boolean;
  thread?: RuntimeThreadRecord;
  appendedMessages: number;
  duplicateMessages: number;
  diagnostics: RuntimeStoreDiagnostic[];
  error?: string;
}

export interface RuntimeEventImportResult {
  ok: boolean;
  appendedEvents: number;
  duplicateEvents: number;
  appendedMessages: number;
  duplicateMessages: number;
  diagnostics: RuntimeStoreDiagnostic[];
  thread?: RuntimeThreadRecord;
  error?: string;
}

export interface RuntimeTranscript {
  thread?: RuntimeThreadRecord;
  messages: RuntimeMessageRecord[];
  events: RuntimeProtocolEvent[];
  diagnostics: RuntimeStoreDiagnostic[];
  recoverableTurnIds: string[];
}

export interface ThreadStore {
  get(sessionId: string): RuntimeThreadRecord | undefined;
  list(): RuntimeThreadRecord[];
  upsert(thread: RuntimeThreadRecord): RuntimeStoreWriteResult;
  delete(sessionId: string): boolean;
}

export interface EventStore {
  append(event: RuntimeProtocolEvent): RuntimeStoreWriteResult;
  list(sessionId: string): RuntimeStoreReadResult<RuntimeProtocolEvent>;
  listSessionIds(): string[];
  pathFor(sessionId: string): string;
  delete(sessionId: string): boolean;
}

export interface MessageStore {
  append(message: RuntimeMessageRecord): RuntimeStoreWriteResult;
  list(sessionId: string): RuntimeStoreReadResult<RuntimeMessageRecord>;
  pathFor(sessionId: string): string;
  delete(sessionId: string): boolean;
}

export class FileThreadStore implements ThreadStore {
  constructor(readonly root = RUNTIME_STORE_DIR) {}

  pathFor(sessionId: string): string {
    return path.join(sessionDirectory(this.root, sessionId), "thread.json");
  }

  get(sessionId: string): RuntimeThreadRecord | undefined {
    const file = this.pathFor(sessionId);
    if (!fs.existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return validateThreadRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  list(): RuntimeThreadRecord[] {
    if (!fs.existsSync(this.root)) return [];
    const threads: RuntimeThreadRecord[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const thread = this.get(entry.name);
        if (thread) threads.push(thread);
      } catch {
        // Invalid app-data entries are ignored; valid threads remain available.
      }
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  upsert(thread: RuntimeThreadRecord): RuntimeStoreWriteResult {
    if (!validateThreadRecord(thread)) return invalidWrite("invalid thread record");
    const file = this.pathFor(thread.id);
    try {
      const current = this.get(thread.id);
      const next: RuntimeThreadRecord = {
        ...thread,
        createdAt: current?.createdAt ?? thread.createdAt,
      };
      atomicWriteJson(file, next);
      return { ok: true, status: current ? "updated" : "appended", path: file };
    } catch (error) {
      return ioWrite(error);
    }
  }

  delete(sessionId: string): boolean {
    const file = this.pathFor(sessionId);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}

export class FileEventStore implements EventStore {
  constructor(readonly root = RUNTIME_STORE_DIR) {}

  pathFor(sessionId: string): string {
    return path.join(sessionDirectory(this.root, sessionId), "events.jsonl");
  }

  append(event: RuntimeProtocolEvent): RuntimeStoreWriteResult {
    const validation = validateRuntimeProtocolEvent(event);
    if (!validation.ok) return invalidWrite(validation.error);
    let read: RuntimeStoreReadResult<RuntimeProtocolEvent>;
    try {
      read = this.list(event.sessionId);
    } catch (error) {
      return ioWrite(error);
    }
    const sameId = read.records.find((record) => record.id === event.id);
    if (sameId) {
      return canonicalJson(sameId) === canonicalJson(event)
        ? { ok: true, status: "duplicate", path: this.pathFor(event.sessionId) }
        : conflictWrite("id_conflict", `event id '${event.id}' already exists with different content`);
    }
    const sameSequence = read.records.find((record) => record.sequence === event.sequence);
    if (sameSequence) {
      return canonicalJson(sameSequence) === canonicalJson(event)
        ? { ok: true, status: "duplicate", path: this.pathFor(event.sessionId) }
        : conflictWrite("sequence_conflict", `event sequence ${event.sequence} already belongs to '${sameSequence.id}'`);
    }
    try {
      const file = this.pathFor(event.sessionId);
      appendJsonLine(file, event);
      return { ok: true, status: "appended", path: file };
    } catch (error) {
      return ioWrite(error);
    }
  }

  list(sessionId: string): RuntimeStoreReadResult<RuntimeProtocolEvent> {
    const file = this.pathFor(sessionId);
    return readJsonLines(file, (value): value is RuntimeProtocolEvent => validateRuntimeProtocolEvent(value).ok);
  }

  listSessionIds(): string[] {
    if (!fs.existsSync(this.root)) return [];
    const sessionIds: string[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        if (fs.existsSync(this.pathFor(entry.name))) sessionIds.push(entry.name);
      } catch {
        // Ignore invalid directories in app data.
      }
    }
    return sessionIds;
  }

  delete(sessionId: string): boolean {
    return deleteFile(this.pathFor(sessionId));
  }
}

export class FileMessageStore implements MessageStore {
  constructor(readonly root = RUNTIME_STORE_DIR) {}

  pathFor(sessionId: string): string {
    return path.join(sessionDirectory(this.root, sessionId), "messages.jsonl");
  }

  append(message: RuntimeMessageRecord): RuntimeStoreWriteResult {
    if (!validateMessageRecord(message)) return invalidWrite("invalid message record");
    let read: RuntimeStoreReadResult<RuntimeMessageRecord>;
    try {
      read = this.list(message.sessionId);
    } catch (error) {
      return ioWrite(error);
    }
    const sameId = read.records.find((record) => record.id === message.id);
    if (sameId) {
      return canonicalJson(sameId) === canonicalJson(message)
        ? { ok: true, status: "duplicate", path: this.pathFor(message.sessionId) }
        : conflictWrite("id_conflict", `message id '${message.id}' already exists with different content`);
    }
    try {
      const file = this.pathFor(message.sessionId);
      appendJsonLine(file, message);
      return { ok: true, status: "appended", path: file };
    } catch (error) {
      return ioWrite(error);
    }
  }

  list(sessionId: string): RuntimeStoreReadResult<RuntimeMessageRecord> {
    const file = this.pathFor(sessionId);
    const result = readJsonLines<RuntimeMessageRecord>(file, validateMessageRecord);
    result.records.sort((a, b) => a.sequence - b.sequence);
    return result;
  }

  delete(sessionId: string): boolean {
    return deleteFile(this.pathFor(sessionId));
  }
}

export class FileRuntimeStore {
  readonly threads: FileThreadStore;
  readonly events: FileEventStore;
  readonly messages: FileMessageStore;

  constructor(readonly root = RUNTIME_STORE_DIR) {
    this.threads = new FileThreadStore(root);
    this.events = new FileEventStore(root);
    this.messages = new FileMessageStore(root);
  }

  syncSession(snapshot: RuntimeSessionSnapshot, source: RuntimeMessageSource = "session-snapshot"): RuntimeStoreSyncResult {
    const validation = validateSessionSnapshot(snapshot);
    if (validation) return { ok: false, appendedMessages: 0, duplicateMessages: 0, diagnostics: [], error: validation };

    const existing = this.threads.get(snapshot.id);
    const sessionCreatedAt = existing?.createdAt ?? snapshot.createdAt;
    const orderedMessages = [snapshot.systemMessage, ...snapshot.messages];
    const records = orderedMessages.map((message, index) => messageRecordFromSnapshot(snapshot.id, message, index + 1, sessionCreatedAt + index + 1, source));
    let appendedMessages = 0;
    let duplicateMessages = 0;
    for (const record of records) {
      const result = this.messages.append(record);
      if (!result.ok) {
        return {
          ok: false,
          appendedMessages,
          duplicateMessages,
          diagnostics: this.messages.list(snapshot.id).diagnostics,
          error: result.error,
        };
      }
      if (result.status === "appended") appendedMessages++;
      else if (result.status === "duplicate") duplicateMessages++;
    }

    const migrationSources = {
      ...(existing?.migrationSources ?? {}),
      [source]: digestJson(snapshot),
    };
    const storedEvents = this.events.list(snapshot.id).records;
    const turnState = threadStateFromEvents(storedEvents);
    const thread: RuntimeThreadRecord = {
      schemaVersion: RUNTIME_STORE_SCHEMA_VERSION,
      id: snapshot.id,
      cwd: snapshot.cwd,
      model: snapshot.model,
      createdAt: existing?.createdAt ?? snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      firstPrompt: snapshot.firstPrompt,
      totalPromptTokens: snapshot.totalPromptTokens,
      totalCompletionTokens: snapshot.totalCompletionTokens,
      messageIds: records.map((record) => record.id),
      contextComplete: true,
      lastEventSequence: Math.max(existing?.lastEventSequence ?? 0, storedEvents.at(-1)?.sequence ?? 0),
      state: turnState.state,
      recoverableTurnIds: turnState.recoverableTurnIds,
      migrationSources,
    };
    const threadResult = this.threads.upsert(thread);
    if (!threadResult.ok) {
      return { ok: false, appendedMessages, duplicateMessages, diagnostics: [], error: threadResult.error };
    }
    return {
      ok: true,
      thread,
      appendedMessages,
      duplicateMessages,
      diagnostics: this.messages.list(snapshot.id).diagnostics,
    };
  }

  loadSession(sessionId: string): ReconstructedRuntimeSession | undefined {
    const thread = this.threads.get(sessionId);
    if (!thread) return undefined;
    const read = this.messages.list(sessionId);
    const byId = new Map(read.records.map((record) => [record.id, record]));
    const ordered = thread.messageIds.map((id) => byId.get(id)).filter((record): record is RuntimeMessageRecord => Boolean(record));
    const system = ordered.find((record) => record.role === "system");
    const contextComplete = thread.contextComplete && ordered.length === thread.messageIds.length && Boolean(system);
    return {
      id: thread.id,
      cwd: thread.cwd,
      model: thread.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      firstPrompt: thread.firstPrompt,
      totalPromptTokens: thread.totalPromptTokens,
      totalCompletionTokens: thread.totalCompletionTokens,
      systemMessage: cloneMessage(system?.message ?? { role: "system", content: "" }),
      messages: ordered.filter((record) => record.role !== "system").map((record) => cloneMessage(record.message)),
      contextComplete,
      diagnostics: read.diagnostics,
    };
  }

  importEvents(sessionId: string, events: RuntimeProtocolEvent[]): RuntimeEventImportResult {
    validateSessionId(sessionId);
    let appendedEvents = 0;
    let duplicateEvents = 0;
    let appendedMessages = 0;
    let duplicateMessages = 0;
    for (const event of events) {
      if (event.sessionId !== sessionId) {
        return { ok: false, appendedEvents, duplicateEvents, appendedMessages, duplicateMessages, diagnostics: [], error: "event session id does not match import target" };
      }
      const result = this.events.append(event);
      if (!result.ok) {
        return { ok: false, appendedEvents, duplicateEvents, appendedMessages, duplicateMessages, diagnostics: this.events.list(sessionId).diagnostics, error: result.error };
      }
      if (result.status === "appended") appendedEvents++;
      else if (result.status === "duplicate") duplicateEvents++;
    }

    const eventRead = this.events.list(sessionId);
    if (!eventRead.records.length && !this.threads.get(sessionId)) {
      return { ok: true, appendedEvents, duplicateEvents, appendedMessages, duplicateMessages, diagnostics: eventRead.diagnostics };
    }
    const messageEvents = eventRead.records.filter((event) => event.kind === "message.appended");
    const messageIds: string[] = [];
    for (const event of messageEvents) {
      const record = messageRecordFromEvent(event);
      if (!record) continue;
      const result = this.messages.append(record);
      if (!result.ok) {
        return {
          ok: false,
          appendedEvents,
          duplicateEvents,
          appendedMessages,
          duplicateMessages,
          diagnostics: [...eventRead.diagnostics, ...this.messages.list(sessionId).diagnostics],
          error: result.error,
        };
      }
      messageIds.push(record.id);
      if (result.status === "appended") appendedMessages++;
      else if (result.status === "duplicate") duplicateMessages++;
    }

    const existing = this.threads.get(sessionId);
    const messageRead = this.messages.list(sessionId);
    const byId = new Map(messageRead.records.map((record) => [record.id, record]));
    const eventMessages = messageIds.map((id) => byId.get(id)).filter((record): record is RuntimeMessageRecord => Boolean(record));
    const eventContextComplete = completeMessageChain(eventMessages);
    const latestMessageSequence = messageEvents.at(-1)?.sequence ?? 0;
    const eventContextAdvanced = latestMessageSequence > (existing?.lastEventSequence ?? 0);
    const useEventContext = eventContextComplete && (!existing?.contextComplete || eventContextAdvanced);
    const preserveCompleteSnapshot = existing?.contextComplete === true && existing.messageIds.length > 0 && !useEventContext;
    const activeMessageIds = useEventContext ? messageIds : preserveCompleteSnapshot ? existing.messageIds : messageIds;
    const first = eventRead.records[0];
    const latest = eventRead.records.at(-1) ?? first;
    const runtimeContext = runtimeContextFromEvents(eventRead.records);
    const firstUser = eventMessages.find((record) => record.role === "user");
    const state = threadStateFromEvents(eventRead.records);
    const thread: RuntimeThreadRecord = {
      schemaVersion: RUNTIME_STORE_SCHEMA_VERSION,
      id: sessionId,
      cwd: existing?.cwd || runtimeContext.cwd || process.cwd(),
      model: existing?.model || runtimeContext.model || "",
      createdAt: existing?.createdAt ?? first?.createdAt ?? Date.now(),
      updatedAt: Math.max(existing?.updatedAt ?? 0, Number(latest?.updatedAt ?? latest?.createdAt ?? Date.now())),
      firstPrompt: existing?.firstPrompt || oneLine(chatMessageText(firstUser?.message), 80) || first?.summary || first?.title || "Runtime session",
      totalPromptTokens: existing?.totalPromptTokens ?? 0,
      totalCompletionTokens: existing?.totalCompletionTokens ?? 0,
      messageIds: activeMessageIds,
      contextComplete: preserveCompleteSnapshot || useEventContext,
      lastEventSequence: latest?.sequence ?? existing?.lastEventSequence ?? 0,
      state: state.state,
      recoverableTurnIds: state.recoverableTurnIds,
      migrationSources: {
        ...(existing?.migrationSources ?? {}),
        "runtime-events": digestJson(eventRead.records),
      },
    };
    const threadResult = this.threads.upsert(thread);
    if (!threadResult.ok) {
      return { ok: false, appendedEvents, duplicateEvents, appendedMessages, duplicateMessages, diagnostics: eventRead.diagnostics, error: threadResult.error };
    }
    return {
      ok: true,
      appendedEvents,
      duplicateEvents,
      appendedMessages,
      duplicateMessages,
      diagnostics: [...eventRead.diagnostics, ...messageRead.diagnostics],
      thread,
    };
  }

  loadTranscript(sessionId: string): RuntimeTranscript {
    validateSessionId(sessionId);
    const eventRead = this.events.list(sessionId);
    const messageRead = this.messages.list(sessionId);
    const thread = this.threads.get(sessionId);
    const activeIds = new Set(thread?.messageIds ?? []);
    return {
      thread,
      messages: messageRead.records.filter((record) => activeIds.has(record.id)),
      events: eventRead.records,
      diagnostics: [...eventRead.diagnostics, ...messageRead.diagnostics],
      recoverableTurnIds: thread?.recoverableTurnIds ?? threadStateFromEvents(eventRead.records).recoverableTurnIds,
    };
  }

  deleteSession(sessionId: string): boolean {
    const directory = sessionDirectory(this.root, sessionId);
    if (!fs.existsSync(directory)) return false;
    fs.rmSync(directory, { recursive: true, force: false });
    return true;
  }
}

function messageRecordFromSnapshot(
  sessionId: string,
  message: ChatMessage,
  sequence: number,
  createdAt: number,
  source: RuntimeMessageSource,
): RuntimeMessageRecord {
  const cloned = cloneMessage(message);
  return {
    schemaVersion: RUNTIME_STORE_SCHEMA_VERSION,
    id: `rmsg-${digestJson({ sessionId, sequence, message: cloned }).slice(0, 24)}`,
    sessionId,
    sequence,
    role: cloned.role,
    message: cloned,
    createdAt,
    source,
  };
}

function messageRecordFromEvent(event: RuntimeProtocolEvent): RuntimeMessageRecord | null {
  const message = event.payload?.message;
  if (!isChatMessage(message)) return null;
  const cloned = cloneMessage(message);
  const declaredId = typeof event.payload?.messageId === "string" ? event.payload.messageId : "";
  return {
    schemaVersion: RUNTIME_STORE_SCHEMA_VERSION,
    id: `rmsg-${digestJson({ sessionId: event.sessionId, eventId: event.id, declaredId, message: cloned }).slice(0, 24)}`,
    sessionId: event.sessionId,
    sequence: event.sequence,
    role: cloned.role,
    message: cloned,
    createdAt: event.createdAt,
    source: "runtime-event",
    turnId: event.turnId,
    sourceEventId: event.id,
  };
}

function completeMessageChain(records: RuntimeMessageRecord[]): boolean {
  if (!records.length || records[0].role !== "system" || !records.some((record) => record.role === "user")) return false;
  const requestedToolCalls = new Set<string>();
  const completedToolCalls = new Set<string>();
  for (const record of records) {
    for (const call of record.message.tool_calls ?? []) requestedToolCalls.add(call.id);
    if (record.role === "tool" && record.message.tool_call_id) completedToolCalls.add(record.message.tool_call_id);
  }
  for (const callId of requestedToolCalls) {
    if (!completedToolCalls.has(callId)) return false;
  }
  for (const callId of completedToolCalls) {
    if (!requestedToolCalls.has(callId)) return false;
  }
  return true;
}

function runtimeContextFromEvents(events: RuntimeProtocolEvent[]): { cwd?: string; model?: string } {
  for (const event of events) {
    const context = event.payload?.runtimeContext;
    if (!context || typeof context !== "object" || Array.isArray(context)) continue;
    const value = context as Record<string, unknown>;
    const cwd = typeof value.cwd === "string" && path.isAbsolute(value.cwd) ? value.cwd : undefined;
    const model = typeof value.model === "string" ? value.model : undefined;
    if (cwd || model) return { cwd, model };
  }
  return {};
}

function threadStateFromEvents(events: RuntimeProtocolEvent[]): {
  state: RuntimeThreadRecord["state"];
  recoverableTurnIds: string[];
} {
  if (!events.length) return { state: "active", recoverableTurnIds: [] };
  const starts = new Map<string, RuntimeProtocolEvent>();
  const terminals = new Map<string, RuntimeProtocolEvent>();
  for (const event of events) {
    if (event.kind === "turn.started") starts.set(event.turnId, event);
    if (event.kind === "turn.completed" || event.kind === "turn.failed" || event.kind === "turn.denied" || event.kind === "turn.interrupted") {
      terminals.set(event.turnId, event);
    }
  }
  const recoverableTurnIds = [...starts.keys()].filter((turnId) => !terminals.has(turnId));
  if (recoverableTurnIds.length) return { state: "interrupted", recoverableTurnIds };
  const lastTerminal = [...terminals.values()].sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!lastTerminal) return { state: "unknown", recoverableTurnIds: [] };
  if (lastTerminal.status === "done") return { state: "completed", recoverableTurnIds: [] };
  return { state: "interrupted", recoverableTurnIds: [lastTerminal.turnId] };
}

function chatMessageText(message: ChatMessage | undefined): string {
  if (!message || message.content === null) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => part.type === "text" ? part.text : "[image]").join(" ");
}

function oneLine(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function validateSessionSnapshot(snapshot: RuntimeSessionSnapshot): string | null {
  try {
    validateSessionId(snapshot.id);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid session id";
  }
  if (!path.isAbsolute(snapshot.cwd)) return "session cwd must be absolute";
  if (typeof snapshot.model !== "string") return "session model must be a string";
  if (!isChatMessage(snapshot.systemMessage) || snapshot.systemMessage.role !== "system") return "systemMessage must be a system chat message";
  if (!Array.isArray(snapshot.messages) || !snapshot.messages.every(isChatMessage)) return "session messages are invalid";
  for (const value of [snapshot.createdAt, snapshot.updatedAt, snapshot.totalPromptTokens, snapshot.totalCompletionTokens]) {
    if (!Number.isFinite(value) || value < 0) return "session numeric fields must be finite and non-negative";
  }
  return null;
}

function validateThreadRecord(value: unknown): value is RuntimeThreadRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RuntimeThreadRecord>;
  try {
    validateSessionId(record.id ?? "");
  } catch {
    return false;
  }
  return record.schemaVersion === RUNTIME_STORE_SCHEMA_VERSION &&
    typeof record.cwd === "string" && path.isAbsolute(record.cwd) &&
    typeof record.model === "string" &&
    Number.isFinite(record.createdAt) && Number.isFinite(record.updatedAt) &&
    typeof record.firstPrompt === "string" &&
    Number.isFinite(record.totalPromptTokens) && Number.isFinite(record.totalCompletionTokens) &&
    Array.isArray(record.messageIds) && record.messageIds.every((id) => typeof id === "string" && id.length > 0) &&
    typeof record.contextComplete === "boolean" &&
    Number.isInteger(record.lastEventSequence) && Number(record.lastEventSequence) >= 0 &&
    (record.state === "active" || record.state === "completed" || record.state === "interrupted" || record.state === "unknown") &&
    Array.isArray(record.recoverableTurnIds) && record.recoverableTurnIds.every((id) => typeof id === "string" && id.length > 0) &&
    Boolean(record.migrationSources) && typeof record.migrationSources === "object" && !Array.isArray(record.migrationSources);
}

function validateMessageRecord(value: unknown): value is RuntimeMessageRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RuntimeMessageRecord>;
  try {
    validateSessionId(record.sessionId ?? "");
  } catch {
    return false;
  }
  return record.schemaVersion === RUNTIME_STORE_SCHEMA_VERSION &&
    typeof record.id === "string" && record.id.length > 0 &&
    Number.isInteger(record.sequence) && Number(record.sequence) > 0 &&
    Number.isFinite(record.createdAt) &&
    (record.source === "session-snapshot" || record.source === "legacy-session" || record.source === "runtime-event") &&
    isChatMessage(record.message) && record.role === record.message.role;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  if (message.role !== "system" && message.role !== "user" && message.role !== "assistant" && message.role !== "tool") return false;
  if (message.content !== null && typeof message.content !== "string") {
    if (!Array.isArray(message.content) || !message.content.every(isContentPart)) return false;
  }
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls) || !message.tool_calls.every((call) =>
      Boolean(call) && call.type === "function" && typeof call.id === "string" &&
      typeof call.function?.name === "string" && typeof call.function?.arguments === "string")) return false;
  }
  if (message.tool_call_id !== undefined && typeof message.tool_call_id !== "string") return false;
  if (message.name !== undefined && typeof message.name !== "string") return false;
  return true;
}

function isContentPart(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (part.type === "text") return typeof part.text === "string";
  if (part.type !== "image_url" || !part.image_url || typeof part.image_url !== "object") return false;
  return typeof (part.image_url as Record<string, unknown>).url === "string";
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return JSON.parse(JSON.stringify(message)) as ChatMessage;
}

function sessionDirectory(root: string, sessionId: string): string {
  const safeId = validateSessionId(sessionId);
  const base = path.resolve(root);
  const directory = path.resolve(base, safeId);
  const relative = path.relative(base, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("runtime store path escapes root");
  return directory;
}

function validateSessionId(sessionId: string): string {
  const value = String(sessionId || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,140}$/.test(value)) throw new Error("invalid runtime store session id");
  return value;
}

function readJsonLines<T>(file: string, validate: (value: unknown) => value is T): RuntimeStoreReadResult<T> {
  if (!fs.existsSync(file)) return { records: [], diagnostics: [] };
  const records: T[] = [];
  const diagnostics: RuntimeStoreDiagnostic[] = [];
  let lines: string[];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch (error) {
    return { records, diagnostics: [{ code: "io_error", message: safeError(error), path: file }] };
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      diagnostics.push({ code: "invalid_json", message: "record is not valid JSON", path: file, line: index + 1 });
      continue;
    }
    if (!validate(parsed)) {
      diagnostics.push({ code: "invalid_record", message: "record failed schema validation", path: file, line: index + 1 });
      continue;
    }
    records.push(parsed);
  }
  return { records, diagnostics };
}

function appendJsonLine(file: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(file));
  const fd = fs.openSync(file, "a", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(value)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function atomicWriteJson(file: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(file));
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function deleteFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function digestJson(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function invalidWrite(error: string): RuntimeStoreWriteResult {
  return { ok: false, code: "invalid_record", error };
}

function conflictWrite(code: "id_conflict" | "sequence_conflict", error: string): RuntimeStoreWriteResult {
  return { ok: false, code, error };
}

function ioWrite(error: unknown): RuntimeStoreWriteResult {
  return { ok: false, code: "io_error", error: safeError(error) };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "runtime store I/O failed";
}
