import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { buildSafeChildEnv, type SafeChildEnvOptions } from "./process-env.js";

export const EXECUTION_POLICY_SCHEMA_VERSION = 1 as const;

export type ExecutionIsolationStrength = "strong" | "partial" | "weak" | "unavailable";
export type ExecutionFilesystemPolicy = "unrestricted" | "workspace-write" | "read-only";
export type ExecutionNetworkPolicy = "allow" | "deny";
export type ExecutionEnforcementMode = "strict" | "report-only";

export interface ExecutionCapabilityControl {
  available: boolean;
  enforcement: string;
  detail: string;
}

export interface ExecutionCapabilities {
  schemaVersion: typeof EXECUTION_POLICY_SCHEMA_VERSION;
  platform: NodeJS.Platform | string;
  backend: {
    id: "macos-sandbox-exec" | "linux-bubblewrap" | "windows-restricted-token" | "none";
    available: boolean;
    reason: string;
  };
  strength: ExecutionIsolationStrength;
  controls: {
    filesystem: ExecutionCapabilityControl;
    environment: ExecutionCapabilityControl;
    network: ExecutionCapabilityControl;
    processTree: ExecutionCapabilityControl;
    timeout: ExecutionCapabilityControl;
    output: ExecutionCapabilityControl;
    approval: ExecutionCapabilityControl;
    audit: ExecutionCapabilityControl;
  };
  warnings: string[];
  setupHint: string;
}

export interface ExecutionBackendAvailability {
  sandboxExec?: boolean;
  bubblewrap?: boolean;
  windowsRestrictedToken?: boolean;
  windowsJobObject?: boolean;
}

export interface DetectExecutionCapabilitiesOptions {
  platform?: NodeJS.Platform | string;
  backendAvailability?: ExecutionBackendAvailability;
  processTreeSupport?: boolean;
  spawnSyncImpl?: SpawnSyncLike;
}

export interface ExecutionPolicyRequest {
  id: string;
  surface: string;
  executable: string;
  args?: string[];
  cwd: string;
  allowedRoots: string[];
  filesystem: ExecutionFilesystemPolicy;
  network: ExecutionNetworkPolicy;
  environment?: SafeChildEnvOptions;
  limits: {
    timeoutMs: number;
    outputBytes: number;
  };
  approval: {
    required: boolean;
    granted: boolean;
  };
  processTree: {
    required: boolean;
  };
  interactive?: boolean;
  commandPolicy?: {
    allow?: string[];
    deny?: string[];
  };
  enforcementMode?: ExecutionEnforcementMode;
}

export interface ExecutionPolicyAudit {
  schemaVersion: typeof EXECUTION_POLICY_SCHEMA_VERSION;
  requestId: string;
  surface: string;
  platform: string;
  backend: string;
  strength: ExecutionIsolationStrength;
  executable: string;
  argCount: number;
  rootCount: number;
  filesystem: ExecutionFilesystemPolicy;
  network: ExecutionNetworkPolicy;
  envKeys: string[];
  timeoutMs: number;
  outputBytes: number;
  approvalRequired: boolean;
  processTreeRequired: boolean;
  interactive: boolean;
}

export interface ExecutionPolicyLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputBytes: number;
  filesystem: ExecutionFilesystemPolicy;
  network: ExecutionNetworkPolicy;
  allowedRoots: string[];
}

export interface ExecutionPolicyDecision {
  ok: boolean;
  code: string;
  error?: string;
  strength: ExecutionIsolationStrength;
  warnings: string[];
  enforced: {
    filesystem: boolean;
    environment: boolean;
    network: boolean;
    processTree: boolean;
    timeout: boolean;
    output: boolean;
    approval: boolean;
    audit: boolean;
  };
  launch?: ExecutionPolicyLaunch;
  audit?: ExecutionPolicyAudit;
}

export interface ExecutionLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputBytes: number;
  detached: boolean;
  strength: ExecutionIsolationStrength;
  warnings: string[];
  audit: ExecutionPolicyAudit;
}

interface SpawnSyncResultLike {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

type SpawnSyncLike = (command: string, args: string[], options: Record<string, unknown>) => SpawnSyncResultLike;

const MAX_EXECUTABLE_BYTES = 4096;
const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_OUTPUT_BYTES = 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export function detectExecutionCapabilities(options: DetectExecutionCapabilitiesOptions = {}): ExecutionCapabilities {
  const platform = options.platform ?? process.platform;
  const availability = options.backendAvailability ?? probeBackends(platform, options.spawnSyncImpl ?? spawnSyncLike);
  const processTreeSupport = options.processTreeSupport ?? ["darwin", "linux", "win32"].includes(platform);

  let backend: ExecutionCapabilities["backend"] = {
    id: "none",
    available: false,
    reason: "No reviewed operating-system isolation backend is available.",
  };
  let filesystem = unavailableControl("No operating-system filesystem write confinement is active.");
  let network = unavailableControl("No child-process network namespace or deny rule is active.");
  let setupHint = "Use explicit approval and an isolated worktree; no supported OS sandbox backend was detected.";
  const warnings: string[] = [];

  if (platform === "darwin" && availability.sandboxExec === true) {
    backend = {
      id: "macos-sandbox-exec",
      available: true,
      reason: "The built-in sandbox-exec backend passed its local probe.",
    };
    filesystem = availableControl("write-confined", "Requested writes can be confined to approved roots; host reads remain available.");
    network = availableControl("deny-when-requested", "Network access can be denied for a non-interactive child when policy requests it.");
    setupHint = "No setup required. sandbox-exec is compatibility technology and is reported as partial isolation.";
    warnings.push("Host filesystem read access remains available; sandbox-exec is not a container boundary.");
  } else if (platform === "darwin") {
    backend.reason = "sandbox-exec is unavailable or failed its probe.";
    setupHint = "Use an isolated worker or container when strict filesystem or network isolation is required.";
  }

  if (platform === "linux" && availability.bubblewrap === true) {
    backend = {
      id: "linux-bubblewrap",
      available: true,
      reason: "bubblewrap and the required user-namespace operation passed their local probe.",
    };
    filesystem = availableControl("write-confined", "Host paths are mounted read-only and approved roots can be rebound writable.");
    network = availableControl("deny-when-requested", "A private network namespace can be created when policy denies network access.");
    setupHint = "bubblewrap is available. Host reads remain visible, so the backend is intentionally reported as partial.";
    warnings.push("Host filesystem read access remains available through read-only mounts; bubblewrap is not configured as a full container.");
  } else if (platform === "linux") {
    backend.reason = "bubblewrap is missing or its user-namespace probe failed.";
    setupHint = "Install and enable bubblewrap/user namespaces, or use an isolated worker/container for strict execution.";
  }

  if (platform === "win32" && availability.windowsRestrictedToken === true) {
    backend = {
      id: "windows-restricted-token",
      available: true,
      reason: "A reviewed restricted-token backend is available.",
    };
    filesystem = availableControl("restricted-token", "The reviewed Windows backend supplies a restricted process token.");
    network = unavailableControl("The current restricted-token backend does not enforce a network deny policy.");
    setupHint = "Use WSL2, a container, or a managed worker when network isolation is required.";
    warnings.push("Windows restricted-token support does not imply a network firewall boundary.");
  } else if (platform === "win32") {
    backend.reason = "No reviewed Windows restricted-token backend is installed.";
    setupHint = "Use WSL2, a container, or a managed worker for strict filesystem/network isolation.";
    warnings.push("Windows execution uses approval, a minimal environment, workspace validation, and process-tree cleanup, but not an OS filesystem sandbox.");
  }

  if (!backend.available) {
    warnings.push("No operating-system filesystem or network isolation backend is active; execution boundary is weak.");
  }

  const processTreeEnforcement = platform === "win32" ? "taskkill-tree" : processTreeSupport ? "process-group" : "none";
  const controls: ExecutionCapabilities["controls"] = {
    filesystem,
    environment: availableControl("allowlist", "Child processes receive an explicit minimal environment instead of process.env."),
    network,
    processTree: processTreeSupport
      ? availableControl(processTreeEnforcement, "Timeout, abort, owner close, and app close can terminate the managed process tree.")
      : unavailableControl("The current launcher cannot prove descendant cleanup."),
    timeout: availableControl("application-deadline", "The launcher enforces a bounded wall-clock deadline."),
    output: availableControl("application-bound", "Captured output is bounded before it enters logs or model context."),
    approval: availableControl("application-gate", "Mutating or interactive execution requires the existing permission decision."),
    audit: availableControl("metadata-only", "Policy decisions record bounded metadata without command arguments or environment values."),
  };

  return {
    schemaVersion: EXECUTION_POLICY_SCHEMA_VERSION,
    platform,
    backend,
    strength: backend.available ? "partial" : "weak",
    controls,
    warnings: uniqueBounded(warnings),
    setupHint,
  };
}

export function projectExecutionCapabilities(capabilities: ExecutionCapabilities): ExecutionCapabilities {
  const controls = Object.fromEntries(
    Object.entries(capabilities.controls).map(([key, control]) => [key, {
      available: control.available === true,
      enforcement: boundedText(control.enforcement, 80),
      detail: boundedText(control.detail, 400),
    }]),
  ) as ExecutionCapabilities["controls"];
  return {
    schemaVersion: EXECUTION_POLICY_SCHEMA_VERSION,
    platform: boundedText(String(capabilities.platform), 32),
    backend: {
      id: capabilities.backend.id,
      available: capabilities.backend.available === true,
      reason: boundedText(capabilities.backend.reason, 400),
    },
    strength: capabilities.strength,
    controls,
    warnings: uniqueBounded(capabilities.warnings),
    setupHint: boundedText(capabilities.setupHint, 600),
  };
}

export function evaluateExecutionPolicy(
  request: ExecutionPolicyRequest,
  capabilities: ExecutionCapabilities,
): ExecutionPolicyDecision {
  const warnings = [...capabilities.warnings];
  const mode = request?.enforcementMode ?? "strict";
  const denied = (code: string, error: string): ExecutionPolicyDecision => ({
    ok: false,
    code,
    error,
    strength: "unavailable",
    warnings: uniqueBounded(warnings),
    enforced: emptyEnforcement(),
  });

  if (
    !request
    || typeof request.id !== "string"
    || typeof request.surface !== "string"
    || request.id.length > 160
    || !safeToken(request.id)
    || request.surface.length > 160
    || !safeToken(request.surface)
  ) {
    return denied("invalid_request", "Execution policy id or surface is invalid.");
  }
  if (!validCommand(request.executable, request.args ?? [])) {
    return denied("invalid_command", "Executable or arguments are invalid or exceed policy bounds.");
  }
  if (!validLimits(request.limits, request.interactive === true)) {
    return denied("invalid_limits", "Timeout or output limit is outside the supported bounds.");
  }
  if (!Array.isArray(request.allowedRoots) || request.allowedRoots.length === 0 || request.allowedRoots.length > 16) {
    return denied("invalid_roots", "At least one bounded filesystem root is required.");
  }

  let cwd: string;
  let roots: string[];
  try {
    cwd = canonicalPath(request.cwd);
    roots = request.allowedRoots.map(canonicalPath);
  } catch {
    return denied("invalid_paths", "Working directory or allowed filesystem roots are invalid.");
  }
  if (!roots.some((root) => pathInside(root, cwd))) {
    return denied("cwd_outside_allowed_roots", "Working directory escapes the allowed filesystem roots.");
  }

  const executableName = path.basename(request.executable).toLowerCase();
  const allowedCommands = normalizeCommandList(request.commandPolicy?.allow);
  const deniedCommands = normalizeCommandList(request.commandPolicy?.deny);
  if (deniedCommands.has(executableName) || deniedCommands.has(request.executable.toLowerCase())) {
    return denied("command_denied", "The executable is denied by execution policy.");
  }
  if (allowedCommands.size && !allowedCommands.has(executableName) && !allowedCommands.has(request.executable.toLowerCase())) {
    return denied("command_not_allowed", "The executable is not in the execution-policy allowlist.");
  }

  if (request.approval.required && !request.approval.granted) {
    return denied("approval_required", "A fresh user approval is required before execution.");
  }

  const filesystemRequested = request.filesystem !== "unrestricted";
  const filesystemEnforced = !filesystemRequested || capabilities.controls.filesystem.available;
  if (!filesystemEnforced) {
    warnings.push("Requested filesystem isolation is not enforced by the current platform backend.");
    if (mode === "strict") return denied("filesystem_isolation_unavailable", "Requested filesystem isolation is unavailable.");
  }

  const networkRequested = request.network === "deny";
  const networkEnforced = !networkRequested || capabilities.controls.network.available;
  if (!networkEnforced) {
    warnings.push("Requested network deny policy is not enforced by the current platform backend.");
    if (mode === "strict") return denied("network_isolation_unavailable", "Requested network isolation is unavailable.");
  }

  const processTreeEnforced = !request.processTree.required || capabilities.controls.processTree.available;
  if (!processTreeEnforced) {
    warnings.push("Managed descendant termination is not available for this execution path.");
    if (mode === "strict") return denied("process_tree_unavailable", "Managed process-tree termination is unavailable.");
  }

  let env: NodeJS.ProcessEnv;
  try {
    env = buildSafeChildEnv(request.environment);
  } catch (error) {
    return denied("environment_invalid", error instanceof Error ? error.message : "Environment policy is invalid.");
  }

  if (request.interactive === true) warnings.push("Interactive execution has no automatic timeout; owner and application lifecycle must terminate its process tree.");
  const isolationRequested = filesystemRequested || networkRequested;
  const strength: ExecutionIsolationStrength = isolationRequested && filesystemEnforced && networkEnforced && capabilities.backend.available
    ? capabilities.strength
    : "weak";
  const launch: ExecutionPolicyLaunch = {
    executable: request.executable,
    args: [...(request.args ?? [])],
    cwd,
    env,
    timeoutMs: Math.round(request.limits.timeoutMs),
    outputBytes: Math.round(request.limits.outputBytes),
    filesystem: request.filesystem,
    network: request.network,
    allowedRoots: roots,
  };
  const audit: ExecutionPolicyAudit = {
    schemaVersion: EXECUTION_POLICY_SCHEMA_VERSION,
    requestId: request.id,
    surface: request.surface,
    platform: String(capabilities.platform),
    backend: capabilities.backend.id,
    strength,
    executable: executableName,
    argCount: launch.args.length,
    rootCount: roots.length,
    filesystem: request.filesystem,
    network: request.network,
    envKeys: Object.keys(env).sort(),
    timeoutMs: launch.timeoutMs,
    outputBytes: launch.outputBytes,
    approvalRequired: request.approval.required,
    processTreeRequired: request.processTree.required,
    interactive: request.interactive === true,
  };
  return {
    ok: true,
    code: "allowed",
    strength,
    warnings: uniqueBounded(warnings),
    enforced: {
      filesystem: filesystemEnforced,
      environment: true,
      network: networkEnforced,
      processTree: processTreeEnforced,
      timeout: request.interactive !== true,
      output: true,
      approval: !request.approval.required || request.approval.granted,
      audit: true,
    },
    launch,
    audit,
  };
}

export function createExecutionLaunchPlan(
  decision: ExecutionPolicyDecision,
  capabilities: ExecutionCapabilities,
): ExecutionLaunchPlan {
  if (!decision.ok || !decision.launch || !decision.audit) {
    throw new Error(decision.error || "Execution policy denied the launch.");
  }
  const launch = decision.launch;
  const base: ExecutionLaunchPlan = {
    command: launch.executable,
    args: [...launch.args],
    cwd: launch.cwd,
    env: { ...launch.env },
    timeoutMs: launch.timeoutMs,
    outputBytes: launch.outputBytes,
    detached: capabilities.platform !== "win32",
    strength: decision.strength,
    warnings: [...decision.warnings],
    audit: { ...decision.audit, envKeys: [...decision.audit.envKeys] },
  };
  const isolationRequested = launch.filesystem !== "unrestricted" || launch.network === "deny";
  if (!isolationRequested || !capabilities.backend.available) return base;

  if (capabilities.backend.id === "macos-sandbox-exec") {
    return {
      ...base,
      command: "/usr/bin/sandbox-exec",
      args: ["-p", macOsSandboxProfile(launch), launch.executable, ...launch.args],
    };
  }
  if (capabilities.backend.id === "linux-bubblewrap") {
    const args = [
      "--die-with-parent",
      "--new-session",
      "--ro-bind", "/", "/",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
    ];
    if (launch.network === "deny") args.push("--unshare-net");
    if (launch.filesystem === "workspace-write") {
      for (const root of launch.allowedRoots) args.push("--bind", root, root);
    }
    args.push("--chdir", launch.cwd, "--", launch.executable, ...launch.args);
    return { ...base, command: "bwrap", args };
  }
  return base;
}

export function terminateExecutionProcessTree({
  pid,
  platform = process.platform,
  signal = "SIGTERM",
  killImpl = process.kill,
  spawnSyncImpl = spawnSyncLike,
}: {
  pid: number;
  platform?: NodeJS.Platform | string;
  signal?: NodeJS.Signals;
  killImpl?: typeof process.kill;
  spawnSyncImpl?: SpawnSyncLike;
}): { ok: boolean; method: string; error?: string } {
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, method: "none", error: "invalid process id" };
  if (platform === "win32") {
    const result = spawnSyncImpl("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      timeout: 5000,
      encoding: "utf8",
      env: buildSafeChildEnv(),
    });
    return result.status === 0
      ? { ok: true, method: "taskkill-tree" }
      : { ok: false, method: "taskkill-tree", error: boundedText(String(result.error?.message || result.stderr || "taskkill failed"), 400) };
  }
  try {
    killImpl(-pid, signal);
    return { ok: true, method: "process-group" };
  } catch (groupError) {
    try {
      killImpl(pid, signal);
      return { ok: true, method: "direct-fallback" };
    } catch (directError) {
      return {
        ok: false,
        method: "process-group",
        error: boundedText(directError instanceof Error ? directError.message : String(groupError), 400),
      };
    }
  }
}

function probeBackends(platform: NodeJS.Platform | string, spawnSyncImpl: SpawnSyncLike): ExecutionBackendAvailability {
  if (platform === "darwin") {
    if (!fs.existsSync("/usr/bin/sandbox-exec")) return { sandboxExec: false };
    const result = spawnSyncImpl("/usr/bin/sandbox-exec", ["-p", "(version 1) (allow default)", "/usr/bin/true"], {
      shell: false,
      timeout: 3000,
      encoding: "utf8",
      env: buildSafeChildEnv(),
    });
    return { sandboxExec: result.status === 0 };
  }
  if (platform === "linux") {
    const version = spawnSyncImpl("bwrap", ["--version"], {
      shell: false,
      timeout: 3000,
      encoding: "utf8",
      env: buildSafeChildEnv(),
    });
    if (version.status !== 0) return { bubblewrap: false };
    const probe = spawnSyncImpl("bwrap", [
      "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--unshare-net", "/bin/true",
    ], {
      shell: false,
      timeout: 3000,
      encoding: "utf8",
      env: buildSafeChildEnv(),
    });
    return { bubblewrap: probe.status === 0 };
  }
  if (platform === "win32") return { windowsRestrictedToken: false, windowsJobObject: false };
  return {};
}

function macOsSandboxProfile(launch: ExecutionPolicyLaunch): string {
  const lines = ["(version 1)", "(allow default)"];
  if (launch.filesystem === "read-only") {
    lines.push("(deny file-write*)");
    lines.push('(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))');
  } else if (launch.filesystem === "workspace-write") {
    lines.push("(deny file-write*)");
    const roots = launch.allowedRoots.map((root) => `(subpath ${sandboxQuote(root)})`).join(" ");
    lines.push(`(allow file-write* ${roots} (subpath "/tmp") (subpath "/private/tmp") (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (subpath "/private/var/folders"))`);
  }
  if (launch.network === "deny") lines.push("(deny network*)");
  return lines.join("\n");
}

function probeSpawn(command: string, args: string[], options: Record<string, unknown>): SpawnSyncResultLike {
  return spawnSync(command, args, options as Parameters<typeof spawnSync>[2]) as SpawnSyncResultLike;
}

const spawnSyncLike: SpawnSyncLike = probeSpawn;

function canonicalPath(candidate: string): string {
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 4096 || candidate.includes("\0")) {
    throw new Error("invalid path");
  }
  const absolute = path.resolve(candidate);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function pathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function validCommand(executable: string, args: string[]): boolean {
  if (typeof executable !== "string" || !executable.trim() || Buffer.byteLength(executable) > MAX_EXECUTABLE_BYTES || executable.includes("\0")) return false;
  if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) return false;
  return args.every((arg) => typeof arg === "string" && !arg.includes("\0") && Buffer.byteLength(arg) <= MAX_ARGUMENT_BYTES);
}

function validLimits(limits: ExecutionPolicyRequest["limits"], interactive: boolean): boolean {
  return Number.isFinite(limits?.timeoutMs)
    && (interactive ? limits.timeoutMs === 0 : limits.timeoutMs >= MIN_TIMEOUT_MS)
    && limits.timeoutMs <= MAX_TIMEOUT_MS
    && Number.isFinite(limits?.outputBytes)
    && limits.outputBytes >= MIN_OUTPUT_BYTES
    && limits.outputBytes <= MAX_OUTPUT_BYTES;
}

function normalizeCommandList(values: string[] | undefined): Set<string> {
  return new Set((values ?? []).filter((value) => typeof value === "string" && value.length <= MAX_EXECUTABLE_BYTES).map((value) => value.toLowerCase()));
}

function safeToken(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value);
}

function emptyEnforcement(): ExecutionPolicyDecision["enforced"] {
  return {
    filesystem: false,
    environment: false,
    network: false,
    processTree: false,
    timeout: false,
    output: false,
    approval: false,
    audit: false,
  };
}

function availableControl(enforcement: string, detail: string): ExecutionCapabilityControl {
  return { available: true, enforcement, detail };
}

function unavailableControl(detail: string): ExecutionCapabilityControl {
  return { available: false, enforcement: "none", detail };
}

function sandboxQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function boundedText(value: string, max: number): string {
  const normalized = String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function uniqueBounded(values: string[]): string[] {
  return [...new Set(values.map((value) => boundedText(value, 600)).filter(Boolean))].slice(0, 16);
}
