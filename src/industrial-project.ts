import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const INDUSTRIAL_PROJECT_SCHEMA_VERSION = 1;
export const INDUSTRIAL_PROJECT_FILE = ".hicode/project.json";

export const INDUSTRIAL_DOMAIN_KEYS = [
  "software",
  "mechanical",
  "cad",
  "solidworks",
  "pcb",
  "plc",
  "bim",
  "architecture",
  "process_chemical",
  "energy",
  "materials",
  "electrical",
  "automation",
  "manufacturing",
  "documentation",
  "qa",
] as const;

export const INDUSTRIAL_ARTIFACT_TYPES = [
  "source_code",
  "requirement_doc",
  "architecture_doc",
  "test_plan",
  "cad_model",
  "drawing",
  "step_file",
  "stl_file",
  "pcb_project",
  "schematic",
  "layout",
  "gerber",
  "bom",
  "plc_program",
  "io_map",
  "wiring_diagram",
  "ifc_model",
  "pid_diagram",
  "simulation_report",
  "material_spec",
  "inspection_report",
  "release_package",
] as const;

export const INDUSTRIAL_GATE_TYPES = [
  "build",
  "test",
  "lint",
  "security",
  "cad_validation",
  "pcb_erc",
  "pcb_drc",
  "plc_compile",
  "bim_check",
  "process_safety",
  "energy_simulation",
  "documentation_review",
  "human_approval",
] as const;

export const TRACEABILITY_RELATIONS = [
  "requirement_design",
  "design_artifact",
  "artifact_test",
  "test_release_gate",
] as const;

export const INDUSTRIAL_GATE_STATUSES = ["pending", "passed", "failed", "warning", "skipped", "simulated", "not_run", "requires_approval"] as const;
export const INDUSTRIAL_ITEM_STATUSES = ["draft", "active", "review", "approved", "released", "deprecated"] as const;
export const INDUSTRIAL_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type IndustrialDomainKey = (typeof INDUSTRIAL_DOMAIN_KEYS)[number];
export type IndustrialArtifactType = (typeof INDUSTRIAL_ARTIFACT_TYPES)[number];
export type IndustrialGateType = (typeof INDUSTRIAL_GATE_TYPES)[number];
export type TraceabilityRelation = (typeof TRACEABILITY_RELATIONS)[number];
export type IndustrialGateStatus = (typeof INDUSTRIAL_GATE_STATUSES)[number];
export type IndustrialItemStatus = (typeof INDUSTRIAL_ITEM_STATUSES)[number];
export type RequirementRiskLevel = (typeof INDUSTRIAL_RISK_LEVELS)[number];
export type TraceabilityNodeType = "requirement" | "design" | "artifact" | "test" | "release_gate";

export interface IndustrialRequirement {
  id: string;
  requirementId: string;
  title: string;
  description?: string;
  domain?: IndustrialDomainKey;
  status: IndustrialItemStatus;
  priority?: "low" | "medium" | "high" | "critical";
  acceptanceCriteria: string[];
  linkedArtifacts: string[];
  linkedTests: string[];
  riskLevel: RequirementRiskLevel;
  approvalRequired: boolean;
  owner?: string;
  source?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface IndustrialArtifact {
  id: string;
  type: IndustrialArtifactType;
  name: string;
  path?: string;
  domain?: IndustrialDomainKey;
  status: IndustrialItemStatus;
  requirementIds: string[];
  designIds: string[];
  testIds: string[];
  releaseTargetIds: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface IndustrialQualityGate {
  id: string;
  type: IndustrialGateType;
  name: string;
  status: IndustrialGateStatus;
  artifactIds: string[];
  requirementIds: string[];
  releaseTargetIds: string[];
  message?: string;
  score?: number;
  command?: string;
  resultPath?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface IndustrialToolchainItem {
  id: string;
  name: string;
  type?: string;
  command?: string;
  version?: string;
  dryRun?: boolean;
  domains: IndustrialDomainKey[];
  metadata?: Record<string, unknown>;
}

export interface IndustrialStandard {
  id: string;
  name: string;
  version?: string;
  domain?: IndustrialDomainKey;
  url?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface IndustrialReleaseTarget {
  id: string;
  name: string;
  type?: string;
  status: IndustrialItemStatus;
  artifactIds: string[];
  gateIds: string[];
  metadata?: Record<string, unknown>;
}

export interface TraceabilityLink {
  id: string;
  relation: TraceabilityRelation;
  fromType: TraceabilityNodeType;
  fromId: string;
  toType: TraceabilityNodeType;
  toId: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface IndustrialProjectEvent {
  id: string;
  type: string;
  message: string;
  createdAt: number;
  actor?: string;
  data?: Record<string, unknown>;
}

export interface IndustrialProject {
  schemaVersion: typeof INDUSTRIAL_PROJECT_SCHEMA_VERSION;
  projectId: string;
  name: string;
  type: string;
  domains: IndustrialDomainKey[];
  requirements: IndustrialRequirement[];
  artifacts: IndustrialArtifact[];
  qualityGates: IndustrialQualityGate[];
  toolchain: IndustrialToolchainItem[];
  standards: IndustrialStandard[];
  releaseTargets: IndustrialReleaseTarget[];
  traceability: TraceabilityLink[];
  events: IndustrialProjectEvent[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface IndustrialProjectStoreOptions {
  workspacePath: string;
}

export interface CreateIndustrialProjectInput {
  projectId?: string;
  name: string;
  type: string;
  domains: string[];
  requirements?: Array<Partial<IndustrialRequirement> & { title: string }>;
  artifacts?: Array<Partial<IndustrialArtifact> & { type: string; name: string }>;
  qualityGates?: Array<Partial<IndustrialQualityGate> & { type: string; name: string }>;
  toolchain?: Array<Partial<IndustrialToolchainItem> & { name: string }>;
  standards?: Array<Partial<IndustrialStandard> & { name: string }>;
  releaseTargets?: Array<Partial<IndustrialReleaseTarget> & { name: string }>;
  traceability?: Array<Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string }>;
  actor?: string;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface ValidationResult {
  ok: boolean;
  project?: IndustrialProject;
  errors: string[];
}

export const INDUSTRIAL_PROJECT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Hi Code Industrial Project",
  type: "object",
  required: [
    "schemaVersion",
    "projectId",
    "name",
    "type",
    "domains",
    "requirements",
    "artifacts",
    "qualityGates",
    "toolchain",
    "standards",
    "releaseTargets",
    "traceability",
  ],
  properties: {
    schemaVersion: { const: INDUSTRIAL_PROJECT_SCHEMA_VERSION },
    projectId: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    domains: { type: "array", items: { enum: [...INDUSTRIAL_DOMAIN_KEYS] } },
    requirements: { type: "array" },
    artifacts: { type: "array" },
    qualityGates: { type: "array" },
    toolchain: { type: "array" },
    standards: { type: "array" },
    releaseTargets: { type: "array" },
    traceability: { type: "array" },
  },
} as const;

export class IndustrialProjectStore {
  private readonly workspacePath: string;
  private readonly projectFile: string;

  constructor(options: IndustrialProjectStoreOptions) {
    if (!options?.workspacePath) throw new Error("IndustrialProjectStore requires workspacePath");
    this.workspacePath = realOrResolve(options.workspacePath);
    if (!fs.existsSync(this.workspacePath) || !fs.statSync(this.workspacePath).isDirectory()) {
      throw new Error("workspacePath must be an existing directory");
    }
    this.projectFile = path.join(this.workspacePath, INDUSTRIAL_PROJECT_FILE);
    assertInside(this.workspacePath, this.projectFile);
  }

  projectPath(): string {
    return this.projectFile;
  }

  getProject(): IndustrialProject | null {
    if (!fs.existsSync(this.projectFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(this.projectFile, "utf8")) as unknown;
    const result = validateIndustrialProject(parsed);
    if (!result.ok || !result.project) throw new Error(`invalid industrial project: ${result.errors.join("; ")}`);
    return clone(result.project);
  }

  createProject(input: CreateIndustrialProjectInput): IndustrialProject {
    const project = normalizeProject(input);
    project.events.push(event("project.created", `Industrial project created: ${project.name}`, input.actor, {
      projectId: project.projectId,
      domains: project.domains,
    }, project.createdAt));
    this.saveProject(project);
    return clone(project);
  }

  saveProject(input: IndustrialProject): IndustrialProject {
    const result = validateIndustrialProject(input);
    if (!result.ok || !result.project) throw new Error(`invalid industrial project: ${result.errors.join("; ")}`);
    this.assertProjectPaths(result.project);
    fs.mkdirSync(path.dirname(this.projectFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.projectFile, JSON.stringify(result.project, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.projectFile, 0o600); } catch {}
    return clone(result.project);
  }

  updateProject(input: Partial<CreateIndustrialProjectInput> & { actor?: string }): IndustrialProject {
    const current = this.getProject();
    if (!current) {
      if (!input.name || !input.type || !input.domains) throw new Error("project does not exist; name, type, and domains are required");
      return this.createProject(input as CreateIndustrialProjectInput);
    }
    const now = Date.now();
    const next: IndustrialProject = {
      ...current,
      name: input.name !== undefined ? requiredString(input.name, "name") : current.name,
      type: input.type !== undefined ? requiredString(input.type, "type") : current.type,
      domains: input.domains !== undefined ? normalizeDomains(input.domains) : current.domains,
      metadata: input.metadata !== undefined ? sanitizeMetadata(input.metadata) : current.metadata,
      updatedAt: now,
    };
    next.events = [
      ...current.events,
      event("project.updated", `Industrial project updated: ${next.name}`, input.actor, { projectId: next.projectId }, now),
    ];
    return this.saveProject(next);
  }

  addRequirement(input: Partial<IndustrialRequirement> & { title: string; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const now = Date.now();
    const requirement = normalizeRequirement(input, now, project.domains);
    const next = {
      ...project,
      requirements: upsertById(project.requirements, requirement),
      updatedAt: now,
      events: [...project.events, event("requirement.added", `Requirement added: ${requirement.title}`, input.actor, { requirementId: requirement.requirementId, domain: requirement.domain }, now)],
    };
    return this.saveProject(next);
  }

  updateRequirementAcceptanceCriteria(input: { requirementId: string; acceptanceCriteria: unknown; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const requirementId = requiredString(input.requirementId, "requirementId");
    const now = Date.now();
    let found = false;
    const requirements = project.requirements.map((requirement) => {
      if (requirement.id !== requirementId && requirement.requirementId !== requirementId) return requirement;
      found = true;
      return {
        ...requirement,
        acceptanceCriteria: criteriaArray(input.acceptanceCriteria),
        updatedAt: now,
      };
    });
    if (!found) throw new Error("requirement not found");
    const next = {
      ...project,
      requirements,
      updatedAt: now,
      events: [...project.events, event("requirement.criteria.updated", `Acceptance criteria updated: ${requirementId}`, input.actor, { requirementId }, now)],
    };
    return this.saveProject(next);
  }

  linkArtifactToRequirement(input: {
    requirementId: string;
    artifactId?: string;
    artifact?: Partial<IndustrialArtifact> & { type: string; name: string };
    actor?: string;
  }): IndustrialProject {
    const project = this.requireProject();
    const requirementId = requiredString(input.requirementId, "requirementId");
    const now = Date.now();
    const requirement = findRequirement(project.requirements, requirementId);
    if (!requirement) throw new Error("requirement not found");
    let artifact = input.artifact ? normalizeArtifact(input.artifact, now, project.domains) : undefined;
    if (!artifact && input.artifactId) artifact = project.artifacts.find((item) => item.id === input.artifactId);
    if (!artifact) throw new Error("artifact not found");
    artifact = {
      ...artifact,
      requirementIds: Array.from(new Set([...artifact.requirementIds, requirement.requirementId])),
      updatedAt: now,
    };
    const designId = `design-${requirement.requirementId}`;
    const traceability = upsertById(
      upsertById(project.traceability, normalizeTraceability({ fromType: "requirement", fromId: requirement.requirementId, toType: "design", toId: designId }, now)),
      normalizeTraceability({ fromType: "design", fromId: designId, toType: "artifact", toId: artifact.id }, now),
    );
    const requirements = project.requirements.map((item) => item.id === requirement.id ? {
      ...item,
      linkedArtifacts: Array.from(new Set([...item.linkedArtifacts, artifact!.id])),
      updatedAt: now,
    } : item);
    const next = {
      ...project,
      requirements,
      artifacts: upsertById(project.artifacts, artifact),
      traceability,
      updatedAt: now,
      events: [...project.events, event("requirement.artifact.linked", `Artifact linked to requirement: ${artifact.id}`, input.actor, { requirementId: requirement.requirementId, artifactId: artifact.id }, now)],
    };
    return this.saveProject(next);
  }

  addRequirementApproval(input: { requirementId: string; status: string; approver?: string; reason?: string; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const requirementId = requiredString(input.requirementId, "requirementId");
    const requirement = findRequirement(project.requirements, requirementId);
    if (!requirement) throw new Error("requirement not found");
    const now = Date.now();
    const status = approvalStatus(input.status);
    const next = {
      ...project,
      updatedAt: now,
      events: [...project.events, event("requirement.approval.recorded", `Requirement approval ${status}: ${requirement.requirementId}`, input.actor || input.approver, {
        requirementId: requirement.requirementId,
        status,
        approver: cleanString(input.approver) || undefined,
        reason: cleanString(input.reason) || undefined,
      }, now)],
    };
    return this.saveProject(next);
  }

  addArtifact(input: Partial<IndustrialArtifact> & { type: string; name: string; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const now = Date.now();
    const artifact = normalizeArtifact(input, now, project.domains);
    const next = {
      ...project,
      artifacts: upsertById(project.artifacts, artifact),
      updatedAt: now,
      events: [...project.events, event("artifact.added", `Artifact added: ${artifact.name}`, input.actor, { artifactId: artifact.id, artifactType: artifact.type }, now)],
    };
    return this.saveProject(next);
  }

  addTraceability(input: Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const now = Date.now();
    const link = normalizeTraceability(input, now);
    const next = {
      ...project,
      traceability: upsertById(project.traceability, link),
      updatedAt: now,
      events: [...project.events, event("traceability.added", `${link.relation}: ${link.fromId} -> ${link.toId}`, input.actor, { traceabilityId: link.id, relation: link.relation }, now)],
    };
    return this.saveProject(next);
  }

  addGateResult(input: Partial<IndustrialQualityGate> & { type: string; name?: string; actor?: string }): IndustrialProject {
    const project = this.requireProject();
    const now = Date.now();
    const gate = normalizeGate(input, now);
    const next = {
      ...project,
      qualityGates: upsertById(project.qualityGates, gate),
      updatedAt: now,
      events: [...project.events, event("gate.result.added", `Gate ${gate.type}: ${gate.status}`, input.actor, { gateId: gate.id, gateType: gate.type, status: gate.status }, now)],
    };
    return this.saveProject(next);
  }

  private requireProject(): IndustrialProject {
    const project = this.getProject();
    if (!project) throw new Error("industrial project does not exist");
    return project;
  }

  private assertProjectPaths(project: IndustrialProject): void {
    for (const artifact of project.artifacts) {
      assertWorkspacePath(this.workspacePath, artifact.path, `artifact ${artifact.id} path`);
    }
    for (const gate of project.qualityGates) {
      assertWorkspacePath(this.workspacePath, gate.resultPath, `gate ${gate.id} resultPath`);
    }
  }
}

export function validateIndustrialProject(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["project must be an object"] };
  const raw = value as Partial<IndustrialProject>;
  if (raw.schemaVersion !== INDUSTRIAL_PROJECT_SCHEMA_VERSION) errors.push("schemaVersion is invalid");
  if (!isNonEmptyString(raw.projectId)) errors.push("projectId is required");
  if (!isNonEmptyString(raw.name)) errors.push("name is required");
  if (!isNonEmptyString(raw.type)) errors.push("type is required");
  const domains = validateDomains(raw.domains, errors);
  const requirements = validateArray(raw.requirements, "requirements", errors);
  const artifacts = validateArray(raw.artifacts, "artifacts", errors);
  const qualityGates = validateArray(raw.qualityGates, "qualityGates", errors);
  const toolchain = validateArray(raw.toolchain, "toolchain", errors);
  const standards = validateArray(raw.standards, "standards", errors);
  const releaseTargets = validateArray(raw.releaseTargets, "releaseTargets", errors);
  const traceability = validateArray(raw.traceability, "traceability", errors);
  const events = Array.isArray(raw.events) ? raw.events : [];
  for (const requirement of requirements as Partial<IndustrialRequirement>[]) {
    if (!isNonEmptyString(requirement.title)) errors.push("requirement.title is required");
    if (requirement.domain !== undefined && !isDomain(requirement.domain)) errors.push(`invalid requirement domain: ${String(requirement.domain)}`);
    if (requirement.riskLevel !== undefined && !isRiskLevel(requirement.riskLevel)) errors.push(`invalid requirement riskLevel: ${String(requirement.riskLevel)}`);
  }
  for (const artifact of artifacts as Partial<IndustrialArtifact>[]) {
    if (!isArtifactType(artifact.type)) errors.push(`invalid artifact type: ${String(artifact.type)}`);
    if (artifact.domain !== undefined && !isDomain(artifact.domain)) errors.push(`invalid artifact domain: ${String(artifact.domain)}`);
  }
  for (const gate of qualityGates as Partial<IndustrialQualityGate>[]) {
    if (!isGateType(gate.type)) errors.push(`invalid gate type: ${String(gate.type)}`);
    if (gate.status !== undefined && !isGateStatus(gate.status)) errors.push(`invalid gate status: ${String(gate.status)}`);
  }
  for (const link of traceability as Partial<TraceabilityLink>[]) {
    if (!isTraceabilityRelation(link.relation)) errors.push(`invalid traceability relation: ${String(link.relation)}`);
  }
  if (errors.length) return { ok: false, errors };
  try {
    const project = normalizeProject({
      projectId: raw.projectId!,
      name: raw.name!,
      type: raw.type!,
      domains,
      requirements: requirements as Array<Partial<IndustrialRequirement> & { title: string }>,
      artifacts: artifacts as Array<Partial<IndustrialArtifact> & { type: string; name: string }>,
      qualityGates: qualityGates as Array<Partial<IndustrialQualityGate> & { type: string; name: string }>,
      toolchain: toolchain as Array<Partial<IndustrialToolchainItem> & { name: string }>,
      standards: standards as Array<Partial<IndustrialStandard> & { name: string }>,
      releaseTargets: releaseTargets as Array<Partial<IndustrialReleaseTarget> & { name: string }>,
      traceability: traceability as Array<Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string }>,
      metadata: raw.metadata,
      now: raw.createdAt,
    });
    project.createdAt = optionalNumber(raw.createdAt) || project.createdAt;
    project.updatedAt = optionalNumber(raw.updatedAt) || project.updatedAt;
    project.events = normalizeEvents(events);
    return { ok: true, project, errors: [] };
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
}

function normalizeProject(input: CreateIndustrialProjectInput): IndustrialProject {
  const now = safeNow(input.now);
  const domains = normalizeDomains(input.domains);
  return {
    schemaVersion: INDUSTRIAL_PROJECT_SCHEMA_VERSION,
    projectId: cleanId(input.projectId) || newId("industrial-project"),
    name: requiredString(input.name, "name"),
    type: requiredString(input.type, "type"),
    domains,
    requirements: (input.requirements || []).map((item) => normalizeRequirement(item, now, domains)),
    artifacts: (input.artifacts || []).map((item) => normalizeArtifact(item, now, domains)),
    qualityGates: (input.qualityGates || []).map((item) => normalizeGate(item, now)),
    toolchain: (input.toolchain || []).map((item) => normalizeToolchain(item, domains)),
    standards: (input.standards || []).map(normalizeStandard),
    releaseTargets: (input.releaseTargets || []).map(normalizeReleaseTarget),
    traceability: (input.traceability || []).map((item) => normalizeTraceability(item, now)),
    events: [],
    createdAt: now,
    updatedAt: now,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeRequirement(input: Partial<IndustrialRequirement> & { title: string }, now: number, domains: IndustrialDomainKey[]): IndustrialRequirement {
  const domain = optionalDomain(input.domain);
  if (domain && !domains.includes(domain)) throw new Error(`requirement domain is not enabled: ${domain}`);
  const requirementId = cleanId(input.requirementId) || cleanId(input.id) || newId("req");
  return {
    id: requirementId,
    requirementId,
    title: requiredString(input.title, "requirement.title"),
    description: cleanString(input.description) || undefined,
    domain,
    status: optionalItemStatus(input.status) || "draft",
    priority: ["low", "medium", "high", "critical"].includes(String(input.priority)) ? input.priority : undefined,
    acceptanceCriteria: criteriaArray(input.acceptanceCriteria),
    linkedArtifacts: stringArray(input.linkedArtifacts),
    linkedTests: stringArray(input.linkedTests),
    riskLevel: optionalRiskLevel(input.riskLevel) || "medium",
    approvalRequired: input.approvalRequired === true,
    owner: cleanString(input.owner) || undefined,
    source: cleanString(input.source) || undefined,
    createdAt: optionalNumber(input.createdAt) || now,
    updatedAt: optionalNumber(input.updatedAt) || now,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeArtifact(input: Partial<IndustrialArtifact> & { type: string; name: string }, now: number, domains: IndustrialDomainKey[]): IndustrialArtifact {
  const type = assertArtifactType(input.type);
  const domain = optionalDomain(input.domain);
  if (domain && !domains.includes(domain)) throw new Error(`artifact domain is not enabled: ${domain}`);
  return {
    id: cleanId(input.id) || newId("artifact"),
    type,
    name: requiredString(input.name, "artifact.name"),
    path: cleanRelativeOrAbsolutePath(input.path),
    domain,
    status: optionalItemStatus(input.status) || "draft",
    requirementIds: stringArray(input.requirementIds),
    designIds: stringArray(input.designIds),
    testIds: stringArray(input.testIds),
    releaseTargetIds: stringArray(input.releaseTargetIds),
    createdAt: optionalNumber(input.createdAt) || now,
    updatedAt: optionalNumber(input.updatedAt) || now,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeGate(input: Partial<IndustrialQualityGate> & { type: string; name?: string }, now: number): IndustrialQualityGate {
  const type = assertGateType(input.type);
  return {
    id: cleanId(input.id) || newId("gate"),
    type,
    name: cleanString(input.name) || type,
    status: isGateStatus(input.status) ? input.status : "pending",
    artifactIds: stringArray(input.artifactIds),
    requirementIds: stringArray(input.requirementIds),
    releaseTargetIds: stringArray(input.releaseTargetIds),
    message: cleanString(input.message) || undefined,
    score: optionalNumber(input.score),
    command: cleanString(input.command) || undefined,
    resultPath: cleanRelativeOrAbsolutePath(input.resultPath),
    createdAt: optionalNumber(input.createdAt) || now,
    updatedAt: optionalNumber(input.updatedAt) || now,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeToolchain(input: Partial<IndustrialToolchainItem> & { name: string }, projectDomains: IndustrialDomainKey[]): IndustrialToolchainItem {
  const domains = input.domains === undefined ? [] : normalizeDomains(input.domains);
  for (const domain of domains) {
    if (!projectDomains.includes(domain)) throw new Error(`toolchain domain is not enabled: ${domain}`);
  }
  return {
    id: cleanId(input.id) || newId("tool"),
    name: requiredString(input.name, "toolchain.name"),
    type: cleanString(input.type) || undefined,
    command: cleanString(input.command) || undefined,
    version: cleanString(input.version) || undefined,
    dryRun: input.dryRun === true,
    domains,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeStandard(input: Partial<IndustrialStandard> & { name: string }): IndustrialStandard {
  return {
    id: cleanId(input.id) || newId("std"),
    name: requiredString(input.name, "standard.name"),
    version: cleanString(input.version) || undefined,
    domain: optionalDomain(input.domain),
    url: cleanString(input.url) || undefined,
    notes: cleanString(input.notes) || undefined,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeReleaseTarget(input: Partial<IndustrialReleaseTarget> & { name: string }): IndustrialReleaseTarget {
  return {
    id: cleanId(input.id) || newId("release"),
    name: requiredString(input.name, "releaseTarget.name"),
    type: cleanString(input.type) || undefined,
    status: optionalItemStatus(input.status) || "draft",
    artifactIds: stringArray(input.artifactIds),
    gateIds: stringArray(input.gateIds),
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeTraceability(input: Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string }, now: number): TraceabilityLink {
  const fromType = assertNodeType(input.fromType);
  const toType = assertNodeType(input.toType);
  const relation = input.relation ? assertTraceabilityRelation(input.relation) : relationFor(fromType, toType);
  validateRelation(relation, fromType, toType);
  return {
    id: cleanId(input.id) || newId("trace"),
    relation,
    fromType,
    fromId: requiredString(input.fromId, "traceability.fromId"),
    toType,
    toId: requiredString(input.toId, "traceability.toId"),
    createdAt: optionalNumber(input.createdAt) || now,
    metadata: sanitizeMetadata(input.metadata),
  };
}

function normalizeEvents(items: unknown[]): IndustrialProjectEvent[] {
  return items.filter((item): item is Partial<IndustrialProjectEvent> => !!item && typeof item === "object").map((item) => ({
    id: cleanId(item.id) || newId("event"),
    type: cleanString(item.type) || "event",
    message: cleanString(item.message) || item.type || "project event",
    createdAt: optionalNumber(item.createdAt) || Date.now(),
    actor: cleanString(item.actor) || undefined,
    data: sanitizeMetadata(item.data),
  }));
}

function validateDomains(value: unknown, errors: string[]): IndustrialDomainKey[] {
  if (!Array.isArray(value)) {
    errors.push("domains must be an array");
    return [];
  }
  const domains: IndustrialDomainKey[] = [];
  for (const item of value) {
    if (isDomain(item)) domains.push(item);
    else errors.push(`invalid domain: ${String(item)}`);
  }
  if (!domains.length) errors.push("domains must contain at least one domain");
  return Array.from(new Set(domains));
}

function normalizeDomains(value: unknown): IndustrialDomainKey[] {
  const errors: string[] = [];
  const domains = validateDomains(value, errors);
  if (errors.length) throw new Error(errors.join("; "));
  return domains;
}

function validateArray(value: unknown, field: string, errors: string[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return value;
}

function relationFor(fromType: TraceabilityNodeType, toType: TraceabilityNodeType): TraceabilityRelation {
  if (fromType === "requirement" && toType === "design") return "requirement_design";
  if (fromType === "design" && toType === "artifact") return "design_artifact";
  if (fromType === "artifact" && toType === "test") return "artifact_test";
  if (fromType === "test" && toType === "release_gate") return "test_release_gate";
  throw new Error(`unsupported traceability relation ${fromType} -> ${toType}`);
}

function validateRelation(relation: TraceabilityRelation, fromType: TraceabilityNodeType, toType: TraceabilityNodeType): void {
  const expected = relationFor(fromType, toType);
  if (relation !== expected) throw new Error(`traceability relation ${relation} does not match ${fromType} -> ${toType}`);
}

function event(type: string, message: string, actor?: string, data?: Record<string, unknown>, now = Date.now()): IndustrialProjectEvent {
  return {
    id: newId("event"),
    type,
    message,
    createdAt: now,
    actor: cleanString(actor) || undefined,
    data: sanitizeMetadata(data),
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function assertArtifactType(value: unknown): IndustrialArtifactType {
  if (isArtifactType(value)) return value;
  throw new Error(`invalid artifact type: ${String(value)}`);
}

function assertGateType(value: unknown): IndustrialGateType {
  if (isGateType(value)) return value;
  throw new Error(`invalid gate type: ${String(value)}`);
}

function assertTraceabilityRelation(value: unknown): TraceabilityRelation {
  if (isTraceabilityRelation(value)) return value;
  throw new Error(`invalid traceability relation: ${String(value)}`);
}

function assertNodeType(value: unknown): TraceabilityNodeType {
  if (value === "requirement" || value === "design" || value === "artifact" || value === "test" || value === "release_gate") return value;
  throw new Error(`invalid traceability node type: ${String(value)}`);
}

function optionalDomain(value: unknown): IndustrialDomainKey | undefined {
  if (value === undefined || value === "") return undefined;
  if (isDomain(value)) return value;
  throw new Error(`invalid domain: ${String(value)}`);
}

function optionalItemStatus(value: unknown): IndustrialItemStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "string" && INDUSTRIAL_ITEM_STATUSES.includes(value as IndustrialItemStatus)) return value as IndustrialItemStatus;
  throw new Error(`invalid item status: ${String(value)}`);
}

function optionalRiskLevel(value: unknown): RequirementRiskLevel | undefined {
  if (value === undefined || value === "") return undefined;
  if (isRiskLevel(value)) return value;
  throw new Error(`invalid requirement riskLevel: ${String(value)}`);
}

function isDomain(value: unknown): value is IndustrialDomainKey {
  return typeof value === "string" && INDUSTRIAL_DOMAIN_KEYS.includes(value as IndustrialDomainKey);
}

function isArtifactType(value: unknown): value is IndustrialArtifactType {
  return typeof value === "string" && INDUSTRIAL_ARTIFACT_TYPES.includes(value as IndustrialArtifactType);
}

function isGateType(value: unknown): value is IndustrialGateType {
  return typeof value === "string" && INDUSTRIAL_GATE_TYPES.includes(value as IndustrialGateType);
}

function isGateStatus(value: unknown): value is IndustrialGateStatus {
  return typeof value === "string" && INDUSTRIAL_GATE_STATUSES.includes(value as IndustrialGateStatus);
}

function isRiskLevel(value: unknown): value is RequirementRiskLevel {
  return typeof value === "string" && INDUSTRIAL_RISK_LEVELS.includes(value as RequirementRiskLevel);
}

function isTraceabilityRelation(value: unknown): value is TraceabilityRelation {
  return typeof value === "string" && TRACEABILITY_RELATIONS.includes(value as TraceabilityRelation);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredString(value: unknown, field: string): string {
  if (!isNonEmptyString(value)) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanId(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim().replace(/[^a-z0-9._:-]/gi, "-") : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter(isNonEmptyString).map((item) => item.trim()))) : [];
}

function criteriaArray(value: unknown): string[] {
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean)));
  }
  return stringArray(value);
}

function approvalStatus(value: unknown): "requested" | "approved" | "denied" {
  if (value === "approved" || value === "denied" || value === "requested") return value;
  throw new Error(`invalid approval status: ${String(value)}`);
}

function findRequirement(requirements: IndustrialRequirement[], requirementId: string): IndustrialRequirement | undefined {
  return requirements.find((requirement) => requirement.id === requirementId || requirement.requirementId === requirementId);
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function cleanRelativeOrAbsolutePath(value: unknown): string | undefined {
  const clean = cleanString(value);
  if (!clean) return undefined;
  if (clean.split(/[\\/]+/).includes("..")) throw new Error(`path escapes project: ${clean}`);
  return clean;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(String(value || ""));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function assertInside(root: string, target: string): void {
  const safeRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const rel = path.relative(safeRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("industrial project path escapes workspace");
}

function assertWorkspacePath(root: string, value: string | undefined, field: string): void {
  const clean = cleanString(value);
  if (!clean) return;
  const candidate = path.isAbsolute(clean) ? clean : path.join(root, clean);
  try {
    assertInside(root, realOrResolve(candidate));
  } catch {
    throw new Error(`${field} escapes workspace`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "validation failed");
}
