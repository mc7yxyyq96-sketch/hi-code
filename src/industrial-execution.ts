import path from "node:path";

import { runManagedExecutionSync, type ManagedExecutionPolicyResult } from "./execution-runner.js";

export interface IndustrialExecutionRequest {
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  extraEnvironment?: Record<string, string | undefined>;
  timeoutMs?: number;
  outputBytes?: number;
  userApproved?: boolean;
  mutating?: boolean;
  network?: "allow" | "deny";
}

export interface IndustrialExecutionResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  timedOut: boolean;
  executionPolicy: ManagedExecutionPolicyResult;
}

export function runIndustrialCommand(request: IndustrialExecutionRequest): IndustrialExecutionResult {
  const cwd = path.resolve(request.cwd);
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const source = request.environment || process.env;
  const result = runManagedExecutionSync({
    id: `industrial:${safeId(request.id)}`,
    surface: "industrial-adapter",
    executable: request.executable,
    args: request.args,
    cwd,
    allowedRoots: [workspaceRoot],
    filesystem: request.mutating === false ? "read-only" : "workspace-write",
    network: request.network || "deny",
    environment: { source, allowlist: Object.keys(source), extraEnv: request.extraEnvironment },
    limits: {
      timeoutMs: Math.min(Math.max(Number(request.timeoutMs || 120_000), 100), 600_000),
      outputBytes: Math.min(Math.max(Number(request.outputBytes || 2 * 1024 * 1024), 1_024), 16 * 1024 * 1024),
    },
    approval: {
      required: request.mutating !== false,
      granted: request.mutating === false || request.userApproved === true,
    },
    processTree: { required: true },
    enforcementMode: "report-only",
  });
  return {
    status: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    executionPolicy: result.policy,
    ...(result.error ? { error: new Error(result.error) } : {}),
  };
}

function safeId(value: string): string {
  return String(value || "command").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || "command";
}
