import fs from "node:fs";
import path from "node:path";

import { HICODE_DIR } from "./config.js";
import type { ProviderFailureCategory, ProviderKind } from "./provider-control-plane.js";

export const PROVIDER_USAGE_SCHEMA_VERSION = 1 as const;

export interface ProviderUsageRecordInput {
  providerId: string;
  providerKind: ProviderKind;
  model?: string;
  success: boolean;
  startedAt: number;
  endedAt?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  failureCategory?: ProviderFailureCategory;
}

export interface ProviderUsageSummary {
  providerId: string;
  providerKind: ProviderKind;
  runs: number;
  succeeded: number;
  failed: number;
  failureRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  estimatedCostUsd: number;
  models: Array<{ model: string; runs: number; tokens: number }>;
  failures: Partial<Record<ProviderFailureCategory, number>>;
  lastUsedAt?: number;
}

interface ProviderUsageBucket extends Omit<ProviderUsageSummary, "failureRate" | "averageLatencyMs" | "models"> {
  models: Record<string, { runs: number; tokens: number }>;
}

interface ProviderUsageLedger {
  schemaVersion: typeof PROVIDER_USAGE_SCHEMA_VERSION;
  providers: Record<string, ProviderUsageBucket>;
  updatedAt: number;
}

export interface ProviderUsageStoreOptions {
  storePath?: string;
  now?: () => number;
}

export class ProviderUsageStore {
  private readonly storePath: string;
  private readonly now: () => number;

  constructor(options: ProviderUsageStoreOptions = {}) {
    this.storePath = path.resolve(options.storePath || path.join(HICODE_DIR, "providers", "usage.json"));
    this.now = options.now || Date.now;
  }

  record(input: ProviderUsageRecordInput): ProviderUsageSummary {
    const normalized = normalizeRecord(input, this.now());
    const ledger = this.readLedger();
    const current = ledger.providers[normalized.providerId] || emptyBucket(normalized.providerId, normalized.providerKind);
    current.providerKind = normalized.providerKind;
    current.runs += 1;
    current.succeeded += normalized.success ? 1 : 0;
    current.failed += normalized.success ? 0 : 1;
    current.inputTokens += normalized.inputTokens;
    current.outputTokens += normalized.outputTokens;
    current.totalTokens += normalized.inputTokens + normalized.outputTokens;
    current.totalLatencyMs += Math.max(0, normalized.endedAt - normalized.startedAt);
    current.estimatedCostUsd = roundCost(current.estimatedCostUsd + normalized.estimatedCostUsd);
    current.lastUsedAt = normalized.endedAt;
    if (normalized.model) {
      const model = current.models[normalized.model] || { runs: 0, tokens: 0 };
      model.runs += 1;
      model.tokens += normalized.inputTokens + normalized.outputTokens;
      current.models[normalized.model] = model;
    }
    if (!normalized.success && normalized.failureCategory) {
      current.failures[normalized.failureCategory] = (current.failures[normalized.failureCategory] || 0) + 1;
    }
    ledger.providers[normalized.providerId] = current;
    ledger.updatedAt = this.now();
    this.writeLedger(ledger);
    return summarize(current);
  }

  list(): ProviderUsageSummary[] {
    return Object.values(this.readLedger().providers)
      .map(summarize)
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || a.providerId.localeCompare(b.providerId));
  }

  get(providerId: string): ProviderUsageSummary | null {
    const id = normalizeProviderId(providerId);
    const bucket = this.readLedger().providers[id];
    return bucket ? summarize(bucket) : null;
  }

  private readLedger(): ProviderUsageLedger {
    try {
      if (!fs.existsSync(this.storePath)) return emptyLedger();
      const parsed = JSON.parse(fs.readFileSync(this.storePath, "utf8")) as Partial<ProviderUsageLedger>;
      if (parsed.schemaVersion !== PROVIDER_USAGE_SCHEMA_VERSION || !parsed.providers || typeof parsed.providers !== "object") return emptyLedger();
      return {
        schemaVersion: PROVIDER_USAGE_SCHEMA_VERSION,
        providers: parsed.providers as Record<string, ProviderUsageBucket>,
        updatedAt: finiteNumber(parsed.updatedAt),
      };
    } catch {
      return emptyLedger();
    }
  }

  private writeLedger(ledger: ProviderUsageLedger): void {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = `${this.storePath}.${process.pid}.${this.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.storePath);
    try { fs.chmodSync(this.storePath, 0o600); } catch {}
  }
}

let defaultStore: ProviderUsageStore | null = null;

export function recordProviderUsage(input: ProviderUsageRecordInput): void {
  try {
    defaultStore ||= new ProviderUsageStore();
    defaultStore.record(input);
  } catch {
    // Telemetry is local-only and must never interrupt provider execution.
  }
}

function normalizeRecord(input: ProviderUsageRecordInput, now: number) {
  const startedAt = finiteNumber(input.startedAt) || now;
  const endedAt = finiteNumber(input.endedAt) || now;
  return {
    providerId: normalizeProviderId(input.providerId),
    providerKind: input.providerKind === "agent" ? "agent" as const : "model" as const,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim().slice(0, 200) : undefined,
    success: input.success === true,
    startedAt,
    endedAt: Math.max(startedAt, endedAt),
    inputTokens: integer(input.inputTokens),
    outputTokens: integer(input.outputTokens),
    estimatedCostUsd: roundCost(nonNegative(input.estimatedCostUsd)),
    failureCategory: input.failureCategory,
  };
}

function emptyLedger(): ProviderUsageLedger {
  return { schemaVersion: PROVIDER_USAGE_SCHEMA_VERSION, providers: {}, updatedAt: 0 };
}

function emptyBucket(providerId: string, providerKind: ProviderKind): ProviderUsageBucket {
  return {
    providerId,
    providerKind,
    runs: 0,
    succeeded: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalLatencyMs: 0,
    estimatedCostUsd: 0,
    models: {},
    failures: {},
  };
}

function summarize(bucket: ProviderUsageBucket): ProviderUsageSummary {
  const runs = integer(bucket.runs);
  const failed = integer(bucket.failed);
  return {
    providerId: bucket.providerId,
    providerKind: bucket.providerKind,
    runs,
    succeeded: integer(bucket.succeeded),
    failed,
    failureRate: runs ? Number((failed / runs).toFixed(4)) : 0,
    inputTokens: integer(bucket.inputTokens),
    outputTokens: integer(bucket.outputTokens),
    totalTokens: integer(bucket.totalTokens),
    totalLatencyMs: integer(bucket.totalLatencyMs),
    averageLatencyMs: runs ? Math.round(integer(bucket.totalLatencyMs) / runs) : 0,
    estimatedCostUsd: roundCost(nonNegative(bucket.estimatedCostUsd)),
    models: Object.entries(bucket.models || {})
      .map(([model, value]) => ({ model, runs: integer(value.runs), tokens: integer(value.tokens) }))
      .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model)),
    failures: { ...(bucket.failures || {}) },
    ...(finiteNumber(bucket.lastUsedAt) ? { lastUsedAt: finiteNumber(bucket.lastUsedAt) } : {}),
  };
}

function normalizeProviderId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(value.trim())) throw new Error("invalid provider id");
  return value.trim();
}

function integer(value: unknown): number {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

function nonNegative(value: unknown): number {
  return Math.max(0, finiteNumber(value));
}

function finiteNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundCost(value: number): number {
  return Number(Math.max(0, value).toFixed(8));
}
