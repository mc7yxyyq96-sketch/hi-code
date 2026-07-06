import fs from "node:fs";
import path from "node:path";

import { QualityGateRunner } from "../../dist/quality-gates.js";
import { IndustrialProjectStore } from "../../dist/industrial-project.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createQualityGateService({ getCwd, jobStore }) {
  if (typeof getCwd !== "function") throw new Error("quality-gate-service requires getCwd");
  if (!jobStore) throw new Error("quality-gate-service requires jobStore");

  return {
    listGates() {
      try {
        const runner = new QualityGateRunner({ cwd: path.resolve(getCwd()) });
        return { ok: true, gates: runner.listBuiltInGates() };
      } catch (error) {
        return { ok: false, error: errorMessage(error), gates: [] };
      }
    },

    async runGate(payload = {}) {
      const input = ipcObject(payload);
      try {
        const cwd = path.resolve(getCwd());
        const runner = new QualityGateRunner({ cwd });
        const gate = input.gate && typeof input.gate === "object" ? input.gate : ipcString(input.gateId || input.id);
        const actor = ipcString(input.actor, "user");
        const job = input.jobId ? jobStore.getJob(ipcString(input.jobId)) : createGateJob({ jobStore, cwd, gateId: typeof gate === "string" ? gate : gate.id, actor });
        if (!job) return { ok: false, error: "job not found" };
        if (!input.jobId) jobStore.updateJob(job.id, { status: "running" });
        jobStore.appendJobEvent(job.id, {
          type: "quality-gate.run.started",
          message: `Quality gate started: ${typeof gate === "string" ? gate : gate.id}`,
          actor,
          data: { gateId: typeof gate === "string" ? gate : gate.id },
        });
        const run = await runner.runGate({
          workspacePath: cwd,
          gate,
          artifactPaths: Array.isArray(input.artifactPaths) ? input.artifactPaths : [],
          changedFiles: Array.isArray(input.changedFiles) ? input.changedFiles : [],
          schemaValue: input.schemaValue,
          adapterResult: ipcObject(input.adapterResult),
          approval: ipcObject(input.approval),
          context: ipcObject(input.context),
        });
        const evidenceArtifact = writeEvidenceArtifact(cwd, run);
        const artifact = jobStore.addArtifact(job.id, {
          type: "quality_gate_evidence",
          path: evidenceArtifact.path,
          name: evidenceArtifact.name,
          producedBy: { executor: "quality-gate-runner" },
          metadata: { gateId: run.gateId, status: run.status, releaseReadable: true },
        });
        const gateResult = jobStore.addGateResult(job.id, {
          gate: run.gateId,
          status: run.status,
          message: run.result.message,
          artifacts: [artifact.id, ...run.result.evidence.artifactLinks],
          metadata: {
            qualityGate: run.result,
            evidencePath: evidenceArtifact.path,
            releaseReadable: true,
          },
        });
        const projectGate = recordProjectGate({ cwd, run, evidencePath: evidenceArtifact.path, actor });
        jobStore.appendJobEvent(job.id, {
          type: "quality-gate.run.completed",
          message: `${run.gateId}: ${run.status}`,
          actor,
          status: run.status,
          data: { gateId: run.gateId, status: run.status, evidencePath: evidenceArtifact.path, projectGateId: projectGate?.id },
        });
        if (!input.jobId) {
          jobStore.updateJob(job.id, { status: jobStatusForGate(run.status), error: run.status === "failed" ? run.result.message : undefined });
        }
        return { ok: true, run, result: run.result, jobId: job.id, gateResult, evidenceArtifact, projectGate };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    approveGate(payload = {}) {
      const input = ipcObject(payload);
      const status = input.approved === false || input.status === "rejected" || input.status === "denied" ? "rejected" : "approved";
      return this.runGate({
        ...input,
        gateId: ipcString(input.gateId, "bim.code_check_manual_approval"),
        approval: {
          status,
          actor: ipcString(input.actor, "user"),
          reason: ipcString(input.reason, undefined),
        },
      });
    },
  };
}

export function registerQualityGateIpc({ register, qualityGate }) {
  if (!register) throw new Error("registerQualityGateIpc requires register");
  if (!qualityGate) throw new Error("registerQualityGateIpc requires qualityGate service");
  register.handle("quality-gate:list", () => qualityGate.listGates());
  register.handle("quality-gate:run", (_event, payload) => qualityGate.runGate(payload));
  register.handle("quality-gate:approve", (_event, payload) => qualityGate.approveGate(payload));
}

function createGateJob({ jobStore, cwd, gateId, actor }) {
  return jobStore.createJob({
    title: `Run quality gate: ${gateId}`,
    source: "quality-gate",
    trigger: "quality-gate:run",
    actor,
    executor: "quality-gate-runner",
    cwd,
    tasks: [{ title: `Run ${gateId}`, executor: "quality-gate-runner" }],
    metadata: { gateId },
  });
}

function writeEvidenceArtifact(cwd, run) {
  const safeGateId = String(run.gateId || "gate").replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 80);
  const dir = path.join(cwd, ".hicode", "artifacts", "quality-gates", run.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${safeGateId}-evidence.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { name: path.basename(file), path: file };
}

function recordProjectGate({ cwd, run, evidencePath, actor }) {
  try {
    const store = new IndustrialProjectStore({ workspacePath: cwd });
    if (!store.getProject()) return null;
    const project = store.addGateResult({
      id: `quality-${run.gateId}`,
      type: industrialGateTypeFor(run.result),
      name: run.result.gateName,
      status: run.status,
      message: run.result.message,
      resultPath: path.relative(cwd, evidencePath),
      actor,
      metadata: {
        qualityGateRunId: run.id,
        qualityGateType: run.result.type,
        evidence: run.result.evidence,
        releaseReadable: true,
      },
    });
    return project.qualityGates.find((gate) => gate.id === `quality-${run.gateId}`) || project.qualityGates[project.qualityGates.length - 1] || null;
  } catch {
    return null;
  }
}

function industrialGateTypeFor(result) {
  if (result.type === "human_approval_gate") return "human_approval";
  if (result.type === "security_gate") return "security";
  if (result.type === "documentation_gate") return "documentation_review";
  if (result.category === "pcb") {
    if (/erc/i.test(result.gateId)) return "pcb_erc";
    if (/drc/i.test(result.gateId)) return "pcb_drc";
    return "pcb_drc";
  }
  if (result.category === "plc") return "plc_compile";
  if (result.category === "bim") return "bim_check";
  if (result.category === "cad") return "cad_validation";
  if (/build/i.test(result.gateId)) return "build";
  if (/test/i.test(result.gateId)) return "test";
  if (/syntax|lint/i.test(result.gateId)) return "lint";
  return "test";
}

function jobStatusForGate(status) {
  if (status === "failed") return "failed";
  if (status === "requires_approval") return "waiting_approval";
  return "succeeded";
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "quality gate operation failed");
}
