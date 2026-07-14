import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  AgentProviderRegistry,
  createPlaceholderProvider,
} from "../../dist/agent-provider.js";
import {
  ProviderControlRegistry,
  credentialStatus,
  executeWithProviderPolicy,
  normalizeProviderFailure,
} from "../../dist/provider-control-plane.js";
import { ProviderUsageStore } from "../../dist/provider-usage-store.js";
import {
  isCredentialPlaceholder,
  isSecretReferenceRecord,
  isSensitiveEnvName,
  modelSecretRef,
  providerSecretRef,
  validateSecretRef,
} from "../../dist/secret-references.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";
import { createExternalAgentProvider } from "./external-agent-provider-service.mjs";

export function createProviderService({
  inputQueue,
  jobStore,
  diffService = null,
  worktreeRunner = null,
  getCwd,
  configPath,
  runArtifactDir,
  secretStore,
  authorize = null,
  loadConfig = null,
  usagePath = null,
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
  const usageStore = new ProviderUsageStore(usagePath ? { storePath: usagePath } : {});
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
  registry.registerProvider(createExternalAgentProvider({
    id: "codex-cli",
    name: "Codex CLI",
    adapterType: "codex-cli",
    description: "Runs a locally installed Codex CLI in an isolated workspace after explicit approval.",
    inputQueue,
    jobStore,
    worktreeRunner,
    getCwd,
    runArtifactDir,
    authorize,
    usageStore,
    logger,
  }));
  registry.registerProvider(createExternalAgentProvider({
    id: "claude-code",
    name: "Claude Code CLI",
    adapterType: "claude-code",
    description: "Runs a locally installed Claude Code CLI in an isolated workspace after explicit approval.",
    inputQueue,
    jobStore,
    worktreeRunner,
    getCwd,
    runArtifactDir,
    authorize,
    usageStore,
    logger,
  }));
  registry.registerProvider(createExternalAgentProvider({
    id: "custom-agent-worker",
    name: "Custom Agent Worker",
    adapterType: "custom-agent-worker",
    description: "Runs an explicitly configured enterprise Agent worker without a shell in an isolated workspace.",
    inputQueue,
    jobStore,
    worktreeRunner,
    getCwd,
    runArtifactDir,
    authorize,
    usageStore,
    logger,
  }));
  registry.registerProvider(createPlaceholderProvider({
    id: "local-model",
    name: "Local Model",
    description: "Compatibility configuration for a local OpenAI-compatible or Ollama model endpoint.",
    capabilities: ["local.model", "workspace.read", "job.center"],
    requiredConfig: ["endpoint"],
    configSchema: [
      { key: "endpoint", label: "Endpoint", type: "string", required: true, description: "Local model endpoint, for example http://127.0.0.1:11434." },
      { key: "apiKey", label: "API Key", type: "secret", sensitive: true, description: "Optional local gateway token." },
    ],
    metadata: { adapter: "local-model", providerKind: "model", availability: "not_configured", implementation: "model-profile-compatibility" },
  }));

  const persistedState = migrateProviderState(configPath, registry, secretStore);
  registry.applyState(persistedState);
  const modelProviderState = normalizeModelProviderState(persistedState.modelProviders);
  const credentialMetadata = normalizeCredentialMetadata(persistedState.credentials);
  const controlRegistry = new ProviderControlRegistry();
  let modelProviderIds = new Map();

  function exportCombinedState() {
    return {
      ...registry.exportState(),
      modelProviders: cloneObject(modelProviderState),
      credentials: cloneObject(credentialMetadata),
    };
  }

  function persistCombinedState() {
    persistProviderState(configPath, exportCombinedState());
  }

  function syncControlRegistry() {
    const desired = new Set();
    for (const provider of registry.listProviders()) {
      const implementation = registry.getProviderImpl(provider.id);
      const control = agentControlDescriptor(provider, implementation, credentialMetadata[provider.id], secretStore);
      const existing = controlRegistry.get(control.descriptor.id);
      if (existing) control.descriptor.health = existing.health;
      desired.add(control.descriptor.id);
      controlRegistry.upsert({
        ...control,
        setEnabled(enabled) {
          if (enabled) registry.enableProvider(provider.id);
          else registry.disableProvider(provider.id);
          persistCombinedState();
        },
      });
    }

    modelProviderIds = new Map();
    for (const entry of discoverModelProfiles(loadConfig, modelProviderState, credentialMetadata, secretStore)) {
      modelProviderIds.set(entry.id, entry.profileKey);
      desired.add(entry.id);
      const existing = controlRegistry.get(entry.id);
      controlRegistry.upsert({
        descriptor: { ...entry.descriptor, ...(existing ? { health: existing.health } : {}) },
        healthCheck: () => probeModelProfile(entry.profile),
        setEnabled(enabled) {
          modelProviderState[entry.profileKey] = {
            ...(modelProviderState[entry.profileKey] || {}),
            enabled,
          };
          persistCombinedState();
        },
      });
    }
    for (const current of controlRegistry.discover()) {
      if (!desired.has(current.id)) controlRegistry.remove(current.id);
    }
  }

  syncControlRegistry();

  return {
    listProviders() {
      syncControlRegistry();
      return { ok: true, providers: unifiedProviderDescriptors(registry, controlRegistry) };
    },

    discoverProviders(payload = {}) {
      syncControlRegistry();
      const input = ipcObject(payload);
      const kind = ["model", "agent"].includes(input.kind) ? input.kind : undefined;
      const health = ["healthy", "degraded", "unavailable", "not_configured", "disabled", "unknown"].includes(input.health)
        ? input.health
        : undefined;
      return {
        ok: true,
        providers: controlRegistry.discover({
          ...(kind ? { kind } : {}),
          ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
          ...(health ? { health } : {}),
          ...(ipcString(input.capability).trim() ? { capability: ipcString(input.capability).trim() } : {}),
        }),
      };
    },

    getProvider(providerId) {
      syncControlRegistry();
      const provider = unifiedProviderDescriptors(registry, controlRegistry)
        .find((entry) => entry.id === ipcString(providerId));
      return provider ? { ok: true, provider } : { ok: false, error: "provider not found" };
    },

    getProviderCapabilities(providerId) {
      syncControlRegistry();
      try {
        return { ok: true, providerId: ipcString(providerId), capability: controlRegistry.queryCapabilities(ipcString(providerId)) };
      } catch (error) {
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    async healthCheckProvider(providerId) {
      syncControlRegistry();
      try {
        const id = ipcString(providerId);
        const health = await controlRegistry.healthCheck(id);
        return { ok: true, providerId: id, health };
      } catch (error) {
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    getProviderRegistryVersion() {
      syncControlRegistry();
      return { ok: true, registry: controlRegistry.version() };
    },

    getProviderUsage(providerId = "") {
      try {
        const id = ipcString(providerId).trim();
        return id ? { ok: true, usage: usageStore.get(id) } : { ok: true, usage: usageStore.list() };
      } catch (error) {
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    configureProvider(providerId, payload = {}) {
      const id = ipcString(providerId);
      if (!id) return { ok: false, error: "providerId is required" };
      const input = ipcObject(payload);
      let secretTransaction = null;
      const previousState = exportCombinedState();
      try {
        syncControlRegistry();
        if (modelProviderIds.has(id)) {
          const profileKey = modelProviderIds.get(id);
          if (Object.prototype.hasOwnProperty.call(input, "config")) {
            throw new Error("Model endpoint settings are managed in Model API settings; use credential rotation for keys.");
          }
          if (input.enabled === true || input.enabled === false) {
            modelProviderState[profileKey] = {
              ...(modelProviderState[profileKey] || {}),
              enabled: input.enabled,
            };
          }
          persistCombinedState();
          syncControlRegistry();
          return { ok: true, provider: controlRegistry.get(id), validation: { ok: true } };
        }
        if (Object.prototype.hasOwnProperty.call(input, "config")) {
          const prepared = prepareProviderConfig(id, ipcObject(input.config), registry.getProviderImpl(id));
          secretTransaction = secretStore.persistSecretWrites(prepared.writes);
          registry.configureProvider(id, prepared.config);
        }
        if (input.enabled === true) registry.enableProvider(id);
        if (input.enabled === false) registry.disableProvider(id);
        persistCombinedState();
        secretTransaction?.commit();
        syncControlRegistry();
        return {
          ok: true,
          provider: unifiedProviderDescriptors(registry, controlRegistry).find((entry) => entry.id === id),
          validation: registry.validateProviderConfig(id),
        };
      } catch (error) {
        secretTransaction?.rollback();
        registry.applyState(previousState);
        replaceObject(modelProviderState, previousState.modelProviders);
        replaceObject(credentialMetadata, previousState.credentials);
        syncControlRegistry();
        return { ok: false, error: providerErrorMessage(error) };
      }
    },

    rotateProviderCredential(providerId, payload = {}) {
      const id = ipcString(providerId).trim();
      const input = ipcObject(payload);
      const value = ipcString(input.value).trim();
      const field = ipcString(input.field, "apiKey").trim();
      if (!id) return { ok: false, error: "providerId is required" };
      if (!value || isCredentialPlaceholder(value)) return { ok: false, error: "credential value is required" };
      if (!/^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(field) || !isSensitiveEnvName(field)) {
        return { ok: false, error: "credential field is not an allowed sensitive field" };
      }
      const expiresAt = normalizeOptionalTimestamp(input.expiresAt);
      const rotatedAt = Date.now();
      try {
        syncControlRegistry();
        if (modelProviderIds.has(id)) {
          const profileKey = modelProviderIds.get(id);
          rotateModelProfileCredential(secretStore, profileKey, value);
          credentialMetadata[id] = { secretRef: modelSecretRef(profileKey), rotatedAt, ...(expiresAt ? { expiresAt } : {}) };
        } else {
          const implementation = registry.getProviderImpl(id);
          if (!implementation) throw new Error("provider not found");
          const prepared = prepareProviderConfig(id, { ...(implementation.config || {}), [field]: value }, implementation);
          const transaction = secretStore.persistSecretWrites(prepared.writes);
          try {
            registry.configureProvider(id, prepared.config);
            credentialMetadata[id] = {
              secretRef: providerSecretRef(id, field),
              rotatedAt,
              ...(expiresAt ? { expiresAt } : {}),
            };
            persistCombinedState();
            transaction.commit();
          } catch (error) {
            transaction.rollback();
            throw error;
          }
        }
        persistCombinedState();
        syncControlRegistry();
        return { ok: true, providerId: id, credential: controlRegistry.get(id)?.credential };
      } catch (error) {
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
        syncControlRegistry();
        const descriptor = controlRegistry.get(id);
        if (!descriptor) throw new Error("provider not found");
        if (descriptor.kind !== "agent") throw new Error("Model Providers run through the Hi Code model runtime, not the External Agent execution API.");
        const request = {
          prompt,
          cwd: ipcString(input.cwd, undefined),
          jobId: ipcString(input.jobId, undefined),
          actor: ipcString(input.actor, "user"),
          messages: Array.isArray(input.messages) ? input.messages : undefined,
          metadata: ipcObject(input.metadata),
          options: ipcObject(input.options),
        };
        const options = ipcObject(input.options);
        const fallbackProviderIds = Array.isArray(options.fallbackProviderIds)
          ? options.fallbackProviderIds.map((value) => ipcString(value).trim()).filter(Boolean)
          : [];
        for (const fallbackId of fallbackProviderIds) {
          if (controlRegistry.get(fallbackId)?.kind !== "agent") throw new Error(`fallback provider must be an Agent Provider: ${fallbackId}`);
        }
        let lastFailedResult = null;
        const outcome = await executeWithProviderPolicy({
          providerId: id,
          policy: {
            retries: Number(options.retries || 0),
            retryDelayMs: Number(options.retryDelayMs || 500),
            fallbackProviderIds,
          },
          async run(candidateId) {
            const result = await registry.runProvider(candidateId, request);
            if (!result.ok) {
              lastFailedResult = result;
              const failure = Object.assign(new Error(result.error?.message || result.summary), {
                code: result.error?.code,
                retriable: result.error?.retriable,
              });
              throw failure;
            }
            return result;
          },
        });
        if (!outcome.ok || !outcome.result) {
          const attempts = publicExecutionAttempts(outcome.attempts);
          return {
            ok: false,
            error: outcome.failure?.message || "provider run failed",
            failure: outcome.failure,
            attempts,
            ...(lastFailedResult ? { result: { ...lastFailedResult, attempts } } : {}),
          };
        }
        return {
          ok: true,
          result: { ...outcome.result, attempts: publicExecutionAttempts(outcome.attempts) },
        };
      } catch (error) {
        const failure = normalizeProviderFailure(error);
        return { ok: false, error: failure.message, failure };
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
    _controlRegistry: controlRegistry,
    _usageStore: usageStore,
  };
}

export function registerProviderIpc({ register, provider }) {
  if (!register) throw new Error("registerProviderIpc requires register");
  if (!provider) throw new Error("registerProviderIpc requires provider service");

  register.handle("provider:list", () => provider.listProviders());
  register.handle("provider:discover", (_event, payload) => provider.discoverProviders(payload));
  register.handle("provider:get", (_event, providerId) => provider.getProvider(providerId));
  register.handle("provider:capabilities", (_event, providerId) => provider.getProviderCapabilities(providerId));
  register.handle("provider:health", (_event, providerId) => provider.healthCheckProvider(providerId));
  register.handle("provider:registry-version", () => provider.getProviderRegistryVersion());
  register.handle("provider:usage", (_event, providerId) => provider.getProviderUsage(providerId));
  register.handle("provider:credential:rotate", (_event, providerId, payload) => provider.rotateProviderCredential(providerId, payload));
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

function unifiedProviderDescriptors(agentRegistry, controlRegistry) {
  const agents = new Map(agentRegistry.listProviders().map((provider) => [provider.id, provider]));
  return controlRegistry.discover().map((control) => {
    const legacy = agents.get(control.id);
    return {
      ...(legacy || {}),
      ...control,
      status: !control.enabled ? "disabled" : control.configured ? "enabled" : "not_configured",
      configured: control.configured,
      kind: control.kind,
      health: control.health,
      capability: control.capability,
      credential: control.credential,
      metadata: { ...(legacy?.metadata || {}), ...(control.metadata || {}) },
    };
  });
}

function agentControlDescriptor(provider, implementation, storedCredential, secretStore) {
  const kind = implementation?.metadata?.providerKind === "model" ? "model" : "agent";
  const adapterType = normalizeText(implementation?.metadata?.adapter) || (provider.id === "hicode-internal" ? "hicode-internal" : provider.id);
  const deployment = adapterType === "local-model"
    ? "local"
    : adapterType === "custom-agent-worker"
      ? "enterprise"
      : "remote";
  const privacyLevel = deployment === "local" ? "local_only" : deployment === "enterprise" ? "enterprise_policy" : "remote_warning";
  const configured = provider.id === "hicode-internal" || provider.configured === true;
  const secretRef = storedCredential?.secretRef || findSecretRef(implementation?.config);
  const credential = credentialStatus({
    state: secretRef ? (safeSecretHas(secretStore, secretRef) ? "stored" : "missing") : "not_required",
    ...(secretRef ? { secretRef } : {}),
    ...(storedCredential?.expiresAt ? { expiresAt: storedCredential.expiresAt } : {}),
    ...(storedCredential?.rotatedAt ? { rotatedAt: storedCredential.rotatedAt } : {}),
  });
  const healthCheck = typeof implementation?.healthCheck === "function"
    ? () => implementation.healthCheck()
    : provider.id === "hicode-internal"
      ? () => ({ status: "healthy", checkedAt: Date.now(), version: provider.version, message: "Built-in runtime is available." })
      : adapterType === "local-model"
        ? () => probeLegacyLocalModel(implementation?.config)
        : undefined;

  return {
    descriptor: {
      id: provider.id,
      kind,
      adapterType,
      name: provider.name,
      version: provider.version,
      description: provider.description,
      enabled: provider.enabled,
      configured,
      health: {
        status: !provider.enabled ? "disabled" : configured ? "unknown" : "not_configured",
        checkedAt: Date.now(),
      },
      capability: {
        ...(kind === "model" && normalizeText(implementation?.config?.model) ? { modelName: normalizeText(implementation.config.model) } : {}),
        vision: kind === "model" ? "unknown" : false,
        tools: kind === "agent" ? true : "unknown",
        streaming: provider.id === "hicode-internal" ? true : false,
        reasoning: provider.id === "hicode-internal" ? true : "unknown",
        cost: { currency: "USD", source: "unknown" },
        deployment,
        privacyLevel,
        capabilities: [...(provider.capabilities || [])],
      },
      credential,
      metadata: {
        providerKind: kind,
        executionBoundary: kind === "agent" ? "managed-process" : "model-runtime",
        ...(implementation?.metadata || {}),
      },
    },
    healthCheck,
  };
}

function discoverModelProfiles(loadConfig, modelProviderState, credentialMetadata, secretStore) {
  if (typeof loadConfig !== "function") return [];
  let config;
  try { config = loadConfig(); } catch { return []; }
  const profiles = config?.profiles && typeof config.profiles === "object" ? config.profiles : {};
  return Object.entries(profiles).map(([profileKey, profile]) => {
    const id = modelProviderId(profileKey);
    const adapterType = modelAdapterType(profile);
    const deployment = modelDeployment(profile);
    const privacyLevel = deployment === "local" ? "local_only" : deployment === "enterprise" ? "enterprise_policy" : "remote_warning";
    const enabled = modelProviderState[profileKey]?.enabled !== false;
    const requiresCredential = deployment !== "local";
    const secretRef = normalizeText(profile?.secretRef) || normalizeText(credentialMetadata[id]?.secretRef);
    const hasRuntimeCredential = typeof profile?.apiKey === "string" && profile.apiKey.trim() && !isCredentialPlaceholder(profile.apiKey);
    const configured = Boolean(normalizeText(profile?.baseURL) && normalizeText(profile?.model) && (!requiresCredential || hasRuntimeCredential));
    const credential = credentialStatus({
      state: !requiresCredential
        ? "not_required"
        : secretRef
          ? (safeSecretHas(secretStore, secretRef) ? "stored" : "missing")
          : hasRuntimeCredential ? "stored" : "missing",
      ...(secretRef ? { secretRef } : {}),
      ...(credentialMetadata[id]?.expiresAt ? { expiresAt: credentialMetadata[id].expiresAt } : {}),
      ...(credentialMetadata[id]?.rotatedAt ? { rotatedAt: credentialMetadata[id].rotatedAt } : {}),
      ...(!secretRef && hasRuntimeCredential && requiresCredential ? { message: "Credential is supplied at runtime and is not exposed." } : {}),
    });
    return {
      id,
      profileKey,
      profile,
      descriptor: {
        id,
        kind: "model",
        adapterType,
        name: profile?.name || profileKey,
        version: "2.0.0",
        description: `${adapterTypeLabel(adapterType)} model profile`,
        enabled,
        configured,
        health: {
          status: !enabled ? "disabled" : configured ? "unknown" : "not_configured",
          checkedAt: Date.now(),
        },
        capability: modelCapabilityProfile(profile, adapterType, deployment, privacyLevel),
        credential,
        metadata: {
          providerKind: "model",
          profileKey,
          protocol: profile?.protocol || "chat_completions",
          dataBoundary: privacyLevel,
        },
      },
    };
  });
}

function modelCapabilityProfile(profile, adapterType, deployment, privacyLevel) {
  const model = normalizeText(profile?.model);
  const lower = model.toLowerCase();
  const vision = /vision|gpt-4o|gpt-4\.1|claude-3|claude-sonnet|claude-opus|gemini|qwen.*vl/.test(lower) ? true : "unknown";
  const reasoning = /reason|deepseek-r|(^|[-_.])o[134]($|[-_.])|r1/.test(lower) ? true : "unknown";
  const inputCost = finiteNonNegative(profile?.cost?.inputPerMillionTokens);
  const outputCost = finiteNonNegative(profile?.cost?.outputPerMillionTokens);
  return {
    ...(model ? { modelName: model } : {}),
    ...(Number.isFinite(Number(profile?.contextWindow)) ? { contextLength: Math.max(1, Math.floor(Number(profile.contextWindow))) } : {}),
    vision,
    tools: true,
    streaming: true,
    reasoning,
    cost: {
      currency: normalizeText(profile?.cost?.currency) || "USD",
      source: inputCost !== undefined || outputCost !== undefined ? "configured" : "unknown",
      ...(inputCost !== undefined ? { inputPerMillionTokens: inputCost } : {}),
      ...(outputCost !== undefined ? { outputPerMillionTokens: outputCost } : {}),
    },
    deployment,
    privacyLevel,
    capabilities: [
      "input.text",
      "input.image",
      "tool.calling",
      "tool.streaming",
      "usage",
      "interruption",
      `transport.${adapterType}`,
    ],
  };
}

async function probeModelProfile(profile) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  timer.unref?.();
  try {
    const url = modelHealthUrl(profile);
    const headers = { accept: "application/json" };
    if (modelDeployment(profile) !== "local" && normalizeText(profile?.apiKey)) {
      if (profile?.protocol === "anthropic_messages") headers["x-api-key"] = profile.apiKey;
      else headers.authorization = `Bearer ${profile.apiKey}`;
    }
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "error" });
    const latencyMs = Math.max(0, Date.now() - startedAt);
    if (response.status === 401 || response.status === 403) {
      return { status: "degraded", checkedAt: Date.now(), latencyMs, message: "Endpoint is reachable, but authentication failed.", failure: normalizeProviderFailure({ status: response.status, message: "authentication failed" }) };
    }
    if (response.status === 429) {
      return { status: "degraded", checkedAt: Date.now(), latencyMs, message: "Endpoint is reachable, but quota or rate limit was exceeded.", failure: normalizeProviderFailure({ status: 429, message: "quota exceeded" }) };
    }
    if (response.status >= 500) {
      return { status: "unavailable", checkedAt: Date.now(), latencyMs, message: `Endpoint returned HTTP ${response.status}.`, failure: normalizeProviderFailure({ status: response.status, message: "provider unavailable" }) };
    }
    return { status: "healthy", checkedAt: Date.now(), latencyMs, message: `Endpoint responded with HTTP ${response.status}.` };
  } catch (error) {
    const failure = normalizeProviderFailure(error);
    return { status: "unavailable", checkedAt: Date.now(), latencyMs: Math.max(0, Date.now() - startedAt), message: failure.message, failure };
  } finally {
    clearTimeout(timer);
  }
}

function probeLegacyLocalModel(config) {
  const endpoint = normalizeText(config?.endpoint);
  if (!endpoint) return { status: "not_configured", checkedAt: Date.now(), message: "Local endpoint is not configured." };
  return probeModelProfile({ baseURL: endpoint, model: normalizeText(config?.model) || "local-model", protocol: "ollama_chat", apiKey: "" });
}

function modelHealthUrl(profile) {
  const base = new URL(normalizeText(profile?.baseURL));
  if (profile?.protocol === "ollama_chat") return new URL("/api/tags", base).toString();
  if (profile?.protocol === "anthropic_messages") return base.toString();
  const pathname = base.pathname.replace(/\/$/, "");
  base.pathname = `${pathname}/models`;
  return base.toString();
}

function modelProviderId(profileKey) {
  const normalized = String(profileKey || "default").normalize("NFKD").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
  const hash = crypto.createHash("sha256").update(String(profileKey)).digest("hex").slice(0, 8);
  return `model.${normalized.slice(0, 60)}.${hash}`;
}

function modelAdapterType(profile) {
  if (profile?.protocol === "responses") return "openai-responses";
  if (profile?.protocol === "anthropic_messages") return "anthropic";
  if (profile?.protocol === "ollama_chat" || modelDeployment(profile) === "local") return "ollama-local";
  return "openai-compatible";
}

function modelDeployment(profile) {
  if (profile?.deployment === "enterprise" || profile?.privacyLevel === "enterprise_policy") return "enterprise";
  try {
    const host = new URL(normalizeText(profile?.baseURL)).hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host)) return "local";
  } catch {}
  return "remote";
}

function adapterTypeLabel(value) {
  return ({
    "openai-responses": "OpenAI Responses",
    anthropic: "Anthropic Messages",
    "ollama-local": "Ollama/local",
    "openai-compatible": "OpenAI-compatible",
  })[value] || value;
}

function rotateModelProfileCredential(secretStore, profileKey, value) {
  const text = secretStore.readConfigForRenderer?.();
  const config = text ? JSON.parse(text) : {};
  if (config.profiles?.[profileKey] && typeof config.profiles[profileKey] === "object") {
    config.profiles[profileKey].apiKey = value;
  } else if ((config.defaultProfile || "default") === profileKey) {
    config.apiKey = value;
  } else {
    throw new Error("Model profile must exist before its credential can be rotated.");
  }
  secretStore.persistConfig(config);
}

function normalizeModelProviderState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, state] of Object.entries(value)) {
    if (!state || typeof state !== "object" || Array.isArray(state)) continue;
    result[key] = { ...(typeof state.enabled === "boolean" ? { enabled: state.enabled } : {}) };
  }
  return result;
}

function normalizeCredentialMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [id, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    try {
      result[id] = {
        ...(item.secretRef ? { secretRef: validateSecretRef(item.secretRef) } : {}),
        ...(normalizeOptionalTimestamp(item.rotatedAt) ? { rotatedAt: normalizeOptionalTimestamp(item.rotatedAt) } : {}),
        ...(normalizeOptionalTimestamp(item.expiresAt) ? { expiresAt: normalizeOptionalTimestamp(item.expiresAt) } : {}),
      };
    } catch {}
  }
  return result;
}

function normalizeOptionalTimestamp(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(number) || number <= 0) throw new Error("timestamp must be a positive epoch value or ISO date");
  return Math.floor(number);
}

function safeSecretHas(secretStore, secretRef) {
  try { return secretStore.has(secretRef) === true; } catch { return false; }
}

function findSecretRef(value) {
  if (!value || typeof value !== "object") return "";
  for (const item of Object.values(value)) {
    if (isSecretReferenceRecord(item)) return item.secretRef;
    if (item && typeof item === "object") {
      const nested = findSecretRef(item);
      if (nested) return nested;
    }
  }
  return "";
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function publicExecutionAttempts(attempts) {
  return (attempts || []).map((attempt) => ({
    providerId: attempt.providerId,
    attempt: attempt.attempt,
    ok: attempt.ok,
    ...(attempt.failure ? { failure: attempt.failure } : {}),
  }));
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function replaceObject(target, value) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneObject(value));
}
