export const PROVIDER_REGISTRY_SCHEMA_VERSION = 1;

export const PROVIDER_STATUSES = ["enabled", "disabled", "not_configured"] as const;
export const PROVIDER_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export type ProviderRunStatus = (typeof PROVIDER_RUN_STATUSES)[number];
export type ProviderCapability =
  | "workspace.read"
  | "workspace.write"
  | "runtime.queue"
  | "job.center"
  | "diff.artifacts"
  | "tool.calls"
  | "multi.agent"
  | "local.model"
  | "external.cli"
  | (string & {});

export type ProviderConfigValue =
  | string
  | number
  | boolean
  | null
  | ProviderConfigValue[]
  | { [key: string]: ProviderConfigValue };

export type ProviderConfig = Record<string, ProviderConfigValue>;

export interface ProviderConfigField {
  key: string;
  label?: string;
  type: "string" | "path" | "secret" | "boolean" | "number";
  required?: boolean;
  sensitive?: boolean;
  description?: string;
}

export interface ProviderError {
  code: string;
  message: string;
  retriable?: boolean;
  details?: Record<string, unknown>;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderArtifact {
  id?: string;
  type: string;
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  patch?: string;
  changedFiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt?: number;
  endedAt?: number;
  error?: ProviderError;
}

export interface ProviderRunRequest {
  providerId: string;
  prompt: string;
  cwd?: string;
  jobId?: string;
  actor?: string;
  messages?: ProviderMessage[];
  metadata?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ProviderRunResult {
  ok: boolean;
  providerId: string;
  runId: string;
  status: ProviderRunStatus;
  summary: string;
  jobId?: string;
  messages?: ProviderMessage[];
  artifacts?: ProviderArtifact[];
  toolCalls?: ProviderToolCall[];
  logs?: string[];
  changedFiles?: string[];
  startedAt?: number;
  endedAt?: number;
  error?: ProviderError;
}

export interface ProviderCancelRequest {
  providerId: string;
  runId?: string;
  jobId?: string;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderConfigValidation {
  ok: boolean;
  missing?: string[];
  warnings?: string[];
  error?: ProviderError;
}

export interface AgentProvider {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled?: boolean;
  capabilities: ProviderCapability[];
  config?: ProviderConfig;
  configSchema?: ProviderConfigField[];
  requiredConfig?: string[];
  metadata?: Record<string, unknown>;
  validateConfig?: (config: ProviderConfig) => ProviderConfigValidation;
  run?: (request: ProviderRunRequest) => Promise<ProviderRunResult> | ProviderRunResult;
  cancel?: (request: ProviderCancelRequest) => Promise<ProviderRunResult> | ProviderRunResult;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  version: string;
  status: ProviderStatus;
  enabled: boolean;
  configured: boolean;
  description?: string;
  capabilities: ProviderCapability[];
  configSchema: ProviderConfigField[];
  missingConfig: string[];
  metadata?: Record<string, unknown>;
}

export interface ProviderRegistryState {
  schemaVersion: typeof PROVIDER_REGISTRY_SCHEMA_VERSION;
  providers: Record<string, {
    enabled?: boolean;
    config?: ProviderConfig;
  }>;
}

export class AgentProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  registerProvider(provider: AgentProvider): ProviderDescriptor {
    const normalized = normalizeProvider(provider);
    if (this.providers.has(normalized.id)) throw new Error(`provider already registered: ${normalized.id}`);
    this.providers.set(normalized.id, normalized);
    return describeProvider(normalized);
  }

  getProvider(id: string): ProviderDescriptor | null {
    const provider = this.providers.get(requiredProviderId(id));
    return provider ? describeProvider(provider) : null;
  }

  getProviderImpl(id: string): AgentProvider | null {
    return this.providers.get(requiredProviderId(id)) || null;
  }

  listProviders(): ProviderDescriptor[] {
    return Array.from(this.providers.values())
      .map(describeProvider)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  enableProvider(id: string): ProviderDescriptor {
    const provider = this.requireProvider(id);
    provider.enabled = true;
    return describeProvider(provider);
  }

  disableProvider(id: string): ProviderDescriptor {
    const provider = this.requireProvider(id);
    provider.enabled = false;
    return describeProvider(provider);
  }

  configureProvider(id: string, config: ProviderConfig): ProviderDescriptor {
    const provider = this.requireProvider(id);
    const nextConfig = sanitizeProviderConfig(config);
    const validation = validateProviderConfigForProvider(provider, nextConfig);
    if (!validation.ok) throw providerErrorToException(validation.error || createProviderError("provider_config_invalid", "provider config is invalid"));
    provider.config = nextConfig;
    return describeProvider(provider);
  }

  validateProviderConfig(id: string, config?: ProviderConfig): ProviderConfigValidation {
    const provider = this.requireProvider(id);
    return validateProviderConfigForProvider(provider, config === undefined ? provider.config || {} : sanitizeProviderConfig(config));
  }

  async runProvider(id: string, request: Omit<ProviderRunRequest, "providerId">): Promise<ProviderRunResult> {
    const provider = this.requireRunnableProvider(id);
    if (typeof provider.run !== "function") {
      throw providerErrorToException(createProviderError("provider_run_unavailable", `${provider.id} does not provide a run adapter`));
    }
    return provider.run({ ...request, providerId: provider.id });
  }

  async cancelProvider(id: string, request: Omit<ProviderCancelRequest, "providerId">): Promise<ProviderRunResult> {
    const provider = this.requireProvider(id);
    if (provider.enabled === false) {
      throw providerErrorToException(createProviderError("provider_disabled", `${provider.id} is disabled`));
    }
    if (typeof provider.cancel !== "function") {
      throw providerErrorToException(createProviderError("provider_cancel_not_supported", `${provider.id} does not support cancel`));
    }
    return provider.cancel({ ...request, providerId: provider.id });
  }

  applyState(state: Partial<ProviderRegistryState>): void {
    const providers = state?.providers && typeof state.providers === "object" ? state.providers : {};
    for (const [id, providerState] of Object.entries(providers)) {
      const provider = this.providers.get(id);
      if (!provider || !providerState || typeof providerState !== "object") continue;
      if (providerState.config && typeof providerState.config === "object") {
        provider.config = sanitizeProviderConfig(providerState.config);
      }
      if (typeof providerState.enabled === "boolean") provider.enabled = providerState.enabled;
    }
  }

  exportState(): ProviderRegistryState {
    const providers: ProviderRegistryState["providers"] = {};
    for (const provider of this.providers.values()) {
      providers[provider.id] = {
        enabled: provider.enabled !== false,
        config: sanitizeProviderConfig(provider.config || {}),
      };
    }
    return { schemaVersion: PROVIDER_REGISTRY_SCHEMA_VERSION, providers };
  }

  private requireProvider(id: string): AgentProvider {
    const provider = this.providers.get(requiredProviderId(id));
    if (!provider) throw providerErrorToException(createProviderError("provider_not_found", `provider not found: ${id}`));
    return provider;
  }

  private requireRunnableProvider(id: string): AgentProvider {
    const provider = this.requireProvider(id);
    if (provider.enabled === false) {
      throw providerErrorToException(createProviderError("provider_disabled", `${provider.id} is disabled`));
    }
    const validation = validateProviderConfigForProvider(provider, provider.config || {});
    if (!validation.ok) {
      throw providerErrorToException(validation.error || createProviderError("provider_config_invalid", `${provider.id} config is invalid`));
    }
    return provider;
  }
}

export function createPlaceholderProvider(input: {
  id: string;
  name: string;
  version?: string;
  description?: string;
  capabilities?: ProviderCapability[];
  requiredConfig?: string[];
  configSchema?: ProviderConfigField[];
  metadata?: Record<string, unknown>;
}): AgentProvider {
  return {
    id: input.id,
    name: input.name,
    version: input.version || "0.1.0",
    description: input.description,
    enabled: true,
    capabilities: input.capabilities || ["external.cli"],
    requiredConfig: input.requiredConfig || [],
    configSchema: input.configSchema || [],
    metadata: { ...(input.metadata || {}), implementation: "reserved", runnable: false },
  };
}

export function createProviderError(code: string, message: string, details?: Record<string, unknown>): ProviderError {
  return { code, message, details };
}

function normalizeProvider(provider: AgentProvider): AgentProvider {
  const id = requiredProviderId(provider.id);
  const name = requiredString(provider.name, "provider name");
  const version = requiredString(provider.version || "0.1.0", "provider version");
  return {
    ...provider,
    id,
    name,
    version,
    enabled: provider.enabled !== false,
    capabilities: Array.isArray(provider.capabilities) ? [...provider.capabilities] : [],
    config: sanitizeProviderConfig(provider.config || {}),
    configSchema: normalizeConfigSchema(provider.configSchema || []),
    requiredConfig: uniqueStrings(provider.requiredConfig || []),
    metadata: sanitizeMetadata(provider.metadata),
  };
}

function describeProvider(provider: AgentProvider): ProviderDescriptor {
  const validation = validateProviderConfigForProvider(provider, provider.config || {});
  const enabled = provider.enabled !== false;
  const runnable = typeof provider.run === "function";
  return {
    id: provider.id,
    name: provider.name,
    version: provider.version,
    description: provider.description,
    status: !enabled ? "disabled" : validation.ok && runnable ? "enabled" : "not_configured",
    enabled,
    configured: validation.ok,
    capabilities: [...provider.capabilities],
    configSchema: normalizeConfigSchema(provider.configSchema || []),
    missingConfig: validation.missing || [],
    metadata: sanitizeMetadata(provider.metadata),
  };
}

function validateProviderConfigForProvider(provider: AgentProvider, config: ProviderConfig): ProviderConfigValidation {
  const required = uniqueStrings([
    ...(provider.requiredConfig || []),
    ...normalizeConfigSchema(provider.configSchema || []).filter((field) => field.required).map((field) => field.key),
  ]);
  const missing = required.filter((key) => isMissingConfigValue(config[key]));
  if (missing.length) {
    return {
      ok: false,
      missing,
      error: createProviderError("provider_config_missing", `missing provider config: ${missing.join(", ")}`, { missing }),
    };
  }
  if (provider.validateConfig) {
    const result = provider.validateConfig(config);
    return result?.ok ? { ok: true, warnings: result.warnings || [] } : {
      ok: false,
      missing: result?.missing || [],
      warnings: result?.warnings || [],
      error: result?.error || createProviderError("provider_config_invalid", "provider config is invalid"),
    };
  }
  return { ok: true };
}

function requiredProviderId(value: string): string {
  const id = requiredString(value, "provider id");
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(id)) throw new Error(`invalid provider id: ${value}`);
  return id;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function isMissingConfigValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function sanitizeProviderConfig(value: unknown): ProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ProviderConfig = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || typeof key !== "string") continue;
    const clean = sanitizeProviderConfigValue(item);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function sanitizeProviderConfigValue(value: unknown): ProviderConfigValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value
      .map(sanitizeProviderConfigValue)
      .filter((item): item is ProviderConfigValue => item !== undefined);
    return items;
  }
  if (value && typeof value === "object") {
    const out: { [key: string]: ProviderConfigValue } = {};
    for (const [key, item] of Object.entries(value)) {
      const clean = sanitizeProviderConfigValue(item);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
}

function normalizeConfigSchema(schema: ProviderConfigField[]): ProviderConfigField[] {
  return schema
    .filter((field) => field && typeof field.key === "string" && field.key.trim())
    .map((field) => ({
      key: field.key.trim(),
      label: field.label,
      type: field.type || "string",
      required: !!field.required,
      sensitive: !!field.sensitive,
      description: field.description,
    }));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function providerErrorToException(error: ProviderError): Error {
  const err = new Error(error.message);
  Object.assign(err, { code: error.code, details: error.details });
  return err;
}
