import fs from "node:fs";
import path from "node:path";
import { ipcBoundedNumber, ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createJobService({ jobStore, shell = null, allowedArtifactRoots = [] }) {
  if (!jobStore) throw new Error("job-service requires jobStore");
  return {
    createJob(payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, job: jobStore.createJob(input) };
    },

    listJobs(payload = {}) {
      const input = ipcObject(payload);
      return {
        ok: true,
        jobs: jobStore.listJobs({
          status: ipcString(input.status, undefined),
          source: ipcString(input.source, undefined),
          limit: input.limit === undefined ? undefined : ipcBoundedNumber(input.limit, 50, { min: 0, max: 500 }),
        }),
      };
    },

    getJob(jobId) {
      const job = jobStore.getJob(ipcString(jobId));
      return job ? { ok: true, job } : { ok: false, error: "job not found" };
    },

    updateJob(jobId, payload = {}) {
      return { ok: true, job: jobStore.updateJob(ipcString(jobId), ipcObject(payload)) };
    },

    appendJobEvent(jobId, payload = {}) {
      return { ok: true, event: jobStore.appendJobEvent(ipcString(jobId), ipcObject(payload)) };
    },

    addArtifact(jobId, payload = {}) {
      return { ok: true, artifact: jobStore.addArtifact(ipcString(jobId), ipcObject(payload)) };
    },

    addGateResult(jobId, payload = {}) {
      return { ok: true, gateResult: jobStore.addGateResult(ipcString(jobId), ipcObject(payload)) };
    },

    cancelJob(jobId, payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, job: jobStore.cancelJob(ipcString(jobId), ipcString(input.reason, "cancelled"), ipcString(input.actor, "user")) };
    },

    retryJob(jobId, payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, job: jobStore.retryJob(ipcString(jobId), ipcString(input.actor, "user")) };
    },

    pauseJob(jobId, payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, job: jobStore.pauseJob(ipcString(jobId), ipcString(input.actor, "user")) };
    },

    resumeJob(jobId, payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, job: jobStore.resumeJob(ipcString(jobId), ipcString(input.actor, "user")) };
    },

    listEvents(jobId) {
      const job = jobStore.getJob(ipcString(jobId));
      return job ? { ok: true, events: job.events } : { ok: false, error: "job not found" };
    },

    listArtifacts(jobId) {
      const job = jobStore.getJob(ipcString(jobId));
      return job ? { ok: true, artifacts: job.artifacts } : { ok: false, error: "job not found" };
    },

    previewArtifact(jobId, artifactId) {
      const artifact = findArtifact(jobStore, jobId, artifactId);
      if (!artifact.ok) return artifact;
      const guard = assertArtifactReadable(artifact.artifact.path, allowedArtifactRoots);
      if (!guard.ok) return guard;
      try {
        const stat = fs.statSync(artifact.artifact.path);
        if (!stat.isFile()) return { ok: false, error: "artifact is not a file" };
        if (stat.size > 200_000) return { ok: false, error: "artifact too large to preview" };
        return {
          ok: true,
          artifact: artifact.artifact,
          content: fs.readFileSync(artifact.artifact.path, "utf8"),
        };
      } catch (error) {
        return { ok: false, error: error?.code === "ENOENT" ? "artifact file does not exist" : (error?.message || "cannot preview artifact") };
      }
    },

    openArtifact(jobId, artifactId) {
      if (!shell || typeof shell.showItemInFolder !== "function") return { ok: false, error: "shell is not available" };
      const artifact = findArtifact(jobStore, jobId, artifactId);
      if (!artifact.ok) return artifact;
      const guard = assertArtifactReadable(artifact.artifact.path, allowedArtifactRoots);
      if (!guard.ok) return guard;
      if (!fs.existsSync(artifact.artifact.path)) return { ok: false, error: "artifact file does not exist" };
      shell.showItemInFolder(artifact.artifact.path);
      return { ok: true };
    },
  };
}

export function registerJobIpc({ register, job }) {
  if (!register) throw new Error("registerJobIpc requires register");
  if (!job) throw new Error("registerJobIpc requires job service");

  register.handle("job:create", (_event, payload) => job.createJob(payload));
  register.handle("job:list", (_event, payload) => job.listJobs(payload));
  register.handle("job:get", (_event, jobId) => job.getJob(jobId));
  register.handle("job:update", (_event, jobId, payload) => job.updateJob(jobId, payload));
  register.handle("job:event:add", (_event, jobId, payload) => job.appendJobEvent(jobId, payload));
  register.handle("job:artifact:add", (_event, jobId, payload) => job.addArtifact(jobId, payload));
  register.handle("job:gate:add", (_event, jobId, payload) => job.addGateResult(jobId, payload));
  register.handle("job:cancel", (_event, jobId, payload) => job.cancelJob(jobId, payload));
  register.handle("job:retry", (_event, jobId, payload) => job.retryJob(jobId, payload));
  register.handle("job:pause", (_event, jobId, payload) => job.pauseJob(jobId, payload));
  register.handle("job:resume", (_event, jobId, payload) => job.resumeJob(jobId, payload));
  register.handle("job:events", (_event, jobId) => job.listEvents(jobId));
  register.handle("job:artifacts", (_event, jobId) => job.listArtifacts(jobId));
  register.handle("job:artifact:preview", (_event, jobId, artifactId) => job.previewArtifact(jobId, artifactId));
  register.handle("job:artifact:open", (_event, jobId, artifactId) => job.openArtifact(jobId, artifactId));
}

function findArtifact(jobStore, jobId, artifactId) {
  const job = jobStore.getJob(ipcString(jobId));
  if (!job) return { ok: false, error: "job not found" };
  const artifact = job.artifacts.find((item) => item.id === ipcString(artifactId));
  return artifact ? { ok: true, artifact } : { ok: false, error: "artifact not found" };
}

function assertArtifactReadable(artifactPath, roots) {
  const target = ipcString(artifactPath);
  if (!target) return { ok: false, error: "artifact path is empty" };
  if (!path.isAbsolute(target)) return { ok: false, error: "artifact path must be absolute" };
  const allowed = roots
    .map((root) => typeof root === "function" ? root() : root)
    .filter((root) => typeof root === "string" && root)
    .map((root) => {
      const resolvedRoot = path.resolve(root);
      try {
        return fs.realpathSync.native(resolvedRoot);
      } catch {
        return resolvedRoot;
      }
    });
  if (!allowed.length) return { ok: false, error: "artifact roots are not configured" };
  const resolved = (() => {
    try {
      return fs.realpathSync.native(target);
    } catch {
      return path.resolve(target);
    }
  })();
  const ok = allowed.some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
  });
  return ok ? { ok: true, path: resolved } : { ok: false, error: "artifact path escapes allowed roots" };
}
