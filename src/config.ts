import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findPlaintextConfigSecrets,
  isCredentialPlaceholder,
  isSensitiveEnvName,
  isSecretReferenceRecord,
  mcpAuthSecretRef,
  mcpSecretEnvName,
  profileApiKeyEnvName,
  validateSecretRef,
} from "./secret-references.js";
import type { McpAuthConfig, McpOAuthConfig } from "./mcp-auth.js";

/** One model endpoint + its parameters. The unit the LLM client speaks. */
export const MODEL_TRANSPORT_PROTOCOLS = ["chat_completions", "responses", "anthropic_messages", "ollama_chat"] as const;
export type ModelTransportProtocol = (typeof MODEL_TRANSPORT_PROTOCOLS)[number];

export interface ModelProfile {
  name: string;
  baseURL: string;
  /** Runtime-only resolved credential. Persisted profiles use secretRef. */
  apiKey: string;
  /** Opaque persisted credential reference; never contains the secret value. */
  secretRef?: string;
  model: string;
  contextWindow: number;
  temperature: number;
  /** Omitted in existing configs; omission deliberately preserves Chat Completions. */
  protocol?: ModelTransportProtocol;
}

export interface VibeConfig {
  /** Named model profiles, e.g. { reasoner, coder, default }. */
  profiles: Record<string, ModelProfile>;
  /** Profile key used by the lead agent and as fallback. */
  defaultProfile: string;
  /** role name → profile key (heterogeneous team / model fusion). */
  roleModels: Record<string, string>;
  /** profile keys that answer in /council. */
  councilMembers: string[];
  /** profile key that synthesizes the council's answers. */
  councilSynthesizer: string;
  /** Auto-compact when estimated tokens exceed this fraction of contextWindow. */
  compactThreshold: number;
  /** Codex-style reasoning preference selected from the composer. */
  reasoningLevel: "low" | "medium" | "high" | "ultra";
  /** Confine bash writes to the workspace via macOS sandbox-exec. */
  sandbox: boolean;
  /** MCP servers to connect to at startup. Existing entries default to stdio. */
  mcpServers: Record<string, McpServerConfig>;
}

interface McpServerCommonConfig {
  timeoutMs?: number;
  reconnect?: { maxAttempts?: number; baseDelayMs?: number };
}

export interface McpStdioServerConfig extends McpServerCommonConfig {
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig extends McpServerCommonConfig {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  auth?: McpAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface LoadConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  resolveSecret?: (secretRef: string) => string | undefined;
  onSecretResolutionError?: (details: { secretRef: string; location: string; error: string }) => void;
  /** Desktop disables this after attempting secure migration; CLI retains read compatibility. */
  allowLegacyPlaintext?: boolean;
}

/**
 * Data directory for config, sessions, history, etc. Prefers `~/.hicode`, but
 * keeps reading an existing `~/.vibe` (the project's former name) so users who
 * upgrade don't lose their config. Fresh installs use `~/.hicode`.
 */
export function resolveDataDir(): string {
  const home = os.homedir();
  const next = path.join(home, ".hicode");
  const legacy = path.join(home, ".vibe");
  if (fs.existsSync(next)) return next;
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

export const HICODE_DIR = resolveDataDir();
const CONFIG_DIR = HICODE_DIR;
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const BASE_PROFILE: ModelProfile = {
  name: "default",
  baseURL: "http://127.0.0.1:11434/v1",
  apiKey: "sk-no-key-required",
  model: "deepseek-chat",
  contextWindow: 65536,
  temperature: 0.2,
  protocol: "chat_completions",
};

/**
 * Resolve config from: built-in defaults < ~/.hicode/config.json < env vars.
 * Supports both the new multi-profile schema and the legacy flat schema
 * ({ baseURL, apiKey, model }), which is treated as the "default" profile.
 */
export function loadConfig(options: LoadConfigOptions = {}): VibeConfig {
  const configPath = options.configPath || CONFIG_PATH;
  let f: any = {};
  try {
    if (fs.existsSync(configPath)) f = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    console.error(`[hicode] failed to read ${configPath}: ${(e as Error).message}`);
  }

  const env = options.env || process.env;
  const profiles: Record<string, ModelProfile> = {};
  if (f.profiles && typeof f.profiles === "object") {
    for (const [k, v] of Object.entries<any>(f.profiles)) {
      const profile = {
        ...BASE_PROFILE,
        ...clean(withoutCredentialFields(v)),
        name: k,
        protocol: normalizeModelTransportProtocol(v?.protocol),
      };
      const secretRef = normalizeProfileSecretRef(v?.secretRef);
      profiles[k] = {
        ...profile,
        apiKey: resolveModelCredential({
          profileKey: k,
          persisted: v,
          profile,
          env,
          options,
        }),
        ...(secretRef ? { secretRef } : {}),
      };
    }
  }

  // Ensure the chosen default profile exists; synthesize it from legacy flat
  // fields (or the base) only when it's missing — don't inject a phantom one.
  const defaultKey = (f.defaultProfile as string) || "default";
  if (!profiles[defaultKey]) {
    const legacy = {
      baseURL: f.baseURL,
      apiKey: f.apiKey,
      secretRef: f.secretRef,
      model: f.model,
      contextWindow: f.contextWindow,
      temperature: f.temperature,
      protocol: f.protocol,
    };
    const profile = {
      ...BASE_PROFILE,
      ...clean(withoutCredentialFields(legacy)),
      name: defaultKey,
      protocol: normalizeModelTransportProtocol(f.protocol),
    };
    const secretRef = normalizeProfileSecretRef(f.secretRef);
    profiles[defaultKey] = {
      ...profile,
      apiKey: resolveModelCredential({
        profileKey: defaultKey,
        persisted: legacy,
        profile,
        env,
        options,
      }),
      ...(secretRef ? { secretRef } : {}),
    };
  }

  const defaultProfile = defaultKey;

  // Environment variables override the default profile.
  const def = profiles[defaultProfile];
  Object.assign(
    def,
    clean({
      baseURL: env.HICODE_BASE_URL ?? env.VIBE_BASE_URL ?? env.OPENAI_BASE_URL,
      apiKey: env.HICODE_API_KEY ?? env.VIBE_API_KEY ?? env.OPENAI_API_KEY,
      model: env.HICODE_MODEL ?? env.VIBE_MODEL,
      contextWindow: (env.HICODE_CONTEXT_WINDOW ?? env.VIBE_CONTEXT_WINDOW)
        ? Number(env.HICODE_CONTEXT_WINDOW ?? env.VIBE_CONTEXT_WINDOW)
        : undefined,
      protocol: env.HICODE_MODEL_PROTOCOL
        ? normalizeModelTransportProtocol(env.HICODE_MODEL_PROTOCOL)
        : undefined,
    }),
  );

  return {
    profiles,
    defaultProfile: profiles[defaultProfile] ? defaultProfile : "default",
    roleModels: (f.roleModels as Record<string, string>) ?? {},
    councilMembers:
      Array.isArray(f.councilMembers) && f.councilMembers.length
        ? f.councilMembers
        : Object.keys(profiles),
    councilSynthesizer: (f.councilSynthesizer as string) || defaultProfile,
    compactThreshold: typeof f.compactThreshold === "number" ? f.compactThreshold : 0.75,
    reasoningLevel: normalizeReasoningLevel(f.reasoningLevel),
    sandbox: f.sandbox === true,
    mcpServers: normalizeMcpServers(f.mcpServers, env, options),
  };
}

/** The profile a given key maps to, falling back to the default profile. */
export function getProfile(cfg: VibeConfig, key?: string): ModelProfile {
  return (key && cfg.profiles[key]) || cfg.profiles[cfg.defaultProfile] || cfg.profiles.default;
}

export function defaultProfile(cfg: VibeConfig): ModelProfile {
  return getProfile(cfg, cfg.defaultProfile);
}

/** The profile assigned to a role — the heart of model fusion by specialization. */
export function profileForRole(cfg: VibeConfig, role: string): ModelProfile {
  return getProfile(cfg, cfg.roleModels[role]);
}

function clean<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") (out as any)[k] = v;
  }
  return out;
}

function withoutCredentialFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { apiKey: _apiKey, secretRef: _secretRef, ...rest } = value as Record<string, unknown>;
  return rest;
}

function normalizeProfileSecretRef(value: unknown): string | undefined {
  return value === undefined ? undefined : validateSecretRef(value, "model");
}

function resolveModelCredential({
  profileKey,
  persisted,
  profile,
  env,
  options,
}: {
  profileKey: string;
  persisted: Record<string, unknown>;
  profile: Pick<ModelProfile, "baseURL" | "protocol">;
  env: NodeJS.ProcessEnv;
  options: LoadConfigOptions;
}): string {
  const profileEnv = env[profileApiKeyEnvName(profileKey)];
  if (profileEnv) return profileEnv;

  if (persisted.secretRef !== undefined) {
    const secretRef = validateSecretRef(persisted.secretRef, "model");
    const resolved = resolveReferencedSecret(secretRef, `profiles.${profileKey}.secretRef`, options);
    if (resolved) return resolved;
  }

  if (options.allowLegacyPlaintext !== false && typeof persisted.apiKey === "string" && !isCredentialPlaceholder(persisted.apiKey)) {
    return persisted.apiKey;
  }
  return profileNeedsNoCredential(profile) ? "sk-no-key-required" : "";
}

function normalizeMcpServers(value: unknown, env: NodeJS.ProcessEnv, options: LoadConfigOptions): Record<string, McpServerConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const servers: Record<string, McpServerConfig> = {};
  for (const [serverName, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const persisted = raw as Record<string, unknown>;
    const transport = persisted.transport === "streamable-http" ? "streamable-http" : "stdio";
    const common = normalizeMcpCommonConfig(persisted);
    if (transport === "streamable-http") {
      if (typeof persisted.url !== "string") continue;
      const url = normalizeMcpHttpUrl(persisted.url);
      const headers = normalizeMcpHeaders(persisted.headers);
      const auth = normalizeMcpAuth(serverName, persisted.auth, env, options);
      servers[serverName] = {
        transport,
        url,
        ...common,
        ...(headers ? { headers } : {}),
        ...(auth ? { auth } : {}),
      };
      continue;
    }
    if (typeof persisted.command !== "string" || !persisted.command.trim()) continue;
    const server: McpStdioServerConfig = {
      transport: "stdio",
      command: persisted.command,
      ...common,
      ...(Array.isArray(persisted.args) ? { args: persisted.args.filter((arg): arg is string => typeof arg === "string") } : {}),
    };
    if (persisted.env && typeof persisted.env === "object" && !Array.isArray(persisted.env)) {
      const resolvedEnv: Record<string, string> = {};
      for (const [envName, rawValue] of Object.entries(persisted.env as Record<string, unknown>)) {
        if (typeof rawValue === "string") {
          if (options.allowLegacyPlaintext === false && isSensitiveEnvName(envName) && !isCredentialPlaceholder(rawValue)) continue;
          resolvedEnv[envName] = rawValue;
          continue;
        }
        if (!isSecretReferenceRecord(rawValue)) continue;
        const secretRef = validateSecretRef(rawValue.secretRef, "mcp");
        const resolved = resolveReferencedSecret(secretRef, `mcpServers.${serverName}.env.${envName}`, options)
          || env[mcpSecretEnvName(serverName, envName)]
          || env[envName];
        if (resolved) resolvedEnv[envName] = resolved;
      }
      if (Object.keys(resolvedEnv).length) server.env = resolvedEnv;
    }
    servers[serverName] = server;
  }
  return servers;
}

function normalizeMcpCommonConfig(persisted: Record<string, unknown>): Pick<McpServerCommonConfig, "timeoutMs" | "reconnect"> {
  const timeout = Number(persisted.timeoutMs);
  const reconnect = persisted.reconnect && typeof persisted.reconnect === "object" && !Array.isArray(persisted.reconnect)
    ? persisted.reconnect as Record<string, unknown>
    : undefined;
  const maxAttempts = Number(reconnect?.maxAttempts);
  const baseDelayMs = Number(reconnect?.baseDelayMs);
  return {
    ...(Number.isFinite(timeout) ? { timeoutMs: Math.max(100, Math.min(10 * 60 * 1000, timeout)) } : {}),
    ...(reconnect ? { reconnect: {
      ...(Number.isFinite(maxAttempts) ? { maxAttempts: Math.max(0, Math.min(10, Math.floor(maxAttempts))) } : {}),
      ...(Number.isFinite(baseDelayMs) ? { baseDelayMs: Math.max(50, Math.min(5000, Math.floor(baseDelayMs))) } : {}),
    } } : {}),
  };
}

function normalizeMcpHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key) || /authorization|cookie|proxy-authorization/i.test(key)) {
      throw new Error(`MCP header ${key} is not allowed`);
    }
    if (typeof raw !== "string" || raw.length > 8192 || /[\0\r\n]/.test(raw)) throw new Error(`MCP header ${key} is invalid`);
    headers[key] = raw;
  }
  return Object.keys(headers).length ? headers : undefined;
}

function normalizeMcpAuth(serverName: string, value: unknown, env: NodeJS.ProcessEnv, options: LoadConfigOptions): McpAuthConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`MCP server ${serverName}.auth must be an object`);
  const raw = value as Record<string, unknown>;
  if (raw.type === "none") return { type: "none" };
  if (raw.type === "bearer") {
    const tokenRef = raw.tokenRef === undefined ? undefined : validateSecretRef(raw.tokenRef, "mcp");
    const token = resolveMcpAuthCredential(serverName, "token", raw.token, tokenRef, env, options);
    return { type: "bearer", ...(token ? { token } : {}), ...(tokenRef ? { tokenRef } : {}) };
  }
  if (raw.type !== "oauth") throw new Error(`MCP server ${serverName}.auth.type is invalid`);
  if (typeof raw.clientId !== "string" || !raw.clientId.trim() || raw.clientId.length > 512) throw new Error(`MCP server ${serverName}.auth.clientId is invalid`);
  const accessTokenRef = raw.accessTokenRef === undefined ? undefined : validateSecretRef(raw.accessTokenRef, "mcp");
  const refreshTokenRef = raw.refreshTokenRef === undefined ? undefined : validateSecretRef(raw.refreshTokenRef, "mcp");
  const accessToken = resolveMcpAuthCredential(serverName, "accessToken", raw.accessToken, accessTokenRef, env, options);
  const refreshToken = resolveMcpAuthCredential(serverName, "refreshToken", raw.refreshToken, refreshTokenRef, env, options);
  const oauth: McpOAuthConfig = {
    type: "oauth",
    clientId: raw.clientId,
    ...(Array.isArray(raw.scopes) ? { scopes: raw.scopes.filter((scope): scope is string => typeof scope === "string") } : {}),
    ...copyMcpAuthUrlFields(raw),
    ...(accessToken ? { accessToken } : {}),
    ...(accessTokenRef ? { accessTokenRef } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(refreshTokenRef ? { refreshTokenRef } : {}),
    ...(typeof raw.expiresAt === "string" ? { expiresAt: raw.expiresAt } : {}),
  };
  return oauth;
}

function resolveMcpAuthCredential(
  serverName: string,
  field: "token" | "accessToken" | "refreshToken",
  legacyValue: unknown,
  secretRef: string | undefined,
  env: NodeJS.ProcessEnv,
  options: LoadConfigOptions,
): string | undefined {
  if (secretRef) {
    const resolved = resolveReferencedSecret(secretRef, `mcpServers.${serverName}.auth.${field}Ref`, options)
      || env[mcpSecretEnvName(serverName, `AUTH_${field}`)];
    if (resolved) return resolved;
  }
  if (options.allowLegacyPlaintext !== false && typeof legacyValue === "string" && !isCredentialPlaceholder(legacyValue)) return legacyValue;
  return undefined;
}

function copyMcpAuthUrlFields(raw: Record<string, unknown>): Partial<McpOAuthConfig> {
  const output: Partial<McpOAuthConfig> = {};
  for (const key of ["resourceMetadataUrl", "authorizationServer", "authorizationEndpoint", "tokenEndpoint"] as const) {
    if (typeof raw[key] === "string" && raw[key]) output[key] = normalizeMcpHttpUrl(raw[key], { allowQuery: true });
  }
  return output;
}

function normalizeMcpHttpUrl(value: string, { allowQuery = false }: { allowQuery?: boolean } = {}): string {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("remote MCP URLs must use HTTPS");
  if (url.username || url.password || url.hash || (!allowQuery && url.search)) {
    throw new Error(`MCP URLs cannot contain credentials, fragments${allowQuery ? "" : ", or query parameters"}`);
  }
  return url.toString();
}

function resolveReferencedSecret(secretRef: string, location: string, options: LoadConfigOptions): string | undefined {
  if (!options.resolveSecret) return undefined;
  try {
    const value = options.resolveSecret(secretRef);
    return typeof value === "string" && value ? value : undefined;
  } catch (error) {
    options.onSecretResolutionError?.({
      secretRef,
      location,
      error: (error as Error).message,
    });
    return undefined;
  }
}

function profileNeedsNoCredential(profile: Pick<ModelProfile, "baseURL" | "protocol">): boolean {
  if (profile.protocol === "ollama_chat") return true;
  try {
    const url = new URL(profile.baseURL);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function normalizeReasoningLevel(value: unknown): VibeConfig["reasoningLevel"] {
  return value === "low" || value === "high" || value === "ultra" ? value : "medium";
}

export function normalizeModelTransportProtocol(value: unknown): ModelTransportProtocol {
  if (value === undefined || value === null || value === "") return "chat_completions";
  if (MODEL_TRANSPORT_PROTOCOLS.includes(value as ModelTransportProtocol)) return value as ModelTransportProtocol;
  const error = new Error(`unsupported model transport protocol: ${String(value).slice(0, 80)}`);
  Object.assign(error, {
    code: "provider_protocol_invalid",
    category: "validation",
    retriable: false,
  });
  throw error;
}

/** Persist the default profile's model (used by /model <name>). */
export function saveModel(model: string, profileKey = "default"): void {
  try {
    saveModelToConfig(CONFIG_PATH, model, profileKey);
  } catch (e) {
    console.error(`[hicode] failed to save model: ${(e as Error).message}`);
  }
}

/** Update a persisted model selection without ever rewriting plaintext credentials. */
export function saveModelToConfig(configPath: string, model: string, profileKey = "default"): void {
  const targetPath = path.resolve(configPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  let cfg: any = {};
  if (fs.existsSync(targetPath)) cfg = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const plaintext = findPlaintextConfigSecrets(cfg);
  if (plaintext.length) {
    throw new Error(`refusing to rewrite plaintext credentials (${plaintext.join(", ")}); migrate them in the desktop app or use CLI environment variables`);
  }
  if (cfg.profiles && typeof cfg.profiles === "object") {
    const key = cfg.defaultProfile || profileKey;
    cfg.defaultProfile = key;
    cfg.profiles[key] = { ...(cfg.profiles[key] ?? {}), model };
  } else {
    cfg.model = model;
  }
  fs.writeFileSync(targetPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(targetPath, 0o600); } catch {}
}

export { CONFIG_PATH, CONFIG_DIR };
