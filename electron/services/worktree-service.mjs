import { ipcBoundedNumber, ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createWorktreeService({ runner, jobStore, getCwd }) {
  if (!runner) throw new Error("worktree-service requires runner");
  if (!jobStore) throw new Error("worktree-service requires jobStore");
  if (typeof getCwd !== "function") throw new Error("worktree-service requires getCwd");

  return {
    createWorkspace(payload = {}) {
      const input = ipcObject(payload);
      const job = ensureJob(jobStore, input, getCwd());
      try {
        const workspace = runner.createIsolatedWorkspace({
          sourcePath: ipcString(input.sourcePath, getCwd()),
          mode: ipcString(input.mode, "auto"),
          jobId: job.id,
          providerId: ipcString(input.providerId, undefined),
          providerRunId: ipcString(input.providerRunId, undefined),
          allowDirty: input.allowDirty === true,
          allowDirect: input.allowDirect === true,
          preserveOnFailure: input.preserveOnFailure !== false,
        });
        appendEvent(jobStore, job.id, {
          type: "worktree.created",
          message: `Created ${workspace.mode} workspace`,
          actor: "worktree-runner",
          data: publicWorkspaceData(workspace),
        });
        return { ok: true, jobId: job.id, workspace };
      } catch (error) {
        recordFailure(jobStore, job.id, "worktree.create.failed", errorMessage(error));
        return { ok: false, jobId: job.id, error: errorMessage(error) };
      }
    },

    run(payload = {}) {
      const input = ipcObject(payload);
      const command = ipcString(input.command).trim();
      if (!command) return { ok: false, error: "command is required" };
      const created = this.createWorkspace(input);
      if (!created.ok) return created;
      const workspace = created.workspace;
      const jobId = created.jobId;
      appendEvent(jobStore, jobId, {
        type: "worktree.command.started",
        message: command,
        actor: "worktree-runner",
        data: { workspaceId: workspace.id, command },
      });
      const result = runner.runInIsolatedWorkspace({
        workspace,
        command,
        timeoutMs: ipcBoundedNumber(input.timeoutMs, 120000, { min: 1000, max: 600000 }),
      });
      appendEvent(jobStore, jobId, {
        type: "worktree.command.finished",
        message: `Command exited with ${result.exitCode}`,
        actor: "worktree-runner",
        status: result.ok ? "succeeded" : "failed",
        data: { workspaceId: workspace.id, exitCode: result.exitCode, output: result.output.slice(-4000) },
      });
      const changes = this.collectChanges({ workspace, jobId });
      let cleanup = null;
      if (result.ok && input.cleanup !== false && workspace.mode !== "dry-run" && workspace.mode !== "direct") {
        cleanup = this.cleanupWorkspace({ workspace, jobId });
      } else if (!result.ok) {
        const preserved = runner.preserveWorkspaceOnFailure(workspace, "command failed");
        appendEvent(jobStore, jobId, {
          type: "worktree.preserved",
          message: preserved.reason,
          actor: "worktree-runner",
          data: { workspaceId: workspace.id, path: workspace.workspacePath },
        });
      }
      return { ok: result.ok, jobId, workspace, result, changes, cleanup };
    },

    collectChanges(payload = {}) {
      const input = ipcObject(payload);
      const workspace = normalizeWorkspacePayload(input.workspace || input);
      const jobId = ipcString(input.jobId, workspace.jobId);
      const changes = runner.collectChanges(workspace);
      if (jobId) {
        appendEvent(jobStore, jobId, {
          type: changes.ok ? "worktree.patch.collected" : "worktree.patch.failed",
          message: changes.ok ? changes.summary : (changes.error || "patch collection failed"),
          actor: "worktree-runner",
          status: changes.ok ? "succeeded" : "failed",
          data: {
            workspaceId: workspace.id,
            changedFiles: changes.changedFiles,
            riskNotes: changes.riskNotes,
          },
        });
        for (const artifact of changes.artifacts || []) {
          try {
            jobStore.addArtifact(jobId, {
              type: artifact.type,
              path: artifact.path,
              name: artifact.name,
              size: artifact.size,
              producedBy: { executor: "worktree-runner" },
              metadata: { workspaceId: workspace.id },
            });
          } catch (error) {
            appendEvent(jobStore, jobId, {
              type: "worktree.artifact.failed",
              message: errorMessage(error),
              actor: "worktree-runner",
              status: "failed",
              data: { workspaceId: workspace.id, artifact },
            });
          }
        }
      }
      return changes.ok ? { ok: true, changes } : { ok: false, changes, error: changes.error };
    },

    cleanupWorkspace(payload = {}) {
      const input = ipcObject(payload);
      const workspace = normalizeWorkspacePayload(input.workspace || input);
      const jobId = ipcString(input.jobId, workspace.jobId);
      const cleanup = runner.cleanupWorkspace(workspace);
      if (jobId) {
        appendEvent(jobStore, jobId, {
          type: cleanup.ok ? "worktree.cleaned" : "worktree.cleanup.failed",
          message: cleanup.ok ? `Cleaned workspace ${workspace.id}` : (cleanup.error || "cleanup failed"),
          actor: "worktree-runner",
          status: cleanup.ok ? "succeeded" : "failed",
          data: { workspaceId: workspace.id, path: workspace.workspacePath, removed: cleanup.removed },
        });
      }
      return cleanup.ok ? { ok: true, cleanup } : { ok: false, cleanup, error: cleanup.error };
    },
  };
}

export function registerWorktreeIpc({ register, worktree }) {
  if (!register) throw new Error("registerWorktreeIpc requires register");
  if (!worktree) throw new Error("registerWorktreeIpc requires worktree service");
  register.handle("worktree:create", (_event, payload) => worktree.createWorkspace(payload));
  register.handle("worktree:run", (_event, payload) => worktree.run(payload));
  register.handle("worktree:collectChanges", (_event, payload) => worktree.collectChanges(payload));
  register.handle("worktree:cleanup", (_event, payload) => worktree.cleanupWorkspace(payload));
}

function ensureJob(jobStore, input, cwd) {
  const jobId = ipcString(input.jobId);
  if (jobId) {
    const existing = jobStore.getJob(jobId);
    if (!existing) throw new Error("job not found");
    return existing;
  }
  return jobStore.createJob({
    title: ipcString(input.title, "Worktree Runner task"),
    source: "worktree-runner",
    trigger: "worktree:ipc",
    actor: ipcString(input.actor, "user"),
    executor: "worktree-runner",
    cwd,
    tasks: [{ title: "Run isolated workspace task", executor: "worktree-runner" }],
    metadata: {
      requestedMode: ipcString(input.mode, "auto"),
      sourcePath: ipcString(input.sourcePath, cwd),
    },
  });
}

function recordFailure(jobStore, jobId, type, message) {
  appendEvent(jobStore, jobId, { type, message, actor: "worktree-runner", status: "failed" });
  try {
    const current = jobStore.getJob(jobId);
    if (current?.status === "queued") jobStore.updateJob(jobId, { status: "running" });
    const next = jobStore.getJob(jobId);
    if (next && !["failed", "cancelled", "succeeded"].includes(next.status)) {
      jobStore.updateJob(jobId, { status: "failed", error: message });
    }
  } catch {
    /* failure event is enough if status update is illegal */
  }
  try {
    jobStore.addGateResult(jobId, { gate: "worktree-runner", status: "failed", message });
  } catch {
    /* gate write should not mask the original failure */
  }
}

function appendEvent(jobStore, jobId, event) {
  try {
    jobStore.appendJobEvent(jobId, event);
  } catch {
    /* Job events are durable telemetry, but should not crash IPC cleanup paths. */
  }
}

function publicWorkspaceData(workspace) {
  return {
    id: workspace.id,
    mode: workspace.mode,
    sourcePath: workspace.sourcePath,
    workspacePath: workspace.workspacePath,
    dirtySource: workspace.dirtySource,
    riskNotes: workspace.riskNotes,
  };
}

function normalizeWorkspacePayload(value) {
  const workspace = ipcObject(value);
  if (!workspace.id || !workspace.workspacePath || !workspace.safeRoot) throw new Error("workspace payload is required");
  return workspace;
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "worktree operation failed");
}
