import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  terminateExecutionProcessTree,
  type ExecutionCapabilities,
  type ExecutionPolicyAudit,
  type ExecutionPolicyRequest,
} from "./execution-policy.js";
import { buildSafeChildEnv } from "./process-env.js";

export interface ManagedExecutionPolicyResult {
  code: string;
  strength: string;
  warnings: string[];
  audit?: ExecutionPolicyAudit;
}

export interface ManagedExecutionResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  endedAt: number;
  policy: ManagedExecutionPolicyResult;
  error?: string;
}

export interface ManagedExecutionOptions {
  capabilities?: ExecutionCapabilities;
  signal?: AbortSignal;
}

export interface ExecutionSupervisorEnvOptions {
  source?: NodeJS.ProcessEnv;
  electron?: boolean;
}

interface SupervisorResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  endedAt: number;
  error?: string;
}

export async function runManagedExecution(
  request: ExecutionPolicyRequest,
  options: ManagedExecutionOptions = {},
): Promise<ManagedExecutionResult> {
  const prepared = prepareExecution(request, options);
  if (!prepared.ok) return prepared.result;
  const { plan, capabilities, policy } = prepared;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = options.signal?.aborted === true;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const finish = (partial: Partial<ManagedExecutionResult>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      resolve({
        ok: partial.exitCode === 0 && !timedOut && !cancelled && !partial.error,
        exitCode: partial.exitCode ?? null,
        signal: partial.signal ?? null,
        stdout,
        stderr,
        timedOut,
        cancelled,
        endedAt: Date.now(),
        policy,
        ...(partial.error ? { error: partial.error } : {}),
      });
    };

    let child;
    if (cancelled) {
      finish({ exitCode: null, error: "execution cancelled before launch" });
      return;
    }
    try {
      child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: plan.env,
        detached: plan.detached,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ exitCode: 127, error: errorMessage(error) });
      return;
    }

    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, plan.outputBytes); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk, plan.outputBytes); });
    child.on("error", (error) => finish({ exitCode: 127, error: errorMessage(error) }));
    child.on("close", (exitCode, signal) => finish({ exitCode, signal }));

    abortListener = () => {
      cancelled = true;
      if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: capabilities.platform, signal: "SIGTERM" });
      forceTimer = setTimeout(() => {
        if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: capabilities.platform, signal: "SIGKILL" });
      }, 750);
      forceTimer.unref?.();
    };
    options.signal?.addEventListener("abort", abortListener, { once: true });

    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: capabilities.platform, signal: "SIGTERM" });
      forceTimer = setTimeout(() => {
        if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: capabilities.platform, signal: "SIGKILL" });
      }, 750);
      forceTimer.unref?.();
    }, plan.timeoutMs);
    timer.unref?.();
  });
}

export function runManagedExecutionSync(
  request: ExecutionPolicyRequest,
  options: ManagedExecutionOptions = {},
): ManagedExecutionResult {
  const prepared = prepareExecution(request, options);
  if (!prepared.ok) return prepared.result;
  const { plan, policy } = prepared;
  const supervisorPath = fileURLToPath(new URL("./execution-supervisor.js", import.meta.url));
  const payload = JSON.stringify({
    command: plan.command,
    args: plan.args,
    cwd: plan.cwd,
    env: plan.env,
    timeoutMs: plan.timeoutMs,
    outputBytes: plan.outputBytes,
    detached: plan.detached,
    platform: prepared.capabilities.platform,
  });
  const result = spawnSync(process.execPath, [supervisorPath], {
    input: payload,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: plan.timeoutMs + 5_000,
    maxBuffer: Math.min(36 * 1024 * 1024, plan.outputBytes * 2 + 512 * 1024),
    env: buildExecutionSupervisorEnv(),
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      exitCode: result.status ?? 127,
      signal: result.signal as NodeJS.Signals | null,
      stdout: "",
      stderr: boundedText(String(result.stderr || ""), plan.outputBytes),
      timedOut: Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT"),
      cancelled: false,
      endedAt: Date.now(),
      policy,
      error: errorMessage(result.error || result.stderr || "execution supervisor failed"),
    };
  }
  try {
    const parsed = JSON.parse(String(result.stdout || "")) as SupervisorResult;
    return {
      ok: parsed.exitCode === 0 && parsed.timedOut !== true && !parsed.error,
      exitCode: parsed.exitCode,
      signal: parsed.signal,
      stdout: boundedText(parsed.stdout, plan.outputBytes),
      stderr: boundedText(parsed.stderr, plan.outputBytes),
      timedOut: parsed.timedOut === true,
      cancelled: false,
      endedAt: Number.isFinite(parsed.endedAt) ? parsed.endedAt : Date.now(),
      policy,
      ...(parsed.error ? { error: boundedText(parsed.error, 1_000) } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 127,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      endedAt: Date.now(),
      policy,
      error: `invalid execution supervisor response: ${errorMessage(error)}`,
    };
  }
}

export function buildExecutionSupervisorEnv(options: ExecutionSupervisorEnvOptions = {}): NodeJS.ProcessEnv {
  const electron = options.electron ?? Boolean((process.versions as NodeJS.ProcessVersions & { electron?: string }).electron);
  return buildSafeChildEnv({
    source: options.source,
    ...(electron ? { extraEnv: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
  });
}

function prepareExecution(request: ExecutionPolicyRequest, options: ManagedExecutionOptions) {
  const capabilities = options.capabilities ?? detectExecutionCapabilities();
  const decision = evaluateExecutionPolicy(request, capabilities);
  const policy: ManagedExecutionPolicyResult = {
    code: decision.code,
    strength: decision.strength,
    warnings: [...decision.warnings],
    ...(decision.audit ? { audit: decision.audit } : {}),
  };
  if (!decision.ok) {
    return {
      ok: false as const,
      result: {
        ok: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        endedAt: Date.now(),
        policy,
        error: decision.error || "execution policy denied the launch",
      } satisfies ManagedExecutionResult,
    };
  }
  return {
    ok: true as const,
    capabilities,
    plan: createExecutionLaunchPlan(decision, capabilities),
    policy,
  };
}

function appendBounded(current: string, chunk: Buffer | string, limit: number): string {
  return boundedText(current + String(chunk), limit);
}

function boundedText(value: unknown, limit: number): string {
  const buffer = Buffer.from(String(value ?? ""));
  return buffer.length <= limit ? buffer.toString("utf8") : buffer.subarray(buffer.length - limit).toString("utf8");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "execution failed");
}
