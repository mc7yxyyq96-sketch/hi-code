import fs from "node:fs";
import path from "node:path";

import {
  createIndustrialControlBoxSample,
  INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION,
} from "../../dist/industrial-control-box-sample.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

const VALID_SAMPLE_IDS = new Set(["", "industrial-control-box", "industrial-control-box-demo"]);
const SAMPLE_PACK_IDS = ["mechanical-cad", "pcb-eda", "plc-automation", "energy-electrical", "manufacturing-qa", "software-product"];

export function createSampleProjectService({ getCwd, jobStore, registry, domainPackManager }) {
  if (typeof getCwd !== "function") throw new Error("sample-project-service requires getCwd");
  if (!jobStore) throw new Error("sample-project-service requires jobStore");
  if (!registry) throw new Error("sample-project-service requires industrial tool registry");

  return {
    createIndustrialControlBox(payload = {}) {
      const input = ipcObject(payload);
      let job = null;
      const actor = ipcString(input.actor, "user");
      try {
        const sampleId = ipcString(input.sampleId || input.id, "industrial-control-box");
        if (!VALID_SAMPLE_IDS.has(sampleId)) throw new Error("unsupported sample project id");
        const cwd = safeWorkspace(getCwd());
        const runInstalledTools = input.runInstalledTools === true;
        const overwrite = input.overwrite === true;
        const releaseVersion = ipcString(input.releaseVersion, INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION);

        job = jobStore.createJob({
          title: "Create Industrial Control Box Demo",
          source: "sample-project",
          trigger: "sample:industrial-control-box:create",
          actor,
          executor: "sample-project-service",
          cwd,
          tasks: [
            { title: "Create industrial project manifest", executor: "sample-project-service" },
            { title: "Generate CAD/PCB/PLC/electrical/docs artifacts", executor: "sample-project-service" },
            { title: "Run quality gates", executor: "sample-project-service" },
            { title: "Build release package", executor: "release-builder" },
          ],
          metadata: {
            sampleId,
            releaseVersion,
            runInstalledTools,
            releaseReadable: true,
          },
        });
        jobStore.updateJob(job.id, { status: "running" });
        append(jobStore, job.id, "sample.create.started", "Creating Industrial Control Box Demo sample project", actor, { cwd, runInstalledTools, overwrite });

        enableSampleDomainPacks({ domainPackManager, jobStore, jobId: job.id, actor });

        const result = createIndustrialControlBoxSample({
          workspacePath: cwd,
          registry,
          actor,
          runInstalledTools,
          overwrite,
          releaseVersion,
        });

        append(jobStore, job.id, "sample.project.created", "Industrial project manifest and artifacts generated", actor, {
          projectId: result.project.projectId,
          projectPath: result.projectPath,
          artifactCount: result.artifacts.length,
        });
        for (const toolRun of result.toolRuns) {
          append(jobStore, job.id, "sample.tool.completed", `${toolRun.adapterId} ${toolRun.mode}: ${toolRun.summary}`, actor, toolRun);
        }
        const jobArtifactIds = [];
        for (const artifact of result.artifacts) {
          if (!fs.existsSync(artifact.absolutePath)) continue;
          const stat = fs.statSync(artifact.absolutePath);
          const jobArtifact = jobStore.addArtifact(job.id, {
            type: artifact.type,
            path: artifact.absolutePath,
            name: artifact.name,
            size: stat.isFile() ? stat.size : undefined,
            producedBy: { executor: "sample-project-service" },
            metadata: {
              sampleId: result.sampleId,
              relativePath: artifact.relativePath,
              simulated: artifact.simulated,
              generated: artifact.generated,
              externalRequired: artifact.externalRequired === true,
              releaseReadable: true,
            },
          });
          jobArtifactIds.push(jobArtifact.id);
        }
        for (const gate of result.gates) {
          jobStore.addGateResult(job.id, {
            gate: gate.id,
            status: toJobGateStatus(gate.status),
            message: gate.message,
            artifacts: jobArtifactIds,
            metadata: {
              sampleId: result.sampleId,
              gateName: gate.name,
              gateType: gate.type,
              evidencePath: gate.resultPath,
              releaseReadable: true,
            },
          });
        }
        const releaseManifestStat = fs.statSync(result.releasePackage.manifestPath);
        const manifestArtifact = jobStore.addArtifact(job.id, {
          type: "release_package",
          path: result.releasePackage.manifestPath,
          name: "release-manifest.json",
          size: releaseManifestStat.size,
          producedBy: { executor: "release-builder" },
          metadata: {
            sampleId: result.sampleId,
            releaseId: result.releasePackage.releaseId,
            releasePath: result.releasePackage.releasePath,
            releaseReadable: true,
          },
        });
        jobStore.addGateResult(job.id, {
          gate: "sample.release.readiness",
          status: result.readiness.warnings.length ? "warning" : "passed",
          message: result.readiness.warnings.length ? "Demo release built with warnings recorded in release notes." : "Demo release package is ready.",
          artifacts: [manifestArtifact.id],
          metadata: {
            sampleId: result.sampleId,
            warnings: result.readiness.warnings,
            blockers: result.readiness.blockers,
            releaseReadable: true,
          },
        });
        append(jobStore, job.id, "sample.release.built", `Demo release package built at ${path.relative(cwd, result.releasePackage.releasePath)}`, actor, {
          releaseId: result.releasePackage.releaseId,
          releasePath: result.releasePackage.releasePath,
          manifestPath: result.releasePackage.manifestPath,
        });
        jobStore.updateJob(job.id, { status: "succeeded" });
        return { ok: true, jobId: job.id, sample: result, project: result.project, releasePackage: result.releasePackage, readiness: result.readiness };
      } catch (error) {
        if (job?.id) {
          try {
            jobStore.addGateResult(job.id, {
              gate: "sample.industrial_control_box",
              status: "failed",
              message: errorMessage(error),
              artifacts: [],
              metadata: { releaseReadable: true },
            });
            append(jobStore, job.id, "sample.create.failed", errorMessage(error), actor, {}, "failed");
            jobStore.updateJob(job.id, { status: "failed", error: errorMessage(error) });
          } catch {
            /* Keep the original error. */
          }
        }
        return { ok: false, jobId: job?.id, error: errorMessage(error) };
      }
    },
  };
}

export function registerSampleProjectIpc({ register, sampleProject }) {
  if (!register) throw new Error("registerSampleProjectIpc requires register");
  if (!sampleProject) throw new Error("registerSampleProjectIpc requires sampleProject service");
  register.handle("sample:industrial-control-box:create", (_event, payload) => sampleProject.createIndustrialControlBox(payload));
}

function enableSampleDomainPacks({ domainPackManager, jobStore, jobId, actor }) {
  if (!domainPackManager) return;
  for (const id of SAMPLE_PACK_IDS) {
    try {
      domainPackManager.installDomainPack({ id, source: "builtin", actor });
      domainPackManager.enableDomainPack(id);
      append(jobStore, jobId, "sample.domain-pack.enabled", `Domain Pack enabled: ${id}`, actor, { packId: id });
    } catch (error) {
      append(jobStore, jobId, "sample.domain-pack.warning", `Domain Pack ${id} was not enabled: ${errorMessage(error)}`, actor, { packId: id }, "warning");
    }
  }
}

function toJobGateStatus(status) {
  if (status === "pending") return "not_run";
  if (status === "passed" || status === "failed" || status === "warning" || status === "skipped" || status === "simulated" || status === "not_run" || status === "requires_approval") return status;
  return "warning";
}

function append(jobStore, jobId, type, message, actor, data = {}, status) {
  jobStore.appendJobEvent(jobId, {
    type,
    message,
    actor,
    status,
    data,
  });
}

function safeWorkspace(value) {
  const cwd = path.resolve(ipcString(value));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error("workspace not found");
  return realOrResolve(cwd);
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
  return error?.message ? String(error.message) : String(error || "sample project operation failed");
}
