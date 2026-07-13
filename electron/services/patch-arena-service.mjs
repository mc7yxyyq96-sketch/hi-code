import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { runDefinitionOfDone } from "../../dist/definition-of-done.js";
import { runManagedExecutionSync } from "../../dist/execution-runner.js";
import { PatchArenaStore } from "../../dist/patch-arena.js";
import { buildSafeChildEnv } from "../../dist/process-env.js";
import { validatePatchPaths } from "../../dist/worktree-runner.js";
import { ipcBoundedNumber, ipcObject, ipcString, ipcStringArray } from "../ipc/ipc-utils.mjs";

const DEFAULT_PROVIDERS = ["hicode-internal"];
const RISKY_FILE_RE = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|electron\/main\.mjs|electron\/preload\.cjs|scripts\/|\.github\/|src\/tools\/bash\.ts)/i;
const SECURITY_FILE_RE = /(^|\/)(\.env|electron\/preload\.cjs|electron\/ipc\/|electron\/services\/security-service\.mjs|src\/permissions\.ts)|secret|token|auth|credential|permission|security/i;

export function createPatchArenaService({
  arenaStore,
  jobStore,
  worktreeRunner,
  getCwd,
  artifactRoot,
  providerService = null,
  shell = null,
}) {
  if (!(arenaStore instanceof PatchArenaStore)) throw new Error("patch-arena-service requires PatchArenaStore");
  if (!jobStore) throw new Error("patch-arena-service requires jobStore");
  if (!worktreeRunner) throw new Error("patch-arena-service requires worktreeRunner");
  if (typeof getCwd !== "function") throw new Error("patch-arena-service requires getCwd");
  if (!artifactRoot) throw new Error("patch-arena-service requires artifactRoot");

  const safeArtifactRoot = path.resolve(artifactRoot);
  fs.mkdirSync(safeArtifactRoot, { recursive: true, mode: 0o700 });

  return {
    listRuns(payload = {}) {
      const input = ipcObject(payload);
      const limit = ipcBoundedNumber(input.limit, 50, { min: 1, max: 200 });
      return { ok: true, runs: arenaStore.listRuns(limit) };
    },

    getRun(runId) {
      const id = ipcString(runId).trim();
      if (!id) return { ok: false, error: "runId is required" };
      const run = arenaStore.getRun(id);
      return run ? { ok: true, run } : { ok: false, error: "arena run not found" };
    },

    runArena(payload = {}) {
      const input = ipcObject(payload);
      const task = ipcString(input.task).trim();
      if (!task) return { ok: false, error: "task is required" };
      const providerIds = uniqueStrings(ipcStringArray(input.providerIds)).length
        ? uniqueStrings(ipcStringArray(input.providerIds))
        : DEFAULT_PROVIDERS;
      const providerValidation = validateProviderIds(providerService, providerIds);
      if (!providerValidation.ok) return providerValidation;
      const actor = ipcString(input.actor, "user") || "user";
      const sourcePath = path.resolve(ipcString(input.sourcePath, getCwd()) || getCwd());
      const startedAt = Date.now();
      const job = jobStore.createJob({
        title: `Patch Arena: ${summarize(task)}`,
        source: "patch-arena",
        trigger: "arena:create",
        actor,
        executor: "patch-arena",
        cwd: sourcePath,
        tasks: providerIds.map((providerId) => ({
          title: `Candidate: ${providerId}`,
          assignee: providerId,
          executor: "patch-arena",
        })),
        metadata: { providerIds, mode: ipcString(input.mode, "auto") },
      });
      const run = arenaStore.createRun({
        task,
        title: ipcString(input.title) || undefined,
        providerIds,
        actor,
        sourcePath,
        jobId: job.id,
        metadata: {
          mode: ipcString(input.mode, "auto"),
          providerCount: providerIds.length,
        },
      });

      appendEvent(jobStore, job.id, {
        type: "arena.run.created",
        message: `Patch Arena run ${run.id} created`,
        actor: "patch-arena",
        data: { runId: run.id, providerIds },
      });
      updateJobStatus(jobStore, job.id, "running");
      arenaStore.updateRun(run.id, { status: "running", startedAt, now: startedAt });

      const commandByProvider = ipcObject(input.candidateCommands);
      const timeoutMs = ipcBoundedNumber(input.timeoutMs, 120000, { min: 1000, max: 600000 });
      const mode = normalizeArenaMode(ipcString(input.mode, "auto"));
      const results = [];
      let failedCount = 0;

      for (const providerId of providerIds) {
        const candidate = arenaStore.addCandidate(run.id, {
          providerId,
          providerName: providerName(providerService, providerId),
          status: "running",
          startedAt: Date.now(),
          jobId: job.id,
          logs: [`candidate ${providerId} queued`],
        });
        const result = executeCandidate({
          run,
          candidate,
          providerId,
          task,
          command: providerCommand(commandByProvider, providerId, input.command, task, candidate.id),
          mode,
          sourcePath,
          allowDirty: input.allowDirty === true,
          preserveWorkspace: input.preserveWorkspace === true,
          timeoutMs,
          worktreeRunner,
          jobStore,
          arenaStore,
          artifactRoot: safeArtifactRoot,
        });
        if (!result.ok) failedCount += 1;
        results.push(result);
      }

      const endedAt = Date.now();
      const finalStatus = results.length && failedCount === results.length ? "failed" : "ready";
      const updated = arenaStore.updateRun(run.id, {
        status: finalStatus,
        endedAt,
        error: finalStatus === "failed" ? "all candidates failed" : undefined,
        now: endedAt,
      });
      if (finalStatus === "failed") updateJobStatus(jobStore, job.id, "failed", "all Patch Arena candidates failed");
      else updateJobStatus(jobStore, job.id, "succeeded");
      appendEvent(jobStore, job.id, {
        type: "arena.run.completed",
        message: `Patch Arena run ${run.id} completed with ${results.length - failedCount}/${results.length} candidates ready`,
        actor: "patch-arena",
        status: finalStatus === "failed" ? "failed" : "succeeded",
        data: { runId: run.id, failedCount, candidateCount: results.length },
      });
      return { ok: finalStatus !== "failed", run: updated, jobId: job.id, results };
    },

    acceptCandidate(runId, candidateId, payload = {}) {
      return decideCandidate({ arenaStore, jobStore, runId, candidateId, payload, decision: "accepted" });
    },

    rejectCandidate(runId, candidateId, payload = {}) {
      const decided = decideCandidate({ arenaStore, jobStore, runId, candidateId, payload, decision: "rejected" });
      if (!decided.ok) return decided;
      const candidate = arenaStore.updateCandidate(runId, candidateId, { status: "rejected", endedAt: Date.now() });
      return { ...decided, candidate, run: arenaStore.getRun(runId) };
    },

    mergeCandidate(runId, candidateId, payload = {}) {
      const input = ipcObject(payload);
      const run = arenaStore.getRun(ipcString(runId));
      if (!run) return { ok: false, error: "arena run not found" };
      const candidate = run.candidates.find((item) => item.id === ipcString(candidateId));
      if (!candidate) return { ok: false, error: "arena candidate not found" };
      if (!candidate.patch?.path) return { ok: false, error: "candidate has no patch artifact" };

      const actor = ipcString(input.actor, "user") || "user";
      const cwd = path.resolve(run.sourcePath || getCwd());
      const patchPath = path.resolve(candidate.patch.path);
      try {
        assertArtifactInsideKnownRoots(patchPath, [safeArtifactRoot, path.resolve(path.dirname(path.dirname(patchPath)))]);
        assertArtifactInsideKnownRoots(patchPath, [safeArtifactRoot, candidate.workspace?.safeRoot].filter(Boolean));
        const patch = normalizePatchForApply(fs.readFileSync(patchPath, "utf8"));
        validatePatchPaths(patch);
        const dirty = gitDirty(cwd);
        if (!dirty.ok) throw new Error(dirty.error);
        if (dirty.dirty) throw new Error("main workspace has uncommitted changes; refusing Patch Arena merge");
        const check = gitWithInput(dirty.root, ["apply", "--check", "-"], patch);
        if (!check.ok) throw new Error(check.err || check.out || "git apply --check failed");
        const apply = gitWithInput(dirty.root, ["apply", "-"], patch);
        if (!apply.ok) throw new Error(apply.err || apply.out || "git apply failed");
        const decision = arenaStore.addDecision(run.id, {
          candidateId: candidate.id,
          decision: "merged",
          actor,
          reason: ipcString(input.reason, "merged from Patch Arena UI"),
          patchPath,
          result: { ok: true, output: apply.out || "patch applied" },
        });
        const mergedCandidate = arenaStore.updateCandidate(run.id, candidate.id, { status: "merged", endedAt: Date.now() });
        const mergedRun = arenaStore.updateRun(run.id, { status: "merged", endedAt: Date.now() });
        appendEvent(jobStore, run.jobId, {
          type: "arena.candidate.merged",
          message: `Merged candidate ${candidate.id}`,
          actor,
          status: "succeeded",
          data: { runId: run.id, candidateId: candidate.id, patchPath },
        });
        return { ok: true, run: mergedRun, candidate: mergedCandidate, decision };
      } catch (error) {
        const message = errorMessage(error);
        const decision = arenaStore.addDecision(run.id, {
          candidateId: candidate.id,
          decision: "merged",
          actor,
          reason: ipcString(input.reason, "merge attempted from Patch Arena UI"),
          patchPath,
          result: { ok: false, error: message },
        });
        appendEvent(jobStore, run.jobId, {
          type: "arena.merge.failed",
          message,
          actor,
          status: "failed",
          data: { runId: run.id, candidateId: candidate.id, patchPath },
        });
        return { ok: false, error: message, run: arenaStore.getRun(run.id), decision };
      }
    },

    previewArtifact(runId, candidateId, artifactPath) {
      const found = findCandidateArtifact(arenaStore, runId, candidateId, artifactPath);
      if (!found.ok) return found;
      try {
        const content = readPreview(found.path);
        return { ok: true, path: found.path, content };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    openArtifact(runId, candidateId, artifactPath) {
      const found = findCandidateArtifact(arenaStore, runId, candidateId, artifactPath);
      if (!found.ok) return found;
      if (!shell || typeof shell.showItemInFolder !== "function") return { ok: false, error: "shell is unavailable" };
      shell.showItemInFolder(found.path);
      return { ok: true };
    },
  };
}

export function registerPatchArenaIpc({ register, arena }) {
  if (!register) throw new Error("registerPatchArenaIpc requires register");
  if (!arena) throw new Error("registerPatchArenaIpc requires arena service");
  register.handle("arena:list", (_event, payload) => arena.listRuns(payload));
  register.handle("arena:get", (_event, runId) => arena.getRun(runId));
  register.handle("arena:create", (_event, payload) => arena.runArena(payload));
  register.handle("arena:acceptCandidate", (_event, runId, candidateId, payload) => arena.acceptCandidate(runId, candidateId, payload));
  register.handle("arena:rejectCandidate", (_event, runId, candidateId, payload) => arena.rejectCandidate(runId, candidateId, payload));
  register.handle("arena:mergeCandidate", (_event, runId, candidateId, payload) => arena.mergeCandidate(runId, candidateId, payload));
  register.handle("arena:artifact:preview", (_event, runId, candidateId, artifactPath) => arena.previewArtifact(runId, candidateId, artifactPath));
  register.handle("arena:artifact:open", (_event, runId, candidateId, artifactPath) => arena.openArtifact(runId, candidateId, artifactPath));
}

function executeCandidate({
  run,
  candidate,
  providerId,
  task,
  command,
  mode,
  sourcePath,
  allowDirty,
  preserveWorkspace,
  timeoutMs,
  worktreeRunner,
  jobStore,
  arenaStore,
  artifactRoot,
}) {
  const logs = [`provider=${providerId}`, `command=${command}`];
  let workspace = null;
  try {
    appendEvent(jobStore, run.jobId, {
      type: "arena.candidate.started",
      message: `Candidate ${candidate.id} started`,
      actor: providerId,
      data: { runId: run.id, candidateId: candidate.id, providerId },
    });
    workspace = worktreeRunner.createIsolatedWorkspace({
      sourcePath,
      mode,
      jobId: run.jobId,
      providerId,
      providerRunId: candidate.id,
      allowDirty,
      preserveOnFailure: preserveWorkspace,
    });
    arenaStore.updateCandidate(run.id, candidate.id, {
      workspace: publicWorkspace(workspace),
      logs: [...logs, ...workspace.logs],
      riskNotes: workspace.riskNotes,
    });
    appendEvent(jobStore, run.jobId, {
      type: "arena.candidate.workspace",
      message: `Created ${workspace.mode} workspace for ${candidate.id}`,
      actor: "worktree-runner",
      data: { runId: run.id, candidateId: candidate.id, workspace: publicWorkspace(workspace) },
    });

    const commandResult = worktreeRunner.runInIsolatedWorkspace({ workspace, command, timeoutMs, userApproved: true });
    logs.push(commandResult.output || `command exited with ${commandResult.exitCode}`);
    appendEvent(jobStore, run.jobId, {
      type: "arena.candidate.command",
      message: `Candidate ${candidate.id} command exited with ${commandResult.exitCode}`,
      actor: providerId,
      status: commandResult.ok ? "succeeded" : "failed",
      data: { runId: run.id, candidateId: candidate.id, exitCode: commandResult.exitCode, output: tail(commandResult.output) },
    });

    const changes = worktreeRunner.collectChanges(workspace);
    appendEvent(jobStore, run.jobId, {
      type: changes.ok ? "arena.candidate.patch.collected" : "arena.candidate.patch.failed",
      message: changes.ok ? changes.summary : changes.error || "patch collection failed",
      actor: "worktree-runner",
      status: changes.ok ? "succeeded" : "failed",
      data: { runId: run.id, candidateId: candidate.id, changedFiles: changes.changedFiles, riskNotes: changes.riskNotes },
    });
    if (!changes.ok) throw new Error(changes.error || "patch collection failed");

    const definitionOfDone = runDefinitionOfDone({
      workspacePath: workspace.workspacePath,
      changedFiles: changes.changedFiles,
      source: "patch-arena",
      evidenceName: `arena-${run.id}-${candidate.id}.json`,
      persistEvidence: true,
    });
    appendEvent(jobStore, run.jobId, {
      type: "definition-of-done.checked",
      message: `Candidate ${candidate.id} Definition of Done ${definitionOfDone.status}`,
      actor: "patch-arena",
      status: definitionOfDone.status === "failed" ? "failed" : definitionOfDone.status === "warning" ? "warning" : "succeeded",
      data: {
        runId: run.id,
        candidateId: candidate.id,
        evidencePath: definitionOfDone.evidencePath,
        summary: definitionOfDone.summary,
        skeletonSummary: definitionOfDone.skeleton.summary,
        remediation: definitionOfDone.remediation,
      },
    });

    const gates = [
      ...runQualityGates({ workspacePath: workspace.workspacePath, changedFiles: changes.changedFiles, patch: changes.patch }),
      definitionOfDoneCandidateGate(definitionOfDone),
    ];
    const score = scoreCandidate({ gateResults: gates, changedFiles: changes.changedFiles });
    const candidateRoot = path.join(artifactRoot, run.id, candidate.id);
    const savedArtifacts = saveCandidateArtifacts({
      candidateRoot,
      changes,
      commandResult,
      gates,
      score,
      providerId,
      task,
      definitionOfDone,
    });
    const artifacts = [...changes.artifacts, ...savedArtifacts];
    for (const gate of gates) {
      addJobGate(jobStore, run.jobId, gate, candidate.id);
    }
    for (const artifact of artifacts) {
      addJobArtifact(jobStore, run.jobId, artifact, candidate.id);
    }

    const status = commandResult.ok && definitionOfDone.status !== "failed" ? "ready" : "failed";
    const patchArtifact = changes.artifacts.find((artifact) => artifact.type === "patch") || savedArtifacts.find((artifact) => artifact.type === "patch");
    const patchInfo = patchArtifact
      ? {
          path: patchArtifact.path,
          changedFiles: changes.changedFiles,
          summary: changes.summary,
          size: patchArtifact.size,
          sha256: sha256File(patchArtifact.path),
        }
      : { path: "", changedFiles: changes.changedFiles, summary: changes.summary };
    const updated = arenaStore.updateCandidate(run.id, candidate.id, {
      status,
      endedAt: Date.now(),
      patch: patchInfo,
      score,
      gateResults: gates,
      artifacts,
      logs: [...logs, ...changes.logs],
      summary: `${providerId}: ${changes.summary}`,
      error: commandResult.ok
        ? definitionOfDone.status === "failed" ? "Definition of Done / Skeleton Detector failed" : undefined
        : `candidate command exited with ${commandResult.exitCode}`,
      riskNotes: [...new Set([...(workspace.riskNotes || []), ...(changes.riskNotes || []), ...score.notes, ...skeletonRiskNotes(definitionOfDone)])],
      metadata: {
        ...(candidate.metadata || {}),
        definitionOfDone,
      },
    });
    if (workspace.mode !== "dry-run" && workspace.mode !== "direct" && !preserveWorkspace) {
      const cleanup = worktreeRunner.cleanupWorkspace(workspace);
      appendEvent(jobStore, run.jobId, {
        type: cleanup.ok ? "arena.candidate.cleaned" : "arena.candidate.cleanup.failed",
        message: cleanup.ok ? `Cleaned candidate workspace ${candidate.id}` : cleanup.error || "cleanup failed",
        actor: "worktree-runner",
        status: cleanup.ok ? "succeeded" : "failed",
        data: { runId: run.id, candidateId: candidate.id, workspacePath: workspace.workspacePath },
      });
    }
    return { ok: status === "ready", candidate: updated };
  } catch (error) {
    const message = errorMessage(error);
    if (workspace && workspace.mode !== "dry-run" && workspace.mode !== "direct") {
      const preserved = worktreeRunner.preserveWorkspaceOnFailure(workspace, message);
      logs.push(...preserved.logs);
      appendEvent(jobStore, run.jobId, {
        type: "arena.candidate.preserved",
        message: preserved.reason,
        actor: "worktree-runner",
        status: "warning",
        data: { runId: run.id, candidateId: candidate.id, path: preserved.workspacePath },
      });
    }
    addJobGate(jobStore, run.jobId, {
      id: newId("gate"),
      gate: "patch-arena-candidate",
      status: "failed",
      message,
      createdAt: Date.now(),
    }, candidate.id);
    const failed = arenaStore.updateCandidate(run.id, candidate.id, {
      status: "failed",
      endedAt: Date.now(),
      error: message,
      logs,
      workspace: workspace ? publicWorkspace(workspace) : undefined,
      riskNotes: workspace?.riskNotes || [],
    });
    appendEvent(jobStore, run.jobId, {
      type: "arena.candidate.failed",
      message,
      actor: providerId,
      status: "failed",
      data: { runId: run.id, candidateId: candidate.id },
    });
    return { ok: false, candidate: failed, error: message };
  }
}

function runQualityGates({ workspacePath, changedFiles, patch }) {
  const now = Date.now();
  const gates = [];
  const jsFiles = changedFiles.filter((file) => /\.(cjs|mjs|js)$/i.test(file) && fs.existsSync(path.join(workspacePath, file)));
  if (jsFiles.length) {
    const started = Date.now();
    let failed = null;
    for (const file of jsFiles) {
      const result = runArenaCommand({ id: "syntax-check", executable: process.execPath, args: ["--check", file], cwd: workspacePath, timeoutMs: 30_000, outputBytes: 3 * 1024 * 1024, mutating: false });
      if (result.status !== 0) {
        failed = { file, result };
        break;
      }
    }
    gates.push({
      id: newId("gate"),
      gate: "syntax check",
      status: failed ? "failed" : "passed",
      message: failed ? `${failed.file}: ${(failed.result.stderr || failed.result.stdout || "").trim()}` : `${jsFiles.length} JavaScript file(s) passed syntax check`,
      command: `${process.execPath} --check <changed-js>`,
      exitCode: failed ? failed.result.status ?? 1 : 0,
      durationMs: Date.now() - started,
      createdAt: now,
      metadata: { files: jsFiles, executionPolicy: failed?.result?.executionPolicy },
    });
  } else {
    gates.push({ id: newId("gate"), gate: "syntax check", status: "skipped", message: "no changed JavaScript files", createdAt: now });
  }

  gates.push(runNpmGate({ workspacePath, script: "build", gate: "npm run build" }));
  gates.push(runTestGate(workspacePath));

  gates.push({
    id: newId("gate"),
    gate: "changed files summary",
    status: "passed",
    message: changedFiles.length ? `${changedFiles.length} changed file(s): ${changedFiles.slice(0, 12).join(", ")}` : "no file changes",
    createdAt: now,
    metadata: { changedFiles, patchSize: String(patch || "").length },
  });
  const risky = changedFiles.filter((file) => RISKY_FILE_RE.test(file));
  gates.push({
    id: newId("gate"),
    gate: "risky file detection",
    status: risky.length ? "warning" : "passed",
    message: risky.length ? `risky files changed: ${risky.join(", ")}` : "no risky files detected",
    createdAt: now,
    metadata: { files: risky },
  });
  const security = changedFiles.filter((file) => SECURITY_FILE_RE.test(file));
  gates.push({
    id: newId("gate"),
    gate: "security-sensitive file detection",
    status: security.length ? "warning" : "passed",
    message: security.length ? `security-sensitive files changed: ${security.join(", ")}` : "no security-sensitive files detected",
    createdAt: now,
    metadata: { files: security },
  });
  return gates;
}

function runNpmGate({ workspacePath, script, gate }) {
  const now = Date.now();
  if (!fs.existsSync(path.join(workspacePath, "package.json"))) {
    return { id: newId("gate"), gate, status: "skipped", message: "package.json not found", createdAt: now };
  }
  const pkg = readPackageJson(path.join(workspacePath, "package.json"));
  if (!pkg?.scripts?.[script]) return { id: newId("gate"), gate, status: "skipped", message: `${script} script not found`, createdAt: now };
  if (!commandExists("npm", workspacePath)) return { id: newId("gate"), gate, status: "warning", message: "npm is not available in PATH", createdAt: now };
  const started = Date.now();
  const result = runArenaCommand({ id: `npm-${script}`, executable: "npm", args: ["run", script], cwd: workspacePath, timeoutMs: 180_000, outputBytes: 8 * 1024 * 1024, mutating: true });
  return {
    id: newId("gate"),
    gate,
    status: result.status === 0 ? "passed" : "failed",
    message: tail(`${result.stdout || ""}${result.stderr || ""}`) || `npm run ${script} exited ${result.status}`,
    command: `npm run ${script}`,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    createdAt: now,
    metadata: { executionPolicy: result.executionPolicy },
  };
}

function runTestGate(workspacePath) {
  const now = Date.now();
  if (fs.existsSync(path.join(workspacePath, "test", "feature-tests.mjs"))) {
    const started = Date.now();
    const result = runArenaCommand({ id: "feature-tests", executable: process.execPath, args: ["test/feature-tests.mjs"], cwd: workspacePath, timeoutMs: 180_000, outputBytes: 8 * 1024 * 1024, mutating: true });
    return {
      id: newId("gate"),
      gate: "feature tests",
      status: result.status === 0 ? "passed" : "failed",
      message: tail(`${result.stdout || ""}${result.stderr || ""}`) || `feature tests exited ${result.status}`,
      command: `${process.execPath} test/feature-tests.mjs`,
      exitCode: result.status ?? 1,
      durationMs: Date.now() - started,
      createdAt: now,
      metadata: { executionPolicy: result.executionPolicy },
    };
  }
  return runNpmGate({ workspacePath, script: "test", gate: "npm run test" });
}

function saveCandidateArtifacts({ candidateRoot, changes, commandResult, gates, score, providerId, task, definitionOfDone }) {
  fs.mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
  const artifacts = [];
  artifacts.push(writeJsonArtifact(candidateRoot, "summary.json", "summary", {
    providerId,
    task,
    summary: changes.summary,
    changedFiles: changes.changedFiles,
    score,
    createdAt: Date.now(),
  }));
  artifacts.push(writeJsonArtifact(candidateRoot, "changed-files.json", "changed-files", {
    changedFiles: changes.changedFiles,
    riskNotes: changes.riskNotes,
  }));
  artifacts.push(writeTextArtifact(candidateRoot, "logs.txt", "logs", commandResult.output || commandResult.logs.join("\n")));
  artifacts.push(writeJsonArtifact(candidateRoot, "gate-results.json", "gate-results", { gates, score }));
  if (definitionOfDone) {
    artifacts.push(writeJsonArtifact(candidateRoot, "definition-of-done.json", "definition-of-done", definitionOfDone));
  }
  return artifacts;
}

function scoreCandidate({ gateResults, changedFiles }) {
  const failed = gateResults.filter((gate) => gate.status === "failed").length;
  const warnings = gateResults.filter((gate) => gate.status === "warning").length;
  const passed = gateResults.filter((gate) => gate.status === "passed").length;
  const riskyFiles = changedFiles.filter((file) => RISKY_FILE_RE.test(file)).length;
  const securitySensitiveFiles = changedFiles.filter((file) => SECURITY_FILE_RE.test(file)).length;
  const skeletonFindings = gateResults.reduce((count, gate) => count + Number(gate.metadata?.definitionOfDone?.skeleton?.summary?.total || 0), 0);
  const skeletonBlocking = gateResults.reduce((count, gate) => count + Number(gate.metadata?.definitionOfDone?.skeleton?.summary?.blocking || 0), 0);
  const total = Math.max(0, 100 - failed * 25 - warnings * 8 - riskyFiles * 5 - securitySensitiveFiles * 8 - skeletonFindings * 10 - skeletonBlocking * 15);
  const notes = [];
  if (failed) notes.push(`${failed} quality gate(s) failed`);
  if (warnings) notes.push(`${warnings} quality warning(s)`);
  if (riskyFiles) notes.push(`${riskyFiles} risky file(s) changed`);
  if (securitySensitiveFiles) notes.push(`${securitySensitiveFiles} security-sensitive file(s) changed`);
  if (skeletonFindings) notes.push(`${skeletonFindings} skeleton risk(s) detected`);
  return {
    total,
    gatesPassed: passed,
    gatesFailed: failed,
    riskyFiles,
    securitySensitiveFiles,
    skeletonFindings,
    skeletonBlocking,
    changedFiles: changedFiles.length,
    notes,
  };
}

function definitionOfDoneCandidateGate(definitionOfDone) {
  const status = definitionOfDone.status === "failed" ? "failed" : definitionOfDone.status === "warning" ? "warning" : "passed";
  return {
    id: newId("gate"),
    gate: "skeleton detector",
    status,
    message: `Definition of Done ${definitionOfDone.status}: ${definitionOfDone.summary.failed} failed check(s), ${definitionOfDone.skeleton.summary.total} skeleton risk(s)`,
    createdAt: definitionOfDone.checkedAt,
    artifactPath: definitionOfDone.evidencePath,
    metadata: {
      evidencePath: definitionOfDone.evidencePath,
      definitionOfDone,
      remediation: definitionOfDone.remediation,
    },
  };
}

function skeletonRiskNotes(definitionOfDone) {
  const findings = definitionOfDone?.skeleton?.findings || [];
  return findings.slice(0, 12).map((finding) => `${finding.type}: ${finding.message}`);
}

function decideCandidate({ arenaStore, jobStore, runId, candidateId, payload, decision }) {
  const run = arenaStore.getRun(ipcString(runId));
  if (!run) return { ok: false, error: "arena run not found" };
  const candidate = run.candidates.find((item) => item.id === ipcString(candidateId));
  if (!candidate) return { ok: false, error: "arena candidate not found" };
  const input = ipcObject(payload);
  const record = arenaStore.addDecision(run.id, {
    candidateId: candidate.id,
    decision,
    actor: ipcString(input.actor, "user") || "user",
    reason: ipcString(input.reason, `${decision} from Patch Arena UI`),
    patchPath: candidate.patch?.path,
    result: { ok: true },
  });
  appendEvent(jobStore, run.jobId, {
    type: `arena.candidate.${decision}`,
    message: `${decision} candidate ${candidate.id}`,
    actor: record.actor,
    data: { runId: run.id, candidateId: candidate.id, decisionId: record.id },
  });
  return { ok: true, run: arenaStore.getRun(run.id), candidate, decision: record };
}

function providerCommand(commandByProvider, providerId, fallbackCommand, task, candidateId) {
  const explicit = ipcString(commandByProvider[providerId]).trim() || ipcString(fallbackCommand).trim();
  if (explicit) return explicit;
  const safeTask = JSON.stringify(`# Patch Arena Candidate\n\nProvider: ${providerId}\nCandidate: ${candidateId}\n\nTask:\n${task}\n`);
  return `mkdir -p .hicode/arena && printf %s ${shellQuote(JSON.parse(safeTask))} > .hicode/arena/${shellSafe(candidateId)}.md`;
}

function providerName(providerService, providerId) {
  try {
    const provider = providerService?.getProvider?.(providerId)?.provider;
    return provider?.name || providerId;
  } catch {
    return providerId;
  }
}

function validateProviderIds(providerService, providerIds) {
  if (!providerService || typeof providerService.listProviders !== "function") return { ok: true };
  try {
    const providers = providerService.listProviders()?.providers || [];
    const known = new Map(providers.map((provider) => [provider.id, provider]));
    for (const providerId of providerIds) {
      const provider = known.get(providerId);
      if (!provider) return { ok: false, error: `provider not found: ${providerId}` };
      if (provider.status !== "enabled") {
        return { ok: false, error: `provider ${providerId} is ${provider.status || "not available"}` };
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  return { ok: true };
}

function normalizeArenaMode(mode) {
  return ["auto", "worktree", "copy", "dry-run"].includes(mode) ? mode : "auto";
}

function readPackageJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function commandExists(command, cwd) {
  const result = runArenaCommand({ id: "command-exists", executable: "bash", args: ["-lc", `command -v ${shellQuote(command)}`], cwd, timeoutMs: 5_000, outputBytes: 64 * 1024, mutating: false });
  return result.status === 0;
}

function runArenaCommand({ id, executable, args, cwd, timeoutMs, outputBytes, mutating }) {
  const electronNodeMode = executable === process.execPath && Boolean(process.versions.electron);
  const result = runManagedExecutionSync({
    id: `patch-arena:${id}`,
    surface: "patch-arena-gate",
    executable,
    args,
    cwd,
    allowedRoots: [cwd],
    filesystem: mutating ? "workspace-write" : "read-only",
    network: "allow",
    environment: {
      source: process.env,
      ...(electronNodeMode ? { extraEnv: { ELECTRON_RUN_AS_NODE: "1" } } : {}),
    },
    limits: { timeoutMs, outputBytes },
    approval: { required: false, granted: true },
    processTree: { required: true },
    enforcementMode: "report-only",
  });
  return {
    status: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? new Error(result.error) : undefined,
    executionPolicy: result.policy,
  };
}

function gitDirty(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root.ok || !root.out) return { ok: false, error: "merge requires a Git workspace" };
  const status = git(root.out, ["status", "--porcelain=v1"]);
  if (!status.ok) return { ok: false, error: status.err || status.out || "git status failed" };
  return { ok: true, dirty: Boolean(status.out.trim()), root: root.out };
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 12 * 1024 * 1024, env: buildSafeChildEnv() });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trimEnd(),
    err: (result.stderr || "").trim(),
    status: result.status,
  };
}

function gitWithInput(cwd, args, input) {
  const result = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 12 * 1024 * 1024, env: buildSafeChildEnv() });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trimEnd(),
    err: (result.stderr || "").trim(),
    status: result.status,
  };
}

function normalizePatchForApply(patch) {
  const text = String(patch || "");
  return text && !text.endsWith("\n") ? `${text}\n` : text;
}

function updateJobStatus(jobStore, jobId, status, error) {
  if (!jobId) return;
  try {
    const current = jobStore.getJob(jobId);
    if (!current || current.status === status || ["failed", "cancelled", "succeeded"].includes(current.status)) return;
    jobStore.updateJob(jobId, { status, error });
  } catch {
    /* Job status telemetry should not mask arena results. */
  }
}

function appendEvent(jobStore, jobId, event) {
  if (!jobId) return;
  try {
    jobStore.appendJobEvent(jobId, event);
  } catch {
    /* Job events are durable telemetry, not control flow. */
  }
}

function addJobArtifact(jobStore, jobId, artifact, candidateId) {
  try {
    jobStore.addArtifact(jobId, {
      type: artifact.type,
      path: artifact.path,
      name: artifact.name,
      size: artifact.size,
      sha256: artifact.sha256,
      producedBy: { executor: "patch-arena" },
      metadata: { candidateId },
    });
  } catch (error) {
    appendEvent(jobStore, jobId, {
      type: "arena.artifact.failed",
      message: errorMessage(error),
      actor: "patch-arena",
      status: "failed",
      data: { candidateId, artifact },
    });
  }
}

function addJobGate(jobStore, jobId, gate, candidateId) {
  try {
    jobStore.addGateResult(jobId, {
      gate: gate.gate,
      status: gate.status,
      message: gate.message,
      score: gate.status === "passed" ? 1 : gate.status === "failed" ? 0 : undefined,
      metadata: {
        candidateId,
        command: gate.command,
        exitCode: gate.exitCode,
        durationMs: gate.durationMs,
        ...gate.metadata,
      },
    });
  } catch {
    /* Gate write should not mask the original candidate result. */
  }
}

function findCandidateArtifact(arenaStore, runId, candidateId, artifactPath) {
  const run = arenaStore.getRun(ipcString(runId));
  if (!run) return { ok: false, error: "arena run not found" };
  const candidate = run.candidates.find((item) => item.id === ipcString(candidateId));
  if (!candidate) return { ok: false, error: "arena candidate not found" };
  const requested = path.resolve(ipcString(artifactPath));
  const artifact = (candidate.artifacts || []).find((item) => path.resolve(item.path) === requested);
  if (!artifact && path.resolve(candidate.patch?.path || "") !== requested) return { ok: false, error: "artifact not found" };
  if (!fs.existsSync(requested)) return { ok: false, error: "artifact file does not exist" };
  return { ok: true, path: requested };
}

function readPreview(file) {
  const stat = fs.statSync(file);
  if (stat.size > 512_000) return fs.readFileSync(file, "utf8").slice(0, 512_000);
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) throw new Error("binary artifact cannot be previewed");
  return buffer.toString("utf8");
}

function writeJsonArtifact(root, name, type, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  return artifact(type, file, name);
}

function writeTextArtifact(root, name, type, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, String(value || ""), { mode: 0o600 });
  return artifact(type, file, name);
}

function artifact(type, file, name) {
  const size = fs.statSync(file).size;
  return { type, path: file, name, size, sha256: sha256File(file) };
}

function sha256File(file) {
  if (!file || !fs.existsSync(file)) return undefined;
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assertArtifactInsideKnownRoots(file, roots) {
  const resolved = path.resolve(file);
  if (roots.some((root) => isInside(path.resolve(root), resolved))) return;
  throw new Error("artifact path escapes Patch Arena roots");
}

function publicWorkspace(workspace) {
  return {
    id: workspace.id,
    mode: workspace.mode,
    sourcePath: workspace.sourcePath,
    workspacePath: workspace.workspacePath,
    safeRoot: workspace.safeRoot,
    dirtySource: workspace.dirtySource,
    riskNotes: workspace.riskNotes,
  };
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarize(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean || "Patch Arena run";
}

function tail(text, length = 4000) {
  const value = String(text || "").trim();
  return value.length > length ? value.slice(-length) : value;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function shellSafe(value) {
  return String(value || "candidate").replace(/[^a-z0-9._-]/gi, "-");
}

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "operation failed");
}
