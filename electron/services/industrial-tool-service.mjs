import path from "node:path";

import { IndustrialToolAdapterRegistry } from "../../dist/industrial-tool-adapters.js";
import { IndustrialProjectStore } from "../../dist/industrial-project.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createIndustrialToolService({ registry, getCwd, jobStore, domainPackManager, authorize }) {
  if (!registry) throw new Error("industrial-tool-service requires registry");
  if (typeof getCwd !== "function") throw new Error("industrial-tool-service requires getCwd");
  if (!jobStore) throw new Error("industrial-tool-service requires jobStore");
  if (typeof authorize !== "function") throw new Error("industrial-tool-service requires authorize");

  return {
    listAdapters() {
      try {
        const cwd = path.resolve(getCwd());
        const job = createToolJob({ jobStore, cwd, title: "Detect industrial tool adapters", trigger: "toolchain:list" });
        jobStore.updateJob(job.id, { status: "running" });
        const adapters = registry.listAdapters().map((adapter) => {
          const detection = registry.detectAdapter(adapter.id);
          recordDetection({ jobStore, jobId: job.id, detection });
          return { adapter, detection };
        });
        jobStore.updateJob(job.id, { status: "succeeded" });
        return {
          ok: true,
          adapters,
          toolRequirements: collectToolRequirements({ cwd, domainPackManager }),
          jobId: job.id,
        };
      } catch (error) {
        return { ok: false, error: errorMessage(error), adapters: [], toolRequirements: [] };
      }
    },

    detectAdapter(adapterId, payload = {}) {
      try {
        const cwd = path.resolve(getCwd());
        const input = ipcObject(payload);
        const detection = registry.detectAdapter(ipcString(adapterId), {
          executablePath: ipcString(input.executablePath, undefined),
        });
        const job = createToolJob({ jobStore, cwd, title: `Detect ${detection.toolName}`, trigger: "toolchain:detect" });
        jobStore.updateJob(job.id, { status: "running" });
        recordDetection({ jobStore, jobId: job.id, detection });
        jobStore.updateJob(job.id, { status: detection.installed ? "succeeded" : "waiting_approval" });
        return { ok: true, detection, jobId: job.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    getAdapterCapabilities(adapterId) {
      try {
        return { ok: true, capabilities: registry.getAdapterCapabilities(ipcString(adapterId)) };
      } catch (error) {
        return { ok: false, error: errorMessage(error), capabilities: [] };
      }
    },

    validateAdapterConfig(payload = {}) {
      const result = registry.validateAdapterConfig(ipcObject(payload).adapter || payload);
      return { ok: result.ok, errors: result.errors, adapter: result.adapter || null };
    },

    async runAdapterTask(payload = {}) {
      const input = ipcObject(payload);
      try {
        const cwd = path.resolve(getCwd());
        const request = {
          adapterId: ipcString(input.adapterId),
          task: ipcString(input.task, "Generate industrial tool dry-run plan"),
          mode: input.mode === "execute" ? "execute" : "dry-run",
          workspacePath: cwd,
          artifactDir: ipcString(input.artifactDir, undefined),
          inputArtifacts: Array.isArray(input.inputArtifacts) ? input.inputArtifacts : [],
          args: Array.isArray(input.args) ? input.args : [],
          executablePath: ipcString(input.executablePath, undefined),
          cadRequest: ipcObject(input.cadRequest || input.freecadRequest),
          pcbRequest: ipcObject(input.pcbRequest || input.kicadRequest),
          plcRequest: ipcObject(input.plcRequest || input.openPlcRequest),
          bimRequest: ipcObject(input.bimRequest || input.ifcRequest),
          solidworksRequest: ipcObject(input.solidworksRequest || input.solidWorksRequest),
          avevaRequest: ipcObject(input.avevaRequest || input.avevaBridgeRequest),
          userApproved: false,
          allowNetwork: input.allowNetwork === true,
          actor: ipcString(input.actor, "user"),
        };
        if (request.mode === "execute" && input.userApproved === true) {
          request.userApproved = normalizeDecision(await authorize({
            tool: `industrial_tool:${request.adapterId}`,
            label: `运行工业工具 ${request.adapterId}`,
            mutating: true,
          })) === "allow";
        }
        const job = createToolJob({ jobStore, cwd, title: `Run ${request.adapterId}`, trigger: "toolchain:run", actor: request.actor });
        jobStore.updateJob(job.id, { status: "running" });
        jobStore.appendJobEvent(job.id, {
          type: "industrial-tool.run.started",
          message: `${request.adapterId} ${request.mode} started`,
          actor: request.actor,
          data: { adapterId: request.adapterId, mode: request.mode },
        });
        const result = registry.runAdapterTask(request);
        recordDetection({ jobStore, jobId: job.id, detection: result.detection });
        for (const artifact of result.artifacts || []) {
          jobStore.addArtifact(job.id, {
            type: artifact.type,
            path: artifact.path,
            name: artifact.name,
            producedBy: { executor: `industrial-tool:${request.adapterId}` },
            metadata: { ...artifact.metadata, simulated: artifact.simulated, executionPolicy: result.executionPolicy },
          });
        }
        for (const diagnostic of result.diagnostics || []) {
          const gateStatus = diagnostic.gateStatus === "simulated" || diagnostic.gateStatus === "not_run" ? "skipped" : diagnostic.severity === "error" ? "failed" : diagnostic.severity === "warning" ? "warning" : "passed";
          jobStore.addGateResult(job.id, {
            gate: String(diagnostic.gate || diagnostic.code || "industrial-tool-diagnostic"),
            status: gateStatus,
            message: diagnostic.message,
            metadata: { adapterId: request.adapterId, diagnostic, executionPolicy: result.executionPolicy },
          });
        }
        jobStore.appendJobEvent(job.id, {
          type: result.simulated ? "industrial-tool.dry-run.completed" : "industrial-tool.run.completed",
          message: result.summary,
          actor: request.actor,
          status: result.ok ? "succeeded" : "failed",
          data: {
            adapterId: request.adapterId,
            mode: result.mode,
            simulated: result.simulated,
            commandCount: result.commandPreview?.length || 0,
            executionPolicy: result.executionPolicy,
          },
        });
        jobStore.updateJob(job.id, { status: result.ok ? "succeeded" : "failed", error: result.error });
        return { ok: result.ok, result, jobId: job.id, error: result.error };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export function registerIndustrialToolIpc({ register, industrialTool }) {
  if (!register) throw new Error("registerIndustrialToolIpc requires register");
  if (!industrialTool) throw new Error("registerIndustrialToolIpc requires industrialTool service");
  register.handle("toolchain:list", () => industrialTool.listAdapters());
  register.handle("toolchain:detect", (_event, adapterId, payload) => industrialTool.detectAdapter(adapterId, payload));
  register.handle("toolchain:capabilities", (_event, adapterId) => industrialTool.getAdapterCapabilities(adapterId));
  register.handle("toolchain:validate-adapter", (_event, payload) => industrialTool.validateAdapterConfig(payload));
  register.handle("toolchain:run", (_event, payload) => industrialTool.runAdapterTask(payload));
}

export function createIndustrialToolRegistry(options) {
  return new IndustrialToolAdapterRegistry(options);
}

function createToolJob({ jobStore, cwd, title, trigger, actor = "toolchain" }) {
  return jobStore.createJob({
    title,
    source: "industrial-tool",
    trigger,
    actor,
    executor: "industrial-tool-service",
    cwd,
    tasks: [{ title, executor: "industrial-tool-service" }],
  });
}

function recordDetection({ jobStore, jobId, detection }) {
  jobStore.appendJobEvent(jobId, {
    type: "industrial-tool.detected",
    message: `${detection.toolName}: ${detection.installed ? "installed" : "not installed"}`,
    actor: "industrial-tool-service",
    status: detection.installed ? "succeeded" : "waiting_approval",
    data: {
      adapterId: detection.adapterId,
      installed: detection.installed,
      reason: detection.reason,
      setupHint: detection.setupHint,
      version: detection.version,
    },
  });
  for (const diagnostic of detection.diagnostics || []) {
    const gateStatus = diagnostic.gateStatus === "simulated" || diagnostic.gateStatus === "not_run" ? "skipped" : diagnostic.severity === "error" ? "failed" : diagnostic.severity === "warning" ? "warning" : "passed";
    jobStore.addGateResult(jobId, {
      gate: String(diagnostic.gate || diagnostic.code || "industrial-tool-detection"),
      status: gateStatus,
      message: diagnostic.message,
      metadata: { adapterId: detection.adapterId, diagnostic },
    });
  }
}

function collectToolRequirements({ cwd, domainPackManager }) {
  const requirements = [];
  try {
    const project = new IndustrialProjectStore({ workspacePath: path.resolve(cwd) }).getProject();
    for (const item of project?.toolchain || []) {
      requirements.push({
        source: "project",
        id: item.id,
        name: item.name,
        type: item.type || "toolchain",
        domains: item.domains || [],
        dryRunSupported: item.dryRun === true,
      });
    }
  } catch {}
  try {
    for (const pack of domainPackManager?.listDomainPacks?.() || []) {
      if (!pack.enabled) continue;
      for (const tool of pack.manifest.toolRequirements || []) {
        requirements.push({
          source: "domain-pack",
          packId: pack.manifest.id,
          id: tool.id,
          name: tool.name,
          type: tool.type,
          domains: tool.domains,
          dryRunSupported: tool.dryRunSupported,
          required: tool.required,
          notes: tool.notes,
        });
      }
    }
  } catch {}
  return requirements;
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "industrial tool operation failed");
}

function normalizeDecision(value) {
  return value === "allow" || value === "always" || value === "y" || value === "a" ? "allow" : "deny";
}
