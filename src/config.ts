import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isCredentialPlaceholder,
  isSecretReferenceRecord,
  mcpSecretEnvName,
  profileApiKeyEnvName,
  validateSecretRef,
} from "./secret-references.js";

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
  /** MCP servers to connect to at startup (stdio transport). */
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface LoadConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  resolveSecret?: (secretRef: string) => string | undefined;
  onSecretResolutionError?: (details: { secretRef: string; location: string; error: string }) => void;
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

  if (typeof persisted.apiKey === "string" && !isCredentialPlaceholder(persisted.apiKey)) {
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
    if (typeof persisted.command !== "string" || !persisted.command.trim()) continue;
    const server: McpServerConfig = {
      command: persisted.command,
      ...(Array.isArray(persisted.args) ? { args: persisted.args.filter((arg): arg is string => typeof arg === "string") } : {}),
    };
    if (persisted.env && typeof persisted.env === "object" && !Array.isArray(persisted.env)) {
      const resolvedEnv: Record<string, string> = {};
      for (const [envName, rawValue] of Object.entries(persisted.env as Record<string, unknown>)) {
        if (typeof rawValue === "string") {
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
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    let cfg: any = {};
    if (fs.existsSync(CONFIG_PATH)) cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (cfg.profiles && typeof cfg.profiles === "object") {
      const key = cfg.defaultProfile || profileKey;
      cfg.defaultProfile = key;
      cfg.profiles[key] = { ...(cfg.profiles[key] ?? {}), model };
    } else {
      cfg.model = model; // legacy flat field, read back into the default profile
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`[vibe] failed to save model: ${(e as Error).message}`);
  }
}

export { CONFIG_PATH, CONFIG_DIR };
