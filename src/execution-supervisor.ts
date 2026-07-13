import { spawn } from "node:child_process";

import { terminateExecutionProcessTree } from "./execution-policy.js";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

interface SupervisorRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputBytes: number;
  detached: boolean;
  platform: NodeJS.Platform | string;
}

async function main(): Promise<void> {
  const input = await readInput();
  const request = validate(JSON.parse(input) as SupervisorRequest);
  const result = await execute(request);
  process.stdout.write(JSON.stringify(result));
}

function execute(request: SupervisorRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: request.detached,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, error?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        endedAt: Date.now(),
        ...(error ? { error } : {}),
      });
    };
    child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, request.outputBytes); });
    child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk, request.outputBytes); });
    child.on("error", (error) => finish(127, null, error.message));
    child.on("close", (exitCode, signal) => finish(exitCode, signal));
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: request.platform, signal: "SIGTERM" });
      forceTimer = setTimeout(() => {
        if (child.pid) terminateExecutionProcessTree({ pid: child.pid, platform: request.platform, signal: "SIGKILL" });
      }, 750);
    }, request.timeoutMs);
  });
}

function validate(value: SupervisorRequest): SupervisorRequest {
  if (!value || typeof value !== "object") throw new Error("supervisor request is required");
  if (typeof value.command !== "string" || !value.command || value.command.includes("\0")) throw new Error("invalid supervisor command");
  if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string" || item.includes("\0"))) throw new Error("invalid supervisor arguments");
  if (typeof value.cwd !== "string" || !value.cwd || value.cwd.includes("\0")) throw new Error("invalid supervisor cwd");
  if (!value.env || typeof value.env !== "object" || Array.isArray(value.env)) throw new Error("invalid supervisor environment");
  if (!Number.isFinite(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 600_000) throw new Error("invalid supervisor timeout");
  if (!Number.isFinite(value.outputBytes) || value.outputBytes < 1_024 || value.outputBytes > 16 * 1024 * 1024) throw new Error("invalid supervisor output bound");
  return value;
}

function appendBounded(current: string, chunk: Buffer | string, limit: number): string {
  const next = Buffer.from(current + String(chunk));
  return (next.length <= limit ? next : next.subarray(next.length - limit)).toString("utf8");
}

function readInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error("supervisor input exceeds limit"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
