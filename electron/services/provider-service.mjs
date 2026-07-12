import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  AgentProviderRegistry,
  createPlaceholderProvider,
} from "../../dist/agent-provider.js";
import {
  isCredentialPlaceholder,
  isSecretReferenceRecord,
  isSensitiveEnvName,
  providerSecretRef,
  validateSecretRef,
} from "../../dist/secret-references.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createProviderService({
  inputQueue,
  jobStore,
  diffService = null,
  worktreeRunner = null,
  getCwd,
  configPath,
  runArtifactDir,
  secretStore,
  interruptRuntime = null,
  logger = null,
}) {
  if (!inputQueue || typeof inputQueue.enqueue !== "function") throw new Error("provider-service requires inputQueue");
  if (!jobStore) throw new Error("provider-service requires jobStore");
  if (typeof getCwd !== "function") throw new Error("provider-service requires getCwd");
  if (!configPath) throw new Error("provider-service requires configPath");
  if (!runArtifactDir) throw new Error("provider-service requires runArtifactDir");
  if (!secretStore?.persistSecretWrites) throw new Error("provider-service requires secretStore");

  const registry = new AgentProviderRegistry();
  registry.registerProvider(createInternalProvider({
    inputQueue,
    jobStore,
    diffService,
    worktreeRunner,
    getCwd,
    runArtifactDir,
    interruptRuntime,
    logger,
  }));
  registry.registerProvider(createPlaceholderProvider({
    id: "codex-cli",
    name: "Codex CLI",
    description: "Reserved adapter for future Codex CLI collaboration. Sprint 3A does not execute this provider.",
    capabilities: ["external.cli", "workspace.read", "workspace.write", "job.center"],
    requiredConfig: ["commandPath"],
    configSchema: [
      { key: "commandPath", label: "Codex CLI path", type: "path", required: true, description: "Absolute path to the Codex CLI executable." },
    ],
    metadata: { adapter: "codex-cli", availability: "not_configured" },
  }));
  registry.registerProvider(createPlaceholderProvider({
    id: "claude-code",
    name: "Claude Code",
    description: "Reserved adapter for future Claude Code collaboration. Sprint 3A does not execute this provider.",
    capabilities: ["external.cli", "workspace.read", "workspace.write", "job.center"],
    requiredConfig: ["commandPath"],
    configSchema: [
      { key: "commandPath", label: "Claude Code path", type: "path", required: true, description: "Absolute path to the Claude Code executable." },
    ],
    metadata: { adapter: "claude-code", availability: "not_configured" },
  }));
  registry.registerProvider(createPlaceholderProvider({
    id: "local-model",
    name: "Local Model",
    description: "Reserved adapter for a local model runtime. Sprint 3A only validates configuration.",
    capabilities: ["local.model", "workspace.read", "job.center"],
    requiredConfig: ["endpoint"],
    configSchema: [
      { key: "endpoint", label: "Endpoint", type: "string", required: true, description: "Local model endpoint, for example http://127.0.0.1:11434." },
      { key: "apiKey", label: "API Key", type: "secret", sensitive: true, description: "Optional local gateway token." },
    ],
    metadata: { adapter: "local-model", availability: "not_configured" },
  }));

  registry.applyState(migrateProviderState(configPath, registry, secretStore));

  return {
    listProviders() {
      return { ok: true, providers: registry.listProviders() };
    },

    getProvider(providerId) {
      const provider = registry.getProvider(ipcString(providerId));
      return provider ? { ok: true, provider } : { ok: false, error: "provider not found" };
    },

    configureProvider(providerId, payload = {}) {
      const id = ipcString(providerId);
      if (!id) return { ok: false, error: "providerId is required" };
      const input = ipcObject(payload);
      let secretTransaction = null;
      const previousState = registry.exportState();
      try {
        if (Object.prototype.hasOwnProperty.call(input, "config")) {
          const prepared = prepareProviderConfig(id, ipcObject(input.config), registry.getProviderImpl(id));
          secretTransaction = secretStore.persistSecretWrites(prepared.writes);
          registry.configureProvider(id, prepared.config);
        }
        if (input.enabled === true) registry.enableProvider(id);
        if (input.enabled === false) registry.disableProvider(id);
        persistProviderState(configPath, registry.exportState());
        secretTransaction?.commit();
        return {
          ok: true,
          provider: registry.getProvider(id),
          validation: registry.validateProviderConfig(id),
        };
      } catch (error) {
        secretTransaction?.rollback();
        registry.applyState(previousState);
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    async runProvider(providerId, payload = {}) {
      const id = ipcString(providerId);
      const input = ipcObject(payload);
      const prompt = ipcString(input.prompt).trim();
      if (!id) return { ok: false, error: "providerId is required" };
      if (!prompt) return { ok: false, error: "prompt is required" };
      try {
        const result = await registry.runProvider(id, {
          prompt,
          cwd: ipcString(input.cwd, undefined),
          jobId: ipcString(input.jobId, undefined),
          actor: ipcString(input.actor, "user"),
          messages: Array.isArray(input.messages) ? input.messages : undefined,
          metadata: ipcObject(input.metadata),
          options: ipcObject(input.options),
        });
        return result.ok ? { ok: true, result } : { ok: false, result, error: result.error?.message || result.summary };
      } catch (error) {
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    async cancelProvider(providerId, payload = {}) {
      const id = ipcString(providerId);
      const input = ipcObject(payload);
      if (!id) return { ok: false, error: "providerId is required" };
      try {
        const result = await registry.cancelProvider(id, {
          runId: ipcString(input.runId, undefined),
          jobId: ipcString(input.jobId, undefined),
          actor: ipcString(input.actor, "user"),
          reason: ipcString(input.reason, "cancelled from provider"),
          metadata: ipcObject(input.metadata),
        });
        return result.ok ? { ok: true, result } : { ok: false, result, error: result.error?.message || result.summary };
      } catch (error) {
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    _registry: registry,
  };
}

export function registerProviderIpc({ register, provider }) {
  if (!register) throw new Error("registerProviderIpc requires register");
  if (!provider) throw new Error("registerProviderIpc requires provider service");

  register.handle("provider:list", () => provider.listProviders());
  register.handle("provider:get", (_event, providerId) => provider.getProvider(providerId));
  register.handle("provider:configure", (_event, providerId, payload) => provider.configureProvider(providerId, payload));
  register.handle("provider:run", (_event, providerId, payload) => provider.runProvider(providerId, payload));
  register.handle("provider:cancel", (_event, providerId, payload) => provider.cancelProvider(providerId, payload));
}

function createInternalProvider({ inputQueue, jobStore, diffService, worktreeRunner, getCwd, runArtifactDir, interruptRuntime, logger }) {
  return {
    id: "hicode-internal",
    name: "Hi Code Internal",
    version: "0.1.0",
    description: "Runs prompts through the built-in Hi Code runtime queue and records all work in Job Center.",
    enabled: true,
    capabilities: ["workspace.read", "workspace.write", "runtime.queue", "job.center", "diff.artifacts", "tool.calls"],
    metadata: { adapter: "internal-runtime", availability: "ready" },

    run(request) {
      return runInternalProvider({ request, inputQueue, jobStore, diffService, worktreeRunner, getCwd, runArtifactDir, logger });
    },

    cancel(request) {
      return cancelInternalProvider({ request, jobStore, interruptRuntime });
    },
  };
}

function runInternalProvider({ request, inputQueue, jobStore, diffService, worktreeRunner, getCwd, runArtifactDir, logger }) {
  const startedAt = Date.now();
  const runId = `provider-run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const prompt = normalizePrompt(request.prompt);
  const actor = normalizeText(request.actor) || "user";
  const logs = [];
  let job = null;
  let isolatedWorkspace = null;

  try {
    const cwd = resolveProviderCwd(request.cwd, getCwd());
    job = resolveOrCreateProviderJob({ request, jobStore, prompt, actor, cwd, runId });
    appendProviderEvent(jobStore, job.id, {
      type: "provider.run.started",
      message: "Provider hicode-internal accepted run",
      actor: "hicode-internal",
      data: { providerId: "hicode-internal", providerRunId: runId, promptPreview: summarize(prompt) },
      now: startedAt,
    });

    if (!worktreeRunner) throw new Error("worktree runner is required for provider execution");
    const executionMode = normalizeExecutionMode(request.options?.executionMode);
    isolatedWorkspace = worktreeRunner.createIsolatedWorkspace({
      sourcePath: cwd,
      mode: executionMode,
      jobId: job.id,
      providerId: "hicode-internal",
      providerRunId: runId,
      allowDirty: request.options?.allowDirty === true,
      allowDirect: executionMode === "direct" && request.options?.allowDirect === true,
      preserveOnFailure: request.options?.preserveWorkspace === true,
    });
    appendProviderEvent(jobStore, job.id, {
      type: "worktree.created",
      message: `Created ${isolatedWorkspace.mode} workspace`,
      actor: "worktree-runner",
      data: {
        workspaceId: isolatedWorkspace.id,
        mode: isolatedWorkspace.mode,
        sourcePath: isolatedWorkspace.sourcePath,
        workspacePath: isolatedWorkspace.workspacePath,
        riskNotes: isolatedWorkspace.riskNotes,
      },
    });

    if (isolatedWorkspace.mode === "dry-run") {
      logs.push("Dry-run mode planned the provider run without executing runtime.");
      const artifact = writeProviderRunArtifact(runArtifactDir, {
        providerId: "hicode-internal",
        providerRunId: runId,
        jobId: job.id,
        promptPreview: summarize(prompt),
        cwd,
        executionMode: isolatedWorkspace.mode,
        workspace: isolatedWorkspace,
        queuedAt: Date.now(),
        changedFiles: [],
        logs,
      });
      const jobArtifact = jobStore.addArtifact(job.id, {
        type: "provider-run",
        path: artifact.path,
        name: artifact.name,
        mimeType: "application/json",
        size: artifact.size,
        producedBy: { executor: "hicode-internal" },
        metadata: { providerId: "hicode-internal", providerRunId: runId, workspaceId: isolatedWorkspace.id },
      });
      appendProviderEvent(jobStore, job.id, {
        type: "provider.run.dry_run",
        message: "Dry-run provider plan created",
        actor: "hicode-internal",
        data: { providerId: "hicode-internal", providerRunId: runId, workspaceId: isolatedWorkspace.id },
      });
      return {
        ok: true,
        providerId: "hicode-internal",
        runId,
        status: "succeeded",
        jobId: job.id,
        summary: "Dry-run provider plan created.",
        logs,
        changedFiles: [],
        artifacts: [{ id: jobArtifact.id, type: jobArtifact.type, path: jobArtifact.path, name: jobArtifact.name, size: jobArtifact.size }],
        startedAt,
        endedAt: Date.now(),
      };
    }

    const runtimeJob = inputQueue.enqueue(prompt, {
      jobCenterId: job.id,
      source: "provider:hicode-internal",
      providerId: "hicode-internal",
      providerRunId: runId,
      executionCwd: isolatedWorkspace.workspacePath,
      isolatedWorkspace,
      isolatedWorkspaceMode: isolatedWorkspace.mode,
      cleanupIsolatedWorkspace: request.options?.preserveWorkspace !== true,
    });
    logs.push(`Queued prompt in Runtime Queue as ${runtimeJob.id}.`);
    appendProviderEvent(jobStore, job.id, {
      type: "provider.run.queued",
      message: `Queued runtime job ${runtimeJob.id}`,
      actor: "hicode-internal",
      data: { runtimeJobId: runtimeJob.id, providerId: "hicode-internal", providerRunId: runId },
    });

    const changedFiles = listChangedFiles(diffService);
    const artifact = writeProviderRunArtifact(runArtifactDir, {
      providerId: "hicode-internal",
      providerRunId: runId,
      runtimeJobId: runtimeJob.id,
      jobId: job.id,
      promptPreview: summarize(prompt),
      cwd,
      executionCwd: isolatedWorkspace.workspacePath,
      workspace: isolatedWorkspace,
      queuedAt: Date.now(),
      changedFiles,
      logs,
    });
    const jobArtifact = jobStore.addArtifact(job.id, {
      type: "provider-run",
      path: artifact.path,
      name: artifact.name,
      mimeType: "application/json",
      size: artifact.size,
      producedBy: { executor: "hicode-internal" },
      metadata: { providerId: "hicode-internal", providerRunId: runId, runtimeJobId: runtimeJob.id, workspaceId: isolatedWorkspace.id },
    });

    return {
      ok: true,
      providerId: "hicode-internal",
      runId,
      status: "queued",
      jobId: job.id,
      summary: "Queued prompt in Hi Code internal runtime.",
      logs,
      changedFiles,
      artifacts: [{ id: jobArtifact.id, type: jobArtifact.type, path: jobArtifact.path, name: jobArtifact.name, size: jobArtifact.size }],
      startedAt,
      endedAt: Date.now(),
    };
  } catch (error) {
    const message = providerErrorMessage(error);
    logs.push(`Provider run failed: ${message}`);
    if (job?.id) {
      markProviderJobFailed(jobStore, job.id, message, runId);
    }
    if (typeof logger === "function") logger("provider:error", { providerId: "hicode-internal", runId, error: message });
    return {
      ok: false,
      providerId: "hicode-internal",
      runId,
      status: "failed",
      jobId: job?.id,
      summary: "Provider run failed.",
      logs,
      startedAt,
      endedAt: Date.now(),
      error: { code: "provider_run_failed", message },
    };
  }
}

function cancelInternalProvider({ request, jobStore, interruptRuntime }) {
  const startedAt = Date.now();
  const runId = normalizeText(request.runId) || `provider-cancel-${Date.now().toString(36)}`;
  const jobId = normalizeText(request.jobId);
  const actor = normalizeText(request.actor) || "user";
  const reason = normalizeText(request.reason) || "cancelled from provider";
  if (!jobId) {
    return {
      ok: false,
      providerId: "hicode-internal",
      runId,
      status: "failed",
      summary: "Job id is required to cancel an internal provider run.",
      startedAt,
      endedAt: Date.now(),
      error: { code: "provider_cancel_missing_job", message: "jobId is required" },
    };
  }
  try {
    const job = jobStore.cancelJob(jobId, reason, actor);
    appendProviderEvent(jobStore, job.id, {
      type: "provider.run.cancelled",
      message: reason,
      actor: "hicode-internal",
      data: { providerId: "hicode-internal", providerRunId: runId },
    });
    if (typeof interruptRuntime === "function" && request.metadata?.interruptActive === true) interruptRuntime();
    return {
      ok: true,
      providerId: "hicode-internal",
      runId,
      status: "cancelled",
      jobId: job.id,
      summary: reason,
      startedAt,
      endedAt: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      providerId: "hicode-internal",
      runId,
      status: "failed",
      jobId,
      summary: "Provider cancel failed.",
      startedAt,
      endedAt: Date.now(),
      error: { code: "provider_cancel_failed", message: providerErrorMessage(error) },
    };
  }
}

function resolveOrCreateProviderJob({ request, jobStore, prompt, actor, cwd, runId }) {
  const existingId = normalizeText(request.jobId);
  if (existingId) {
    const existing = jobStore.getJob(existingId);
    if (!existing) throw new Error("job not found");
    appendProviderEvent(jobStore, existing.id, {
      type: "provider.run.attached",
      message: "Provider run attached to existing job",
      actor: "hicode-internal",
      data: { providerId: "hicode-internal", providerRunId: runId },
    });
    return existing;
  }
  return jobStore.createJob({
    title: summarize(prompt) || "Provider run",
    source: "provider",
    trigger: "provider:run",
    actor,
    executor: "hicode-internal",
    cwd,
    tasks: [{
      title: "Run provider prompt",
      executor: "hicode-internal",
      steps: [{ title: "Queue prompt in Hi Code runtime", command: "provider:run hicode-internal" }],
    }],
    metadata: {
      providerId: "hicode-internal",
      providerRunId: runId,
      promptPreview: summarize(prompt),
    },
  });
}

function markProviderJobFailed(jobStore, jobId, message, runId) {
  appendProviderEvent(jobStore, jobId, {
    type: "provider.run.failed",
    message,
    actor: "hicode-internal",
    status: "failed",
    data: { providerId: "hicode-internal", providerRunId: runId },
  });
  try {
    const current = jobStore.getJob(jobId);
    if (current?.status === "queued") jobStore.updateJob(jobId, { status: "running" });
    const next = jobStore.getJob(jobId);
    if (next && !["failed", "cancelled", "succeeded"].includes(next.status)) {
      jobStore.updateJob(jobId, { status: "failed", error: message });
    }
  } catch {
    /* event + gate are the minimum durable failure record */
  }
  try {
    jobStore.addGateResult(jobId, {
      gate: "provider-run",
      status: "failed",
      message,
      metadata: { providerId: "hicode-internal", providerRunId: runId },
    });
  } catch {
    /* gate persistence should not hide the provider failure */
  }
}

function appendProviderEvent(jobStore, jobId, input) {
  try {
    jobStore.appendJobEvent(jobId, input);
  } catch {
    /* best-effort event logging; caller still returns the operational error */
  }
}

function writeProviderRunArtifact(runArtifactDir, payload) {
  fs.mkdirSync(runArtifactDir, { recursive: true, mode: 0o700 });
  const name = `${payload.providerRunId}.json`;
  const file = path.join(runArtifactDir, name);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { path: file, name, size: fs.statSync(file).size };
}

function listChangedFiles(diffService) {
  if (!diffService || typeof diffService.list !== "function") return [];
  try {
    return diffService.list()
      .map((diff) => normalizeText(diff.path || diff.file || diff.name))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveProviderCwd(requestedCwd, fallbackCwd) {
  const root = path.resolve(normalizeText(fallbackCwd) || process.cwd());
  const requested = normalizeText(requestedCwd);
  if (!requested) return root;
  const resolved = path.resolve(requested);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))) return resolved;
  throw new Error("provider cwd escapes current workspace");
}

function readProviderState(file) {
  try {
    if (!fs.existsSync(file)) return { schemaVersion: 1, providers: {} };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { schemaVersion: 1, providers: {} };
  } catch {
    return { schemaVersion: 1, providers: {} };
  }
}

function migrateProviderState(file, registry, secretStore) {
  const state = readProviderState(file);
  const next = JSON.parse(JSON.stringify(state));
  const writes = [];
  let changed = false;
  for (const [providerId, providerState] of Object.entries(next.providers || {})) {
    if (!providerState?.config || typeof providerState.config !== "object" || Array.isArray(providerState.config)) continue;
    const prepared = prepareProviderConfig(providerId, providerState.config, registry.getProviderImpl(providerId));
    providerState.config = prepared.config;
    writes.push(...prepared.writes);
    changed = changed || prepared.changed;
  }
  if (!changed) return next;
  const transaction = secretStore.persistSecretWrites(writes);
  try {
    persistProviderState(file, next);
    transaction.commit();
    return next;
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

function prepareProviderConfig(providerId, input, descriptor) {
  const config = JSON.parse(JSON.stringify(input || {}));
  const previousConfig = descriptor?.config && typeof descriptor.config === "object" && !Array.isArray(descriptor.config)
    ? descriptor.config
    : {};
  const sensitiveFields = new Set(
    (descriptor?.configSchema || [])
      .filter((field) => field?.sensitive === true || field?.type === "secret")
      .map((field) => field.key),
  );
  const writes = [];
  let changed = false;
  for (const key of sensitiveFields) {
    if (Object.prototype.hasOwnProperty.call(config, key)) continue;
    const previous = previousConfig[key];
    if (!isSecretReferenceRecord(previous)) continue;
    config[key] = { secretRef: validateSecretRef(previous.secretRef, "provider") };
    changed = true;
  }
  for (const [key, value] of Object.entries(config)) {
    if (!sensitiveFields.has(key) && !isSensitiveEnvName(key)) continue;
    if (isSecretReferenceRecord(value)) {
      value.secretRef = validateSecretRef(value.secretRef, "provider");
      continue;
    }
    if (typeof value !== "string") throw new Error(`provider credential ${key} must be a string or secretRef`);
    if (isCredentialPlaceholder(value)) {
      const previous = previousConfig[key];
      if (isSecretReferenceRecord(previous)) config[key] = { secretRef: validateSecretRef(previous.secretRef, "provider") };
      else delete config[key];
      changed = true;
      continue;
    }
    const ref = providerSecretRef(providerId, key);
    config[key] = { secretRef: ref };
    writes.push({ ref, value: value.trim(), location: `providers.${providerId}.config.${key}`, scope: "provider" });
    changed = true;
  }
  return { config, writes, changed };
}

function persistProviderState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function normalizePrompt(prompt) {
  const text = normalizeText(prompt);
  if (!text) throw new Error("prompt is required");
  return text;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function summarize(text) {
  const value = normalizeText(text).replace(/\s+/g, " ");
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function providerErrorMessage(error) {
  return error?.message ? String(error.message) : String(error || "provider operation failed");
}

function normalizeExecutionMode(value) {
  const mode = normalizeText(value) || "auto";
  if (["auto", "worktree", "copy", "dry-run", "direct"].includes(mode)) return mode;
  return "auto";
}
