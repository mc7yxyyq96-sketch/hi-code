import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { DomainPack, DomainQualityGate, DomainTemplate, DomainToolRequirement } from "./domain-packs.js";
import {
  INDUSTRIAL_ARTIFACT_TYPES,
  INDUSTRIAL_DOMAIN_KEYS,
  INDUSTRIAL_GATE_TYPES,
  type IndustrialArtifactType,
  type IndustrialDomainKey,
  type IndustrialGateType,
  type IndustrialProject,
} from "./industrial-project.js";

export const AGENT_TEAM_SCHEMA_VERSION = 1;
export const AGENT_TEAM_STATE_FILE = "agent-team-plans.json";

export type AgentRole =
  | "product-manager"
  | "system-architect"
  | "fullstack-engineer"
  | "qa-engineer"
  | "security-engineer"
  | "release-manager"
  | "mechanical-cad-engineer"
  | "solidworks-engineer"
  | "pcb-engineer"
  | "plc-automation-engineer"
  | "electrical-engineer"
  | "bim-architect"
  | "process-chemical-engineer"
  | "energy-systems-engineer"
  | "materials-engineer"
  | "manufacturing-engineer"
  | "technical-writer"
  | "domain-pack-reviewer";

export interface AgentResponsibility {
  id: string;
  description: string;
  domains: IndustrialDomainKey[];
  deliverables: string[];
}

export interface AgentInput {
  task: string;
  projectType: string;
  domains: IndustrialDomainKey[];
  domainPackIds: string[];
  dependsOn: string[];
  context: Record<string, unknown>;
}

export interface AgentOutput {
  summary: string;
  artifacts: string[];
  reviewResult: "pending" | "passed" | "needs_changes";
  notes: string[];
}

export interface AgentReviewChecklist {
  id: string;
  title: string;
  items: string[];
  required: boolean;
}

export interface AgentEscalationRule {
  id: string;
  condition: string;
  action: string;
  approvalRequired: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: AgentRole;
  domains: IndustrialDomainKey[];
  responsibilities: AgentResponsibility[];
  inputs: string[];
  outputs: string[];
  reviewChecklists: AgentReviewChecklist[];
  escalationRules: AgentEscalationRule[];
  qualityGates: IndustrialGateType[];
  artifactTypes: IndustrialArtifactType[];
  canUsePatchArena: boolean;
  source: "builtin" | "domain-pack";
  domainPackId?: string;
}

export interface AgentTaskPlan {
  id: string;
  agentId: string;
  agentName: string;
  role: AgentRole;
  title: string;
  status: "queued" | "running" | "paused" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
  executionGroup: number;
  parallelGroup: string;
  dependsOn: string[];
  input: AgentInput;
  output: AgentOutput;
  expectedArtifacts: string[];
  qualityGates: IndustrialGateType[];
  reviewChecklist: AgentReviewChecklist[];
  reviewResult: "pending" | "passed" | "needs_changes";
  humanApprovalRequired: boolean;
}

export interface AgentTeamRoute {
  patchArena: boolean;
  patchArenaRequest?: {
    task: string;
    providerIds: string[];
    mode: "auto";
    reason: string;
  };
  industrialPlan: boolean;
  artifactPlan: string[];
  checklistPlan: string[];
  toolRunPlan: Array<{
    tool: string;
    domainPackId?: string;
    dryRunOnly: true;
    approvalRequired: true;
    notes: string;
  }>;
}

export interface AgentTeamPlan {
  schemaVersion: typeof AGENT_TEAM_SCHEMA_VERSION;
  id: string;
  title: string;
  task: string;
  projectType: string;
  domains: IndustrialDomainKey[];
  domainPackIds: string[];
  executionMode: "sequential" | "parallel" | "hybrid";
  tasks: AgentTaskPlan[];
  reviewChain: string[];
  qualityGates: IndustrialGateType[];
  humanApprovalPoints: string[];
  expectedArtifacts: string[];
  route: AgentTeamRoute;
  createdAt: number;
  updatedAt: number;
  actor: string;
  source: "agent-team";
  metadata?: Record<string, unknown>;
}

export interface CreateAgentTeamPlanInput {
  task: string;
  project?: Partial<IndustrialProject> | null;
  domains?: string[];
  projectType?: string;
  domainPacks?: DomainPack[];
  actor?: string;
  title?: string;
  executionMode?: "sequential" | "parallel" | "hybrid";
  now?: number;
}

export interface AgentTeamStoreOptions {
  safeRoot: string;
}

export class AgentTeamStore {
  private readonly safeRoot: string;
  private readonly statePath: string;

  constructor(options: AgentTeamStoreOptions) {
    if (!options?.safeRoot) throw new Error("AgentTeamStore requires safeRoot");
    this.safeRoot = path.resolve(options.safeRoot);
    this.statePath = path.join(this.safeRoot, AGENT_TEAM_STATE_FILE);
    assertInside(this.safeRoot, this.statePath);
  }

  savePlan(plan: AgentTeamPlan): AgentTeamPlan {
    const state = this.loadState();
    const normalized = normalizePlan(plan);
    state.plans[normalized.id] = normalized;
    this.saveState(state);
    return clone(normalized);
  }

  getPlan(planId: string): AgentTeamPlan | null {
    const id = cleanId(planId);
    return this.loadState().plans[id] ? clone(this.loadState().plans[id]) : null;
  }

  listPlans(limit = 50): AgentTeamPlan[] {
    return Object.values(this.loadState().plans)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(0, Math.min(200, limit)))
      .map(clone);
  }

  private loadState(): { plans: Record<string, AgentTeamPlan> } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return { plans: parsed && typeof parsed.plans === "object" && !Array.isArray(parsed.plans) ? parsed.plans : {} };
    } catch {
      return { plans: {} };
    }
  }

  private saveState(state: { plans: Record<string, AgentTeamPlan> }): void {
    fs.mkdirSync(this.safeRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}

export function createAgentTeamPlan(input: CreateAgentTeamPlanInput): AgentTeamPlan {
  const task = requiredText(input.task, "task");
  const now = safeNow(input.now);
  const enabledPacks = (input.domainPacks || []).filter((pack) => pack?.enabled === true);
  const domains = inferDomains({
    explicit: input.domains,
    project: input.project || null,
    task,
    packs: enabledPacks,
  });
  const projectType = cleanString(input.projectType) || cleanString(input.project?.type) || inferProjectType(domains);
  const profiles = selectProfiles({ domains, task, enabledPacks });
  const executionMode = input.executionMode || (profiles.length > 6 ? "hybrid" : "sequential");
  const domainPackIds = enabledPacks.map((pack) => pack.manifest.id).sort();
  const qualityGates = unique([
    ...profiles.flatMap((profile) => profile.qualityGates),
    ...enabledPacks.flatMap((pack) => pack.manifest.qualityGates.map((gate) => gate.type)),
    ...baseGatesForTask(task, domains),
  ]).filter(isGate) as IndustrialGateType[];
  const expectedArtifacts = unique([
    ...profiles.flatMap((profile) => profile.artifactTypes),
    ...enabledPacks.flatMap((pack) => pack.manifest.templates.map((template) => template.type)),
    ...enabledPacks.flatMap((pack) => pack.manifest.checklists.map((checklist) => checklist.path)),
  ]);
  const reviewChain = buildReviewChain(profiles);
  const humanApprovalPoints = buildApprovalPoints({ task, domains, packs: enabledPacks, gates: qualityGates });
  const route = buildRoute({ task, domains, packs: enabledPacks });
  const tasks = buildTasks({ profiles, task, projectType, domains, domainPackIds, expectedArtifacts, qualityGates, humanApprovalPoints });
  return normalizePlan({
    schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
    id: `agent-plan-${hash(`${task}:${domains.join(",")}:${now}`).slice(0, 12)}`,
    title: cleanString(input.title) || summarizeTask(task),
    task,
    projectType,
    domains,
    domainPackIds,
    executionMode,
    tasks,
    reviewChain,
    qualityGates,
    humanApprovalPoints,
    expectedArtifacts,
    route,
    createdAt: now,
    updatedAt: now,
    actor: cleanString(input.actor) || "user",
    source: "agent-team",
    metadata: {
      profileCount: profiles.length,
      domainPackCount: enabledPacks.length,
      supportsParallel: profiles.length > 3,
    },
  });
}

export function builtInAgentProfiles(): AgentProfile[] {
  return clone(BUILTIN_AGENT_PROFILES);
}

export function listAgentProfilesForContext(input: { domains?: string[]; domainPacks?: DomainPack[]; task?: string } = {}): AgentProfile[] {
  const domains = normalizeDomains(input.domains || []);
  const enabledPacks = (input.domainPacks || []).filter((pack) => pack.enabled === true);
  return selectProfiles({ domains, task: input.task || "", enabledPacks });
}

function selectProfiles({ domains, task, enabledPacks }: { domains: IndustrialDomainKey[]; task: string; enabledPacks: DomainPack[] }): AgentProfile[] {
  const selected = new Map<string, AgentProfile>();
  for (const id of ["product-manager", "system-architect"]) addProfile(selected, id);
  if (domains.includes("software") || mentions(task, ["api", "frontend", "backend", "electron", "code", "software"])) addProfile(selected, "fullstack-engineer");
  if (domains.some((domain) => ["mechanical", "cad"].includes(domain))) addProfile(selected, "mechanical-cad-engineer");
  if (domains.includes("solidworks")) addProfile(selected, "solidworks-engineer");
  if (domains.includes("pcb")) addProfile(selected, "pcb-engineer");
  if (domains.includes("plc") || domains.includes("automation")) addProfile(selected, "plc-automation-engineer");
  if (domains.includes("electrical")) addProfile(selected, "electrical-engineer");
  if (domains.includes("bim") || domains.includes("architecture")) addProfile(selected, "bim-architect");
  if (domains.includes("process_chemical")) addProfile(selected, "process-chemical-engineer");
  if (domains.includes("energy")) addProfile(selected, "energy-systems-engineer");
  if (domains.includes("materials")) addProfile(selected, "materials-engineer");
  if (domains.includes("manufacturing")) addProfile(selected, "manufacturing-engineer");
  addProfile(selected, "qa-engineer");
  addProfile(selected, "security-engineer");
  addProfile(selected, "technical-writer");
  addProfile(selected, "release-manager");
  for (const pack of enabledPacks) {
    for (const profile of pack.manifest.agentProfiles || []) {
      const id = `${pack.manifest.id}:${profile.id}`;
      selected.set(id, {
        id,
        name: profile.name,
        role: "domain-pack-reviewer",
        domains: normalizeDomains(profile.domains),
        responsibilities: [{
          id: `${id}:review`,
          description: `Review Domain Pack ${pack.manifest.id} standards, templates, and checklists.`,
          domains: normalizeDomains(profile.domains),
          deliverables: pack.manifest.checklists.map((checklist) => checklist.path),
        }],
        inputs: ["project plan", "domain pack manifest", "quality gate evidence"],
        outputs: ["domain pack review notes", "checklist coverage"],
        reviewChecklists: pack.manifest.checklists.map((checklist) => ({
          id: checklist.id,
          title: checklist.name,
          items: checklist.items,
          required: true,
        })),
        escalationRules: [{
          id: `${id}:approval`,
          condition: "pack checklist or gate evidence is missing",
          action: "request human domain approval",
          approvalRequired: true,
        }],
        qualityGates: pack.manifest.qualityGates.map((gate) => gate.type),
        artifactTypes: pack.manifest.templates.map((template) => normalizeArtifactType(template.type)).filter(Boolean) as IndustrialArtifactType[],
        canUsePatchArena: false,
        source: "domain-pack",
        domainPackId: pack.manifest.id,
      });
    }
  }
  return Array.from(selected.values());
}

function addProfile(map: Map<string, AgentProfile>, id: string): void {
  const profile = BUILTIN_AGENT_PROFILES.find((item) => item.id === id);
  if (profile) map.set(profile.id, clone(profile));
}

function buildTasks({ profiles, task, projectType, domains, domainPackIds, expectedArtifacts, qualityGates, humanApprovalPoints }: {
  profiles: AgentProfile[];
  task: string;
  projectType: string;
  domains: IndustrialDomainKey[];
  domainPackIds: string[];
  expectedArtifacts: string[];
  qualityGates: IndustrialGateType[];
  humanApprovalPoints: string[];
}): AgentTaskPlan[] {
  const agentIds = profiles.map((profile) => profile.id);
  return profiles.map((profile) => {
    const executionGroup = profile.role === "product-manager" ? 1
      : profile.role === "system-architect" ? 2
        : ["qa-engineer", "security-engineer", "technical-writer"].includes(profile.role) ? 4
          : profile.role === "release-manager" ? 5
            : 3;
    const dependsOn = executionGroup === 1 ? [] : executionGroup === 2 ? ["product-manager"] : executionGroup === 3 ? ["system-architect"] : agentIds.filter((id) => !["qa-engineer", "security-engineer", "technical-writer", "release-manager"].includes(id));
    const artifacts = unique([...profile.artifactTypes, ...expectedArtifacts.filter((item) => profileMatchesArtifact(profile, item))]).slice(0, 10);
    return {
      id: `agent-task-${cleanId(profile.id)}`,
      agentId: profile.id,
      agentName: profile.name,
      role: profile.role,
      title: `${profile.name}: ${taskAction(profile.role)}`,
      status: humanApprovalPoints.length ? "waiting_approval" : "queued",
      executionGroup,
      parallelGroup: `group-${executionGroup}`,
      dependsOn: unique(dependsOn).filter((id) => id !== profile.id),
      input: {
        task,
        projectType,
        domains,
        domainPackIds,
        dependsOn: unique(dependsOn).filter((id) => id !== profile.id),
        context: {
          responsibilities: profile.responsibilities.map((item) => item.description),
          source: profile.source,
          domainPackId: profile.domainPackId,
        },
      },
      output: {
        summary: `${profile.name} will produce ${artifacts.length ? artifacts.join(", ") : "review notes"} for this plan.`,
        artifacts,
        reviewResult: "pending",
        notes: ["Task is planned; execution must be performed through provider/worktree/job flows."],
      },
      expectedArtifacts: artifacts,
      qualityGates: unique([...profile.qualityGates, ...qualityGates.filter((gate) => profile.qualityGates.includes(gate))]).filter(isGate) as IndustrialGateType[],
      reviewChecklist: profile.reviewChecklists,
      reviewResult: "pending",
      humanApprovalRequired: profile.escalationRules.some((rule) => rule.approvalRequired) || humanApprovalPoints.length > 0,
    };
  });
}

function buildRoute({ task, domains, packs }: { task: string; domains: IndustrialDomainKey[]; packs: DomainPack[] }): AgentTeamRoute {
  const patchArena = domains.includes("software") || mentions(task, ["code", "bug", "feature", "frontend", "backend", "electron", "api"]);
  const industrial = domains.some((domain) => domain !== "software" && domain !== "documentation" && domain !== "qa");
  const templates = packs.flatMap((pack) => pack.manifest.templates);
  const tools = packs.flatMap((pack) => pack.manifest.toolRequirements.map((tool) => ({ tool, packId: pack.manifest.id })));
  return {
    patchArena,
    patchArenaRequest: patchArena ? {
      task,
      providerIds: ["hicode-internal"],
      mode: "auto",
      reason: "software task can be sent to Patch Arena after human approval",
    } : undefined,
    industrialPlan: industrial,
    artifactPlan: templates.map((template) => `${template.type}: ${template.path}`),
    checklistPlan: packs.flatMap((pack) => pack.manifest.checklists.map((checklist) => `${pack.manifest.id}: ${checklist.name}`)),
    toolRunPlan: tools.map(({ tool, packId }) => ({
      tool: tool.name,
      domainPackId: packId,
      dryRunOnly: true,
      approvalRequired: true,
      notes: tool.notes || "External tool requirement only; No real industrial tool execution in Sprint 5B.",
    })),
  };
}

function buildReviewChain(profiles: AgentProfile[]): string[] {
  const order: AgentRole[] = [
    "product-manager",
    "system-architect",
    "fullstack-engineer",
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
    "domain-pack-reviewer",
    "qa-engineer",
    "security-engineer",
    "technical-writer",
    "release-manager",
  ];
  return profiles
    .slice()
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))
    .map((profile) => profile.id);
}

function buildApprovalPoints({ task, domains, packs, gates }: { task: string; domains: IndustrialDomainKey[]; packs: DomainPack[]; gates: IndustrialGateType[] }): string[] {
  const points = ["Approve multi-agent plan before execution"];
  if (domains.some((domain) => !["software", "documentation", "qa"].includes(domain))) points.push("Approve industrial artifact and tool run plan");
  if (packs.some((pack) => pack.manifest.toolRequirements.length > 0)) points.push("Approve any external industrial tool invocation");
  if (gates.includes("human_approval") || mentions(task, ["release", "safety", "hazop", "certification", "compliance"])) points.push("Human release or safety approval required");
  return unique(points);
}

function inferDomains({ explicit, project, task, packs }: { explicit?: string[]; project?: Partial<IndustrialProject> | null; task: string; packs: DomainPack[] }): IndustrialDomainKey[] {
  const values = [
    ...(explicit || []),
    ...(project?.domains || []),
    ...packs.flatMap((pack) => pack.manifest.domains),
    ...domainsFromText(task),
  ];
  const domains = normalizeDomains(values);
  return domains.length ? domains : ["software", "documentation", "qa"];
}

function domainsFromText(text: string): IndustrialDomainKey[] {
  const lower = text.toLowerCase();
  const domains: IndustrialDomainKey[] = [];
  const pairs: Array<[IndustrialDomainKey, RegExp]> = [
    ["software", /software|code|api|frontend|backend|electron|runtime|test/],
    ["pcb", /pcb|schematic|layout|gerber|erc|drc/],
    ["plc", /plc|ladder|iec 61131|fat|sat/],
    ["automation", /automation|robot|control system/],
    ["cad", /cad|step|stl|drawing/],
    ["solidworks", /solidworks|sldprt|sldasm/],
    ["mechanical", /mechanical|bom|machining|tolerance/],
    ["bim", /bim|ifc|revit/],
    ["architecture", /building|floor plan|architecture/],
    ["process_chemical", /chemical|p&id|pid|hazop|pfd|material balance/],
    ["energy", /energy|load flow|power system|protection setting/],
    ["electrical", /electrical|wiring|single-line|sld/],
    ["materials", /material|astm|inspection|metallurgy/],
    ["manufacturing", /manufacturing|mes|qms|apqp|pilot build/],
  ];
  for (const [domain, pattern] of pairs) {
    if (pattern.test(lower)) domains.push(domain);
  }
  if (domains.length && !domains.includes("qa")) domains.push("qa");
  if (domains.length && !domains.includes("documentation")) domains.push("documentation");
  return unique(domains).filter(isDomain) as IndustrialDomainKey[];
}

function baseGatesForTask(task: string, domains: IndustrialDomainKey[]): IndustrialGateType[] {
  const gates: IndustrialGateType[] = ["documentation_review", "human_approval"];
  if (domains.includes("software")) gates.push("build", "test", "lint", "security");
  if (domains.includes("pcb")) gates.push("pcb_erc", "pcb_drc");
  if (domains.includes("plc") || domains.includes("automation")) gates.push("plc_compile", "test");
  if (domains.includes("cad") || domains.includes("mechanical") || domains.includes("solidworks")) gates.push("cad_validation");
  if (domains.includes("bim") || domains.includes("architecture")) gates.push("bim_check");
  if (domains.includes("process_chemical")) gates.push("process_safety");
  if (domains.includes("energy") || domains.includes("electrical")) gates.push("energy_simulation");
  if (mentions(task, ["security", "auth", "permission"])) gates.push("security");
  return unique(gates).filter(isGate) as IndustrialGateType[];
}

function inferProjectType(domains: IndustrialDomainKey[]): string {
  if (domains.includes("software") && domains.length <= 3) return "software_product";
  if (domains.includes("pcb")) return "pcb_product_development";
  if (domains.includes("plc") || domains.includes("automation")) return "automation_system";
  if (domains.includes("cad") || domains.includes("mechanical")) return "mechanical_product";
  return "industrial_workbench";
}

function normalizePlan(plan: AgentTeamPlan): AgentTeamPlan {
  const task = requiredText(plan.task, "task");
  return {
    schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
    id: cleanId(plan.id) || `agent-plan-${hash(task).slice(0, 12)}`,
    title: cleanString(plan.title) || summarizeTask(task),
    task,
    projectType: cleanString(plan.projectType) || "industrial_workbench",
    domains: normalizeDomains(plan.domains),
    domainPackIds: unique((plan.domainPackIds || []).map(cleanId).filter(Boolean)),
    executionMode: ["sequential", "parallel", "hybrid"].includes(plan.executionMode) ? plan.executionMode : "sequential",
    tasks: Array.isArray(plan.tasks) ? plan.tasks : [],
    reviewChain: unique(plan.reviewChain || []),
    qualityGates: unique(plan.qualityGates || []).filter(isGate) as IndustrialGateType[],
    humanApprovalPoints: unique(plan.humanApprovalPoints || []),
    expectedArtifacts: unique(plan.expectedArtifacts || []),
    route: plan.route || { patchArena: false, industrialPlan: false, artifactPlan: [], checklistPlan: [], toolRunPlan: [] },
    createdAt: numberOr(plan.createdAt, Date.now()),
    updatedAt: numberOr(plan.updatedAt, Date.now()),
    actor: cleanString(plan.actor) || "user",
    source: "agent-team",
    metadata: sanitizeMetadata(plan.metadata),
  };
}

const BUILTIN_AGENT_PROFILES: AgentProfile[] = [
  agent("product-manager", "Product Manager", "product-manager", ["software", "documentation", "qa"], ["Clarify user goals, acceptance criteria, value, and approval scope."], ["requirement_doc"], ["documentation_review", "human_approval"]),
  agent("system-architect", "System Architect", "system-architect", ["software", "mechanical", "cad", "pcb", "plc", "bim", "process_chemical", "energy", "materials", "electrical", "automation", "manufacturing", "documentation", "qa"], ["Create system boundaries, interfaces, risk map, and execution order."], ["architecture_doc"], ["documentation_review", "security"]),
  agent("fullstack-engineer", "Fullstack Engineer", "fullstack-engineer", ["software"], ["Implement software changes through isolated workspace or Patch Arena."], ["source_code", "architecture_doc"], ["build", "test", "lint"], true),
  agent("qa-engineer", "QA Engineer", "qa-engineer", ["software", "mechanical", "pcb", "plc", "bim", "process_chemical", "energy", "materials", "manufacturing", "qa"], ["Define verification strategy and check gate evidence."], ["test_plan", "inspection_report"], ["test", "documentation_review"]),
  agent("security-engineer", "Security Engineer", "security-engineer", ["software", "electrical", "automation", "documentation", "qa"], ["Review permissions, secrets, path boundaries, and release risks."], ["inspection_report"], ["security", "documentation_review"]),
  agent("release-manager", "Release Manager", "release-manager", ["software", "mechanical", "pcb", "plc", "bim", "process_chemical", "energy", "materials", "manufacturing", "documentation", "qa"], ["Coordinate release checklist, approvals, and package readiness."], ["release_package"], ["human_approval", "documentation_review"]),
  agent("mechanical-cad-engineer", "Mechanical CAD Engineer", "mechanical-cad-engineer", ["mechanical", "cad", "manufacturing"], ["Plan CAD model, drawing, STEP export, BOM, and manufacturability review."], ["cad_model", "drawing", "step_file", "bom"], ["cad_validation", "documentation_review", "human_approval"]),
  agent("solidworks-engineer", "SolidWorks Engineer", "solidworks-engineer", ["solidworks", "mechanical", "cad"], ["Plan SolidWorks rebuild, drawing, BOM, configuration, and neutral export checks."], ["cad_model", "drawing", "step_file", "bom"], ["cad_validation", "documentation_review", "human_approval"]),
  agent("pcb-engineer", "PCB Engineer", "pcb-engineer", ["pcb", "electrical"], ["Plan schematic, layout, Gerber, BOM, ERC/DRC, and fabrication release evidence."], ["schematic", "layout", "gerber", "bom"], ["pcb_erc", "pcb_drc", "documentation_review", "human_approval"]),
  agent("plc-automation-engineer", "PLC Automation Engineer", "plc-automation-engineer", ["plc", "automation", "electrical"], ["Plan PLC program, I/O map, FAT/SAT, wiring, and commissioning evidence."], ["plc_program", "io_map", "wiring_diagram", "test_plan"], ["plc_compile", "test", "documentation_review", "human_approval"]),
  agent("electrical-engineer", "Electrical Engineer", "electrical-engineer", ["electrical", "energy", "automation"], ["Plan wiring, single-line evidence, protection, electrical safety, and load checks."], ["wiring_diagram", "simulation_report", "inspection_report"], ["energy_simulation", "documentation_review", "human_approval"]),
  agent("bim-architect", "BIM Architect", "bim-architect", ["bim", "architecture"], ["Plan IFC/floor-plan evidence, model checks, and building code review."], ["ifc_model", "drawing", "architecture_doc", "inspection_report"], ["bim_check", "documentation_review", "human_approval"]),
  agent("process-chemical-engineer", "Process Chemical Engineer", "process-chemical-engineer", ["process_chemical", "materials"], ["Plan PFD/P&ID, material balance, HAZOP, safety, and process evidence."], ["pid_diagram", "simulation_report", "material_spec", "test_plan"], ["process_safety", "documentation_review", "human_approval"]),
  agent("energy-systems-engineer", "Energy Systems Engineer", "energy-systems-engineer", ["energy", "electrical"], ["Plan load flow, energy simulation, protection settings, and commissioning evidence."], ["simulation_report", "wiring_diagram", "inspection_report"], ["energy_simulation", "documentation_review", "human_approval"]),
  agent("materials-engineer", "Materials Engineer", "materials-engineer", ["materials", "manufacturing"], ["Plan material spec, test report, inspection plan, and supplier evidence."], ["material_spec", "test_plan", "inspection_report"], ["test", "documentation_review", "human_approval"]),
  agent("manufacturing-engineer", "Manufacturing Engineer", "manufacturing-engineer", ["manufacturing", "mechanical", "qa"], ["Plan manufacturing route, pilot build, inspection, QMS evidence, and release package."], ["drawing", "bom", "inspection_report", "release_package"], ["test", "documentation_review", "human_approval"]),
  agent("technical-writer", "Technical Writer", "technical-writer", ["documentation", "software", "mechanical", "pcb", "plc", "bim", "process_chemical", "energy", "materials", "manufacturing"], ["Prepare technical docs, release notes, traceability summaries, and user-facing approvals."], ["requirement_doc", "architecture_doc", "release_package"], ["documentation_review"]),
];

function agent(id: AgentRole, name: string, role: AgentRole, domains: IndustrialDomainKey[], responsibilities: string[], artifactTypes: IndustrialArtifactType[], qualityGates: IndustrialGateType[], canUsePatchArena = false): AgentProfile {
  return {
    id,
    name,
    role,
    domains,
    responsibilities: responsibilities.map((description, index) => ({
      id: `${id}-resp-${index + 1}`,
      description,
      domains,
      deliverables: artifactTypes,
    })),
    inputs: ["user task", "project domains", "enabled domain packs", "quality gates"],
    outputs: artifactTypes.map((type) => `${type} plan`).concat(["review notes"]),
    reviewChecklists: [{
      id: `${id}-review`,
      title: `${name} review checklist`,
      items: [
        "Inputs are traceable to the user task",
        "Expected artifacts are named",
        "Quality gates and owner are clear",
        "Escalation conditions are recorded",
      ],
      required: true,
    }],
    escalationRules: [{
      id: `${id}-approval`,
      condition: "artifact, tool, safety, or release evidence is incomplete",
      action: "request human approval before execution or release",
      approvalRequired: ["release-manager", "security-engineer", "pcb-engineer", "plc-automation-engineer", "mechanical-cad-engineer", "solidworks-engineer", "process-chemical-engineer"].includes(role),
    }],
    qualityGates,
    artifactTypes,
    canUsePatchArena,
    source: "builtin",
  };
}

function profileMatchesArtifact(profile: AgentProfile, artifact: string): boolean {
  return profile.artifactTypes.includes(artifact as IndustrialArtifactType) || profile.domains.some((domain) => artifact.includes(domain));
}

function taskAction(role: AgentRole): string {
  return {
    "product-manager": "define requirements and acceptance criteria",
    "system-architect": "define architecture and dependency boundaries",
    "fullstack-engineer": "prepare software implementation path",
    "qa-engineer": "prepare verification plan",
    "security-engineer": "review security and permission boundaries",
    "release-manager": "prepare release and approval plan",
    "mechanical-cad-engineer": "prepare CAD artifact plan",
    "solidworks-engineer": "prepare SolidWorks artifact plan",
    "pcb-engineer": "prepare PCB artifact and ERC/DRC plan",
    "plc-automation-engineer": "prepare PLC and FAT/SAT plan",
    "electrical-engineer": "prepare electrical evidence plan",
    "bim-architect": "prepare BIM/architecture evidence plan",
    "process-chemical-engineer": "prepare process safety evidence plan",
    "energy-systems-engineer": "prepare energy simulation evidence plan",
    "materials-engineer": "prepare material test evidence plan",
    "manufacturing-engineer": "prepare manufacturing QA evidence plan",
    "technical-writer": "prepare documentation plan",
    "domain-pack-reviewer": "review enabled Domain Pack evidence",
  }[role];
}

function summarizeTask(task: string): string {
  const text = task.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function normalizeArtifactType(value: unknown): IndustrialArtifactType | null {
  return typeof value === "string" && INDUSTRIAL_ARTIFACT_TYPES.includes(value as IndustrialArtifactType) ? value as IndustrialArtifactType : null;
}

function normalizeDomains(values: unknown[]): IndustrialDomainKey[] {
  return unique(values.filter(isDomain) as IndustrialDomainKey[]);
}

function isDomain(value: unknown): value is IndustrialDomainKey {
  return typeof value === "string" && INDUSTRIAL_DOMAIN_KEYS.includes(value as IndustrialDomainKey);
}

function isGate(value: unknown): value is IndustrialGateType {
  return typeof value === "string" && INDUSTRIAL_GATE_TYPES.includes(value as IndustrialGateType);
}

function mentions(text: string, words: string[]): boolean {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "")));
}

function requiredText(value: unknown, field: string): string {
  const text = cleanString(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[^a-z0-9._:-]/gi, "-").slice(0, 160) : "";
}

function numberOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeNow(value: unknown): number {
  return numberOr(value, Date.now());
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function assertInside(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("agent team path escapes safe root");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
