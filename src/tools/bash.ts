import { spawn } from "node:child_process";
import {
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  terminateExecutionProcessTree,
  type ExecutionCapabilities,
  type ExecutionPolicyAudit,
} from "../execution-policy.js";
import { buildSafeChildEnv } from "../process-env.js";
import { resolveWorkspacePath, type ToolContext } from "./fs.js";

export interface BashResult {
  output: string;
  exitCode: number;
  executionPolicy?: {
    strength: string;
    backend: string;
    warnings: string[];
    audit: ExecutionPolicyAudit;
  };
}

export type BashOutputStream = "stdout" | "stderr";
export type BashOutputCallback = (chunk: string, stream: BashOutputStream) => void;

const BASE_BASH_ENV_ALLOWLIST = new Set(["PATH", "HOME", "SHELL", "TMPDIR", "LANG", "LC_ALL"]);
let cachedExecutionCapabilities: ExecutionCapabilities | null = null;

export function bashExecutionCapabilities(): ExecutionCapabilities {
  cachedExecutionCapabilities ||= detectExecutionCapabilities();
  return cachedExecutionCapabilities;
}

export function filterEnv(
  source: NodeJS.ProcessEnv = process.env,
  extraAllowlist: string[] = [],
): NodeJS.ProcessEnv {
  const configured = String(source.HICODE_BASH_ENV_ALLOWLIST || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return buildSafeChildEnv({
    source,
    allowlist: [...BASE_BASH_ENV_ALLOWLIST, ...configured, ...extraAllowlist],
  });
}

export function runBash(
  ctx: ToolContext,
  args: { command: string; timeout?: number },
  signal?: AbortSignal,
  onOutput?: BashOutputCallback,
): Promise<BashResult> {
  const timeoutMs = Math.max(100, Math.min(args.timeout ?? 120000, 600000));
  const capabilities = bashExecutionCapabilities();
  const readOnly = ctx.bashMode === "read-only";
  const policyDecision = evaluateExecutionPolicy({
    id: readOnly ? "reviewer-bash" : "runtime-bash",
    surface: readOnly ? "reviewer-bash" : "runtime-bash",
    executable: "bash",
    args: ["-lc", args.command],
    cwd: ctx.cwd,
    allowedRoots: [ctx.cwd],
    filesystem: readOnly ? "read-only" : ctx.sandbox ? "workspace-write" : "unrestricted",
    network: ctx.networkPolicy === "deny" ? "deny" : "allow",
    environment: { source: process.env, allowlist: ctx.envAllowlist },
    limits: { timeoutMs, outputBytes: 100_000 },
    approval: { required: true, granted: true },
    processTree: { required: true },
    enforcementMode: "strict",
  }, capabilities);
  if (!policyDecision.ok) {
    return Promise.resolve({
      output: `execution policy denied: ${policyDecision.error || policyDecision.code}`,
      exitCode: 126,
    });
  }
  const plan = createExecutionLaunchPlan(policyDecision, capabilities);
  const executionPolicy = {
    strength: plan.strength,
    backend: plan.audit.backend,
    warnings: [...plan.warnings],
    audit: plan.audit,
  };
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ output: "interrupted", exitCode: 130, executionPolicy });
      return;
    }

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      detached: plan.detached,
      shell: false,
      windowsHide: true,
    });

    let out = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const cap = plan.outputBytes;

    const onData = (stream: BashOutputStream) => (d: Buffer) => {
      const chunk = d.toString();
      if (out.length < cap) out += chunk;
      onOutput?.(chunk, stream);
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    const killChild = (killSignal: NodeJS.Signals) => {
      if (!child.pid) return;
      terminateExecutionProcessTree({ pid: child.pid, signal: killSignal });
    };

    const terminate = (reason: "timeout" | "abort") => {
      if (settled) return;
      if (reason === "timeout") timedOut = true;
      else aborted = true;
      killChild("SIGTERM");
      forceKillTimer = setTimeout(() => killChild("SIGKILL"), 1200);
    };

    const onAbort = () => terminate("abort");
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      terminate("timeout");
    }, timeoutMs);

    const finish = (result: BashResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, executionPolicy });
    };

    child.on("close", (code) => {
      let text = out.trim();
      if (out.length >= cap) text += "\n… (output truncated)";
      if (aborted) text += "\n… (interrupted)";
      if (timedOut) text += `\n… (killed after ${timeoutMs}ms timeout)`;
      const exitCode = aborted ? 130 : timedOut ? 124 : code ?? 0;
      finish({ output: text || (aborted ? "interrupted" : "(no output)"), exitCode });
    });

    child.on("error", (err) => {
      finish({ output: `failed to spawn: ${err.message}`, exitCode: 127 });
    });
  });
}

/** Search file contents using ripgrep if available, else grep -r. */
export async function grep(
  ctx: ToolContext,
  args: { pattern: string; path?: string; glob?: string; ignore_case?: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const resolved = resolveWorkspacePath(ctx, args.path ?? ".", { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const where = resolved.abs;
  const hasRg = await commandExists("rg");
  let cmd: string;
  if (hasRg) {
    const flags = ["--line-number", "--no-heading", "--color=never", "-S"];
    if (args.ignore_case) flags.push("-i");
    if (args.glob) flags.push(`--glob ${shellQuote(args.glob)}`);
    cmd = `rg ${flags.join(" ")} ${shellQuote(args.pattern)} ${shellQuote(where)}`;
  } else {
    const ic = args.ignore_case ? "-i" : "";
    cmd = `grep -rn ${ic} --exclude-dir=node_modules --exclude-dir=.git ${shellQuote(args.pattern)} ${shellQuote(where)}`;
  }
  const res = await runBash(ctx, { command: cmd, timeout: 30000 }, signal);
  const lines = res.output.split("\n").slice(0, 100);
  if (res.exitCode !== 0 && lines.join("").trim() === "") return "(no matches)";
  return lines.join("\n");
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn("bash", ["-lc", `command -v ${cmd}`], {
      env: buildSafeChildEnv(),
      shell: false,
      windowsHide: true,
    });
    c.on("close", (code) => resolve(code === 0));
    c.on("error", () => resolve(false));
  });
}
