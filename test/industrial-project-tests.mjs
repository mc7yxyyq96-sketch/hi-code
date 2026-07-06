import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../dist/job-center.js";
import {
  INDUSTRIAL_PROJECT_FILE,
  IndustrialProjectStore,
  validateIndustrialProject,
} from "../dist/industrial-project.js";
import {
  buildArtifactPlan,
  buildRequirementFromText,
  buildSpecPackage,
  buildTestPlanOutline,
} from "../dist/industrial-requirement-builder.js";
import { createIndustrialProjectService, registerIndustrialProjectIpc } from "../electron/services/industrial-project-service.mjs";

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

console.log("\n[industrial-project] store and schema");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-industrial-project-"));
const workspace = path.join(tmp, "workspace with space");
fs.mkdirSync(workspace, { recursive: true });
const store = new IndustrialProjectStore({ workspacePath: workspace });
const project = store.createProject({
  projectId: "industrial-demo",
  name: "Industrial Demo",
  type: "mixed_discipline_product",
  domains: ["software", "mechanical", "electrical", "qa"],
  requirements: [{ id: "REQ-1", title: "Track release package", domain: "software" }],
  qualityGates: [{ id: "GATE-1", type: "test", name: "Feature tests", status: "pending", requirementIds: ["REQ-1"] }],
});
const projectPath = path.join(workspace, INDUSTRIAL_PROJECT_FILE);
check("project.json is created", fs.existsSync(projectPath));
check("project has required schema fields", project.projectId === "industrial-demo" && Array.isArray(project.artifacts) && Array.isArray(project.traceability));
check("schema validation accepts created project", validateIndustrialProject(project).ok === true);
check("project event records creation", project.events.some((event) => event.type === "project.created"));

console.log("\n[industrial-project] requirement/spec builder core");
const pcbDraft = buildRequirementFromText({
  text: "PCB controller board must include schematic, layout, Gerber, BOM and pass ERC/DRC before release.",
  projectDomains: project.domains.concat(["pcb"]),
});
check("requirement builder creates structured requirement", pcbDraft.requirementId.startsWith("REQ-PCB") && pcbDraft.domain === "pcb" && pcbDraft.acceptanceCriteria.length >= 3);
const pcbPlan = buildArtifactPlan({ id: pcbDraft.requirementId, requirementId: pcbDraft.requirementId, title: pcbDraft.title, domain: pcbDraft.domain });
check("artifact plan is domain aware", pcbPlan.artifacts.some((artifact) => artifact.type === "gerber") && pcbPlan.qualityGates.includes("pcb_drc"));
const pcbTestPlan = buildTestPlanOutline({ id: pcbDraft.requirementId, requirementId: pcbDraft.requirementId, title: pcbDraft.title, domain: pcbDraft.domain, acceptanceCriteria: pcbDraft.acceptanceCriteria });
check("test plan is domain aware", pcbTestPlan.tests.some((test) => /ERC|DRC|Gerber/i.test(test.title)));

const withArtifact = store.addArtifact({
  id: "ART-1",
  type: "source_code",
  name: "Runtime source",
  path: "src/index.ts",
  domain: "software",
  requirementIds: ["REQ-1"],
});
check("artifact add persists artifact", withArtifact.artifacts.some((artifact) => artifact.id === "ART-1" && artifact.type === "source_code"));

const withRequirement = store.addRequirement({
  requirementId: "REQ-SW-1",
  title: "Runtime queue shall be traceable",
  description: "Runtime queue work must link to artifacts and tests.",
  domain: "software",
  priority: "high",
  acceptanceCriteria: ["Queue work has a Job Center id", "Artifact links are stored"],
  riskLevel: "high",
  approvalRequired: true,
});
check("requirement add persists structured fields", withRequirement.requirements.some((req) => req.requirementId === "REQ-SW-1" && req.acceptanceCriteria.length === 2 && req.approvalRequired === true));
const withCriteria = store.updateRequirementAcceptanceCriteria({ requirementId: "REQ-SW-1", acceptanceCriteria: "Updated criterion\nSecond criterion" });
check("acceptance criteria update persists", withCriteria.requirements.find((req) => req.requirementId === "REQ-SW-1")?.acceptanceCriteria.includes("Updated criterion"));
const withLinkedArtifact = store.linkArtifactToRequirement({
  requirementId: "REQ-SW-1",
  artifact: { id: "ART-REQ-SW-1", type: "source_code", name: "Traceable source", path: "src/runtime.ts", domain: "software" },
});
const linkedReq = withLinkedArtifact.requirements.find((req) => req.requirementId === "REQ-SW-1");
check("link artifact records requirement and traceability", linkedReq?.linkedArtifacts.includes("ART-REQ-SW-1") && withLinkedArtifact.traceability.some((link) => link.toId === "ART-REQ-SW-1"));
const withApproval = store.addRequirementApproval({ requirementId: "REQ-SW-1", status: "approved", approver: "lead", reason: "ready" });
check("requirement approval is persisted as project event", withApproval.events.some((event) => event.type === "requirement.approval.recorded" && event.data?.status === "approved"));
const specPackage = buildSpecPackage(withApproval, withApproval.requirements.find((req) => req.requirementId === "REQ-SW-1"));
check("spec builder emits required documents", specPackage.prd.includes("# PRD") && specPackage.systemSpecification.includes("# System Specification") && specPackage.releaseChecklist.includes("# Release Checklist"));

try {
  store.addArtifact({
    id: "ART-ESCAPE",
    type: "source_code",
    name: "Escaping artifact",
    path: path.join(tmp, "outside.txt"),
    domain: "software",
  });
  check("artifact path outside workspace rejected", false, "expected addArtifact to throw");
} catch (error) {
  check("artifact path outside workspace rejected", /escapes workspace/.test(error?.message || String(error)), error?.message || "");
}

const withTrace = store.addTraceability({
  id: "TRACE-1",
  fromType: "requirement",
  fromId: "REQ-1",
  toType: "design",
  toId: "DES-1",
});
check("traceability add persists link", withTrace.traceability.some((link) => link.relation === "requirement_design" && link.toId === "DES-1"));

const withGate = store.addGateResult({
  id: "GATE-2",
  type: "security",
  name: "Security review",
  status: "passed",
  artifactIds: ["ART-1"],
  message: "No blocking issues",
});
check("gate result add persists gate", withGate.qualityGates.some((gate) => gate.id === "GATE-2" && gate.status === "passed"));

try {
  store.addGateResult({
    id: "GATE-ESCAPE",
    type: "security",
    name: "Escaping gate result",
    status: "failed",
    resultPath: path.join(tmp, "outside-gate.json"),
  });
  check("gate resultPath outside workspace rejected", false, "expected addGateResult to throw");
} catch (error) {
  check("gate resultPath outside workspace rejected", /escapes workspace/.test(error?.message || String(error)), error?.message || "");
}

try {
  store.createProject({ name: "Bad Domain", type: "bad", domains: ["software", "illegal_domain"] });
  check("illegal domain rejected", false, "expected createProject to throw");
} catch (error) {
  check("illegal domain rejected", /invalid domain/.test(error?.message || String(error)), error?.message || "");
}

console.log("\n[industrial-project] service and Job Center");
const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "industrial-job",
});
const service = createIndustrialProjectService({
  getCwd: () => workspace,
  jobStore,
});
const loaded = service.getProject();
check("service reads project", loaded.ok && loaded.project.projectId === "industrial-demo");
const schema = service.schema();
check("service exposes domains and artifact types", schema.domains.includes("solidworks") && schema.artifactTypes.includes("plc_program"));
check("service exposes domain planning rules", schema.planningRules.some((rule) => rule.domain === "pcb" && rule.gates.includes("pcb_drc")));
const serviceDraft = service.buildRequirementDraft({
  text: "Software API must expose job status, include tests, and pass build before deployment.",
  domain: "software",
  priority: "high",
});
check("service builds requirement draft", serviceDraft.ok && serviceDraft.draft.domain === "software" && serviceDraft.artifactPlan.artifacts.some((artifact) => artifact.type === "source_code"));
const serviceRequirement = service.addRequirement(serviceDraft.draft);
check("service adds requirement", serviceRequirement.ok && serviceRequirement.requirement.requirementId === serviceDraft.draft.requirementId);
const serviceCriteria = service.updateRequirementCriteria({ requirementId: serviceRequirement.requirement.requirementId, acceptanceCriteria: ["API returns status", "Tests pass"] });
check("service updates acceptance criteria", serviceCriteria.ok && serviceCriteria.requirement.acceptanceCriteria.includes("API returns status"));
const serviceArtifactPlan = service.generateArtifactPlan({ requirementId: serviceRequirement.requirement.requirementId });
check("service generates artifact plan and files", serviceArtifactPlan.ok && serviceArtifactPlan.generated.every((item) => fs.existsSync(item.path)) && serviceArtifactPlan.project.artifacts.some((artifact) => artifact.requirementIds.includes(serviceRequirement.requirement.requirementId)));
const artifactPlanJob = jobStore.getJob(serviceArtifactPlan.jobId || "");
check("artifact plan writes Job Center artifacts", artifactPlanJob?.artifacts.some((artifact) => artifact.type === "industrial-generated-doc" && artifact.path.endsWith("artifact-plan.md")));
const serviceTestPlan = service.generateTestPlan({ requirementId: serviceRequirement.requirement.requirementId });
check("service generates test plan", serviceTestPlan.ok && serviceTestPlan.plan.tests.length > 0 && serviceTestPlan.requirement.acceptanceCriteria.includes("API returns status"));
const serviceSpecPackage = service.generateSpecPackage({ requirementId: serviceRequirement.requirement.requirementId });
check("service generates spec package documents", serviceSpecPackage.ok && serviceSpecPackage.generated.some((item) => item.name === "release-checklist.md") && fs.existsSync(serviceSpecPackage.generated.find((item) => item.name === "prd.md").path));
const serviceApproval = service.approveRequirement({ requirementId: serviceRequirement.requirement.requirementId, status: "approved", approver: "lead", reason: "accepted for Sprint 4B" });
check("service records approval in Job Center", serviceApproval.ok && serviceApproval.approval?.status === "approved");
const approvalJob = jobStore.getJob(serviceApproval.jobId || "");
check("approval job persists approval record", approvalJob?.approvals.some((approval) => approval.scope === `requirement:${serviceRequirement.requirement.requirementId}` && approval.status === "approved"));
const serviceArtifact = service.addArtifact({ type: "bom", name: "Release BOM", domain: "mechanical", path: "bom/release.csv" });
check("service adds artifact", serviceArtifact.ok && serviceArtifact.artifact.type === "bom");
const secondServiceArtifact = service.addArtifact({ id: "ART-SECOND", type: "drawing", name: "Second drawing", domain: "mechanical", path: "drawings/second.pdf" });
const updatedFirstArtifact = service.addArtifact({ id: "ART-1", type: "source_code", name: "Runtime source updated", domain: "software", path: "src/index.ts" });
check("service returns the upserted artifact instead of the last artifact", secondServiceArtifact.ok && updatedFirstArtifact.ok && updatedFirstArtifact.artifact.id === "ART-1" && updatedFirstArtifact.artifact.name === "Runtime source updated");
const serviceEscape = service.addArtifact({ type: "source_code", name: "Service escape", domain: "software", path: path.join(tmp, "service-outside.txt") });
check("service rejects artifact path outside workspace", serviceEscape.ok === false && /escapes workspace/.test(serviceEscape.error || ""), serviceEscape.error || "");
const artifactJob = jobStore.getJob(serviceArtifact.jobId || "");
check("artifact add writes Job Center event", artifactJob?.events.some((event) => event.type === "industrial.artifact.added"));
check("artifact add records project.json as Job artifact", artifactJob?.artifacts.some((artifact) => artifact.type === "industrial-project" && artifact.path.endsWith(".hicode/project.json")));
const serviceTrace = service.addTraceability({ fromType: "artifact", fromId: "ART-1", toType: "test", toId: "TEST-1" });
check("service adds artifact -> test traceability", serviceTrace.ok && serviceTrace.traceability.relation === "artifact_test");
const serviceGate = service.addGateResult({ type: "documentation_review", name: "Doc review", status: "warning", message: "Needs final approver" });
check("service adds gate result", serviceGate.ok && serviceGate.gate.status === "warning");
const gateJob = jobStore.getJob(serviceGate.jobId || "");
check("gate result writes Job Center gate", gateJob?.gateResults.some((gate) => gate.gate === "documentation_review" && gate.status === "warning"));
const badDomain = service.saveProject({ name: "Bad", type: "x", domains: ["not_a_domain"] });
check("service rejects illegal domain", badDomain.ok === false && /invalid domain/.test(badDomain.error || ""), badDomain.error || "");

console.log("\n[industrial-project] IPC/API");
const ipcWorkspace = path.join(tmp, "ipc workspace");
fs.mkdirSync(ipcWorkspace, { recursive: true });
const ipcJobStore = new JobStore({
  storePath: path.join(tmp, "ipc-jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "industrial-ipc-job",
});
const ipcService = createIndustrialProjectService({
  getCwd: () => ipcWorkspace,
  jobStore: ipcJobStore,
});
const ipcHandlers = new Map();
registerIndustrialProjectIpc({
  register: {
    handle(channel, fn) {
      ipcHandlers.set(channel, fn);
    },
  },
  industrialProject: ipcService,
});
check("IPC registers all industrial project channels", [
  "industrial-project:schema",
  "industrial-project:get",
  "industrial-project:validate",
  "industrial-project:save",
  "industrial-requirement:draft",
  "industrial-requirement:add",
  "industrial-requirement:criteria:update",
  "industrial-requirement:artifact-plan",
  "industrial-requirement:test-plan",
  "industrial-requirement:spec-package",
  "industrial-requirement:approve",
  "industrial-project:artifact:add",
  "industrial-project:traceability:add",
  "industrial-project:gate:add",
].every((channel) => ipcHandlers.has(channel)));
const ipcSchema = await ipcHandlers.get("industrial-project:schema")({});
check("IPC schema exposes industrial domains", ipcSchema.ok && ipcSchema.domains.includes("automation") && ipcSchema.gateTypes.includes("plc_compile"));
const ipcCreate = await ipcHandlers.get("industrial-project:save")({}, {
  name: "IPC Industrial Project",
  type: "mixed_discipline_product",
  domains: ["software", "qa"],
});
check("IPC save creates persisted project", ipcCreate.ok && fs.existsSync(path.join(ipcWorkspace, INDUSTRIAL_PROJECT_FILE)));
const ipcGet = await ipcHandlers.get("industrial-project:get")({});
check("IPC get reads persisted project", ipcGet.ok && ipcGet.project.name === "IPC Industrial Project");
const ipcDraft = await ipcHandlers.get("industrial-requirement:draft")({}, {
  text: "QA must produce acceptance test plan and release checklist.",
  domain: "qa",
});
check("IPC builds requirement draft", ipcDraft.ok && ipcDraft.draft.domain === "qa");
const ipcRequirement = await ipcHandlers.get("industrial-requirement:add")({}, ipcDraft.draft);
check("IPC adds requirement", ipcRequirement.ok && ipcRequirement.requirement.requirementId === ipcDraft.draft.requirementId);
const ipcCriteria = await ipcHandlers.get("industrial-requirement:criteria:update")({}, {
  requirementId: ipcDraft.draft.requirementId,
  acceptanceCriteria: ["Acceptance test plan exists"],
});
check("IPC updates requirement criteria", ipcCriteria.ok && ipcCriteria.requirement.acceptanceCriteria.includes("Acceptance test plan exists"));
const ipcPlan = await ipcHandlers.get("industrial-requirement:artifact-plan")({}, { requirementId: ipcDraft.draft.requirementId });
check("IPC generates artifact plan", ipcPlan.ok && ipcPlan.generated.some((item) => fs.existsSync(item.path)));
const ipcTestPlan = await ipcHandlers.get("industrial-requirement:test-plan")({}, { requirementId: ipcDraft.draft.requirementId });
check("IPC generates test plan", ipcTestPlan.ok && ipcTestPlan.plan.tests.length > 0);
const ipcSpec = await ipcHandlers.get("industrial-requirement:spec-package")({}, { requirementId: ipcDraft.draft.requirementId });
check("IPC generates spec package", ipcSpec.ok && ipcSpec.generated.some((item) => item.name === "release-checklist.md"));
const ipcApproval = await ipcHandlers.get("industrial-requirement:approve")({}, { requirementId: ipcDraft.draft.requirementId, status: "approved", approver: "qa-lead" });
check("IPC records approval", ipcApproval.ok && ipcApproval.approval?.status === "approved");
const ipcArtifact = await ipcHandlers.get("industrial-project:artifact:add")({}, {
  type: "test_plan",
  name: "IPC Test Plan",
  domain: "qa",
  path: "qa/test-plan.md",
});
check("IPC artifact add persists through service", ipcArtifact.ok && ipcArtifact.project.artifacts.some((artifact) => artifact.name === "IPC Test Plan"));
const ipcInvalid = await ipcHandlers.get("industrial-project:validate")({}, { name: "", domains: ["bad_domain"] });
check("IPC validate rejects bad payload", ipcInvalid.ok === false && ipcInvalid.errors.length > 0);
const ipcEscape = await ipcHandlers.get("industrial-project:artifact:add")({}, {
  type: "source_code",
  name: "Bad IPC Artifact",
  domain: "software",
  path: path.join(tmp, "ipc-outside.txt"),
});
check("IPC artifact path escape is rejected", ipcEscape.ok === false && /escapes workspace/.test(ipcEscape.error || ""), ipcEscape.error || "");
const ipcJob = ipcJobStore.listJobs({ source: "industrial-project" })[0];
check("IPC mutations enter Job Center", !!ipcJob && ipcJob.events.some((event) => event.type.startsWith("industrial.")));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
