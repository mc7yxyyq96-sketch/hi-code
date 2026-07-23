import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspacePath, type ToolContext } from "./fs.js";

export interface BashResult {
  output: string;
  exitCode: number;
}

export type BashOutputStream = "stdout" | "stderr";
export type BashOutputCallback = (chunk: string, stream: BashOutputStream) => void;

let sandboxExecPath: string | null | undefined; // undefined = not probed yet

/** Whether macOS sandbox-exec is available (probed once). */
function sandboxAvailable(): boolean {
  if (sandboxExecPath === undefined) {
    if (process.platform !== "darwin") {
      sandboxExecPath = null;
    } else {
      const r = spawnSync("/bin/sh", ["-c", "command -v sandbox-exec"], { encoding: "utf8" });
      sandboxExecPath = r.status === 0 ? "sandbox-exec" : null;
    }
  }
  return sandboxExecPath !== null;
}

/**
 * Build the spawn argv. With sandbox enabled on macOS, wrap bash in
 * sandbox-exec with an SBPL profile: reads allowed everywhere, but writes
 * confined to the workspace, temp dirs, and the usual devices.
 */
function buildInvocation(ctx: ToolContext, command: string): { cmd: string; argv: string[]; cleanup?: () => void } {
  const readOnly = ctx.bashMode === "read-only";
  if (readOnly && !sandboxAvailable()) {
    return {
      cmd: "bash",
      argv: ["-lc", "echo 'read-only bash is unavailable because sandbox-exec is not available' >&2; exit 126"],
    };
  }
  if (!readOnly && (!ctx.sandbox || !sandboxAvailable())) {
    return { cmd: "bash", argv: ["-lc", command] };
  }
  const profile = readOnly ? readOnlyProfile() : workspaceWriteProfile(ctx.cwd);
  const profilePath = path.join(os.tmpdir(), `vibe-sandbox-${process.pid}-${Date.now()}.sb`);
  fs.writeFileSync(profilePath, profile);
  return {
    cmd: "sandbox-exec",
    argv: ["-f", profilePath, "bash", "-lc", command],
    cleanup: () => {
      try {
        fs.unlinkSync(profilePath);
      } catch {
        /* ignore */
      }
    },
  };
}

function readOnlyProfile(): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))`,
  ].join("\n");
}

function workspaceWriteProfile(cwd: string): string {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${q(cwd)}) (subpath "/tmp") (subpath "/private/tmp") (subpath ${q(os.tmpdir())}) (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (subpath "/private/var/folders"))`,
  ].join("\n");
}

function q(p: string): string {
  return '"' + p.replace(/"/g, '\\"') + '"';
}

const BASE_BASH_ENV_ALLOWLIST = new Set(["PATH", "HOME", "SHELL", "TMPDIR", "LANG", "LC_ALL"]);

export function filterEnv(
  source: NodeJS.ProcessEnv = process.env,
  extraAllowlist: string[] = [],
): NodeJS.ProcessEnv {
  const configured = String(source.HICODE_BASH_ENV_ALLOWLIST || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const allowed = new Set([...BASE_BASH_ENV_ALLOWLIST, ...configured, ...extraAllowlist]);
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function runBash(
  ctx: ToolContext,
  args: { command: string; timeout?: number },
  signal?: AbortSignal,
  onOutput?: BashOutputCallback,
): Promise<BashResult> {
  const timeoutMs = Math.min(args.timeout ?? 120000, 600000);
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ output: "interrupted", exitCode: 130 });
      return;
    }

    const inv = buildInvocation(ctx, args.command);
    const detached = process.platform !== "win32";
    const child = spawn(inv.cmd, inv.argv, {
      cwd: ctx.cwd,
      env: filterEnv(process.env, ctx.envAllowlist),
      detached,
    });

    let out = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const cap = 100_000; // cap captured output to keep context lean

    const onData = (stream: BashOutputStream) => (d: Buffer) => {
      const chunk = d.toString();
      if (out.length < cap) out += chunk;
      onOutput?.(chunk, stream);
    };
    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    const killChild = (killSignal: NodeJS.Signals) => {
      try {
        if (detached && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch {
        try {
          child.kill(killSignal);
        } catch {
          /* process already exited */
        }
      }
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
      inv.cleanup?.();
      resolve(result);
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
  args: { pattern: string; path?: string; glob?: string; ignore_case?: boolean; limit?: number },
  signal?: AbortSignal,
): Promise<string> {
  const resolved = resolveWorkspacePath(ctx, args.path ?? ".", { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const where = resolved.abs;
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 100)));
  const hasRg = await commandExists("rg");
  let cmd: string;
  if (hasRg) {
    const flags = ["--line-number", "--no-heading", "--color=never", "-S", `-m ${limit}`];
    if (args.ignore_case) flags.push("-i");
    if (args.glob) flags.push(`--glob ${shellQuote(args.glob)}`);
    cmd = `rg ${flags.join(" ")} ${shellQuote(args.pattern)} ${shellQuote(where)}`;
  } else {
    const ic = args.ignore_case ? "-i" : "";
    cmd = `grep -rn ${ic} --exclude-dir=node_modules --exclude-dir=.git ${shellQuote(args.pattern)} ${shellQuote(where)}`;
  }
  const res = await runBash(ctx, { command: cmd, timeout: 30000 }, signal);
  const lines = res.output.split("\n").slice(0, limit);
  if (res.exitCode !== 0 && lines.join("").trim() === "") return "(no matches)";
  return lines.join("\n");
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = spawn("bash", ["-lc", `command -v ${cmd}`]);
    c.on("close", (code) => resolve(code === 0));
    c.on("error", () => resolve(false));
  });
}
