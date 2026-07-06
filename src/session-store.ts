import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatMessage } from "./llm.js";
import { type Session, contentText } from "./context.js";
import { HICODE_DIR } from "./config.js";

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
}

export interface SessionMeta {
  id: string;
  cwd: string;
  model: string;
  updatedAt: number;
  firstPrompt: string;
  messageCount: number;
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
  } catch (e) {
    // Persistence is best-effort; never crash the session over it.
    if (process.env.VIBE_DEBUG) console.error(`[vibe] saveSession failed: ${(e as Error).message}`);
  }
}

export function loadSession(id: string): StoredSession | undefined {
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  return fs.existsSync(file) ? readRaw(file) : undefined;
}

export function deleteSession(id: string): boolean {
  try {
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** All sessions, newest first. Optionally only those for a given cwd. */
export function listSessions(cwd?: string): SessionMeta[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const metas: SessionMeta[] = [];
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = readRaw(path.join(SESSIONS_DIR, f));
      if (!s) continue;
      if (cwd && s.cwd !== cwd) continue;
      metas.push({
        id: s.id,
        cwd: s.cwd,
        model: s.model,
        updatedAt: s.updatedAt,
        firstPrompt: s.firstPrompt,
        messageCount: s.messages.length,
      });
    } catch {
      /* ignore corrupt files */
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Most recent session for this cwd (for --continue). */
export function latestSession(cwd: string): StoredSession | undefined {
  const meta = listSessions(cwd)[0];
  return meta ? loadSession(meta.id) : undefined;
}

function readRaw(file: string): StoredSession | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredSession;
  } catch {
    return undefined;
  }
}

function oneLine(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

export { SESSIONS_DIR };
