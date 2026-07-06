import {
  INDUSTRIAL_ARTIFACT_TYPES,
  INDUSTRIAL_DOMAIN_KEYS,
  INDUSTRIAL_GATE_TYPES,
  type IndustrialArtifactType,
  type IndustrialDomainKey,
  type IndustrialGateType,
  type IndustrialProject,
  type IndustrialRequirement,
  type RequirementRiskLevel,
} from "./industrial-project.js";

export interface RequirementBuilderInput {
  text: string;
  domain?: string;
  priority?: string;
  projectDomains?: string[];
  actor?: string;
}

export interface StructuredRequirement {
  requirementId: string;
  title: string;
  description: string;
  domain: IndustrialDomainKey;
  priority: "low" | "medium" | "high" | "critical";
  acceptanceCriteria: string[];
  linkedArtifacts: string[];
  linkedTests: string[];
  riskLevel: RequirementRiskLevel;
  approvalRequired: boolean;
}

export interface PlannedArtifact {
  id: string;
  type: IndustrialArtifactType;
  name: string;
  path: string;
  domain: IndustrialDomainKey;
  qualityGates: IndustrialGateType[];
}

export interface PlannedTest {
  id: string;
  title: string;
  gate: IndustrialGateType;
  evidence: string;
}

export interface DomainPlanningRule {
  domain: IndustrialDomainKey;
  artifacts: IndustrialArtifactType[];
  tests: string[];
  gates: IndustrialGateType[];
  releaseChecklist: string[];
}

export interface ArtifactPlan {
  requirementId: string;
  domain: IndustrialDomainKey;
  artifacts: PlannedArtifact[];
  qualityGates: IndustrialGateType[];
  traceability: Array<{ fromType: string; fromId: string; toType: string; toId: string; relation: string }>;
}

export interface TestPlanOutline {
  requirementId: string;
  domain: IndustrialDomainKey;
  tests: PlannedTest[];
  acceptanceCriteria: string[];
}

export interface SpecPackage {
  requirementId: string;
  prd: string;
  systemSpecification: string;
  architectureOutline: string;
  industrialArtifactPlan: string;
  testPlanOutline: string;
  releaseChecklist: string;
}

export const DOMAIN_PLANNING_RULES: Record<IndustrialDomainKey, DomainPlanningRule> = {
  software: {
    domain: "software",
    artifacts: ["source_code", "architecture_doc", "test_plan", "release_package"],
    tests: ["unit tests", "integration tests", "API contract tests", "deployment smoke test"],
    gates: ["build", "test", "lint", "security", "documentation_review"],
    releaseChecklist: ["source tagged", "tests passed", "security review complete", "deployment notes ready"],
  },
  mechanical: {
    domain: "mechanical",
    artifacts: ["cad_model", "drawing", "step_file", "bom", "inspection_report"],
    tests: ["fit check", "tolerance review", "BOM review", "inspection plan review"],
    gates: ["cad_validation", "documentation_review", "human_approval"],
    releaseChecklist: ["drawing approved", "STEP exported", "BOM checked", "inspection plan attached"],
  },
  cad: {
    domain: "cad",
    artifacts: ["cad_model", "drawing", "step_file", "stl_file", "bom"],
    tests: ["model integrity check", "drawing review", "STEP export check", "BOM consistency check"],
    gates: ["cad_validation", "documentation_review", "human_approval"],
    releaseChecklist: ["native CAD saved", "neutral format exported", "drawing revision set", "BOM released"],
  },
  solidworks: {
    domain: "solidworks",
    artifacts: ["cad_model", "drawing", "step_file", "bom", "inspection_report"],
    tests: ["SolidWorks rebuild check", "drawing dimension review", "mass properties review", "export validation"],
    gates: ["cad_validation", "documentation_review", "human_approval"],
    releaseChecklist: ["SLDPRT/SLDASM archived", "drawing PDF exported", "STEP exported", "BOM approved"],
  },
  pcb: {
    domain: "pcb",
    artifacts: ["schematic", "layout", "gerber", "bom", "inspection_report"],
    tests: ["schematic ERC", "layout DRC", "Gerber review", "BOM availability check"],
    gates: ["pcb_erc", "pcb_drc", "documentation_review", "human_approval"],
    releaseChecklist: ["ERC passed", "DRC passed", "Gerber package reviewed", "fabrication notes attached"],
  },
  plc: {
    domain: "plc",
    artifacts: ["plc_program", "io_map", "wiring_diagram", "test_plan"],
    tests: ["PLC compile", "I/O map review", "FAT procedure", "SAT procedure"],
    gates: ["plc_compile", "test", "documentation_review", "human_approval"],
    releaseChecklist: ["PLC project archived", "I/O map approved", "FAT passed", "SAT checklist ready"],
  },
  automation: {
    domain: "automation",
    artifacts: ["plc_program", "io_map", "wiring_diagram", "test_plan"],
    tests: ["control sequence simulation", "I/O verification", "FAT procedure", "SAT procedure"],
    gates: ["plc_compile", "test", "documentation_review", "human_approval"],
    releaseChecklist: ["sequence reviewed", "interlocks verified", "FAT passed", "operator notes ready"],
  },
  bim: {
    domain: "bim",
    artifacts: ["ifc_model", "drawing", "inspection_report", "release_package"],
    tests: ["IFC export check", "clash review", "code check", "model metadata review"],
    gates: ["bim_check", "documentation_review", "human_approval"],
    releaseChecklist: ["IFC exported", "clash report reviewed", "code check complete", "model revision frozen"],
  },
  architecture: {
    domain: "architecture",
    artifacts: ["ifc_model", "drawing", "architecture_doc", "inspection_report"],
    tests: ["floor plan review", "code compliance check", "accessibility review", "drawing package review"],
    gates: ["bim_check", "documentation_review", "human_approval"],
    releaseChecklist: ["floor plan approved", "code check complete", "drawing package sealed", "IFC exported"],
  },
  process_chemical: {
    domain: "process_chemical",
    artifacts: ["pid_diagram", "simulation_report", "material_spec", "test_plan"],
    tests: ["PFD review", "P&ID review", "HAZOP action review", "material balance check"],
    gates: ["process_safety", "documentation_review", "human_approval"],
    releaseChecklist: ["PFD/P&ID reviewed", "HAZOP actions closed", "material balance attached", "process safety approved"],
  },
  energy: {
    domain: "energy",
    artifacts: ["simulation_report", "wiring_diagram", "material_spec", "inspection_report"],
    tests: ["load flow study", "protection coordination review", "energy simulation", "commissioning checklist"],
    gates: ["energy_simulation", "documentation_review", "human_approval"],
    releaseChecklist: ["load flow complete", "protection settings reviewed", "commissioning plan ready", "approval recorded"],
  },
  electrical: {
    domain: "electrical",
    artifacts: ["wiring_diagram", "io_map", "material_spec", "inspection_report"],
    tests: ["single-line diagram review", "load flow review", "protection settings review", "continuity inspection"],
    gates: ["energy_simulation", "documentation_review", "human_approval"],
    releaseChecklist: ["single-line approved", "protection settings checked", "wiring drawings released", "inspection plan ready"],
  },
  materials: {
    domain: "materials",
    artifacts: ["material_spec", "test_plan", "simulation_report", "inspection_report"],
    tests: ["material property test", "supplier certificate review", "inspection plan review", "traceability review"],
    gates: ["test", "documentation_review", "human_approval"],
    releaseChecklist: ["material spec approved", "test report attached", "inspection plan ready", "traceability recorded"],
  },
  manufacturing: {
    domain: "manufacturing",
    artifacts: ["drawing", "bom", "inspection_report", "release_package"],
    tests: ["manufacturability review", "process plan review", "inspection plan review", "pilot build review"],
    gates: ["documentation_review", "test", "human_approval"],
    releaseChecklist: ["process plan approved", "BOM released", "inspection report ready", "release package complete"],
  },
  documentation: {
    domain: "documentation",
    artifacts: ["requirement_doc", "architecture_doc", "test_plan", "release_package"],
    tests: ["document review", "traceability review", "release checklist review"],
    gates: ["documentation_review", "human_approval"],
    releaseChecklist: ["documents reviewed", "traceability links complete", "approver recorded", "release notes ready"],
  },
  qa: {
    domain: "qa",
    artifacts: ["test_plan", "inspection_report", "release_package"],
    tests: ["test plan review", "acceptance test execution", "inspection record review", "release gate review"],
    gates: ["test", "documentation_review", "human_approval"],
    releaseChecklist: ["test plan approved", "acceptance evidence attached", "inspection complete", "release gate signed"],
  },
};

const DOMAIN_KEYWORDS: Array<[IndustrialDomainKey, RegExp]> = [
  ["pcb", /\b(pcb|schematic|gerber|layout|erc|drc)\b/i],
  ["plc", /\b(plc|ladder|io map|i\/o|fat|sat)\b/i],
  ["automation", /\b(automation|control sequence|interlock|scada|hmi)\b/i],
  ["solidworks", /\b(solidworks|sldprt|sldasm)\b/i],
  ["cad", /\b(cad|step|stl|drawing|3d model)\b/i],
  ["mechanical", /\b(mechanical|tolerance|machining|bom|assembly)\b/i],
  ["bim", /\b(bim|ifc|clash)\b/i],
  ["architecture", /\b(floor plan|architecture|building code|accessibility)\b/i],
  ["process_chemical", /\b(pfd|p&id|pid|hazop|chemical|material balance)\b/i],
  ["energy", /\b(energy|load flow|protection|commissioning)\b/i],
  ["electrical", /\b(electrical|single-line|wiring|protection settings)\b/i],
  ["materials", /\b(material|inspection|certificate|property test)\b/i],
  ["manufacturing", /\b(manufacturing|fabrication|pilot build|process plan)\b/i],
  ["qa", /\b(qa|quality|acceptance|inspection|test plan)\b/i],
  ["software", /\b(api|source|code|deploy|service|frontend|backend|database|test)\b/i],
];

export function buildRequirementFromText(input: RequirementBuilderInput): StructuredRequirement {
  const text = requiredText(input.text);
  const projectDomains = normalizeDomains(input.projectDomains);
  const domain = pickDomain(text, input.domain, projectDomains);
  const priority = pickPriority(text, input.priority);
  const riskLevel = pickRiskLevel(text, priority, domain);
  const title = titleFromText(text, domain);
  const acceptanceCriteria = criteriaFromText(text, domain);
  const requirementId = requirementIdFrom(title, domain);
  return {
    requirementId,
    title,
    description: text,
    domain,
    priority,
    acceptanceCriteria,
    linkedArtifacts: [],
    linkedTests: [],
    riskLevel,
    approvalRequired: riskLevel === "high" || riskLevel === "critical" || /approval|批准|签核|sign[- ]?off/i.test(text),
  };
}

export function buildArtifactPlan(requirement: Pick<IndustrialRequirement, "id" | "requirementId" | "title" | "domain">): ArtifactPlan {
  const domain = ensureDomain(requirement.domain);
  const rule = DOMAIN_PLANNING_RULES[domain];
  const requirementId = requirement.requirementId || requirement.id;
  const designId = `design-${safeSlug(requirementId)}`;
  const artifacts = rule.artifacts.map((type, index) => ({
    id: `${safeSlug(requirementId)}-${type}`,
    type,
    name: `${requirement.title} ${artifactLabel(type)}`,
    path: `.hicode/generated/requirements/${safeSlug(requirementId)}/${index + 1}-${type}.md`,
    domain,
    qualityGates: rule.gates.filter((gate) => INDUSTRIAL_GATE_TYPES.includes(gate)),
  }));
  return {
    requirementId,
    domain,
    artifacts,
    qualityGates: rule.gates,
    traceability: [
      { fromType: "requirement", fromId: requirementId, toType: "design", toId: designId, relation: "requirement_design" },
      ...artifacts.map((artifact) => ({ fromType: "design", fromId: designId, toType: "artifact", toId: artifact.id, relation: "design_artifact" })),
    ],
  };
}

export function buildTestPlanOutline(requirement: Pick<IndustrialRequirement, "id" | "requirementId" | "title" | "domain" | "acceptanceCriteria">): TestPlanOutline {
  const domain = ensureDomain(requirement.domain);
  const rule = DOMAIN_PLANNING_RULES[domain];
  const requirementId = requirement.requirementId || requirement.id;
  return {
    requirementId,
    domain,
    tests: rule.tests.map((title, index) => ({
      id: `${safeSlug(requirementId)}-test-${index + 1}`,
      title,
      gate: rule.gates[Math.min(index, rule.gates.length - 1)] || "test",
      evidence: `.hicode/generated/requirements/${safeSlug(requirementId)}/test-${index + 1}-evidence.md`,
    })),
    acceptanceCriteria: requirement.acceptanceCriteria?.length ? requirement.acceptanceCriteria : criteriaFromText(requirement.title, domain),
  };
}

export function buildSpecPackage(project: IndustrialProject, requirement: IndustrialRequirement): SpecPackage {
  const artifactPlan = buildArtifactPlan(requirement);
  const testPlan = buildTestPlanOutline(requirement);
  const release = DOMAIN_PLANNING_RULES[artifactPlan.domain].releaseChecklist;
  const heading = `${requirement.requirementId}: ${requirement.title}`;
  return {
    requirementId: requirement.requirementId,
    prd: markdown("PRD", heading, [
      ["Problem", requirement.description || requirement.title],
      ["Domain", artifactPlan.domain],
      ["Priority", requirement.priority || "medium"],
      ["Acceptance Criteria", list(requirement.acceptanceCriteria)],
    ]),
    systemSpecification: markdown("System Specification", heading, [
      ["Project", project.name],
      ["Functional Scope", requirement.description || requirement.title],
      ["Interfaces", interfaceSection(artifactPlan.domain)],
      ["Constraints", constraintsFor(artifactPlan.domain)],
    ]),
    architectureOutline: markdown("Architecture Outline", heading, [
      ["Decomposition", architectureFor(artifactPlan.domain)],
      ["Traceability", artifactPlan.traceability.map((link) => `${link.fromType}:${link.fromId} -> ${link.toType}:${link.toId}`).join("\n")],
      ["Quality Gates", list(artifactPlan.qualityGates)],
    ]),
    industrialArtifactPlan: markdown("Industrial Artifact Plan", heading, [
      ["Artifacts", artifactPlan.artifacts.map((artifact) => `${artifact.id}: ${artifact.type} - ${artifact.name}`).join("\n")],
      ["Storage", `.hicode/generated/requirements/${safeSlug(requirement.requirementId)}/`],
    ]),
    testPlanOutline: markdown("Test Plan Outline", heading, [
      ["Tests", testPlan.tests.map((test) => `${test.id}: ${test.title} (${test.gate})`).join("\n")],
      ["Acceptance Criteria", list(testPlan.acceptanceCriteria)],
    ]),
    releaseChecklist: markdown("Release Checklist", heading, [
      ["Checklist", release.map((item) => `[ ] ${item}`).join("\n")],
      ["Approval", requirement.approvalRequired ? "Human approval required before release." : "Human approval optional unless project policy requires it."],
    ]),
  };
}

export function planningRulesForDomains(domains: string[] = []): DomainPlanningRule[] {
  const keys = normalizeDomains(domains);
  const selected: IndustrialDomainKey[] = keys.length ? keys : ["software"];
  return selected.map((domain) => DOMAIN_PLANNING_RULES[domain]);
}

function pickDomain(text: string, requested: string | undefined, projectDomains: IndustrialDomainKey[]): IndustrialDomainKey {
  if (isDomain(requested)) return requested;
  const matched = DOMAIN_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0];
  if (matched && (!projectDomains.length || projectDomains.includes(matched))) return matched;
  return projectDomains[0] || "software";
}

function pickPriority(text: string, requested: string | undefined): StructuredRequirement["priority"] {
  if (requested === "low" || requested === "medium" || requested === "high" || requested === "critical") return requested;
  if (/critical|紧急|安全|hazop|protection|interlock|release blocker/i.test(text)) return "critical";
  if (/must|必须|required|shall|risk|approval/i.test(text)) return "high";
  if (/should|需要|improve|optimize/i.test(text)) return "medium";
  return "medium";
}

function pickRiskLevel(text: string, priority: StructuredRequirement["priority"], domain: IndustrialDomainKey): RequirementRiskLevel {
  if (/safety|安全|hazop|protection|interlock|chemical|高压|critical/i.test(text)) return "critical";
  if (priority === "critical") return "critical";
  if (priority === "high" || ["process_chemical", "energy", "electrical", "plc", "automation"].includes(domain)) return "high";
  if (priority === "low") return "low";
  return "medium";
}

function criteriaFromText(text: string, domain: IndustrialDomainKey): string[] {
  const explicit = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => /^(acceptance|验收|criterion|criteria|must|shall|should|需要|必须)/i.test(line))
    .slice(0, 6);
  if (explicit.length) return explicit;
  const rule = DOMAIN_PLANNING_RULES[domain];
  return [
    "Requirement is traceable to at least one design or artifact.",
    `${artifactLabel(rule.artifacts[0])} is created or planned with owner and path.`,
    `${rule.gates[0]} gate has a recorded result or pending approval.`,
  ];
}

function titleFromText(text: string, domain: IndustrialDomainKey): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || `${domain} requirement`;
  const sentence = firstLine.split(/[。.!?]/)[0] || firstLine;
  return sentence.slice(0, 88);
}

function requirementIdFrom(title: string, domain: IndustrialDomainKey): string {
  const digest = hash(title).slice(0, 8).toUpperCase();
  return `REQ-${domain.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${digest}`;
}

function normalizeDomains(domains: unknown): IndustrialDomainKey[] {
  if (!Array.isArray(domains)) return [];
  return Array.from(new Set(domains.filter(isDomain)));
}

function ensureDomain(value: unknown): IndustrialDomainKey {
  return isDomain(value) ? value : "software";
}

function isDomain(value: unknown): value is IndustrialDomainKey {
  return typeof value === "string" && INDUSTRIAL_DOMAIN_KEYS.includes(value as IndustrialDomainKey);
}

function artifactLabel(type: IndustrialArtifactType): string {
  return type.replace(/_/g, " ");
}

function markdown(title: string, heading: string, sections: Array<[string, string]>): string {
  return [`# ${title}`, "", `## ${heading}`, "", ...sections.flatMap(([name, body]) => [`### ${name}`, body || "-", ""])].join("\n");
}

function list(items: unknown): string {
  return Array.isArray(items) && items.length ? items.map((item) => `- ${String(item)}`).join("\n") : "-";
}

function interfaceSection(domain: IndustrialDomainKey): string {
  if (domain === "software") return "API contracts, runtime configuration, deployment environment, and test fixtures.";
  if (domain === "pcb") return "Electrical nets, connector pinout, fabrication outputs, and BOM line items.";
  if (domain === "plc" || domain === "automation") return "I/O map, control sequence, HMI/SCADA signals, FAT/SAT evidence.";
  if (domain === "process_chemical") return "PFD/P&ID references, equipment tags, material streams, safety actions.";
  if (domain === "energy" || domain === "electrical") return "Single-line diagram, load flow assumptions, protection settings, commissioning evidence.";
  return "Domain artifacts, review evidence, quality gates, and release package references.";
}

function constraintsFor(domain: IndustrialDomainKey): string {
  return DOMAIN_PLANNING_RULES[domain].gates.map((gate) => `- ${gate} gate must be recorded before release.`).join("\n");
}

function architectureFor(domain: IndustrialDomainKey): string {
  if (domain === "software") return "User workflow, service/API boundary, data model, test and deployment pipeline.";
  if (domain === "pcb") return "Schematic blocks, board layout constraints, fabrication outputs, bring-up evidence.";
  if (domain === "plc" || domain === "automation") return "Control sequence, I/O boundary, interlock logic, FAT/SAT workflow.";
  if (domain === "mechanical" || domain === "cad" || domain === "solidworks") return "Assembly structure, CAD model, drawings, neutral exports, BOM.";
  if (domain === "bim" || domain === "architecture") return "Model hierarchy, drawing package, IFC export, code/check evidence.";
  if (domain === "process_chemical") return "Process flow, P&ID, material balance, process safety review.";
  return "Requirement, domain artifact set, quality evidence, release approval.";
}

function safeSlug(value: string): string {
  return String(value || "requirement").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "requirement";
}

function requiredText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error("requirement text is required");
  return text;
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
