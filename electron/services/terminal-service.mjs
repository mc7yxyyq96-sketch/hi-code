import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { buildSafeChildEnv } from "../../dist/process-env.js";
import {
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  projectExecutionCapabilities,
} from "../../dist/execution-policy.js";
import { ipcBoundedNumber, ipcObject, ipcString, redactString } from "../ipc/ipc-utils.mjs";

export const TERMINAL_EVENT_CHANNEL = "terminal:event";
export const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
export const MAX_TERMINAL_OUTPUT_EVENT_BYTES = 64 * 1024;
export const MAX_TERMINAL_TRANSCRIPT_BYTES = 1024 * 1024;

const TERMINAL_ID_RE = /^terminal-[a-f0-9-]{36}$/;
const MIN_COLS = 20;
const MAX_COLS = 400;
const MIN_ROWS = 5;
const MAX_ROWS = 200;
const TRUSTED_UNIX_SHELL_ROOTS = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"];
const UNIX_SHELL_ARGS = Object.freeze({
  zsh: ["-f"],
  bash: ["--noprofile", "--norc", "-i"],
  sh: ["-i"],
  dash: ["-i"],
  ksh: ["-i"],
  fish: ["--no-config"],
});

export function createTerminalService({
  getCwd,
  authorize,
  logger = null,
  loadPty = defaultLoadPty,
  platform = process.platform,
  envSource = process.env,
  fsImpl = fs,
  idFactory = () => `terminal-${crypto.randomUUID()}`,
  terminateProcessTree = defaultTerminateProcessTree,
  transcriptLimit = MAX_TERMINAL_TRANSCRIPT_BYTES,
  executionPolicy = null,
} = {}) {
  if (typeof getCwd !== "function") throw new Error("terminal-service requires getCwd");
  if (typeof authorize !== "function") throw new Error("terminal-service requires authorize");
  if (typeof loadPty !== "function") throw new Error("terminal-service requires loadPty");
  if (typeof terminateProcessTree !== "function") throw new Error("terminal-service requires terminateProcessTree");
  const policy = normalizeExecutionPolicy(executionPolicy, { platform });

  const sessions = new Map();
  const ownerSessions = new Map();
  const pendingOwners = new Set();
  let ptyModulePromise = null;

  const getPty = async () => {
    ptyModulePromise ||= Promise.resolve().then(() => loadPty()).then(normalizePtyModule);
    return ptyModulePromise;
  };

  const log = (event, payload = {}) => {
    if (typeof logger !== "function") return;
    logger(event, sanitizeTerminalLog(payload));
  };

  const capabilities = async () => {
    let shell;
    try {
      shell = resolveTerminalShell({ platform, env: envSource, fsImpl });
    } catch (error) {
      return terminalUnavailable(platform, error?.message || "No trusted shell is available.");
    }
    try {
      await getPty();
      return {
        ok: true,
        available: true,
        platform,
        shell: publicShell(shell),
        supportsResize: true,
        profileLoading: false,
        maxSessionsPerWindow: 1,
        executionPolicy: policy.capabilities().capabilities,
      };
    } catch (error) {
      return terminalUnavailable(platform, `PTY component failed to load: ${redactString(error?.message || String(error))}`, shell);
    }
  };

  const create = async (event, payload = {}) => {
    const owner = requireOwner(event);
    const currentId = ownerSessions.get(owner.id);
    if (currentId) {
      const current = sessions.get(currentId);
      if (current && !current.finalized) return { ok: true, reused: true, session: publicSession(current), snapshot: current.transcript };
      ownerSessions.delete(owner.id);
    }
    if (pendingOwners.has(owner.id)) return { ok: false, code: "terminal_start_pending", error: "终端正在启动，请稍候" };

    pendingOwners.add(owner.id);
    try {
      const data = ipcObject(payload);
      const cols = boundedDimension(data.cols, 100, MIN_COLS, MAX_COLS);
      const rows = boundedDimension(data.rows, 28, MIN_ROWS, MAX_ROWS);
      const workspace = resolveWorkspace(getCwd(), fsImpl);
      const shell = resolveTerminalShell({ platform, env: envSource, fsImpl });
      const decision = normalizeDecision(await authorize({
        tool: "terminal",
        action: `terminal: start ${shell.label} in ${workspace}`,
        mutating: true,
      }));
      if (decision === "deny") {
        log("terminal:permission-denied", { ownerId: owner.id, workspace, shell: shell.label });
        return { ok: false, code: "terminal_permission_denied", denied: true, error: "终端启动已拒绝" };
      }
      if (isOwnerDestroyed(owner)) return { ok: false, code: "terminal_owner_closed", error: "窗口已关闭，未启动终端" };

      const pty = await getPty();
      if (isOwnerDestroyed(owner)) {
        log("terminal:start-cancelled", { ownerId: owner.id, workspace, reason: "owner_closed" });
        return { ok: false, code: "terminal_owner_closed", error: "窗口已关闭，未启动终端" };
      }
      const activeWorkspace = resolveWorkspace(getCwd(), fsImpl);
      if (activeWorkspace !== workspace) {
        log("terminal:start-cancelled", { ownerId: owner.id, workspace, reason: "workspace_changed" });
        return { ok: false, code: "terminal_workspace_changed", error: "工作区已切换，请在新工作区重新启动终端" };
      }
      const policyDecision = policy.evaluate({
        id: "integrated-terminal",
        surface: "integrated-terminal",
        executable: shell.executable,
        args: shell.args,
        cwd: workspace,
        allowedRoots: [workspace],
        filesystem: "unrestricted",
        network: "allow",
        environment: terminalEnvironmentOptions({ platform, envSource, cwd: workspace }),
        limits: { timeoutMs: 0, outputBytes: boundedTranscriptLimit(transcriptLimit) },
        approval: { required: true, granted: decision !== "deny" },
        processTree: { required: true },
        interactive: true,
        enforcementMode: "strict",
      });
      if (!policyDecision.ok || !policyDecision.launch) {
        log("terminal:policy-denied", { ownerId: owner.id, workspace, code: policyDecision.code, error: policyDecision.error });
        return {
          ok: false,
          code: policyDecision.code || "terminal_policy_denied",
          error: `终端执行策略拒绝启动：${policyDecision.error || "安全边界不可用"}`,
        };
      }
      const env = policyDecision.launch.env;
      const ptyProcess = pty.spawn(shell.executable, shell.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workspace,
        env,
        useConpty: true,
      });
      const id = idFactory();
      if (!TERMINAL_ID_RE.test(id) || sessions.has(id)) {
        try { ptyProcess.kill(); } catch {}
        throw new Error("terminal id generator returned an invalid or duplicate id");
      }

      const session = {
        id,
        owner,
        ownerId: owner.id,
        workspace,
        shell,
        ptyProcess,
        cols,
        rows,
        startedAt: Date.now(),
        sequence: 0,
        transcript: "",
        transcriptLimit: boundedTranscriptLimit(transcriptLimit),
        closing: false,
        finalized: false,
        executionPolicy: policyDecision.audit,
        disposables: [],
        ownerDestroyedHandler: null,
      };
      sessions.set(id, session);
      ownerSessions.set(owner.id, id);

      const dataDisposable = ptyProcess.onData((chunk) => deliverOutput(session, chunk));
      const exitDisposable = ptyProcess.onExit((exit) => finalizeSession(session, {
        reason: session.closing ? "closed" : "process_exit",
        exitCode: integerOrNull(exit?.exitCode),
        signal: integerOrNull(exit?.signal),
      }));
      session.disposables.push(dataDisposable, exitDisposable);
      session.ownerDestroyedHandler = () => { void closeSession(session, "owner_closed"); };
      if (typeof owner.once === "function") owner.once("destroyed", session.ownerDestroyedHandler);

      log("terminal:started", {
        sessionId: id,
        ownerId: owner.id,
        workspace,
        shell: shell.label,
        permission: decision,
        envKeys: Object.keys(env).sort(),
        executionPolicy: policyDecision.audit,
        isolationWarnings: policyDecision.warnings,
      });
      return { ok: true, reused: false, session: publicSession(session), snapshot: session.transcript };
    } catch (error) {
      const message = redactString(error?.message || String(error));
      log("terminal:start-failed", { ownerId: owner.id, error: message });
      return { ok: false, code: "terminal_start_failed", error: `终端启动失败：${message}` };
    } finally {
      pendingOwners.delete(owner.id);
    }
  };

  const write = (event, sessionId, input) => {
    const session = requireOwnedSession(event, sessionId, sessions);
    if (session.closing || session.finalized) return { ok: false, code: "terminal_closed", error: "终端已关闭" };
    const data = ipcString(input);
    const bytes = Buffer.byteLength(data, "utf8");
    if (!data || bytes > MAX_TERMINAL_INPUT_BYTES) return { ok: false, code: "terminal_input_invalid", error: "终端输入为空或超过 64 KiB" };
    session.ptyProcess.write(data);
    return { ok: true, bytes };
  };

  const resize = (event, sessionId, payload = {}) => {
    const session = requireOwnedSession(event, sessionId, sessions);
    if (session.closing || session.finalized) return { ok: false, code: "terminal_closed", error: "终端已关闭" };
    const data = ipcObject(payload);
    const cols = boundedDimension(data.cols, session.cols, MIN_COLS, MAX_COLS);
    const rows = boundedDimension(data.rows, session.rows, MIN_ROWS, MAX_ROWS);
    session.ptyProcess.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return { ok: true, cols, rows };
  };

  const close = async (event, sessionId, reason = "user_closed") => {
    const session = requireOwnedSession(event, sessionId, sessions);
    await closeSession(session, normalizeCloseReason(reason));
    return { ok: true, sessionId: session.id, closed: true };
  };

  const status = (event) => {
    const owner = requireOwner(event);
    const id = ownerSessions.get(owner.id);
    const session = id ? sessions.get(id) : null;
    return session && !session.finalized
      ? { ok: true, active: true, session: publicSession(session), snapshot: session.transcript }
      : { ok: true, active: false, session: null, snapshot: "" };
  };

  const closeAllForOwner = async (ownerId, reason = "owner_closed") => {
    const id = ownerSessions.get(Number(ownerId));
    const session = id ? sessions.get(id) : null;
    if (!session) return { ok: true, closed: 0 };
    await closeSession(session, normalizeCloseReason(reason));
    return { ok: true, closed: 1 };
  };

  const closeAll = async (reason = "service_shutdown") => {
    const active = [...sessions.values()].filter((session) => !session.finalized);
    await Promise.all(active.map((session) => closeSession(session, normalizeCloseReason(reason))));
    return { ok: true, closed: active.length };
  };

  const closeSession = async (session, reason) => {
    if (!session || session.finalized) return;
    if (session.closing) return session.closePromise;
    session.closing = true;
    session.closePromise = Promise.resolve()
      .then(() => terminateProcessTree({ ptyProcess: session.ptyProcess, platform, envSource }))
      .catch((error) => log("terminal:cleanup-warning", { sessionId: session.id, error: redactString(error?.message || String(error)) }))
      .finally(() => finalizeSession(session, { reason, exitCode: null, signal: null }));
    return session.closePromise;
  };

  const deliverOutput = (session, value) => {
    if (!session || session.finalized || session.closing) return;
    const text = String(value || "");
    if (!text) return;
    session.transcript = utf8Tail(session.transcript + text, session.transcriptLimit);
    for (const data of splitUtf8(text, MAX_TERMINAL_OUTPUT_EVENT_BYTES)) {
      session.sequence += 1;
      if (!sendToOwner(session.owner, {
        type: "output",
        sessionId: session.id,
        sequence: session.sequence,
        data,
      })) {
        void closeSession(session, "owner_unavailable");
        break;
      }
    }
  };

  const finalizeSession = (session, result) => {
    if (!session || session.finalized) return;
    session.finalized = true;
    sessions.delete(session.id);
    if (ownerSessions.get(session.ownerId) === session.id) ownerSessions.delete(session.ownerId);
    for (const disposable of session.disposables) {
      try { disposable?.dispose?.(); } catch {}
    }
    if (session.ownerDestroyedHandler && typeof session.owner.removeListener === "function") {
      try { session.owner.removeListener("destroyed", session.ownerDestroyedHandler); } catch {}
    }
    session.sequence += 1;
    sendToOwner(session.owner, {
      type: "exit",
      sessionId: session.id,
      sequence: session.sequence,
      reason: normalizeCloseReason(result?.reason),
      exitCode: integerOrNull(result?.exitCode),
      signal: integerOrNull(result?.signal),
    });
    log("terminal:closed", {
      sessionId: session.id,
      ownerId: session.ownerId,
      reason: normalizeCloseReason(result?.reason),
      exitCode: integerOrNull(result?.exitCode),
      signal: integerOrNull(result?.signal),
    });
  };

  return Object.freeze({
    capabilities,
    create,
    status,
    write,
    resize,
    close,
    closeAllForOwner,
    closeAll,
    activeCount: () => sessions.size,
  });
}

export function registerTerminalIpc({ register, terminal }) {
  if (!register) throw new Error("registerTerminalIpc requires register");
  if (!terminal) throw new Error("registerTerminalIpc requires terminal service");

  register.handle("terminal:capabilities", (event) => terminal.capabilities(event));
  register.handle("terminal:create", (event, payload) => terminal.create(event, payload));
  register.handle("terminal:status", (event) => terminal.status(event));
  register.handle("terminal:write", (event, sessionId, data) => terminal.write(event, sessionId, data));
  register.handle("terminal:resize", (event, sessionId, payload) => terminal.resize(event, sessionId, payload));
  register.handle("terminal:close", (event, sessionId, reason) => terminal.close(event, sessionId, reason));
}

export function resolveTerminalShell({ platform = process.platform, env = process.env, fsImpl = fs } = {}) {
  if (platform === "win32") return resolveWindowsShell(env, fsImpl);
  if (platform !== "darwin" && platform !== "linux") throw new Error(`Unsupported PTY platform: ${platform}`);

  const configured = typeof env.SHELL === "string" ? env.SHELL.trim() : "";
  const candidates = [];
  if (configured) candidates.push(configured);
  if (platform === "darwin") candidates.push("/bin/zsh", "/bin/bash", "/bin/sh");
  else candidates.push("/bin/bash", "/bin/sh", "/usr/bin/bash", "/usr/bin/zsh");

  for (const candidate of [...new Set(candidates)]) {
    if (!path.isAbsolute(candidate)) continue;
    let resolved;
    try { resolved = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(candidate) : fsImpl.realpathSync(candidate); } catch { continue; }
    if (!isTrustedUnixShell(resolved) || !isExecutableFile(resolved, fsImpl, platform)) continue;
    const name = path.basename(resolved);
    const args = UNIX_SHELL_ARGS[name];
    if (!args) continue;
    return { executable: resolved, args: [...args], label: name, profileLoading: false };
  }
  throw new Error("No trusted interactive shell is installed.");
}

export async function defaultTerminateProcessTree({ ptyProcess, platform = process.platform, envSource = process.env }) {
  const pid = Number(ptyProcess?.pid);
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    try { ptyProcess?.kill?.(); } catch {}
    return;
  }

  if (platform === "win32") {
    const systemRoot = String(envSource.SystemRoot || envSource.SYSTEMROOT || "C:\\Windows");
    const taskkill = path.win32.join(systemRoot, "System32", "taskkill.exe");
    const command = fs.existsSync(taskkill) ? taskkill : "taskkill.exe";
    spawnSync(command, ["/PID", String(pid), "/T", "/F"], {
      env: buildSafeChildEnv({ source: envSource }),
      stdio: "ignore",
      windowsHide: true,
      timeout: 5000,
      shell: false,
    });
    try { ptyProcess.kill(); } catch {}
    return;
  }

  const descendants = collectUnixDescendants(pid, envSource);
  for (const childPid of [...descendants].reverse()) signalProcess(childPid, "SIGTERM");

  let groupSignaled = false;
  try {
    process.kill(-pid, "SIGTERM");
    groupSignaled = true;
  } catch {
    try { ptyProcess.kill("SIGTERM"); } catch {}
  }
  await delay(120);
  for (const childPid of [...descendants].reverse()) {
    if (processAlive(childPid)) signalProcess(childPid, "SIGKILL");
  }
  if (groupSignaled && processGroupAlive(pid)) {
    try { process.kill(-pid, "SIGKILL"); } catch {}
  } else {
    try { ptyProcess.kill("SIGKILL"); } catch {}
  }
  await delay(20);
}

async function defaultLoadPty() {
  return import("node-pty");
}

function normalizePtyModule(module) {
  const candidate = typeof module?.spawn === "function" ? module : module?.default;
  if (!candidate || typeof candidate.spawn !== "function") throw new Error("node-pty does not expose spawn()");
  return candidate;
}

function resolveWindowsShell(env, fsImpl) {
  const systemRoot = String(env.SystemRoot || env.SYSTEMROOT || "C:\\Windows");
  const programFiles = String(env.ProgramFiles || "C:\\Program Files");
  const candidates = [
    { executable: path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe"), args: ["-NoLogo", "-NoProfile"], label: "PowerShell 7" },
    { executable: path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), args: ["-NoLogo", "-NoProfile"], label: "Windows PowerShell" },
    { executable: path.win32.join(systemRoot, "System32", "cmd.exe"), args: ["/Q"], label: "Command Prompt" },
  ];
  const selected = candidates.find((candidate) => isExecutableFile(candidate.executable, fsImpl, "win32"));
  if (!selected) throw new Error("PowerShell or Command Prompt was not found under SystemRoot/ProgramFiles.");
  return { ...selected, profileLoading: false };
}

function terminalEnvironmentOptions({ platform, envSource, cwd }) {
  return {
    source: envSource,
    extraEnv: {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "HiCode",
      HICODE_TERMINAL: "1",
      PWD: cwd,
      ...(platform === "win32" ? {} : { HISTFILE: os.devNull }),
    },
  };
}

function publicShell(shell) {
  return Object.freeze({
    executable: shell.executable,
    label: shell.label,
    profileLoading: shell.profileLoading === true,
  });
}

function publicSession(session) {
  return Object.freeze({
    id: session.id,
    cwd: session.workspace,
    shell: publicShell(session.shell),
    cols: session.cols,
    rows: session.rows,
    startedAt: session.startedAt,
    state: session.closing ? "closing" : "running",
    isolationStrength: session.executionPolicy?.strength || "weak",
    executionBackend: session.executionPolicy?.backend || "none",
  });
}

function terminalUnavailable(platform, reason, shell = null) {
  return {
    ok: true,
    available: false,
    platform,
    shell: shell ? publicShell(shell) : null,
    supportsResize: false,
    profileLoading: false,
    maxSessionsPerWindow: 1,
    reason: redactString(reason),
    setupHint: "重新安装 Hi Code 的完整桌面包；浏览器预览模式不提供原生终端。",
    executionPolicy: null,
  };
}

function normalizeExecutionPolicy(candidate, { platform }) {
  if (candidate && typeof candidate.capabilities === "function" && typeof candidate.evaluate === "function") return candidate;
  const detected = detectExecutionCapabilities({ platform });
  return Object.freeze({
    capabilities: () => ({ ok: true, capabilities: projectExecutionCapabilities(detected) }),
    evaluate: (request) => evaluateExecutionPolicy(request, detected),
  });
}

function resolveWorkspace(value, fsImpl) {
  const cwd = path.resolve(String(value || ""));
  const real = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(cwd) : fsImpl.realpathSync(cwd);
  const stat = fsImpl.statSync(real);
  if (!stat.isDirectory()) throw new Error("Current workspace is not a directory.");
  return real;
}

function requireOwner(event) {
  const owner = event?.sender;
  if (!owner || !Number.isInteger(owner.id) || owner.id <= 0 || typeof owner.send !== "function") {
    throw new Error("terminal request has no valid renderer owner");
  }
  if (isOwnerDestroyed(owner)) throw new Error("terminal renderer owner is closed");
  return owner;
}

function requireOwnedSession(event, value, sessions) {
  const owner = requireOwner(event);
  const id = ipcString(value).trim();
  if (!TERMINAL_ID_RE.test(id)) throw new Error("terminal session id is invalid");
  const session = sessions.get(id);
  if (!session || session.finalized) throw new Error("terminal session does not exist");
  if (session.ownerId !== owner.id) throw new Error("terminal session belongs to another window");
  return session;
}

function sendToOwner(owner, payload) {
  if (isOwnerDestroyed(owner)) return false;
  try {
    owner.send(TERMINAL_EVENT_CHANNEL, Object.freeze({ ...payload }));
    return true;
  } catch {
    return false;
  }
}

function isOwnerDestroyed(owner) {
  try { return typeof owner?.isDestroyed === "function" && owner.isDestroyed(); } catch { return true; }
}

function isTrustedUnixShell(candidate) {
  return TRUSTED_UNIX_SHELL_ROOTS.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
}

function isExecutableFile(candidate, fsImpl, platform = process.platform) {
  try {
    if (!fsImpl.statSync(candidate).isFile()) return false;
    if (platform !== "win32" && typeof fsImpl.accessSync === "function") fsImpl.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function boundedDimension(value, fallback, min, max) {
  return Math.round(ipcBoundedNumber(value, fallback, { min, max }));
}

function boundedTranscriptLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MAX_TERMINAL_TRANSCRIPT_BYTES;
  return Math.max(MAX_TERMINAL_OUTPUT_EVENT_BYTES, Math.min(4 * MAX_TERMINAL_TRANSCRIPT_BYTES, Math.floor(numeric)));
}

function normalizeDecision(value) {
  const decision = typeof value === "string" ? value : value?.decision;
  if (decision === "allow" || decision === "always") return decision;
  return "deny";
}

function normalizeCloseReason(value) {
  const text = String(value || "closed").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
  return text || "closed";
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function sanitizeTerminalLog(value) {
  const out = {};
  for (const [key, item] of Object.entries(ipcObject(value))) {
    if (/input|output|transcript|env$/i.test(key)) continue;
    if (key === "envKeys") out.envKeys = Array.isArray(item) ? item.filter((entry) => typeof entry === "string").slice(0, 32) : [];
    else if (key === "isolationWarnings") out.isolationWarnings = Array.isArray(item) ? item.filter((entry) => typeof entry === "string").slice(0, 8).map((entry) => redactString(entry).slice(0, 600)) : [];
    else if (key === "executionPolicy" && item && typeof item === "object" && !Array.isArray(item)) {
      out.executionPolicy = sanitizeExecutionPolicyAudit(item);
    }
    else if (typeof item === "string") out[key] = redactString(item).slice(0, 4096);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) out[key] = item;
  }
  return out;
}

function sanitizeExecutionPolicyAudit(value) {
  const input = ipcObject(value);
  return {
    schemaVersion: Number(input.schemaVersion) || 1,
    requestId: redactString(input.requestId || "").slice(0, 160),
    surface: redactString(input.surface || "").slice(0, 160),
    platform: redactString(input.platform || "").slice(0, 32),
    backend: redactString(input.backend || "none").slice(0, 80),
    strength: ["strong", "partial", "weak", "unavailable"].includes(input.strength) ? input.strength : "unavailable",
    executable: path.basename(redactString(input.executable || "")).slice(0, 160),
    argCount: Number.isInteger(input.argCount) ? input.argCount : 0,
    rootCount: Number.isInteger(input.rootCount) ? input.rootCount : 0,
    filesystem: redactString(input.filesystem || "").slice(0, 40),
    network: redactString(input.network || "").slice(0, 40),
    timeoutMs: Number(input.timeoutMs) || 0,
    outputBytes: Number(input.outputBytes) || 0,
    approvalRequired: input.approvalRequired === true,
    processTreeRequired: input.processTreeRequired === true,
    interactive: input.interactive === true,
  };
}

function splitUtf8(value, maxBytes) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const character of String(value)) {
    const size = Buffer.byteLength(character, "utf8");
    if (current.length && bytes + size > maxBytes) {
      chunks.push(current.join(""));
      current = [];
      bytes = 0;
    }
    current.push(character);
    bytes += size;
  }
  if (current.length) chunks.push(current.join(""));
  return chunks;
}

function utf8Tail(value, maxBytes) {
  const buffer = Buffer.from(String(value), "utf8");
  if (buffer.length <= maxBytes) return String(value);
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  return buffer.subarray(start).toString("utf8");
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function collectUnixDescendants(rootPid, envSource) {
  const ps = fs.existsSync("/bin/ps") ? "/bin/ps" : "/usr/bin/ps";
  const result = spawnSync(ps, ["-axo", "pid=,ppid="], {
    env: buildSafeChildEnv({ source: envSource }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 2000,
    shell: false,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  const childrenByParent = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const child = Number(match[1]);
    const parent = Number(match[2]);
    if (!Number.isInteger(child) || !Number.isInteger(parent) || child <= 1 || child === process.pid) continue;
    const children = childrenByParent.get(parent) || [];
    children.push(child);
    childrenByParent.set(parent, children);
  }
  const descendants = [];
  const visited = new Set([rootPid]);
  const visit = (parent) => {
    for (const child of childrenByParent.get(parent) || []) {
      if (visited.has(child)) continue;
      visited.add(child);
      descendants.push(child);
      visit(child);
    }
  };
  visit(rootPid);
  return descendants;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
  try { process.kill(pid, signal); } catch {}
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
