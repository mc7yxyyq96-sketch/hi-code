import path from "node:path";

import { DomainPackManager, validateDomainPackManifest } from "../../dist/domain-packs.js";
import { IndustrialProjectStore } from "../../dist/industrial-project.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createDomainPackService({ manager, getCwd, jobStore }) {
  if (!manager) throw new Error("domain-pack-service requires manager");
  if (typeof getCwd !== "function") throw new Error("domain-pack-service requires getCwd");
  if (!jobStore) throw new Error("domain-pack-service requires jobStore");

  return {
    listDomainPacks() {
      try {
        const project = readProject(getCwd());
        const recommendedIds = new Set(project ? manager.recommendForDomains(project.domains).map((pack) => pack.manifest.id) : []);
        return { ok: true, packs: manager.listDomainPacks().map((pack) => serializePack(pack, recommendedIds)) };
      } catch (error) {
        return { ok: false, error: errorMessage(error), packs: [] };
      }
    },

    getDomainPack(packId) {
      try {
        const pack = manager.getDomainPack(ipcString(packId));
        if (!pack) return { ok: false, error: "domain pack not found" };
        return { ok: true, pack };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    validateDomainPack(payload = {}) {
      const input = ipcObject(payload);
      const result = validateDomainPackManifest(input.manifest || input, { remote: input.source === "remote" });
      return { ok: result.ok, errors: result.errors, manifest: result.manifest || null };
    },

    installDomainPack(payload = {}) {
      const input = ipcObject(payload);
      try {
        const pack = manager.installDomainPack({
          id: ipcString(input.id, undefined),
          manifest: input.manifest,
          source: ipcString(input.source, "builtin"),
          sourceUrl: ipcString(input.sourceUrl, undefined),
          allowUnverified: input.allowUnverified === true,
          actor: ipcString(input.actor, "user"),
        });
        const job = recordDomainPackJob({
          jobStore,
          cwd: getCwd(),
          title: "Install domain pack",
          eventType: "domain-pack.installed",
          message: `Installed domain pack ${pack.manifest.id}`,
          actor: ipcString(input.actor, "user"),
          data: { packId: pack.manifest.id, version: pack.manifest.version },
          manifestPath: pack.path ? path.join(pack.path, "hicode.domain.json") : undefined,
        });
        return { ok: true, pack, jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    updateDomainPack(payload = {}) {
      const input = ipcObject(payload);
      try {
        const pack = manager.updateDomainPack({
          id: ipcString(input.id, undefined),
          manifest: input.manifest,
          source: ipcString(input.source, "builtin"),
          sourceUrl: ipcString(input.sourceUrl, undefined),
          allowUnverified: input.allowUnverified === true,
          actor: ipcString(input.actor, "user"),
        });
        const job = recordDomainPackJob({
          jobStore,
          cwd: getCwd(),
          title: "Update domain pack",
          eventType: "domain-pack.updated",
          message: `Updated domain pack ${pack.manifest.id}`,
          actor: ipcString(input.actor, "user"),
          data: { packId: pack.manifest.id, version: pack.manifest.version },
          manifestPath: pack.path ? path.join(pack.path, "hicode.domain.json") : undefined,
        });
        return { ok: true, pack, jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    enableDomainPack(packId, payload = {}) {
      const input = ipcObject(payload);
      try {
        const pack = manager.enableDomainPack(ipcString(packId));
        const projectResult = applyPackToCurrentProject({
          cwd: getCwd(),
          pack,
          actor: ipcString(input.actor, "user"),
          enabled: true,
        });
        const job = recordDomainPackJob({
          jobStore,
          cwd: getCwd(),
          title: "Enable domain pack",
          eventType: "domain-pack.enabled",
          message: `Enabled domain pack ${pack.manifest.id}`,
          actor: ipcString(input.actor, "user"),
          data: { packId: pack.manifest.id, projectId: projectResult?.project?.projectId },
          projectPath: projectResult?.path,
          manifestPath: pack.path ? path.join(pack.path, "hicode.domain.json") : undefined,
          gate: { gate: "domain-pack-enable", status: "passed", message: "domain pack manifest applied to project" },
        });
        return { ok: true, pack, project: projectResult?.project || null, path: projectResult?.path, jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    disableDomainPack(packId, payload = {}) {
      const input = ipcObject(payload);
      try {
        const pack = manager.disableDomainPack(ipcString(packId));
        const projectResult = applyPackToCurrentProject({
          cwd: getCwd(),
          pack,
          actor: ipcString(input.actor, "user"),
          enabled: false,
        });
        const job = recordDomainPackJob({
          jobStore,
          cwd: getCwd(),
          title: "Disable domain pack",
          eventType: "domain-pack.disabled",
          message: `Disabled domain pack ${pack.manifest.id}`,
          actor: ipcString(input.actor, "user"),
          data: { packId: pack.manifest.id, projectId: projectResult?.project?.projectId },
          projectPath: projectResult?.path,
        });
        return { ok: true, pack, project: projectResult?.project || null, path: projectResult?.path, jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    uninstallDomainPack(packId, payload = {}) {
      const input = ipcObject(payload);
      try {
        const result = manager.uninstallDomainPack(ipcString(packId));
        const job = recordDomainPackJob({
          jobStore,
          cwd: getCwd(),
          title: "Uninstall domain pack",
          eventType: "domain-pack.uninstalled",
          message: `Uninstalled domain pack ${result.id}`,
          actor: ipcString(input.actor, "user"),
          data: { packId: result.id },
        });
        return { ok: true, ...result, jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    recommendDomainPacks() {
      try {
        const project = readProject(getCwd());
        return { ok: true, packs: project ? manager.recommendForDomains(project.domains) : [] };
      } catch (error) {
        return { ok: false, error: errorMessage(error), packs: [] };
      }
    },
  };
}

export function registerDomainPackIpc({ register, domainPack }) {
  if (!register) throw new Error("registerDomainPackIpc requires register");
  if (!domainPack) throw new Error("registerDomainPackIpc requires domainPack service");
  register.handle("domain-pack:list", () => domainPack.listDomainPacks());
  register.handle("domain-pack:get", (_event, packId) => domainPack.getDomainPack(packId));
  register.handle("domain-pack:validate", (_event, payload) => domainPack.validateDomainPack(payload));
  register.handle("domain-pack:install", (_event, payload) => domainPack.installDomainPack(payload));
  register.handle("domain-pack:update", (_event, payload) => domainPack.updateDomainPack(payload));
  register.handle("domain-pack:enable", (_event, packId, payload) => domainPack.enableDomainPack(packId, payload));
  register.handle("domain-pack:disable", (_event, packId, payload) => domainPack.disableDomainPack(packId, payload));
  register.handle("domain-pack:uninstall", (_event, packId, payload) => domainPack.uninstallDomainPack(packId, payload));
  register.handle("domain-pack:recommend", () => domainPack.recommendDomainPacks());
}

export function createDomainPackManager(options) {
  return new DomainPackManager(options);
}

function applyPackToCurrentProject({ cwd, pack, actor, enabled }) {
  const store = new IndustrialProjectStore({ workspacePath: path.resolve(cwd) });
  const project = store.getProject();
  if (!project) return null;
  const now = Date.now();
  const manifest = pack.manifest;
  const metadata = project.metadata && typeof project.metadata === "object" ? { ...project.metadata } : {};
  const domainPacks = metadata.domainPacks && typeof metadata.domainPacks === "object" && !Array.isArray(metadata.domainPacks)
    ? { ...metadata.domainPacks }
    : {};
  const enabledPacks = new Set(Array.isArray(domainPacks.enabled) ? domainPacks.enabled.filter((id) => typeof id === "string") : []);
  if (enabled) enabledPacks.add(manifest.id);
  else enabledPacks.delete(manifest.id);
  domainPacks.enabled = Array.from(enabledPacks).sort();
  domainPacks.checklists = mergeById(Array.isArray(domainPacks.checklists) ? domainPacks.checklists : [], manifest.checklists.map((checklist) => ({
    id: checklist.id,
    packId: manifest.id,
    name: checklist.name,
    type: checklist.type,
    items: checklist.items,
  })));
  domainPacks.templates = mergeById(Array.isArray(domainPacks.templates) ? domainPacks.templates : [], manifest.templates.map((template) => ({
    id: template.id,
    packId: manifest.id,
    name: template.name,
    type: template.type,
    path: template.path,
  })));
  metadata.domainPacks = domainPacks;
  const standards = enabled ? mergeById(project.standards, manifest.standards.map((standard) => ({
    id: standard.id,
    name: standard.name,
    version: standard.version,
    domain: standard.domains[0],
    notes: [standard.notes, `Domain Pack: ${manifest.id}`].filter(Boolean).join(" | "),
    url: standard.url,
    metadata: { domainPackId: manifest.id, domains: standard.domains },
  }))) : project.standards;
  const qualityGates = enabled ? mergeById(project.qualityGates, manifest.qualityGates.map((gate) => ({
    id: `${manifest.id}-${gate.id}`,
    type: gate.type,
    name: gate.name,
    status: "pending",
    artifactIds: [],
    requirementIds: [],
    releaseTargetIds: [],
    message: gate.description,
    createdAt: now,
    updatedAt: now,
    metadata: { domainPackId: manifest.id, required: gate.required, automated: gate.automated },
  }))) : project.qualityGates;
  const next = {
    ...project,
    standards,
    qualityGates,
    metadata,
    updatedAt: now,
    events: [
      ...project.events,
      {
        id: `event-${now}-${manifest.id}`,
        type: enabled ? "domain-pack.enabled" : "domain-pack.disabled",
        message: `${enabled ? "Enabled" : "Disabled"} domain pack: ${manifest.id}`,
        createdAt: now,
        actor,
        data: { packId: manifest.id, domains: manifest.domains },
      },
    ],
  };
  const saved = store.saveProject(next);
  return { project: saved, path: store.projectPath() };
}

function readProject(cwd) {
  try {
    return new IndustrialProjectStore({ workspacePath: path.resolve(cwd) }).getProject();
  } catch {
    return null;
  }
}

function serializePack(pack, recommendedIds) {
  return { ...pack, recommended: recommendedIds.has(pack.manifest.id) };
}

function mergeById(current, additions) {
  const map = new Map();
  for (const item of current || []) map.set(item.id, item);
  for (const item of additions || []) map.set(item.id, item);
  return Array.from(map.values());
}

function recordDomainPackJob({ jobStore, cwd, title, eventType, message, actor, data, projectPath, manifestPath, gate }) {
  try {
    const job = jobStore.createJob({
      title,
      source: "domain-pack",
      trigger: eventType,
      actor: actor || "user",
      executor: "domain-pack-service",
      cwd,
      tasks: [{ title, executor: "domain-pack-service" }],
      metadata: data,
    });
    jobStore.updateJob(job.id, { status: "running" });
    jobStore.appendJobEvent(job.id, { type: eventType, message, actor: actor || "user", data });
    for (const artifactPath of [projectPath, manifestPath].filter(Boolean)) {
      jobStore.addArtifact(job.id, {
        type: artifactPath.endsWith("hicode.domain.json") ? "domain-pack-manifest" : "industrial-project",
        path: artifactPath,
        name: path.basename(artifactPath),
        producedBy: { executor: "domain-pack-service" },
        metadata: data,
      });
    }
    if (gate) jobStore.addGateResult(job.id, { gate: gate.gate, status: gate.status, message: gate.message, metadata: data });
    jobStore.updateJob(job.id, { status: "succeeded" });
    return jobStore.getJob(job.id);
  } catch {
    return null;
  }
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "domain pack operation failed");
}
