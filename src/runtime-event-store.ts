import fs from "node:fs";
import path from "node:path";
import { HICODE_DIR } from "./config.js";
import {
  type RuntimeProtocolEvent,
  isRuntimeProtocolEvent,
  validateRuntimeProtocolEvent,
} from "./runtime-protocol.js";
import { FileRuntimeStore } from "./runtime-stores.js";

export const RUNTIME_EVENT_STORE_DIR = path.join(HICODE_DIR, "runtime-events");

export interface RuntimeEventReplay {
  ok: true;
  sessionId: string;
  events: RuntimeProtocolEvent[];
  eventCount: number;
  firstSequence: number | null;
  lastSequence: number | null;
  path: string;
}

export interface RuntimeEventSessionMeta {
  sessionId: string;
  eventCount: number;
  updatedAt: number;
  path: string;
}

export function appendRuntimeProtocolEvent(event: RuntimeProtocolEvent): { ok: true; path: string } | { ok: false; error: string } {
  const validation = validateRuntimeProtocolEvent(event);
  if (!validation.ok) return { ok: false, error: validation.error };
  try {
    const file = runtimeProtocolEventPath(event.sessionId);
    const legacyEvents = readLegacyRuntimeProtocolEvents(event.sessionId);
    const store = new FileRuntimeStore();
    const legacyImport = store.importEvents(event.sessionId, legacyEvents);
    if (!legacyImport.ok) return { ok: false, error: legacyImport.error || "failed to import legacy runtime events" };
    const imported = store.importEvents(event.sessionId, [event]);
    if (!imported.ok) return { ok: false, error: imported.error || "failed to append typed runtime event" };

    const legacyMatch = legacyEvents.find((record) => record.id === event.id || record.sequence === event.sequence);
    if (legacyMatch) {
      if (JSON.stringify(legacyMatch) !== JSON.stringify(event)) return { ok: false, error: "legacy runtime event id or sequence conflict" };
      return { ok: true, path: file };
    }
    appendPrivateJsonLine(file, event);
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "failed to append runtime event" };
  }
}

export function readRuntimeProtocolEvents(sessionId: string): RuntimeProtocolEvent[] {
  const legacyEvents = readLegacyRuntimeProtocolEvents(sessionId);
  const store = new FileRuntimeStore();
  const imported = store.importEvents(sessionId, legacyEvents);
  if (!imported.ok) return legacyEvents;
  return store.events.list(sessionId).records;
}

export function replayRuntimeProtocolEvents(sessionId: string): RuntimeEventReplay {
  const events = readRuntimeProtocolEvents(sessionId);
  return {
    ok: true,
    sessionId,
    events,
    eventCount: events.length,
    firstSequence: events[0]?.sequence ?? null,
    lastSequence: events.at(-1)?.sequence ?? null,
    path: runtimeProtocolEventPath(sessionId),
  };
}

export function listRuntimeProtocolEventSessions(): RuntimeEventSessionMeta[] {
  const store = new FileRuntimeStore();
  const sessionIds = new Set(store.events.listSessionIds());
  if (fs.existsSync(RUNTIME_EVENT_STORE_DIR)) {
    for (const fileName of fs.readdirSync(RUNTIME_EVENT_STORE_DIR)) {
      if (fileName.endsWith(".jsonl")) sessionIds.add(fileName.slice(0, -".jsonl".length));
    }
  }
  const sessions: RuntimeEventSessionMeta[] = [];
  for (const sessionId of sessionIds) {
    try {
      const legacyFile = runtimeProtocolEventPath(sessionId);
      const typedFile = store.events.pathFor(sessionId);
      const file = fs.existsSync(legacyFile) ? legacyFile : typedFile;
      const stat = fs.statSync(file);
      const eventCount = readRuntimeProtocolEvents(sessionId).length;
      sessions.push({ sessionId, eventCount, updatedAt: stat.mtimeMs, path: file });
    } catch {
      /* ignore files with invalid names or unreadable metadata */
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteRuntimeProtocolEvents(sessionId: string): boolean {
  const file = runtimeProtocolEventPath(sessionId);
  let deleted = false;
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    deleted = true;
  }
  deleted = new FileRuntimeStore().events.delete(sessionId) || deleted;
  return deleted;
}

export function runtimeProtocolEventPath(sessionId: string): string {
  const safeSessionId = sanitizeSessionId(sessionId);
  const file = path.resolve(RUNTIME_EVENT_STORE_DIR, `${safeSessionId}.jsonl`);
  const base = path.resolve(RUNTIME_EVENT_STORE_DIR);
  const rel = path.relative(base, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("runtime event path escapes store directory");
  return file;
}

function sanitizeSessionId(sessionId: string): string {
  const value = String(sessionId || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,140}$/.test(value)) throw new Error("invalid runtime event session id");
  return value;
}

function readLegacyRuntimeProtocolEvents(sessionId: string): RuntimeProtocolEvent[] {
  const file = runtimeProtocolEventPath(sessionId);
  if (!fs.existsSync(file)) return [];
  const events: RuntimeProtocolEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRuntimeProtocolEvent(parsed)) events.push(parsed);
    } catch {
      // One corrupt or partial line does not hide neighboring durable events.
    }
  }
  return events.sort((a, b) => a.sequence - b.sequence);
}

function appendPrivateJsonLine(file: string, event: RuntimeProtocolEvent): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.dirname(file), 0o700); } catch {}
  const fd = fs.openSync(file, "a", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(event)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}
