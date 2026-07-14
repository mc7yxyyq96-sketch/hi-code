export const PROVIDER_CONTROL_SCHEMA_VERSION = 1 as const;

export type ProviderKind = "model" | "agent";
export type ProviderDeployment = "local" | "remote" | "enterprise";
export type ProviderPrivacyLevel = "local_only" | "remote_warning" | "enterprise_policy";
export type ProviderHealthStatus = "healthy" | "degraded" | "unavailable" | "not_configured" | "disabled" | "unknown";
export type ProviderCredentialState = "not_required" | "missing" | "stored" | "expired" | "expiring";
export type ProviderFailureCategory =
  | "timeout"
  | "quota_exceeded"
  | "authentication"
  | "network"
  | "unavailable"
  | "cancelled"
  | "validation"
  | "provider";

export interface ProviderCostMetadata {
  currency: "USD" | string;
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  fixedRunCost?: number;
  source: "configured" | "provider" | "unknown";
}

export interface ProviderCapabilityProfile {
  modelName?: string;
  contextLength?: number;
  vision: boolean | "unknown";
  tools: boolean | "unknown";
  streaming: boolean | "unknown";
  reasoning: boolean | "unknown";
  cost: ProviderCostMetadata;
  deployment: ProviderDeployment;
  privacyLevel: ProviderPrivacyLevel;
  capabilities: string[];
}

export interface ProviderCredentialStatus {
  state: ProviderCredentialState;
  secretRef?: string;
  expiresAt?: number;
  rotatedAt?: number;
  message?: string;
}

export interface ProviderHealthResult {
  status: ProviderHealthStatus;
  checkedAt: number;
  latencyMs?: number;
  version?: string;
  message?: string;
  failure?: ProviderFailure;
}

export interface ProviderFailure {
  code: string;
  category: ProviderFailureCategory;
  message: string;
  retriable: boolean;
  retryAfterMs?: number;
  status?: number;
}

export interface ProviderControlDescriptor {
  schemaVersion: typeof PROVIDER_CONTROL_SCHEMA_VERSION;
  id: string;
  kind: ProviderKind;
  adapterType: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  configured: boolean;
  health: ProviderHealthResult;
  capability: ProviderCapabilityProfile;
  credential: ProviderCredentialStatus;
  metadata?: Record<string, unknown>;
}

export interface ProviderControlRegistration {
  descriptor: Omit<ProviderControlDescriptor, "schemaVersion" | "health"> & { health?: ProviderHealthResult };
  healthCheck?: () => Promise<ProviderHealthResult> | ProviderHealthResult;
  setEnabled?: (enabled: boolean) => Promise<void> | void;
}

export interface ProviderDiscoveryFilter {
  kind?: ProviderKind;
  enabled?: boolean;
  health?: ProviderHealthStatus;
  capability?: string;
}

export interface ProviderExecutionPolicy {
  retries?: number;
  retryDelayMs?: number;
  fallbackProviderIds?: string[];
}

export interface ProviderExecutionAttempt<T> {
  providerId: string;
  attempt: number;
  ok: boolean;
  result?: T;
  failure?: ProviderFailure;
}

export interface ProviderExecutionOutcome<T> {
  ok: boolean;
  providerId?: string;
  result?: T;
  failure?: ProviderFailure;
  attempts: ProviderExecutionAttempt<T>[];
}

interface ProviderControlRecord {
  descriptor: ProviderControlDescriptor;
  healthCheck?: ProviderControlRegistration["healthCheck"];
  setEnabled?: ProviderControlRegistration["setEnabled"];
}

export class ProviderControlRegistry {
  private readonly records = new Map<string, ProviderControlRecord>();
  private revision = 0;

  register(registration: ProviderControlRegistration): ProviderControlDescriptor {
    const descriptor = normalizeDescriptor(registration.descriptor);
    if (this.records.has(descriptor.id)) throw new Error(`provider already registered: ${descriptor.id}`);
    this.records.set(descriptor.id, {
      descriptor,
      healthCheck: registration.healthCheck,
      setEnabled: registration.setEnabled,
    });
    this.revision += 1;
    return cloneDescriptor(descriptor);
  }

  upsert(registration: ProviderControlRegistration): ProviderControlDescriptor {
    const descriptor = normalizeDescriptor(registration.descriptor);
    const current = this.records.get(descriptor.id);
    this.records.set(descriptor.id, {
      descriptor: current ? { ...descriptor, health: normalizeHealth(registration.descriptor.health || current.descriptor.health) } : descriptor,
      healthCheck: registration.healthCheck || current?.healthCheck,
      setEnabled: registration.setEnabled || current?.setEnabled,
    });
    this.revision += 1;
    return cloneDescriptor(this.records.get(descriptor.id)!.descriptor);
  }

  remove(id: string): boolean {
    const removed = this.records.delete(providerId(id));
    if (removed) this.revision += 1;
    return removed;
  }

  get(id: string): ProviderControlDescriptor | null {
    const record = this.records.get(providerId(id));
    return record ? cloneDescriptor(record.descriptor) : null;
  }

  discover(filter: ProviderDiscoveryFilter = {}): ProviderControlDescriptor[] {
    return Array.from(this.records.values())
      .map(({ descriptor }) => descriptor)
      .filter((descriptor) => filter.kind === undefined || descriptor.kind === filter.kind)
      .filter((descriptor) => filter.enabled === undefined || descriptor.enabled === filter.enabled)
      .filter((descriptor) => filter.health === undefined || descriptor.health.status === filter.health)
      .filter((descriptor) => !filter.capability || descriptor.capability.capabilities.includes(filter.capability))
      .map(cloneDescriptor)
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }

  queryCapabilities(id: string): ProviderCapabilityProfile {
    const descriptor = this.requireRecord(id).descriptor;
    return cloneCapability(descriptor.capability);
  }

  async healthCheck(id: string): Promise<ProviderHealthResult> {
    const record = this.requireRecord(id);
    if (!record.descriptor.enabled) {
      record.descriptor.health = normalizeHealth({ status: "disabled", checkedAt: Date.now(), message: "Provider is disabled." });
      return { ...record.descriptor.health };
    }
    if (!record.descriptor.configured) {
      record.descriptor.health = normalizeHealth({ status: "not_configured", checkedAt: Date.now(), message: "Provider configuration is incomplete." });
      return { ...record.descriptor.health };
    }
    if (!record.healthCheck) {
      record.descriptor.health = normalizeHealth({ status: "unknown", checkedAt: Date.now(), message: "No active health probe is registered." });
      return { ...record.descriptor.health };
    }
    const startedAt = Date.now();
    try {
      const health = normalizeHealth(await record.healthCheck());
      record.descriptor.health = { ...health, latencyMs: health.latencyMs ?? Math.max(0, Date.now() - startedAt) };
    } catch (error) {
      const failure = normalizeProviderFailure(error);
      record.descriptor.health = {
        status: failure.category === "authentication" ? "degraded" : "unavailable",
        checkedAt: Date.now(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        message: failure.message,
        failure,
      };
    }
    this.revision += 1;
    return { ...record.descriptor.health };
  }

  async enable(id: string): Promise<ProviderControlDescriptor> {
    return this.setEnabled(id, true);
  }

  async disable(id: string): Promise<ProviderControlDescriptor> {
    return this.setEnabled(id, false);
  }

  version(): { schemaVersion: typeof PROVIDER_CONTROL_SCHEMA_VERSION; revision: number; providers: number } {
    return { schemaVersion: PROVIDER_CONTROL_SCHEMA_VERSION, revision: this.revision, providers: this.records.size };
  }

  private async setEnabled(id: string, enabled: boolean): Promise<ProviderControlDescriptor> {
    const record = this.requireRecord(id);
    await record.setEnabled?.(enabled);
    record.descriptor.enabled = enabled;
    record.descriptor.health = normalizeHealth({
      status: enabled ? (record.descriptor.configured ? "unknown" : "not_configured") : "disabled",
      checkedAt: Date.now(),
      message: enabled ? "Health check required." : "Provider is disabled.",
    });
    this.revision += 1;
    return cloneDescriptor(record.descriptor);
  }

  private requireRecord(id: string): ProviderControlRecord {
    const key = providerId(id);
    const record = this.records.get(key);
    if (!record) throw new Error(`provider not found: ${key}`);
    return record;
  }
}

export async function executeWithProviderPolicy<T>(input: {
  providerId: string;
  policy?: ProviderExecutionPolicy;
  run: (providerId: string, attempt: number) => Promise<T>;
  isSuccessful?: (result: T) => boolean;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ProviderExecutionOutcome<T>> {
  const policy = normalizeExecutionPolicy(input.policy);
  const providerIds = uniqueStrings([input.providerId, ...policy.fallbackProviderIds]);
  const attempts: ProviderExecutionAttempt<T>[] = [];
  const sleep = input.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastFailure: ProviderFailure | undefined;

  for (const id of providerIds) {
    for (let attempt = 1; attempt <= policy.retries + 1; attempt += 1) {
      try {
        const result = await input.run(id, attempt);
        const ok = input.isSuccessful ? input.isSuccessful(result) : true;
        if (ok) {
          attempts.push({ providerId: id, attempt, ok: true, result });
          return { ok: true, providerId: id, result, attempts };
        }
        lastFailure = normalizeProviderFailure({ code: "provider_run_failed", message: "Provider returned an unsuccessful result." });
      } catch (error) {
        lastFailure = normalizeProviderFailure(error);
      }
      attempts.push({ providerId: id, attempt, ok: false, failure: lastFailure });
      if (!lastFailure.retriable || attempt > policy.retries) break;
      await sleep(lastFailure.retryAfterMs ?? policy.retryDelayMs * attempt);
    }
  }
  return { ok: false, failure: lastFailure || normalizeProviderFailure("provider unavailable"), attempts };
}

export function normalizeProviderFailure(error: unknown): ProviderFailure {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = finiteNumber(source.status);
  const original = error instanceof Error ? error.message : String(source.message || error || "Provider operation failed.");
  const message = redactSensitiveText(original);
  const rawCode = typeof source.code === "string" ? source.code.trim().toLowerCase() : "";
  const lower = `${rawCode} ${original}`.toLowerCase();
  let category: ProviderFailureCategory = "provider";
  let code = rawCode || "provider_failure";
  let retriable = false;

  if (lower.includes("cancel") || lower.includes("abort")) {
    category = "cancelled";
    code = rawCode || "provider_cancelled";
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|authentication/.test(lower)) {
    category = "authentication";
    code = rawCode || "provider_authentication_failed";
  } else if (status === 429 || /quota|rate.?limit|too many requests/.test(lower)) {
    category = "quota_exceeded";
    code = rawCode || "provider_quota_exceeded";
    retriable = true;
  } else if (/timed?\s*out|timeout|etimedout/.test(lower)) {
    category = "timeout";
    code = rawCode || "provider_timeout";
    retriable = true;
  } else if (/econn|enotfound|network|fetch failed|socket|dns/.test(lower)) {
    category = "network";
    code = rawCode || "provider_network_failure";
    retriable = true;
  } else if (/not found|not configured|unavailable|enoent|executable/.test(lower)) {
    category = "unavailable";
    code = rawCode || "provider_unavailable";
    retriable = false;
  } else if (/invalid|required|must be|unsupported/.test(lower)) {
    category = "validation";
    code = rawCode || "provider_validation_failed";
  }

  return {
    code: safeCode(code),
    category,
    message,
    retriable,
    ...(status !== undefined ? { status } : {}),
    ...(finiteNumber(source.retryAfterMs) !== undefined ? { retryAfterMs: finiteNumber(source.retryAfterMs) } : {}),
  };
}

export function credentialStatus(input: Partial<ProviderCredentialStatus> = {}, now = Date.now()): ProviderCredentialStatus {
  const expiresAt = finiteNumber(input.expiresAt);
  const rotatedAt = finiteNumber(input.rotatedAt);
  let state = input.state || (input.secretRef ? "stored" : "not_required");
  if (expiresAt !== undefined) {
    if (expiresAt <= now) state = "expired";
    else if (expiresAt - now <= 7 * 24 * 60 * 60 * 1000) state = "expiring";
  }
  return {
    state,
    ...(input.secretRef ? { secretRef: validateSecretRef(input.secretRef) } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(rotatedAt !== undefined ? { rotatedAt } : {}),
    ...(input.message ? { message: redactSensitiveText(input.message) } : {}),
  };
}

function normalizeDescriptor(input: ProviderControlRegistration["descriptor"]): ProviderControlDescriptor {
  const enabled = input.enabled !== false;
  const configured = input.configured === true;
  return {
    schemaVersion: PROVIDER_CONTROL_SCHEMA_VERSION,
    id: providerId(input.id),
    kind: input.kind === "agent" ? "agent" : "model",
    adapterType: requiredText(input.adapterType, "adapterType"),
    name: requiredText(input.name, "name"),
    version: requiredText(input.version, "version"),
    ...(input.description ? { description: redactSensitiveText(input.description) } : {}),
    enabled,
    configured,
    health: normalizeHealth(input.health || {
      status: !enabled ? "disabled" : configured ? "unknown" : "not_configured",
      checkedAt: Date.now(),
    }),
    capability: normalizeCapability(input.capability),
    credential: credentialStatus(input.credential),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function normalizeCapability(input: ProviderCapabilityProfile): ProviderCapabilityProfile {
  if (!input || typeof input !== "object") throw new Error("provider capability profile is required");
  const deployment: ProviderDeployment = ["local", "remote", "enterprise"].includes(input.deployment) ? input.deployment : "remote";
  const expectedPrivacy: ProviderPrivacyLevel = deployment === "local" ? "local_only" : deployment === "enterprise" ? "enterprise_policy" : "remote_warning";
  if (input.privacyLevel !== expectedPrivacy) throw new Error(`privacy level ${input.privacyLevel} does not match ${deployment} deployment`);
  return {
    ...(input.modelName ? { modelName: requiredText(input.modelName, "modelName") } : {}),
    ...(finiteNumber(input.contextLength) !== undefined ? { contextLength: Math.max(1, Math.floor(finiteNumber(input.contextLength)!)) } : {}),
    vision: booleanOrUnknown(input.vision),
    tools: booleanOrUnknown(input.tools),
    streaming: booleanOrUnknown(input.streaming),
    reasoning: booleanOrUnknown(input.reasoning),
    cost: normalizeCost(input.cost),
    deployment,
    privacyLevel: expectedPrivacy,
    capabilities: uniqueStrings(input.capabilities || []),
  };
}

function normalizeCost(input: ProviderCostMetadata): ProviderCostMetadata {
  const value = input && typeof input === "object" ? input : { currency: "USD", source: "unknown" as const };
  return {
    currency: requiredText(value.currency || "USD", "cost currency"),
    source: ["configured", "provider", "unknown"].includes(value.source) ? value.source : "unknown",
    ...(finiteNumber(value.inputPerMillionTokens) !== undefined ? { inputPerMillionTokens: Math.max(0, finiteNumber(value.inputPerMillionTokens)!) } : {}),
    ...(finiteNumber(value.outputPerMillionTokens) !== undefined ? { outputPerMillionTokens: Math.max(0, finiteNumber(value.outputPerMillionTokens)!) } : {}),
    ...(finiteNumber(value.fixedRunCost) !== undefined ? { fixedRunCost: Math.max(0, finiteNumber(value.fixedRunCost)!) } : {}),
  };
}

function normalizeHealth(input: Partial<ProviderHealthResult>): ProviderHealthResult {
  const status = ["healthy", "degraded", "unavailable", "not_configured", "disabled", "unknown"].includes(String(input.status))
    ? input.status as ProviderHealthStatus
    : "unknown";
  return {
    status,
    checkedAt: finiteNumber(input.checkedAt) ?? Date.now(),
    ...(finiteNumber(input.latencyMs) !== undefined ? { latencyMs: Math.max(0, finiteNumber(input.latencyMs)!) } : {}),
    ...(input.version ? { version: redactSensitiveText(input.version).slice(0, 200) } : {}),
    ...(input.message ? { message: redactSensitiveText(input.message).slice(0, 500) } : {}),
    ...(input.failure ? { failure: normalizeProviderFailure(input.failure) } : {}),
  };
}

function cloneDescriptor(input: ProviderControlDescriptor): ProviderControlDescriptor {
  return JSON.parse(JSON.stringify(input)) as ProviderControlDescriptor;
}

function cloneCapability(input: ProviderCapabilityProfile): ProviderCapabilityProfile {
  return JSON.parse(JSON.stringify(input)) as ProviderCapabilityProfile;
}

function normalizeExecutionPolicy(input: ProviderExecutionPolicy = {}): Required<ProviderExecutionPolicy> {
  return {
    retries: Math.min(3, Math.max(0, Math.floor(finiteNumber(input.retries) ?? 0))),
    retryDelayMs: Math.min(30_000, Math.max(0, Math.floor(finiteNumber(input.retryDelayMs) ?? 500))),
    fallbackProviderIds: uniqueStrings(input.fallbackProviderIds || []).map(providerId),
  };
}

function providerId(value: unknown): string {
  const id = requiredText(value, "provider id");
  if (!/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)) throw new Error(`invalid provider id: ${redactSensitiveText(id)}`);
  return id;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function booleanOrUnknown(value: unknown): boolean | "unknown" {
  return typeof value === "boolean" ? value : "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function validateSecretRef(value: string): string {
  const ref = requiredText(value, "secretRef");
  if (!/^[a-z][a-z0-9._:/-]{3,240}$/i.test(ref)) throw new Error("invalid secret reference");
  return ref;
}

function safeCode(value: string): string {
  const normalized = String(value || "provider_failure").toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 100);
  return normalized || "provider_failure";
}

function redactSensitiveText(value: unknown): string {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)-[a-z0-9._-]{6,}\b/gi, "[REDACTED]")
    .replace(/((?:invalid\s+)?api[_ -]?key(?:\s+(?:is|value))?\s*(?:[=:]\s*|\s+))[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function sanitizeMetadata(value: Record<string, unknown>, seen = new WeakSet<object>()): Record<string, unknown> {
  if (seen.has(value)) return { circular: "[REDACTED]" };
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api[_-]?key|credential|authorization|cookie/i.test(key)) {
      output[key] = "[REDACTED]";
    } else if (typeof item === "string") {
      output[key] = redactSensitiveText(item).slice(0, 2_000);
    } else if (Array.isArray(item)) {
      output[key] = item.slice(0, 100).map((entry) => typeof entry === "string" ? redactSensitiveText(entry) : entry);
    } else if (item && typeof item === "object") {
      output[key] = sanitizeMetadata(item as Record<string, unknown>, seen);
    } else if (["number", "boolean"].includes(typeof item) || item === null) {
      output[key] = item;
    }
  }
  return output;
}
