import fs from "node:fs";
import path from "node:path";
import { HICODE_DIR } from "./config.js";
import {
  type RuntimeProtocolEvent,
  isRuntimeProtocolEvent,
  validateRuntimeProtocolEvent,
} from "./runtime-protocol.js";

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
    fs.mkdirSync(RUNTIME_EVENT_STORE_DIR, { recursive: true, mode: 0o700 });
    const file = runtimeProtocolEventPath(event.sessionId);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "failed to append runtime event" };
  }
}

export function readRuntimeProtocolEvents(sessionId: string): RuntimeProtocolEvent[] {
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
      /* corrupt lines are ignored so one bad write does not break replay */
    }
  }
  return events;
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
  if (!fs.existsSync(RUNTIME_EVENT_STORE_DIR)) return [];
  const sessions: RuntimeEventSessionMeta[] = [];
  for (const fileName of fs.readdirSync(RUNTIME_EVENT_STORE_DIR)) {
    if (!fileName.endsWith(".jsonl")) continue;
    const sessionId = fileName.slice(0, -".jsonl".length);
    try {
      const file = runtimeProtocolEventPath(sessionId);
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
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
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
