import fs from "node:fs";
import path from "node:path";
import { HICODE_DIR } from "./config.js";
import { listSessions, loadSession } from "./session-store.js";

const USAGE_DIR = path.join(HICODE_DIR, "usage");
const USAGE_PATH = path.join(USAGE_DIR, "ledger.json");

export interface UsageRecordInput {
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
  reasoningLevel?: string;
  durationMs?: number;
}

interface DayBucket {
  promptTokens: number;
  completionTokens: number;
  turns: number;
  models: Record<string, number>;
  reasoning: Record<string, number>;
  longestTaskMs: number;
}

interface UsageLedger {
  version: 1;
  backfilled?: boolean;
  daily: Record<string, DayBucket>;
  updatedAt: string;
}

export interface UsageHeatmapCell {
  date: string;
  tokens: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface UsageStats {
  ok: true;
  lifetimeTokens: number;
  lifetimePromptTokens: number;
  lifetimeCompletionTokens: number;
  peakDayTokens: number;
  peakDay: string;
  longestTaskMs: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  totalTurns: number;
  heatmap: UsageHeatmapCell[];
  heatmapWeeks: number;
  reasoningBreakdown: Array<{ level: string; count: number; pct: number }>;
  topModels: Array<{ model: string; tokens: number }>;
  topTools: Array<{ tool: string; count: number }>;
  formatted: {
    lifetimeTokens: string;
    peakDayTokens: string;
    longestTask: string;
    currentStreak: string;
    longestStreak: string;
  };
}

function emptyDay(): DayBucket {
  return { promptTokens: 0, completionTokens: 0, turns: 0, models: {}, reasoning: {}, longestTaskMs: 0 };
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function loadLedger(): UsageLedger {
  try {
    if (fs.existsSync(USAGE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as UsageLedger;
      if (raw?.version === 1 && raw.daily && typeof raw.daily === "object") return raw;
    }
  } catch {
    /* ignore corrupt ledger */
  }
  return { version: 1, daily: {}, updatedAt: "" };
}

function saveLedger(ledger: UsageLedger): void {
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true, mode: 0o700 });
    ledger.updatedAt = new Date().toISOString();
    fs.writeFileSync(USAGE_PATH, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  } catch {
    /* usage tracking must never break the agent */
  }
}

function touchDay(ledger: UsageLedger, key: string): DayBucket {
  if (!ledger.daily[key]) ledger.daily[key] = emptyDay();
  return ledger.daily[key];
}

/** Record token usage and/or task duration for today. Safe to call from the agent loop. */
export function recordUsage(input: UsageRecordInput): void {
  const prompt = Math.max(0, Math.floor(input.promptTokens || 0));
  const completion = Math.max(0, Math.floor(input.completionTokens || 0));
  const durationMs = Math.max(0, Math.floor(input.durationMs || 0));
  if (prompt + completion === 0 && durationMs === 0) return;

  const ledger = loadLedger();
  const day = touchDay(ledger, dayKey());
  if (prompt + completion > 0) {
    day.promptTokens += prompt;
    day.completionTokens += completion;
    day.turns += 1;
    if (input.model) {
      const model = String(input.model).trim();
      if (model) day.models[model] = (day.models[model] || 0) + prompt + completion;
    }
    if (input.reasoningLevel) {
      const level = String(input.reasoningLevel).trim();
      if (level) day.reasoning[level] = (day.reasoning[level] || 0) + 1;
    }
  }
  if (durationMs > 0) day.longestTaskMs = Math.max(day.longestTaskMs, durationMs);
  saveLedger(ledger);
}

/** One-time import from saved sessions so existing installs see historical usage. */
export function ensureUsageBackfill(): void {
  const ledger = loadLedger();
  if (ledger.backfilled) return;
  for (const meta of listSessions()) {
    const stored = loadSession(meta.id);
    if (!stored) continue;
    const prompt = stored.totalPromptTokens || 0;
    const completion = stored.totalCompletionTokens || 0;
    if (prompt + completion <= 0) continue;
    const key = new Date(stored.updatedAt || meta.updatedAt || Date.now()).toISOString().slice(0, 10);
    const day = touchDay(ledger, key);
    day.promptTokens += prompt;
    day.completionTokens += completion;
    day.turns += Math.max(1, Math.floor((stored.messages?.length || 0) / 2));
    if (stored.model) day.models[stored.model] = (day.models[stored.model] || 0) + prompt + completion;
  }
  ledger.backfilled = true;
  saveLedger(ledger);
}

export function formatTokenCount(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n >= 1_000_000_000) return `${trimTrailingZero(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trimTrailingZero(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trimTrailingZero(n / 1_000)}K`;
  return String(n);
}

function trimTrailingZero(n: number): string {
  const text = n.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

function computeStreaks(daily: Record<string, DayBucket>): { current: number; longest: number } {
  const active = Object.entries(daily)
    .filter(([, bucket]) => bucket.promptTokens + bucket.completionTokens > 0 || bucket.turns > 0)
    .map(([date]) => date)
    .sort();
  if (!active.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < active.length; i++) {
    const prev = Date.parse(`${active[i - 1]}T00:00:00Z`);
    const cur = Date.parse(`${active[i]}T00:00:00Z`);
    if (cur - prev === 86_400_000) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }

  const activeSet = new Set(active);
  let current = 0;
  for (const cursor = new Date(); current < 4000; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    const key = cursor.toISOString().slice(0, 10);
    if (!activeSet.has(key)) break;
    current += 1;
  }
  return { current, longest };
}

function buildHeatmap(daily: Record<string, DayBucket>, days = 371): UsageHeatmapCell[] {
  const cells: UsageHeatmapCell[] = [];
  const values: number[] = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const pad = start.getUTCDay();
  for (let i = 0; i < pad; i++) {
    cells.push({ date: "", tokens: 0, level: 0 });
    values.push(0);
  }
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = dayKey(date);
    const tokens = (daily[key]?.promptTokens || 0) + (daily[key]?.completionTokens || 0);
    values.push(tokens);
    cells.push({ date: key, tokens, level: 0 });
  }
  const max = Math.max(...values.filter((value) => value > 0), 1);
  for (let i = 0; i < cells.length; i++) {
    const ratio = cells[i].tokens / max;
    cells[i].level = cells[i].tokens <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
  }
  return cells;
}

function aggregateModels(daily: Record<string, DayBucket>): Array<{ model: string; tokens: number }> {
  const totals = new Map<string, number>();
  for (const bucket of Object.values(daily)) {
    for (const [model, tokens] of Object.entries(bucket.models || {})) {
      totals.set(model, (totals.get(model) || 0) + tokens);
    }
  }
  return [...totals.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
}

function aggregateReasoning(daily: Record<string, DayBucket>): Array<{ level: string; count: number; pct: number }> {
  const totals = new Map<string, number>();
  let sum = 0;
  for (const bucket of Object.values(daily)) {
    for (const [level, count] of Object.entries(bucket.reasoning || {})) {
      totals.set(level, (totals.get(level) || 0) + count);
      sum += count;
    }
  }
  if (!sum) return [];
  return [...totals.entries()]
    .map(([level, count]) => ({ level, count, pct: Math.round((count / sum) * 100) }))
    .sort((a, b) => b.count - a.count);
}

/** Aggregate usage stats for the settings Profile / Usage page. */
export function getUsageStats(): UsageStats {
  ensureUsageBackfill();
  const ledger = loadLedger();
  const daily = ledger.daily;

  let lifetimePromptTokens = 0;
  let lifetimeCompletionTokens = 0;
  let totalTurns = 0;
  let peakDayTokens = 0;
  let peakDay = "";
  let longestTaskMs = 0;

  for (const [date, bucket] of Object.entries(daily)) {
    lifetimePromptTokens += bucket.promptTokens;
    lifetimeCompletionTokens += bucket.completionTokens;
    totalTurns += bucket.turns;
    const dayTokens = bucket.promptTokens + bucket.completionTokens;
    if (dayTokens > peakDayTokens) {
      peakDayTokens = dayTokens;
      peakDay = date;
    }
    longestTaskMs = Math.max(longestTaskMs, bucket.longestTaskMs || 0);
  }

  const lifetimeTokens = lifetimePromptTokens + lifetimeCompletionTokens;
  const streaks = computeStreaks(daily);
  const heatmap = buildHeatmap(daily);

  return {
    ok: true,
    lifetimeTokens,
    lifetimePromptTokens,
    lifetimeCompletionTokens,
    peakDayTokens,
    peakDay,
    longestTaskMs,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    totalSessions: listSessions().length,
    totalTurns,
    heatmap,
    heatmapWeeks: Math.ceil(heatmap.length / 7),
    reasoningBreakdown: aggregateReasoning(daily),
    topModels: aggregateModels(daily),
    topTools: [],
    formatted: {
      lifetimeTokens: formatTokenCount(lifetimeTokens),
      peakDayTokens: formatTokenCount(peakDayTokens),
      longestTask: longestTaskMs > 0 ? formatDuration(longestTaskMs) : "—",
      currentStreak: streaks.current ? `${streaks.current} 天` : "0 天",
      longestStreak: streaks.longest ? `${streaks.longest} 天` : "0 天",
    },
  };
}

export { USAGE_PATH, USAGE_DIR };
