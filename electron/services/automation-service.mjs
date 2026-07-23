import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Persistent automations / schedules (clean-room Wave1).
 * Stores cron-like and interval jobs under ~/.hicode/automations.json.
 */

const INTERVAL_MS = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

export function createAutomationService({ storePath, now = () => Date.now() } = {}) {
  if (!storePath) throw new Error("createAutomationService requires storePath");

  function emptyStore() {
    return { version: 1, items: [] };
  }

  function readStore() {
    try {
      if (!fs.existsSync(storePath)) return emptyStore();
      const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return emptyStore();
      return { version: 1, items: raw.items.map(normalizeItem).filter(Boolean) };
    } catch {
      return emptyStore();
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
    const payload = { version: 1, items: store.items.map(normalizeItem).filter(Boolean) };
    fs.writeFileSync(storePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    try { fs.chmodSync(storePath, 0o600); } catch { /* ignore */ }
    return payload;
  }

  function normalizeItem(item) {
    if (!item || typeof item !== "object") return null;
    const id = String(item.id || "").trim();
    const title = String(item.title || "").trim();
    const prompt = String(item.prompt || "").trim();
    if (!id || !title || !prompt) return null;
    const schedule = normalizeSchedule(item.schedule);
    const enabled = item.enabled !== false;
    const createdAt = Number(item.createdAt) || now();
    const updatedAt = Number(item.updatedAt) || createdAt;
    const lastRunAt = item.lastRunAt == null ? null : Number(item.lastRunAt) || null;
    const runCount = Math.max(0, Number(item.runCount) || 0);
    const workspace = item.workspace ? String(item.workspace) : "";
    const nextRunAt = enabled ? computeNextRunAt({ schedule, lastRunAt, createdAt, now: now() }) : null;
    return {
      id,
      title,
      prompt,
      schedule,
      enabled,
      workspace,
      createdAt,
      updatedAt,
      lastRunAt,
      nextRunAt,
      runCount,
    };
  }

  function normalizeSchedule(schedule = {}) {
    const kind = String(schedule.kind || "interval");
    if (kind === "once") {
      const at = Number(schedule.at) || now() + 60_000;
      return { kind: "once", at };
    }
    if (kind === "cron") {
      const expression = String(schedule.expression || "0 9 * * *").trim() || "0 9 * * *";
      return { kind: "cron", expression };
    }
    const every = String(schedule.every || "1h");
    const everyMs = INTERVAL_MS[every] || Number(schedule.everyMs) || INTERVAL_MS["1h"];
    const key = Object.entries(INTERVAL_MS).find(([, ms]) => ms === everyMs)?.[0] || "1h";
    return { kind: "interval", every: key, everyMs: INTERVAL_MS[key] };
  }

  function computeNextRunAt({ schedule, lastRunAt, createdAt, now: ts }) {
    if (!schedule) return null;
    if (schedule.kind === "once") {
      if (lastRunAt) return null;
      // Keep the scheduled instant even if overdue so due() can pick it up.
      return Number(schedule.at) || ts;
    }
    if (schedule.kind === "interval") {
      const everyMs = schedule.everyMs || INTERVAL_MS["1h"];
      const base = lastRunAt || createdAt || ts;
      // Do not skip overdue slots: a past nextRunAt means the job is due.
      return base + everyMs;
    }
    if (schedule.kind === "cron") {
      if (lastRunAt && ts - lastRunAt < 60_000) return nextCronApprox(schedule.expression, ts);
      return nextCronApprox(schedule.expression, Math.max(0, ts - 60_000));
    }
    return null;
  }

  /** Lightweight 5-field cron: m h dom mon dow (UTC). Supports * and simple ints. */
  function nextCronApprox(expression, fromTs) {
    const parts = String(expression || "").trim().split(/\s+/);
    if (parts.length < 5) return fromTs + 60 * 60 * 1000;
    const [minPart, hourPart] = parts;
    const minute = minPart === "*" ? 0 : Math.min(59, Math.max(0, Number(minPart) || 0));
    const hour = hourPart === "*" ? null : Math.min(23, Math.max(0, Number(hourPart) || 0));
    const d = new Date(fromTs + 60_000);
    d.setUTCSeconds(0, 0);
    for (let i = 0; i < 48 * 60; i += 1) {
      const okMinute = minPart === "*" || d.getUTCMinutes() === minute;
      const okHour = hour == null || d.getUTCHours() === hour;
      if (okMinute && okHour) return d.getTime();
      d.setUTCMinutes(d.getUTCMinutes() + 1);
    }
    return fromTs + 24 * 60 * 60 * 1000;
  }

  function list() {
    const store = readStore();
    store.items = store.items.map((item) => normalizeItem(item)).filter(Boolean);
    writeStore(store);
    return { ok: true, items: store.items };
  }

  function get(id) {
    const item = readStore().items.find((entry) => entry.id === id);
    return item ? { ok: true, item: normalizeItem(item) } : { ok: false, error: "automation not found" };
  }

  function create(input = {}) {
    const title = String(input.title || "").trim();
    const prompt = String(input.prompt || "").trim();
    if (!title) return { ok: false, error: "title is required" };
    if (!prompt) return { ok: false, error: "prompt is required" };
    const store = readStore();
    const ts = now();
    const item = normalizeItem({
      id: `auto-${crypto.randomBytes(6).toString("hex")}`,
      title,
      prompt,
      schedule: input.schedule,
      enabled: input.enabled !== false,
      workspace: input.workspace || "",
      createdAt: ts,
      updatedAt: ts,
      lastRunAt: null,
      runCount: 0,
    });
    store.items.unshift(item);
    writeStore(store);
    return { ok: true, item };
  }

  function update(id, patch = {}) {
    const store = readStore();
    const idx = store.items.findIndex((entry) => entry.id === id);
    if (idx < 0) return { ok: false, error: "automation not found" };
    const prev = store.items[idx];
    const next = normalizeItem({
      ...prev,
      ...patch,
      id: prev.id,
      schedule: patch.schedule ? normalizeSchedule(patch.schedule) : prev.schedule,
      updatedAt: now(),
    });
    store.items[idx] = next;
    writeStore(store);
    return { ok: true, item: next };
  }

  function remove(id) {
    const store = readStore();
    const before = store.items.length;
    store.items = store.items.filter((entry) => entry.id !== id);
    if (store.items.length === before) return { ok: false, error: "automation not found" };
    writeStore(store);
    return { ok: true };
  }

  function setEnabled(id, enabled) {
    return update(id, { enabled: Boolean(enabled) });
  }

  function due(limit = 20) {
    const ts = now();
    const items = readStore().items
      .map((item) => normalizeItem(item))
      .filter((item) => item && item.enabled && item.nextRunAt != null && item.nextRunAt <= ts)
      .slice(0, Math.max(1, Number(limit) || 20));
    return { ok: true, items, at: ts };
  }

  function markRun(id, { at = now(), status = "queued" } = {}) {
    const store = readStore();
    const idx = store.items.findIndex((entry) => entry.id === id);
    if (idx < 0) return { ok: false, error: "automation not found" };
    const prev = store.items[idx];
    const next = normalizeItem({
      ...prev,
      lastRunAt: at,
      runCount: (Number(prev.runCount) || 0) + 1,
      updatedAt: at,
      enabled: prev.schedule?.kind === "once" ? false : prev.enabled,
    });
    store.items[idx] = next;
    writeStore(store);
    return { ok: true, item: next, status };
  }

  return {
    list,
    get,
    create,
    update,
    remove,
    setEnabled,
    due,
    markRun,
    INTERVAL_MS,
  };
}

export function registerAutomationIpc({ register, automation }) {
  if (!register || !automation) throw new Error("registerAutomationIpc requires register + automation");
  register("automation:list", async () => automation.list());
  register("automation:get", async (_event, id) => automation.get(String(id || "")));
  register("automation:create", async (_event, payload = {}) => automation.create(payload || {}));
  register("automation:update", async (_event, payload = {}) => {
    const id = String(payload?.id || "");
    if (!id) return { ok: false, error: "id is required" };
    const { id: _omit, ...patch } = payload;
    return automation.update(id, patch);
  });
  register("automation:remove", async (_event, id) => automation.remove(String(id || "")));
  register("automation:set-enabled", async (_event, payload = {}) =>
    automation.setEnabled(String(payload?.id || ""), payload?.enabled !== false));
  register("automation:due", async (_event, payload = {}) => automation.due(payload?.limit));
  register("automation:mark-run", async (_event, payload = {}) =>
    automation.markRun(String(payload?.id || ""), payload || {}));
}
