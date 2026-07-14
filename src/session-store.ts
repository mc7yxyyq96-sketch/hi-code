import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatMessage } from "./llm.js";
import { type Session, contentText } from "./context.js";
import { HICODE_DIR } from "./config.js";
import {
  deleteRuntimeProtocolEvents,
  listRuntimeProtocolEventSessions,
  readRuntimeProtocolEvents,
} from "./runtime-event-store.js";
import type { RuntimeProtocolEvent } from "./runtime-protocol.js";
import { FileRuntimeStore } from "./runtime-stores.js";

const SESSIONS_DIR = path.join(HICODE_DIR, "sessions");

export interface StoredSession {
  id: string;
  cwd: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  firstPrompt: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  messages: ChatMessage[];
  source?: "session" | "runtime-store";
}

export interface SessionMeta {
  id: string;
  cwd: string;
  model: string;
  updatedAt: number;
  firstPrompt: string;
  messageCount: number;
  source?: "session" | "runtime-store" | "runtime-events";
  eventCount?: number;
  replayOnly?: boolean;
}

export interface SessionDisplayMessage {
  role: "user" | "assistant";
  text: string;
  replayOnly?: boolean;
}

export function newSessionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Persist a session. Skips empty sessions to avoid clutter. */
export function saveSession(id: string, cwd: string, model: string, session: Session): void {
  if (session.messages.length === 0) return;
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    const existing = fs.existsSync(file) ? readRaw(file) : undefined;
    const firstUser = session.messages.find((m) => m.role === "user");
    const data: StoredSession = {
      id,
      cwd,
      model,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      firstPrompt: existing?.firstPrompt || oneLine(contentText(firstUser?.content ?? ""), 80),
      totalPromptTokens: session.totalPromptTokens,
      totalCompletionTokens: session.totalCompletionTokens,
      messages: session.messages,
    };
    fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    const synced = new FileRuntimeStore().syncSession({
      ...data,
      systemMessage: session.system,
    });
    if (!synced.ok && process.env.VIBE_DEBUG) console.error(`[hicode] typed session sync failed: ${synced.error}`);
  } catch (e) {
    // Persistence is best-effort; never crash the session over it.
    if (process.env.VIBE_DEBUG) console.error(`[vibe] saveSession failed: ${(e as Error).message}`);
  }
}

export function loadSession(id: string): StoredSession | undefined {
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  const legacy = fs.existsSync(file) ? readRaw(file) : undefined;
  try {
    readRuntimeProtocolEvents(id);
    const runtimeStore = new FileRuntimeStore();
    const typed = runtimeStore.loadSession(id);
    if (typed?.contextComplete) {
      const activeRuntimeContext = runtimeStore.loadTranscript(id).messages.some((message) => message.source === "runtime-event");
      if (!legacy || activeRuntimeContext) {
        return {
          id: typed.id,
          cwd: typed.cwd,
          model: typed.model,
          createdAt: typed.createdAt,
          updatedAt: typed.updatedAt,
          firstPrompt: typed.firstPrompt,
          totalPromptTokens: typed.totalPromptTokens,
          totalCompletionTokens: typed.totalCompletionTokens,
          messages: typed.messages,
          source: "runtime-store",
        };
      }
    }
  } catch {
    // Fall through to the intact legacy source when typed replay is unavailable.
  }
  if (legacy) {
    importLegacySession(legacy);
    return legacy;
  }
  return undefined;
}

export function deleteSession(id: string): boolean {
  let deleted = false;
  try {
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      deleted = true;
    }
  } catch {
    /* ignore */
  }
  try {
    deleted = deleteRuntimeProtocolEvents(id) || deleted;
  } catch {
    /* ignore invalid or missing event-store ids */
  }
  try {
    deleted = new FileRuntimeStore().deleteSession(id) || deleted;
  } catch {
    /* ignore invalid or missing typed-store ids */
  }
  return deleted;
}

/** All sessions, newest first. Optionally only those for a given cwd. */
export function listSessions(cwd?: string): SessionMeta[] {
  const metas: SessionMeta[] = [];
  const representedIds = new Set<string>();
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = readRaw(path.join(SESSIONS_DIR, f));
        if (!s) continue;
        if (cwd && s.cwd !== cwd) continue;
        representedIds.add(s.id);
        importLegacySession(s);
        metas.push({
          id: s.id,
          cwd: s.cwd,
          model: s.model,
          updatedAt: s.updatedAt,
          firstPrompt: s.firstPrompt,
          messageCount: s.messages.length,
          source: "session",
        });
      } catch {
        /* ignore corrupt files */
      }
    }
  }

  const runtimeStore = new FileRuntimeStore();
  for (const thread of runtimeStore.threads.list()) {
    if (representedIds.has(thread.id)) continue;
    const stored = runtimeStore.loadSession(thread.id);
    if (!stored?.contextComplete) continue;
    if (cwd && stored.cwd !== cwd) continue;
    representedIds.add(stored.id);
    metas.push({
      id: stored.id,
      cwd: stored.cwd,
      model: stored.model,
      updatedAt: stored.updatedAt,
      firstPrompt: stored.firstPrompt,
      messageCount: stored.messages.length,
      source: "runtime-store",
      eventCount: runtimeStore.events.list(stored.id).records.length,
      replayOnly: false,
    });
  }

  for (const eventMeta of listRuntimeProtocolEventSessions()) {
    if (representedIds.has(eventMeta.sessionId)) continue;
    const events = readRuntimeProtocolEvents(eventMeta.sessionId);
    const meta = sessionMetaFromRuntimeEvents(eventMeta.sessionId, events, eventMeta.updatedAt);
    if (!meta) continue;
    if (cwd && meta.cwd !== cwd) continue;
    metas.push(meta);
  }

  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Most recent session for this cwd (for --continue). */
export function latestSession(cwd: string): StoredSession | undefined {
  const meta = listSessions(cwd).find((s) => !s.replayOnly);
  return meta ? loadSession(meta.id) : undefined;
}

export function replaySessionMessages(id: string): SessionDisplayMessage[] {
  const events = readRuntimeProtocolEvents(id);
  if (!events.length) return [];
  const messages: SessionDisplayMessage[] = [];
  messages.push({
    role: "assistant",
    text: "事件回放：这个会话没有完整的聊天上下文，只能展示运行时记录。若要继续，请基于回放重新发起任务。",
    replayOnly: true,
  });
  const starts = events.filter((event) => event.kind === "turn.started");
  for (const start of starts) {
    const input = stringFromPayload(start, "retryInput") || stringFromPayload(start, "input") || start.summary || start.title;
    if (input) messages.push({ role: "user", text: input, replayOnly: true });
    const turnEvents = events.filter((event) => event.turnId === start.turnId && event.sequence > start.sequence);
    const done = turnEvents.find((event) => event.kind.startsWith("turn.") && event.kind !== "turn.started");
    const tools = turnEvents
      .filter((event) => event.kind.startsWith("tool.") || event.kind.startsWith("diff."))
      .filter((event) => event.status !== "running")
      .map((event) => {
        const name = event.tool || event.legacyType;
        const status = event.status === "done" ? "完成" : statusLabel(event.status);
        return `${name}: ${status}${event.summary ? ` (${event.summary})` : ""}`;
      })
      .slice(0, 6);
    const lines = [
      `状态：${done ? statusLabel(done.status) : "运行记录未结束"}`,
      done?.summary ? `摘要：${done.summary}` : "",
      tools.length ? `工具：${tools.join("；")}` : "",
    ].filter(Boolean);
    if (lines.length) messages.push({ role: "assistant", text: lines.join("\n"), replayOnly: true });
  }
  if (messages.length === 1) {
    messages.push({
      role: "assistant",
      text: `共记录 ${events.length} 个运行时事件，但没有可回放的用户输入。`,
      replayOnly: true,
    });
  }
  return messages;
}

function readRaw(file: string): StoredSession | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredSession;
  } catch {
    return undefined;
  }
}

function importLegacySession(session: StoredSession): void {
  try {
    const runtimeStore = new FileRuntimeStore();
    if (runtimeStore.threads.get(session.id)?.contextComplete) return;
    const synced = runtimeStore.syncSession({
      id: session.id,
      cwd: session.cwd,
      model: session.model,
      systemMessage: { role: "system", content: "" },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      firstPrompt: session.firstPrompt,
      totalPromptTokens: session.totalPromptTokens,
      totalCompletionTokens: session.totalCompletionTokens,
      messages: session.messages,
    }, "legacy-session");
    if (!synced.ok && process.env.VIBE_DEBUG) console.error(`[hicode] legacy session import failed: ${synced.error}`);
  } catch (error) {
    if (process.env.VIBE_DEBUG) console.error(`[hicode] legacy session import failed: ${(error as Error).message}`);
  }
}

function oneLine(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

function sessionMetaFromRuntimeEvents(sessionId: string, events: RuntimeProtocolEvent[], fallbackUpdatedAt: number): SessionMeta | null {
  if (!events.length) return null;
  const start = events.find((event) => event.kind === "turn.started") ?? events[0];
  const latest = events.at(-1) ?? start;
  const context = runtimeContextFromEvent(start) ?? runtimeContextFromEvent(events.find((event) => runtimeContextFromEvent(event)));
  const cwd = context?.cwd;
  if (!cwd) return null;
  const firstPrompt =
    stringFromPayload(start, "retryInput") ||
    stringFromPayload(start, "input") ||
    start.summary ||
    start.title ||
    "事件回放";
  return {
    id: sessionId,
    cwd,
    model: context?.model || "",
    updatedAt: Number.isFinite(latest.updatedAt) ? Number(latest.updatedAt) : Number.isFinite(latest.createdAt) ? latest.createdAt : fallbackUpdatedAt,
    firstPrompt: oneLine(firstPrompt, 80),
    messageCount: Math.max(1, events.filter((event) => event.kind === "turn.started").length),
    source: "runtime-events",
    eventCount: events.length,
    replayOnly: true,
  };
}

function runtimeContextFromEvent(event: RuntimeProtocolEvent | undefined): { cwd?: string; model?: string } | null {
  const context = event?.payload?.runtimeContext;
  if (!context || typeof context !== "object") return null;
  const value = context as Record<string, unknown>;
  return {
    cwd: typeof value.cwd === "string" && value.cwd ? value.cwd : undefined,
    model: typeof value.model === "string" ? value.model : undefined,
  };
}

function stringFromPayload(event: RuntimeProtocolEvent, key: string): string {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : "";
}

function statusLabel(status: RuntimeProtocolEvent["status"]): string {
  if (status === "done") return "完成";
  if (status === "error") return "失败";
  if (status === "denied") return "已拒绝";
  if (status === "interrupted") return "已中断";
  if (status === "waiting") return "等待确认";
  return "运行中";
}

export { SESSIONS_DIR };
