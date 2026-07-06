import fs from "node:fs";
import path from "node:path";

import { IndustrialProjectStore } from "../../dist/industrial-project.js";
import { ReleaseBuilder } from "../../dist/release-builder.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createReleaseService({ getCwd, jobStore, shell }) {
  if (typeof getCwd !== "function") throw new Error("release-service requires getCwd");
  if (!jobStore) throw new Error("release-service requires jobStore");

  return {
    readiness(payload = {}) {
      const input = ipcObject(payload);
      try {
        const cwd = safeWorkspace(getCwd());
        const builder = new ReleaseBuilder({ workspacePath: cwd, jobs: listWorkspaceJobs(jobStore, cwd) });
        return { ok: true, readiness: builder.getReadiness({ version: ipcString(input.version, undefined) }) };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    buildRelease(payload = {}) {
      const input = ipcObject(payload);
      let job = null;
      const actor = ipcString(input.createdBy || input.actor, "user");
      try {
        const cwd = safeWorkspace(getCwd());
        const version = ipcString(input.version);
        job = jobStore.createJob({
          title: `Build release package${version ? ` ${version}` : ""}`,
          source: "release-builder",
          trigger: "release:build",
          actor,
          executor: "release-builder",
          cwd,
          tasks: [
            { title: "Check release readiness", executor: "release-builder" },
            { title: "Copy artifacts and evidence", executor: "release-builder" },
            { title: "Write manifest, notes, report, and checksums", executor: "release-builder" },
          ],
          metadata: { version, releaseReadable: true },
        });
        jobStore.updateJob(job.id, { status: "running" });
        jobStore.appendJobEvent(job.id, {
          type: "release.readiness.check.started",
          message: "Checking release readiness",
          actor,
        });
        const builder = new ReleaseBuilder({ workspacePath: cwd, jobs: listWorkspaceJobs(jobStore, cwd) });
        const readiness = builder.getReadiness({ version });
        jobStore.appendJobEvent(job.id, {
          type: "release.readiness.check.completed",
          message: readiness.ready ? "Release readiness passed" : "Release readiness blocked",
          actor,
          data: { ready: readiness.ready, blockers: readiness.blockers, warnings: readiness.warnings },
        });
        recordDefinitionOfDoneJobEvidence({ jobStore, jobId: job.id, actor, definitionOfDone: readiness.definitionOfDone });
        if (!readiness.ready) throw new Error(`release readiness blocked: ${readiness.blockers.map((item) => item.message).join("; ")}`);

        jobStore.appendJobEvent(job.id, {
          type: "release.package.build.started",
          message: `Building release package ${readiness.version}`,
          actor,
          data: { version: readiness.version, releasePath: readiness.releasePath },
        });
        const releasePackage = builder.buildRelease({
          version: readiness.version,
          createdBy: actor,
          overwrite: input.overwrite === true,
          includeSourceCode: input.includeSourceCode !== false,
          includeBuildOutput: input.includeBuildOutput !== false,
          includeDocs: input.includeDocs !== false,
        });
        const manifestStat = fs.statSync(releasePackage.manifestPath);
        const manifestArtifact = jobStore.addArtifact(job.id, {
          type: "release_package",
          path: releasePackage.manifestPath,
          name: "release-manifest.json",
          size: manifestStat.size,
          sha256: releasePackage.checksums["release-manifest.json"],
          producedBy: { executor: "release-builder" },
          metadata: {
            releaseId: releasePackage.releaseId,
            version: releasePackage.version,
            releasePath: releasePackage.releasePath,
            releaseReadable: true,
          },
        });
        jobStore.addGateResult(job.id, {
          gate: "release.readiness",
          status: releasePackage.readiness.warnings.length ? "warning" : "passed",
          message: releasePackage.readiness.warnings.length ? "Release built with warnings recorded in release notes." : "Release package is ready.",
          artifacts: [manifestArtifact.id],
          metadata: {
            releaseId: releasePackage.releaseId,
            warnings: releasePackage.readiness.warnings,
            blockers: releasePackage.readiness.blockers,
            manifestPath: releasePackage.manifestPath,
            releaseReadable: true,
          },
        });
        recordProjectReleaseArtifact({ cwd, releasePackage, actor });
        jobStore.appendJobEvent(job.id, {
          type: "release.package.build.completed",
          message: `Release package built at ${path.relative(cwd, releasePackage.releasePath)}`,
          actor,
          data: {
            releaseId: releasePackage.releaseId,
            version: releasePackage.version,
            releasePath: releasePackage.releasePath,
            manifestPath: releasePackage.manifestPath,
          },
        });
        jobStore.updateJob(job.id, { status: "succeeded" });
        return { ok: true, jobId: job.id, releasePackage, readiness: releasePackage.readiness };
      } catch (error) {
        if (job?.id) {
          try {
            jobStore.addGateResult(job.id, {
              gate: "release.readiness",
              status: "failed",
              message: errorMessage(error),
              artifacts: [],
              metadata: { releaseReadable: true },
            });
            jobStore.appendJobEvent(job.id, {
              type: "release.package.build.failed",
              message: errorMessage(error),
              actor,
              status: "failed",
            });
            jobStore.updateJob(job.id, { status: "failed", error: errorMessage(error) });
          } catch {
            /* keep original release error */
          }
        }
        return { ok: false, jobId: job?.id, error: errorMessage(error) };
      }
    },

    openRelease(payload = {}) {
      const input = ipcObject(payload);
      try {
        if (!shell) return { ok: false, error: "shell API unavailable" };
        const cwd = safeWorkspace(getCwd());
        const releasePath = releasePathFromPayload(cwd, input);
        if (!fs.existsSync(releasePath)) return { ok: false, error: "release package not found" };
        const manifest = path.join(releasePath, "release-manifest.json");
        if (fs.existsSync(manifest) && typeof shell.showItemInFolder === "function") shell.showItemInFolder(manifest);
        else if (typeof shell.openPath === "function") shell.openPath(releasePath);
        return { ok: true, releasePath };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export function registerReleaseIpc({ register, release }) {
  if (!register) throw new Error("registerReleaseIpc requires register");
  if (!release) throw new Error("registerReleaseIpc requires release service");
  register.handle("release:readiness", (_event, payload) => release.readiness(payload));
  register.handle("release:build", (_event, payload) => release.buildRelease(payload));
  register.handle("release:open", (_event, payload) => release.openRelease(payload));
}

function listWorkspaceJobs(jobStore, cwd) {
  try {
    return jobStore.listJobs({ limit: 250 }).filter((job) => (job.cwd && pathInside(cwd, job.cwd)) || job.metadata?.releaseReadable === true);
  } catch {
    return [];
  }
}

function recordProjectReleaseArtifact({ cwd, releasePackage, actor }) {
  try {
    const store = new IndustrialProjectStore({ workspacePath: cwd });
    if (!store.getProject()) return;
    store.addArtifact({
      id: `release-${releasePackage.version}`,
      type: "release_package",
      name: `Release package ${releasePackage.version}`,
      path: path.relative(cwd, releasePackage.manifestPath),
      status: "released",
      actor,
      metadata: {
        releaseId: releasePackage.releaseId,
        releasePath: path.relative(cwd, releasePackage.releasePath),
        manifestPath: path.relative(cwd, releasePackage.manifestPath),
        checksumPath: path.relative(cwd, releasePackage.checksumPath),
      },
    });
  } catch {
    /* Project release artifact is best-effort; Job artifact is authoritative. */
  }
}

function recordDefinitionOfDoneJobEvidence({ jobStore, jobId, actor, definitionOfDone }) {
  if (!definitionOfDone) return;
  const status = definitionOfDone.status === "failed" ? "failed" : definitionOfDone.status === "warning" ? "warning" : "passed";
  const message = `Definition of Done ${definitionOfDone.status}: ${definitionOfDone.summary.failed} failed check(s), ${definitionOfDone.skeleton.summary.total} skeleton risk(s)`;
  try {
    jobStore.appendJobEvent(jobId, {
      type: "definition-of-done.checked",
      message,
      actor,
      status,
      data: {
        source: definitionOfDone.source,
        evidencePath: definitionOfDone.evidencePath,
        summary: definitionOfDone.summary,
        skeletonSummary: definitionOfDone.skeleton.summary,
        remediation: definitionOfDone.remediation,
      },
    });
    jobStore.addGateResult(jobId, {
      gate: "definition-of-done",
      status,
      message,
      artifacts: [],
      metadata: {
        releaseReadable: true,
        evidencePath: definitionOfDone.evidencePath,
        definitionOfDone,
        remediation: definitionOfDone.remediation,
      },
    });
  } catch {
    /* DoD telemetry should not hide the release readiness result. */
  }
}

function releasePathFromPayload(cwd, input) {
  const rawPath = ipcString(input.releasePath);
  const version = ipcString(input.version);
  const candidate = rawPath ? (path.isAbsolute(rawPath) ? rawPath : path.join(cwd, rawPath)) : path.join(cwd, "releases", version);
  const safeReleases = path.join(cwd, "releases");
  const resolved = path.resolve(candidate);
  if (!pathInside(safeReleases, resolved)) throw new Error("release path escapes releases directory");
  return resolved;
}

function safeWorkspace(value) {
  const cwd = path.resolve(ipcString(value));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("workspace not found");
  return realOrResolve(cwd);
}

function pathInside(root, target) {
  const rel = path.relative(realOrResolve(root), realOrResolve(target));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function realOrResolve(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "release operation failed");
}
