import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** One model endpoint + its parameters. The unit the LLM client speaks. */
export const MODEL_TRANSPORT_PROTOCOLS = ["chat_completions", "responses", "anthropic_messages", "ollama_chat"] as const;
export type ModelTransportProtocol = (typeof MODEL_TRANSPORT_PROTOCOLS)[number];

export interface ModelProfile {
  name: string;
  baseURL: string;
  apiKey: string;
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
export function loadConfig(): VibeConfig {
  let f: any = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) f = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    console.error(`[hicode] failed to read ${CONFIG_PATH}: ${(e as Error).message}`);
  }

  const profiles: Record<string, ModelProfile> = {};
  if (f.profiles && typeof f.profiles === "object") {
    for (const [k, v] of Object.entries<any>(f.profiles)) {
      profiles[k] = {
        ...BASE_PROFILE,
        ...clean(v),
        name: k,
        protocol: normalizeModelTransportProtocol(v?.protocol),
      };
    }
  }

  // Ensure the chosen default profile exists; synthesize it from legacy flat
  // fields (or the base) only when it's missing — don't inject a phantom one.
  const defaultKey = (f.defaultProfile as string) || "default";
  if (!profiles[defaultKey]) {
    profiles[defaultKey] = {
      ...BASE_PROFILE,
      ...clean({
        baseURL: f.baseURL,
        apiKey: f.apiKey,
        model: f.model,
        contextWindow: f.contextWindow,
        temperature: f.temperature,
        protocol: f.protocol,
      }),
      name: defaultKey,
      protocol: normalizeModelTransportProtocol(f.protocol),
    };
  }

  const defaultProfile = defaultKey;

  // Environment variables override the default profile.
  const env = process.env;
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
    mcpServers: (f.mcpServers as Record<string, McpServerConfig>) ?? {},
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
