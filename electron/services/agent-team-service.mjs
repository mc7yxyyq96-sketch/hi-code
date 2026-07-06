import fs from "node:fs";
import path from "node:path";

import {
  AgentTeamStore,
  builtInAgentProfiles,
  createAgentTeamPlan,
  listAgentProfilesForContext,
} from "../../dist/agent-team.js";
import { IndustrialProjectStore } from "../../dist/industrial-project.js";
import { ipcBoundedNumber, ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createAgentTeamService({ store, domainPackManager, jobStore, getCwd }) {
  if (!store) throw new Error("agent-team-service requires store");
  if (!domainPackManager) throw new Error("agent-team-service requires domainPackManager");
  if (!jobStore) throw new Error("agent-team-service requires jobStore");
  if (typeof getCwd !== "function") throw new Error("agent-team-service requires getCwd");

  return {
    listAgentProfiles(payload = {}) {
      const input = ipcObject(payload);
      const project = readProject(getCwd());
      const packs = enabledDomainPacks(domainPackManager);
      const domains = Array.isArray(input.domains) ? input.domains : project?.domains || [];
      const profiles = input.contextOnly === true
        ? listAgentProfilesForContext({ domains, domainPacks: packs, task: ipcString(input.task) })
        : mergeProfiles(builtInAgentProfiles(), listAgentProfilesForContext({ domains, domainPacks: packs, task: ipcString(input.task) }).filter((profile) => profile.source === "domain-pack"));
      return { ok: true, profiles };
    },

    getAgentProfile(profileId) {
      const id = ipcString(profileId).trim();
      if (!id) return { ok: false, error: "profileId is required" };
      const profiles = mergeProfiles(builtInAgentProfiles(), listAgentProfilesForContext({ domainPacks: enabledDomainPacks(domainPackManager) }).filter((profile) => profile.source === "domain-pack"));
      const profile = profiles.find((item) => item.id === id);
      return profile ? { ok: true, profile } : { ok: false, error: "agent profile not found" };
    },

    createAgentPlan(payload = {}) {
      const input = ipcObject(payload);
      try {
        const plan = createAgentTeamPlan({
          task: ipcString(input.task),
          title: ipcString(input.title, undefined),
          domains: Array.isArray(input.domains) ? input.domains : undefined,
          projectType: ipcString(input.projectType, undefined),
          project: readProject(getCwd()),
          domainPacks: enabledDomainPacks(domainPackManager),
          actor: ipcString(input.actor, "user"),
          executionMode: ipcString(input.executionMode, undefined),
        });
        const saved = store.savePlan(plan);
        return { ok: true, plan: saved, profiles: this.listAgentProfiles({ contextOnly: true, task: plan.task, domains: plan.domains }).profiles };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    listAgentPlans(payload = {}) {
      const input = ipcObject(payload);
      return { ok: true, plans: store.listPlans(ipcBoundedNumber(input.limit, 50, { min: 1, max: 200 })) };
    },

    getAgentPlan(planId) {
      const plan = store.getPlan(ipcString(planId));
      return plan ? { ok: true, plan } : { ok: false, error: "agent plan not found" };
    },

    createMultiAgentJob(payload = {}) {
      const input = ipcObject(payload);
      try {
        const plan = input.plan && typeof input.plan === "object"
          ? store.savePlan(input.plan)
          : store.getPlan(ipcString(input.planId)) || createAgentTeamPlan({
            task: ipcString(input.task),
            title: ipcString(input.title, undefined),
            domains: Array.isArray(input.domains) ? input.domains : undefined,
            projectType: ipcString(input.projectType, undefined),
            project: readProject(getCwd()),
            domainPacks: enabledDomainPacks(domainPackManager),
            actor: ipcString(input.actor, "user"),
          });
        const savedPlan = store.savePlan(plan);
        const cwd = path.resolve(getCwd());
        const artifacts = writePlanArtifacts({ cwd, plan: savedPlan });
        const job = jobStore.createJob({
          title: `Multi-Agent: ${savedPlan.title}`,
          source: "agent-team",
          trigger: "agent-team:job:create",
          actor: ipcString(input.actor, savedPlan.actor || "user"),
          executor: "agent-team",
          cwd,
          tasks: savedPlan.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            assignee: task.agentId,
            executor: task.agentName,
            description: task.output.summary,
            metadata: {
              agentId: task.agentId,
              role: task.role,
              executionGroup: task.executionGroup,
              parallelGroup: task.parallelGroup,
              dependsOn: task.dependsOn,
              input: task.input,
              output: task.output,
              reviewChecklist: task.reviewChecklist,
              reviewResult: task.reviewResult,
              expectedArtifacts: task.expectedArtifacts,
            },
          })),
          metadata: {
            planId: savedPlan.id,
            executionMode: savedPlan.executionMode,
            reviewChain: savedPlan.reviewChain,
            route: savedPlan.route,
            domainPackIds: savedPlan.domainPackIds,
          },
        });
        jobStore.updateJob(job.id, { status: "running" });
        jobStore.appendJobEvent(job.id, {
          type: "agent-team.plan.created",
          message: `Agent team plan ${savedPlan.id} created with ${savedPlan.tasks.length} agent tasks`,
          actor: "agent-team",
          data: { planId: savedPlan.id, domains: savedPlan.domains, domainPackIds: savedPlan.domainPackIds },
        });
        for (const task of savedPlan.tasks) {
          jobStore.appendJobEvent(job.id, {
            type: "agent-team.task.assigned",
            message: `${task.agentName} assigned: ${task.title}`,
            actor: task.agentId,
            taskId: task.id,
            status: task.status,
            data: { role: task.role, executionGroup: task.executionGroup, expectedArtifacts: task.expectedArtifacts },
          });
        }
        for (const artifact of artifacts) {
          jobStore.addArtifact(job.id, {
            type: artifact.type,
            path: artifact.path,
            name: artifact.name,
            producedBy: { executor: "agent-team" },
            metadata: { planId: savedPlan.id },
          });
        }
        jobStore.addGateResult(job.id, {
          gate: "agent-review-chain",
          status: "passed",
          message: `Review chain: ${savedPlan.reviewChain.join(" -> ")}`,
          metadata: { planId: savedPlan.id },
        });
        for (const point of savedPlan.humanApprovalPoints) {
          jobStore.addApprovalRecord(job.id, {
            status: "requested",
            requestedBy: "agent-team",
            scope: `agent-plan:${savedPlan.id}`,
            reason: point,
            metadata: { planId: savedPlan.id },
          });
        }
        jobStore.appendJobEvent(job.id, {
          type: savedPlan.route.patchArena ? "agent-team.patch-arena.eligible" : "agent-team.patch-arena.skipped",
          message: savedPlan.route.patchArena ? "Software task can enter Patch Arena after approval" : "Patch Arena is not required for this plan",
          actor: "agent-team",
          data: savedPlan.route.patchArenaRequest || {},
        });
        if (savedPlan.route.industrialPlan) {
          jobStore.appendJobEvent(job.id, {
            type: "agent-team.industrial-plan.created",
            message: "Industrial artifact, checklist, and dry-run tool plan generated",
            actor: "agent-team",
            data: { artifactPlan: savedPlan.route.artifactPlan, checklistPlan: savedPlan.route.checklistPlan, toolRunPlan: savedPlan.route.toolRunPlan },
          });
        }
        const finalStatus = savedPlan.humanApprovalPoints.length ? "waiting_approval" : "succeeded";
        const finalJob = jobStore.updateJob(job.id, { status: finalStatus });
        return { ok: true, plan: savedPlan, job: finalJob, artifacts, patchArenaRequest: savedPlan.route.patchArenaRequest || null };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export function registerAgentTeamIpc({ register, agentTeam }) {
  if (!register) throw new Error("registerAgentTeamIpc requires register");
  if (!agentTeam) throw new Error("registerAgentTeamIpc requires agentTeam service");
  register.handle("agent-team:profiles", (_event, payload) => agentTeam.listAgentProfiles(payload));
  register.handle("agent-team:profile:get", (_event, profileId) => agentTeam.getAgentProfile(profileId));
  register.handle("agent-team:plan:create", (_event, payload) => agentTeam.createAgentPlan(payload));
  register.handle("agent-team:plan:list", (_event, payload) => agentTeam.listAgentPlans(payload));
  register.handle("agent-team:plan:get", (_event, planId) => agentTeam.getAgentPlan(planId));
  register.handle("agent-team:job:create", (_event, payload) => agentTeam.createMultiAgentJob(payload));
}

export function createAgentTeamStore(options) {
  return new AgentTeamStore(options);
}

function readProject(cwd) {
  try {
    return new IndustrialProjectStore({ workspacePath: path.resolve(cwd) }).getProject();
  } catch {
    return null;
  }
}

function enabledDomainPacks(domainPackManager) {
  return domainPackManager.listDomainPacks().filter((pack) => pack.installed && pack.enabled);
}

function mergeProfiles(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const profile of group || []) map.set(profile.id, profile);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function writePlanArtifacts({ cwd, plan }) {
  const root = path.resolve(cwd);
  const dir = path.join(root, ".hicode", "generated", "agent-team", safeSegment(plan.id));
  assertInside(root, dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = [
    { name: "agent-plan.json", type: "agent-team-plan", content: plan },
    { name: "artifact-plan.json", type: "agent-artifact-plan", content: { expectedArtifacts: plan.expectedArtifacts, route: plan.route.artifactPlan } },
    { name: "review-chain.json", type: "agent-review-chain", content: { reviewChain: plan.reviewChain, qualityGates: plan.qualityGates, approvalPoints: plan.humanApprovalPoints } },
    { name: "tool-run-plan.json", type: "agent-tool-run-plan", content: { toolRunPlan: plan.route.toolRunPlan, note: "No real industrial tool execution in Sprint 5B." } },
  ];
  return files.map((file) => {
    const target = path.join(dir, file.name);
    assertInside(root, target);
    fs.writeFileSync(target, JSON.stringify(file.content, null, 2), { mode: 0o600 });
    return { name: file.name, type: file.type, path: target };
  });
}

function assertInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("agent team artifact path escapes workspace");
}

function safeSegment(value) {
  return String(value || "agent-plan").replace(/[^a-z0-9._:-]/gi, "-").slice(0, 160);
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "agent team operation failed");
}
