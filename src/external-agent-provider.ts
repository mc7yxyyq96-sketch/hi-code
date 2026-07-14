import fs from "node:fs";
import path from "node:path";

import type { ProviderConfig, ProviderConfigValidation } from "./agent-provider.js";

export type ExternalAgentAdapterType = "codex-cli" | "claude-code" | "custom-agent-worker";

export interface ExternalAgentCommandPlan {
  adapterType: ExternalAgentAdapterType;
  executable: string;
  args: string[];
  versionArgs: string[];
  timeoutMs: number;
  outputBytes: number;
  network: "allow" | "deny";
}

export function validateExternalAgentConfig(adapterType: ExternalAgentAdapterType, config: ProviderConfig): ProviderConfigValidation {
  try {
    const executable = requireAbsoluteExecutable(config.commandPath);
    if (!fs.existsSync(executable)) return invalid("provider_executable_missing", "Configured executable does not exist.");
    const stat = fs.statSync(executable);
    if (!stat.isFile()) return invalid("provider_executable_invalid", "Configured executable must be a file.");
    if (process.platform !== "win32") {
      try { fs.accessSync(executable, fs.constants.X_OK); } catch { return invalid("provider_executable_not_executable", "Configured executable is not executable."); }
    }
    if (adapterType === "custom-agent-worker") parseArgsJson(config.argsJson, true);
    if (config.timeoutMs !== undefined) boundedInteger(config.timeoutMs, "timeoutMs", 1_000, 600_000);
    return { ok: true };
  } catch (error) {
    return invalid("provider_config_invalid", errorMessage(error));
  }
}

export function buildExternalAgentCommandPlan(
  adapterType: ExternalAgentAdapterType,
  config: ProviderConfig,
  prompt: string,
): ExternalAgentCommandPlan {
  const executable = requireAbsoluteExecutable(config.commandPath);
  const normalizedPrompt = normalizePrompt(prompt);
  const configuredArgs = parseArgsJson(config.argsJson, adapterType === "custom-agent-worker");
  const args = configuredArgs.length
    ? substituteArguments(configuredArgs, normalizedPrompt)
    : defaultArguments(adapterType, normalizedPrompt);
  if (!args.some((arg) => arg.includes(normalizedPrompt)) && adapterType === "custom-agent-worker") {
    throw new Error("Custom Agent Worker argsJson must contain the {prompt} substitution token.");
  }
  return {
    adapterType,
    executable,
    args,
    versionArgs: adapterType === "custom-agent-worker" ? ["--version"] : ["--version"],
    timeoutMs: boundedInteger(config.timeoutMs ?? 300_000, "timeoutMs", 1_000, 600_000),
    outputBytes: boundedInteger(config.outputBytes ?? 8 * 1024 * 1024, "outputBytes", 64 * 1024, 16 * 1024 * 1024),
    network: config.network === false ? "deny" : "allow",
  };
}

export function externalAgentVersionArgs(adapterType: ExternalAgentAdapterType, config: ProviderConfig): string[] {
  const configured = parseArgsJson(config.versionArgsJson, false);
  if (configured.length) return configured;
  return adapterType === "custom-agent-worker" ? ["--version"] : ["--version"];
}

export function redactExternalAgentOutput(value: unknown, limit = 20_000): string {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)-[a-z0-9._-]{6,}\b/gi, "[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(-Math.max(1_000, Math.min(100_000, limit)));
}

function defaultArguments(adapterType: ExternalAgentAdapterType, prompt: string): string[] {
  if (adapterType === "codex-cli") {
    return ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", prompt];
  }
  if (adapterType === "claude-code") {
    return ["--print", "--verbose", "--output-format", "stream-json", prompt];
  }
  throw new Error("Custom Agent Worker requires argsJson with the {prompt} substitution token.");
}

function substituteArguments(args: string[], prompt: string): string[] {
  return args.map((arg) => arg.replaceAll("{prompt}", prompt));
}

function parseArgsJson(value: unknown, required: boolean): string[] {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("argsJson is required for Custom Agent Worker.");
    return [];
  }
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("argsJson must be a JSON string array."); }
  }
  if (!Array.isArray(parsed) || parsed.length > 128) throw new Error("argsJson must be an array with at most 128 arguments.");
  return parsed.map((entry) => {
    if (typeof entry !== "string" || entry.includes("\0") || Buffer.byteLength(entry) > 64 * 1024) {
      throw new Error("External Agent arguments must be bounded strings without NUL bytes.");
    }
    return entry;
  });
}

function requireAbsoluteExecutable(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("commandPath is required.");
  if (value.includes("\0")) throw new Error("commandPath contains a NUL byte.");
  const executable = path.normalize(value.trim());
  if (!path.isAbsolute(executable)) throw new Error("commandPath must be absolute.");
  return executable;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("prompt is required.");
  if (value.includes("\0")) throw new Error("prompt contains a NUL byte.");
  if (Buffer.byteLength(value) > 512 * 1024) throw new Error("prompt exceeds 512 KiB.");
  return value.trim();
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${field} must be between ${min} and ${max}.`);
  return Math.floor(number);
}

function invalid(code: string, message: string): ProviderConfigValidation {
  return { ok: false, error: { code, message, retriable: false } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Invalid External Agent configuration.");
}
