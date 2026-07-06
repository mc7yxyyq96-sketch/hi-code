import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../dist/job-center.js";
import { DomainPackManager } from "../dist/domain-packs.js";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import {
  AgentTeamStore,
  builtInAgentProfiles,
  createAgentTeamPlan,
} from "../dist/agent-team.js";
import { createAgentTeamService, registerAgentTeamIpc } from "../electron/services/agent-team-service.mjs";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

console.log("\n[agent-team] profiles");
const profiles = builtInAgentProfiles();
check("built-in agent list covers required roles", [
  "product-manager",
  "system-architect",
  "fullstack-engineer",
  "qa-engineer",
  "security-engineer",
  "release-manager",
  "mechanical-cad-engineer",
  "solidworks-engineer",
  "pcb-engineer",
  "plc-automation-engineer",
  "electrical-engineer",
  "bim-architect",
  "process-chemical-engineer",
  "energy-systems-engineer",
  "materials-engineer",
  "manufacturing-engineer",
  "technical-writer",
].every((id) => profiles.some((profile) => profile.id === id)));
check("profiles include responsibilities inputs outputs checklists escalation", profiles.every((profile) => profile.responsibilities.length && profile.inputs.length && profile.outputs.length && profile.reviewChecklists.length && profile.escalationRules.length));

console.log("\n[agent-team] core planning");
const softwarePlan = createAgentTeamPlan({
  task: "Implement software API status view, run tests, and prepare release checklist.",
  project: { type: "software_product", domains: ["software", "documentation", "qa"] },
  domainPacks: [],
});
check("software project generates software agent plan", softwarePlan.tasks.some((task) => task.agentId === "fullstack-engineer") && softwarePlan.tasks.some((task) => task.agentId === "qa-engineer"));
check("software task can enter Patch Arena", softwarePlan.route.patchArena === true && softwarePlan.route.patchArenaRequest?.providerIds.includes("hicode-internal"));
check("software plan has review chain and approvals", softwarePlan.reviewChain.includes("security-engineer") && softwarePlan.humanApprovalPoints.length > 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-agent-team-"));
const packManager = new DomainPackManager({ safeRoot: path.join(tmp, "packs") });
packManager.installDomainPack({ id: "pcb-eda" });
packManager.enableDomainPack("pcb-eda");
packManager.installDomainPack({ id: "plc-automation" });
packManager.enableDomainPack("plc-automation");
packManager.installDomainPack({ id: "mechanical-cad" });
packManager.enableDomainPack("mechanical-cad");
packManager.installDomainPack({ id: "solidworks" });
packManager.disableDomainPack("solidworks");
const enabledPacks = packManager.listDomainPacks().filter((pack) => pack.installed && pack.enabled);
const industrialPlan = createAgentTeamPlan({
  task: "Build PCB and PLC automation plan with CAD enclosure, Gerber, BOM, I/O map, FAT/SAT, and release gates.",
  project: { type: "industrial_controller", domains: ["pcb", "plc", "automation", "cad", "mechanical", "electrical", "qa", "documentation"] },
  domainPacks: packManager.listDomainPacks(),
});
check("pcb/plc/cad project generates specialist agents", ["pcb-engineer", "plc-automation-engineer", "mechanical-cad-engineer", "electrical-engineer"].every((id) => industrialPlan.tasks.some((task) => task.agentId === id)));
check("enabled domain packs participate in plan", ["pcb-eda", "plc-automation", "mechanical-cad"].every((id) => industrialPlan.domainPackIds.includes(id)));
check("disabled domain pack does not participate", !industrialPlan.domainPackIds.includes("solidworks"));
check("industrial plan creates artifact checklist and dry-run tool plan", industrialPlan.route.industrialPlan === true && industrialPlan.route.artifactPlan.length > 0 && industrialPlan.route.checklistPlan.length > 0 && industrialPlan.route.toolRunPlan.every((item) => item.dryRunOnly === true && item.approvalRequired === true));
check("agent task model supports parallel groups", new Set(industrialPlan.tasks.map((task) => task.parallelGroup)).size > 1 && industrialPlan.tasks.some((task) => task.executionGroup === 3));

console.log("\n[agent-team] service, persistence, Job Center");
const workspace = path.join(tmp, "workspace with space");
fs.mkdirSync(workspace, { recursive: true });
const projectStore = new IndustrialProjectStore({ workspacePath: workspace });
projectStore.createProject({
  projectId: "agent-team-demo",
  name: "Agent Team Demo",
  type: "industrial_controller",
  domains: ["software", "pcb", "plc", "automation", "cad", "mechanical", "electrical", "qa", "documentation"],
});
const agentStore = new AgentTeamStore({ safeRoot: path.join(tmp, "agent-team") });
const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs", "job-center.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "agent-team-job",
});
const service = createAgentTeamService({
  store: agentStore,
  domainPackManager: packManager,
  jobStore,
  getCwd: () => workspace,
});
const servicePlan = service.createAgentPlan({ task: "Coordinate software, PCB, PLC, CAD and release verification.", actor: "tester" });
check("service creates persisted agent plan", servicePlan.ok === true && agentStore.getPlan(servicePlan.plan.id)?.id === servicePlan.plan.id);
check("service plan excludes disabled pack", !servicePlan.plan.domainPackIds.includes("solidworks"));
const serviceJob = service.createMultiAgentJob({ planId: servicePlan.plan.id, actor: "tester" });
check("service creates multi-agent job", serviceJob.ok === true && serviceJob.job.source === "agent-team" && serviceJob.job.status === "waiting_approval");
const persistedJob = jobStore.getJob(serviceJob.job.id);
check("job contains one task per agent", persistedJob.tasks.length === servicePlan.plan.tasks.length && persistedJob.tasks.every((task) => task.metadata?.agentId));
check("agent tasks include input output and review result", persistedJob.tasks.every((task) => task.metadata?.input && task.metadata?.output && task.metadata?.reviewResult === "pending"));
check("job writes assigned task events", persistedJob.events.some((event) => event.type === "agent-team.task.assigned"));
check("job writes review chain gate result", persistedJob.gateResults.some((gate) => gate.gate === "agent-review-chain" && gate.status === "passed"));
check("job records approval points", persistedJob.approvals.length === servicePlan.plan.humanApprovalPoints.length && persistedJob.approvals.every((approval) => approval.status === "requested"));
check("job records generated artifacts", persistedJob.artifacts.some((artifact) => artifact.name === "agent-plan.json") && persistedJob.artifacts.some((artifact) => artifact.name === "tool-run-plan.json"));
check("artifact files exist on disk", serviceJob.artifacts.every((artifact) => fs.existsSync(artifact.path)));
check("software route creates Patch Arena request", serviceJob.patchArenaRequest?.providerIds.includes("hicode-internal"));
check("industrial route does not pretend tools executed", fs.readFileSync(serviceJob.artifacts.find((artifact) => artifact.name === "tool-run-plan.json").path, "utf8").includes("No real industrial tool execution"));

console.log("\n[agent-team] IPC/API");
const handlers = new Map();
registerAgentTeamIpc({
  register: {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  },
  agentTeam: service,
});
for (const channel of ["agent-team:profiles", "agent-team:profile:get", "agent-team:plan:create", "agent-team:plan:list", "agent-team:plan:get", "agent-team:job:create"]) {
  check(`registerAgentTeamIpc exposes ${channel}`, handlers.has(channel));
}
const ipcProfiles = await handlers.get("agent-team:profiles")({}, {});
check("IPC profiles returns built-in agents", ipcProfiles.ok === true && ipcProfiles.profiles.some((profile) => profile.id === "product-manager"));
const ipcPlan = await handlers.get("agent-team:plan:create")({}, { task: "Create software release plan" });
check("IPC creates plan", ipcPlan.ok === true && ipcPlan.plan.tasks.length > 0);
const ipcJob = await handlers.get("agent-team:job:create")({}, { planId: ipcPlan.plan.id });
check("IPC creates multi-agent job", ipcJob.ok === true && ipcJob.job.source === "agent-team");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
