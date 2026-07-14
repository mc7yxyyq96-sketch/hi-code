import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  buildExternalAgentCommandPlan,
  externalAgentVersionArgs,
  redactExternalAgentOutput,
  validateExternalAgentConfig,
} from "../../dist/external-agent-provider.js";
import { normalizeProviderFailure } from "../../dist/provider-control-plane.js";
import { runManagedExecution } from "../../dist/execution-runner.js";

const EXTERNAL_AGENT_VERSION = "1.0.0";

export function createExternalAgentProvider({
  id,
  name,
  adapterType,
  description,
  inputQueue: _inputQueue,
  jobStore,
  worktreeRunner,
  getCwd,
  runArtifactDir,
  authorize,
  usageStore,
  logger,
  executeManaged = runManagedExecution,
}) {
  const activeRuns = new Map();
  const provider = {
    id,
    name,
    version: EXTERNAL_AGENT_VERSION,
    description,
    enabled: true,
    capabilities: [
      "external.cli",
      "workspace.read",
      "workspace.write",
      "job.center",
      "diff.artifacts",
      "provider.cancel",
    ],
    requiredConfig: ["commandPath"],
    configSchema: [
      {
        key: "commandPath",
        label: `${name} executable`,
        type: "path",
        required: true,
        description: "Absolute path to the locally installed executable.",
      },
      {
        key: "argsJson",
        label: "Arguments JSON",
        type: "string",
        required: adapterType === "custom-agent-worker",
        description: adapterType === "custom-agent-worker"
          ? "JSON string array. Include {prompt} exactly where the task prompt belongs."
          : "Optional advanced argument override as a JSON string array.",
      },
      {
        key: "versionArgsJson",
        label: "Version arguments JSON",
        type: "string",
        description: "Optional JSON string array used by the health probe.",
      },
      {
        key: "timeoutMs",
        label: "Timeout (ms)",
        type: "number",
        description: "Bounded between 1 second and 10 minutes.",
      },
      {
        key: "network",
        label: "Allow network",
        type: "boolean",
        description: "Network access remains explicit in execution evidence.",
      },
    ],
    metadata: {
      adapter: adapterType,
      providerKind: "agent",
      implementation: "managed-external-agent",
      runnable: true,
      shell: false,
      defaultExecutionMode: "isolated",
    },
    validateConfig(config) {
      return validateExternalAgentConfig(adapterType, config);
    },
    async run(request) {
      return runExternalAgent({
        provider,
        adapterType,
        request,
        jobStore,
        worktreeRunner,
        getCwd,
        runArtifactDir,
        authorize,
        usageStore,
        logger,
        activeRuns,
        executeManaged,
      });
    },
    async cancel(request) {
      const controller = request.runId ? activeRuns.get(request.runId) : findControllerByJob(activeRuns, request.jobId);
      if (!controller) {
        return failedResult({
          providerId: id,
          runId: request.runId || `provider-cancel-${Date.now().toString(36)}`,
          jobId: request.jobId,
          code: "provider_run_not_active",
          message: "No active external Agent run matches this request.",
        });
      }
      controller.abort();
      return {
        ok: true,
        providerId: id,
        runId: request.runId || controller.runId,
        status: "cancelled",
        jobId: request.jobId || controller.jobId,
        summary: request.reason || "External Agent cancellation requested.",
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
    },
    async healthCheck() {
      return probeExternalAgent({ provider, adapterType, getCwd, executeManaged });
    },
  };
  return provider;
}

export async function probeExternalAgent({ provider, adapterType, getCwd, executeManaged = runManagedExecution }) {
  const validation = validateExternalAgentConfig(adapterType, provider.config || {});
  if (!validation.ok) {
    return {
      status: "not_configured",
      checkedAt: Date.now(),
      message: validation.error?.message || "External Agent configuration is incomplete.",
    };
  }
  const startedAt = Date.now();
  const executable = String(provider.config.commandPath);
  const cwd = path.resolve(getCwd());
  const result = await executeManaged({
    id: `provider-health-${provider.id}-${crypto.randomUUID()}`,
    surface: "provider-health",
    executable,
    args: externalAgentVersionArgs(adapterType, provider.config || {}),
    cwd,
    allowedRoots: [cwd],
    filesystem: "read-only",
    network: "deny",
    limits: { timeoutMs: 5_000, outputBytes: 64 * 1024 },
    approval: { required: false, granted: true },
    processTree: { required: true },
    commandPolicy: { allow: [path.basename(executable)] },
    enforcementMode: "report-only",
  });
  const version = redactExternalAgentOutput(result.stdout || result.stderr, 500).trim().split(/\r?\n/)[0] || undefined;
  return {
    status: result.ok ? "healthy" : "unavailable",
    checkedAt: Date.now(),
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...(version ? { version } : {}),
    message: result.ok ? "Executable health probe passed." : redactExternalAgentOutput(result.error || result.stderr || "Health probe failed.", 500),
    ...(!result.ok ? { failure: normalizeProviderFailure(result.error || result.stderr || "provider unavailable") } : {}),
  };
}

async function runExternalAgent({
  provider,
  adapterType,
  request,
  jobStore,
  worktreeRunner,
  getCwd,
  runArtifactDir,
  authorize,
  usageStore,
  logger,
  activeRuns,
  executeManaged,
}) {
  const startedAt = Date.now();
  const runId = `provider-run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const prompt = normalizePrompt(request.prompt);
  const cwd = resolveProviderCwd(request.cwd, getCwd());
  const plan = buildExternalAgentCommandPlan(adapterType, provider.config || {}, prompt);
  const job = resolveOrCreateJob({ request, jobStore, provider, prompt, cwd, runId });
  let workspace;
  let execution;
  let changes;
  const controller = new AbortController();
  Object.assign(controller, { runId, jobId: job.id });
  activeRuns.set(runId, controller);

  appendEvent(jobStore, job.id, {
    type: "provider.run.started",
    message: `${provider.name} accepted a managed run.`,
    actor: provider.id,
    data: { providerId: provider.id, providerRunId: runId, adapterType },
  });

  try {
    workspace = worktreeRunner.createIsolatedWorkspace({
      sourcePath: cwd,
      mode: normalizeExecutionMode(request.options?.executionMode),
      jobId: job.id,
      providerId: provider.id,
      providerRunId: runId,
      allowDirty: request.options?.allowDirty === true,
      allowDirect: request.options?.executionMode === "direct" && request.options?.allowDirect === true,
      preserveOnFailure: true,
    });
    appendEvent(jobStore, job.id, {
      type: "worktree.created",
      message: `Created ${workspace.mode} workspace for ${provider.name}.`,
      actor: "worktree-runner",
      data: publicWorkspace(workspace),
    });

    if (workspace.mode === "dry-run") {
      const artifact = persistRunArtifact(runArtifactDir, {
        schemaVersion: 1,
        providerId: provider.id,
        providerKind: "agent",
        adapterType,
        providerRunId: runId,
        jobId: job.id,
        status: "simulated",
        simulated: true,
        externalExecutionRequired: true,
        command: { executable: path.basename(plan.executable), argCount: plan.args.length },
        workspace: publicWorkspace(workspace),
        startedAt,
        endedAt: Date.now(),
      });
      const jobArtifact = addArtifact(jobStore, job.id, artifact, provider.id, { simulated: true, providerRunId: runId });
      finishJob(jobStore, job.id, "succeeded");
      recordUsage(usageStore, provider.id, startedAt, true);
      return {
        ok: true,
        providerId: provider.id,
        runId,
        status: "succeeded",
        jobId: job.id,
        summary: "Dry-run plan created; the external Agent was not executed.",
        logs: ["simulated: external Agent execution was not run"],
        artifacts: [publicArtifact(jobArtifact)],
        changedFiles: [],
        startedAt,
        endedAt: Date.now(),
      };
    }

    const permission = await requestAuthorization(authorize, provider.name);
    if (!permission) {
      const denied = Object.assign(new Error("External Agent execution was denied by the user."), { code: "provider_permission_denied" });
      throw denied;
    }
    markJobRunning(jobStore, job.id);
    appendEvent(jobStore, job.id, {
      type: "provider.execution.authorized",
      message: `User authorized ${provider.name} for this managed run.`,
      actor: "user",
      data: { providerId: provider.id, providerRunId: runId, executable: path.basename(plan.executable) },
    });

    execution = await executeManaged({
      id: `provider-${provider.id}-${crypto.randomUUID()}`,
      surface: "external-agent-provider",
      executable: plan.executable,
      args: plan.args,
      cwd: workspace.workspacePath,
      allowedRoots: [workspace.workspacePath],
      filesystem: "workspace-write",
      network: plan.network,
      limits: { timeoutMs: plan.timeoutMs, outputBytes: plan.outputBytes },
      approval: { required: true, granted: true },
      processTree: { required: true },
      commandPolicy: { allow: [path.basename(plan.executable)] },
      enforcementMode: "strict",
    }, { signal: controller.signal });

    const stdout = redactExternalAgentOutput(execution.stdout, 40_000);
    const stderr = redactExternalAgentOutput(execution.stderr, 20_000);
    appendEvent(jobStore, job.id, {
      type: execution.ok ? "provider.execution.completed" : "provider.execution.failed",
      message: execution.ok ? `${provider.name} completed.` : safeFailureMessage(execution),
      actor: provider.id,
      status: execution.ok ? "succeeded" : "failed",
      data: {
        providerId: provider.id,
        providerRunId: runId,
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        cancelled: execution.cancelled,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        executionPolicy: execution.policy,
      },
    });

    changes = worktreeRunner.collectChanges(workspace);
    appendEvent(jobStore, job.id, {
      type: changes.ok ? "worktree.patch.collected" : "worktree.patch.failed",
      message: changes.ok ? changes.summary : changes.error || "Patch collection failed.",
      actor: "worktree-runner",
      status: changes.ok ? "succeeded" : "failed",
      data: { workspaceId: workspace.id, changedFiles: changes.changedFiles, riskNotes: changes.riskNotes },
    });
    for (const artifact of changes.artifacts || []) addArtifact(jobStore, job.id, artifact, provider.id, { providerRunId: runId });

    const runArtifact = persistRunArtifact(runArtifactDir, {
      schemaVersion: 1,
      providerId: provider.id,
      providerKind: "agent",
      adapterType,
      providerRunId: runId,
      jobId: job.id,
      status: execution.ok && changes.ok ? "completed" : execution.cancelled ? "cancelled" : "failed",
      simulated: false,
      command: { executable: path.basename(plan.executable), argCount: plan.args.length },
      workspace: publicWorkspace(workspace),
      execution: {
        ok: execution.ok,
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        cancelled: execution.cancelled,
        policy: execution.policy,
        stdout,
        stderr,
      },
      changes: {
        ok: changes.ok,
        changedFiles: changes.changedFiles,
        summary: changes.summary,
        riskNotes: changes.riskNotes,
      },
      startedAt,
      endedAt: Date.now(),
    });
    const jobArtifact = addArtifact(jobStore, job.id, runArtifact, provider.id, { providerRunId: runId, simulated: false });

    if (!execution.ok || !changes.ok) {
      const failure = normalizeProviderFailure(execution.cancelled ? "provider cancelled" : execution.error || execution.stderr || changes.error || "provider failed");
      failJob(jobStore, job.id, failure.message, provider.id, runId);
      worktreeRunner.preserveWorkspaceOnFailure(workspace, failure.message);
      recordUsage(usageStore, provider.id, startedAt, false, failure.category);
      return {
        ok: false,
        providerId: provider.id,
        runId,
        status: execution.cancelled ? "cancelled" : "failed",
        jobId: job.id,
        summary: failure.message,
        logs: [stdout, stderr].filter(Boolean),
        artifacts: [publicArtifact(jobArtifact)],
        changedFiles: changes.changedFiles,
        startedAt,
        endedAt: Date.now(),
        error: { code: failure.code, message: failure.message, retriable: failure.retriable },
      };
    }

    finishJob(jobStore, job.id, "succeeded");
    if (request.options?.preserveWorkspace !== true) {
      const cleanup = worktreeRunner.cleanupWorkspace(workspace);
      appendEvent(jobStore, job.id, {
        type: cleanup.ok ? "worktree.cleaned" : "worktree.cleanup.failed",
        message: cleanup.ok ? `Cleaned workspace ${workspace.id}.` : cleanup.error || "Cleanup failed.",
        actor: "worktree-runner",
        status: cleanup.ok ? "succeeded" : "failed",
        data: { workspaceId: workspace.id, removed: cleanup.removed },
      });
    }
    recordUsage(usageStore, provider.id, startedAt, true);
    return {
      ok: true,
      providerId: provider.id,
      runId,
      status: "succeeded",
      jobId: job.id,
      summary: outputSummary(stdout) || `${provider.name} completed successfully.`,
      logs: [stdout, stderr].filter(Boolean),
      artifacts: [publicArtifact(jobArtifact)],
      changedFiles: changes.changedFiles,
      startedAt,
      endedAt: Date.now(),
    };
  } catch (error) {
    const failure = normalizeProviderFailure(error);
    failJob(jobStore, job.id, failure.message, provider.id, runId);
    if (workspace && workspace.mode !== "direct" && workspace.mode !== "dry-run") {
      try { worktreeRunner.preserveWorkspaceOnFailure(workspace, failure.message); } catch {}
    }
    recordUsage(usageStore, provider.id, startedAt, false, failure.category);
    if (typeof logger === "function") logger("provider:error", {
      providerId: provider.id,
      providerRunId: runId,
      failure: { code: failure.code, category: failure.category, message: failure.message },
    });
    return failedResult({
      providerId: provider.id,
      runId,
      jobId: job.id,
      code: failure.code,
      message: failure.message,
      retriable: failure.retriable,
      startedAt,
    });
  } finally {
    activeRuns.delete(runId);
  }
}

function resolveOrCreateJob({ request, jobStore, provider, prompt, cwd, runId }) {
  if (request.jobId) {
    const existing = jobStore.getJob(request.jobId);
    if (!existing) throw new Error("job not found");
    return existing;
  }
  return jobStore.createJob({
    title: summarize(prompt) || `${provider.name} run`,
    source: "provider",
    trigger: "provider:run",
    actor: request.actor || "user",
    executor: provider.id,
    cwd,
    tasks: [{
      title: `Run ${provider.name}`,
      executor: provider.id,
      steps: [
        { title: "Create isolated workspace", command: "worktree:create" },
        { title: "Execute external Agent", command: `provider:run ${provider.id}` },
        { title: "Collect patch and evidence", command: "worktree:collectChanges" },
      ],
    }],
    metadata: { providerId: provider.id, providerKind: "agent", providerRunId: runId },
  });
}

function persistRunArtifact(root, payload) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = `${payload.providerRunId}.json`;
  const file = path.join(root, name);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { type: "provider-run", path: file, name, size: fs.statSync(file).size };
}

function addArtifact(jobStore, jobId, artifact, providerId, metadata) {
  return jobStore.addArtifact(jobId, {
    type: artifact.type,
    path: artifact.path,
    name: artifact.name,
    size: artifact.size,
    mimeType: artifact.name?.endsWith(".json") ? "application/json" : "text/x-diff",
    producedBy: { executor: providerId },
    metadata,
  });
}

function appendEvent(jobStore, jobId, event) {
  try { jobStore.appendJobEvent(jobId, event); } catch {}
}

function markJobRunning(jobStore, jobId) {
  try {
    if (jobStore.getJob(jobId)?.status === "queued") jobStore.updateJob(jobId, { status: "running" });
  } catch {}
}

function finishJob(jobStore, jobId, status) {
  try {
    const current = jobStore.getJob(jobId);
    if (current?.status === "queued") jobStore.updateJob(jobId, { status: "running" });
    const next = jobStore.getJob(jobId);
    if (next && !["failed", "cancelled", "succeeded"].includes(next.status)) jobStore.updateJob(jobId, { status });
  } catch {}
}

function failJob(jobStore, jobId, message, providerId, runId) {
  appendEvent(jobStore, jobId, {
    type: "provider.run.failed",
    message,
    actor: providerId,
    status: "failed",
    data: { providerId, providerRunId: runId },
  });
  try {
    const current = jobStore.getJob(jobId);
    if (current?.status === "queued") jobStore.updateJob(jobId, { status: "running" });
    const next = jobStore.getJob(jobId);
    if (next && !["failed", "cancelled", "succeeded"].includes(next.status)) jobStore.updateJob(jobId, { status: "failed", error: message });
  } catch {}
  try {
    jobStore.addGateResult(jobId, {
      gate: "provider-run",
      status: "failed",
      message,
      metadata: { providerId, providerRunId: runId },
    });
  } catch {}
}

function recordUsage(usageStore, providerId, startedAt, success, failureCategory) {
  try {
    usageStore?.record({
      providerId,
      providerKind: "agent",
      success,
      startedAt,
      endedAt: Date.now(),
      ...(failureCategory ? { failureCategory } : {}),
    });
  } catch {}
}

async function requestAuthorization(authorize, providerName) {
  if (typeof authorize !== "function") return false;
  const result = await authorize({
    tool: "external_agent_provider",
    label: `在隔离工作区运行 ${providerName}`,
    mutating: true,
  });
  return result === true || result === "y" || result === "a" || result === "allow" || result === "allow_once";
}

function resolveProviderCwd(requested, fallback) {
  const root = path.resolve(String(fallback || process.cwd()));
  if (!requested) return root;
  const resolved = path.resolve(String(requested));
  const relative = path.relative(root, resolved);
  if (relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))) return resolved;
  throw new Error("provider cwd escapes current workspace");
}

function normalizePrompt(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("prompt is required");
  if (value.includes("\0") || Buffer.byteLength(value) > 512 * 1024) throw new Error("prompt is invalid or too large");
  return value.trim();
}

function normalizeExecutionMode(value) {
  return ["auto", "worktree", "copy", "dry-run", "direct"].includes(value) ? value : "auto";
}

function findControllerByJob(activeRuns, jobId) {
  if (!jobId) return null;
  for (const controller of activeRuns.values()) if (controller.jobId === jobId) return controller;
  return null;
}

function publicWorkspace(workspace) {
  return {
    id: workspace.id,
    mode: workspace.mode,
    workspacePath: workspace.workspacePath,
    sourcePath: workspace.sourcePath,
    dirtySource: workspace.dirtySource === true,
    riskNotes: workspace.riskNotes,
  };
}

function publicArtifact(artifact) {
  return artifact ? {
    id: artifact.id,
    type: artifact.type,
    path: artifact.path,
    name: artifact.name,
    size: artifact.size,
  } : null;
}

function failedResult({ providerId, runId, jobId, code, message, retriable = false, startedAt = Date.now() }) {
  return {
    ok: false,
    providerId,
    runId,
    status: code === "provider_cancelled" ? "cancelled" : "failed",
    jobId,
    summary: message,
    logs: [],
    startedAt,
    endedAt: Date.now(),
    error: { code, message, retriable },
  };
}

function safeFailureMessage(execution) {
  return redactExternalAgentOutput(execution.error || execution.stderr || `External Agent exited with ${execution.exitCode}.`, 1_000);
}

function outputSummary(output) {
  const line = String(output || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
  return line.length > 500 ? `${line.slice(0, 497)}...` : line;
}

function summarize(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
