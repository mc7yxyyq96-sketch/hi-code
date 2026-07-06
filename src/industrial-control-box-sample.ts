import fs from "node:fs";
import path from "node:path";

import {
  IndustrialProjectStore,
  type IndustrialArtifact,
  type IndustrialArtifactType,
  type IndustrialDomainKey,
  type IndustrialGateStatus,
  type IndustrialGateType,
  type IndustrialProject,
  type IndustrialQualityGate,
  type IndustrialRequirement,
  type IndustrialStandard,
  type TraceabilityLink,
} from "./industrial-project.js";
import { builtInDomainPacks as getBuiltInDomainPacks } from "./domain-packs.js";
import { IndustrialToolAdapterRegistry, type ToolRunResult } from "./industrial-tool-adapters.js";
import { ReleaseBuilder, type ReleasePackage, type ReleaseReadiness } from "./release-builder.js";

export const INDUSTRIAL_CONTROL_BOX_SAMPLE_ID = "industrial-control-box-demo";
export const INDUSTRIAL_CONTROL_BOX_SAMPLE_NAME = "Industrial Control Box Demo";
export const INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION = "industrial-control-box-demo";

export interface IndustrialControlBoxSampleOptions {
  workspacePath: string;
  registry?: IndustrialToolAdapterRegistry;
  actor?: string;
  runInstalledTools?: boolean;
  overwrite?: boolean;
  releaseVersion?: string;
  now?: number;
}

export interface IndustrialControlBoxSampleArtifact {
  id: string;
  type: IndustrialArtifactType;
  name: string;
  relativePath: string;
  absolutePath: string;
  simulated: boolean;
  generated: boolean;
  externalRequired?: boolean;
}

export interface IndustrialControlBoxSampleGate {
  id: string;
  name: string;
  status: IndustrialGateStatus;
  type: IndustrialGateType;
  resultPath: string;
  message: string;
}

export interface IndustrialControlBoxToolRunSummary {
  adapterId: "freecad" | "kicad" | "openplc";
  installed: boolean;
  mode: "dry-run" | "execute";
  simulated: boolean;
  ok: boolean;
  summary: string;
  artifacts: string[];
}

export interface IndustrialControlBoxSampleResult {
  sampleId: typeof INDUSTRIAL_CONTROL_BOX_SAMPLE_ID;
  name: typeof INDUSTRIAL_CONTROL_BOX_SAMPLE_NAME;
  sampleRoot: string;
  projectPath: string;
  project: IndustrialProject;
  requestedDomainPacks: string[];
  enabledDomainPacks: string[];
  domainPackAliasMappings: Record<string, string>;
  artifacts: IndustrialControlBoxSampleArtifact[];
  gates: IndustrialControlBoxSampleGate[];
  toolRuns: IndustrialControlBoxToolRunSummary[];
  releasePackage: ReleasePackage;
  readiness: ReleaseReadiness;
  simulated: {
    cad: boolean;
    pcb: boolean;
    plcCompile: boolean;
  };
}

type ArtifactInput = Omit<IndustrialArtifact, "createdAt" | "updatedAt">;
type GateInput = Omit<IndustrialQualityGate, "createdAt" | "updatedAt">;

const SAMPLE_ROOT = INDUSTRIAL_CONTROL_BOX_SAMPLE_ID;
const REQUESTED_DOMAIN_PACKS = ["mechanical-cad", "pcb-eda", "plc-automation", "electrical", "manufacturing-qa", "documentation"];
const DOMAIN_PACK_ALIAS_MAPPINGS: Record<string, string> = {
  electrical: "energy-electrical",
  documentation: "software-product",
};
const ENABLED_DOMAIN_PACKS = ["mechanical-cad", "pcb-eda", "plc-automation", "energy-electrical", "manufacturing-qa", "software-product"];
const SAMPLE_DOMAINS: IndustrialDomainKey[] = ["software", "mechanical", "cad", "pcb", "plc", "electrical", "automation", "manufacturing", "documentation", "qa"];

export function createIndustrialControlBoxSample(options: IndustrialControlBoxSampleOptions): IndustrialControlBoxSampleResult {
  const workspace = safeWorkspace(options.workspacePath);
  const now = options.now || Date.now();
  const actor = cleanText(options.actor) || "user";
  const releaseVersion = cleanVersion(options.releaseVersion || INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION);
  const sampleRoot = safeJoin(workspace, SAMPLE_ROOT);
  const releaseRoot = safeJoin(workspace, "releases", releaseVersion);

  if (fs.existsSync(sampleRoot) || fs.existsSync(releaseRoot)) {
    if (!options.overwrite) {
      throw new Error("Industrial Control Box sample already exists; set overwrite to recreate it.");
    }
    removeKnownSamplePath(workspace, sampleRoot);
    removeKnownSamplePath(workspace, releaseRoot);
  }

  fs.mkdirSync(sampleRoot, { recursive: true, mode: 0o755 });
  const registry = options.registry || new IndustrialToolAdapterRegistry();
  const runInstalledTools = options.runInstalledTools === true;

  const requirements = buildRequirements(now);
  const artifactInputs: ArtifactInput[] = [];
  const sampleArtifacts: IndustrialControlBoxSampleArtifact[] = [];
  const gateInputs: GateInput[] = [];
  const gates: IndustrialControlBoxSampleGate[] = [];
  const traceability: Array<Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string }> = [];

  writeRequirements({ workspace, requirements, artifactInputs, sampleArtifacts });
  writeSoftwareArtifacts({ workspace, artifactInputs, sampleArtifacts });
  writeElectricalArtifacts({ workspace, artifactInputs, sampleArtifacts });
  writeBomArtifact({ workspace, artifactInputs, sampleArtifacts });
  writeProjectDocs({ workspace, artifactInputs, sampleArtifacts });

  const freecad = runFreeCadSample({ registry, workspace, runInstalledTools, actor });
  mirrorToolArtifacts({ workspace, result: freecad, targetDir: "cad", sampleArtifacts, artifactInputs, defaultType: "cad_model", defaultDomain: "cad", required: false });
  ensureToolMetadata({ workspace, dir: "cad", adapterId: "freecad", result: freecad, sampleArtifacts, artifactInputs, type: "inspection_report", domain: "cad", name: "FreeCAD run metadata", primaryArtifactId: "artifact-cad-metadata" });
  collectAdapterArtifacts({ workspace, result: freecad, sampleArtifacts, artifactInputs, defaultType: "cad_model", defaultDomain: "cad", required: false });

  writeKiCadBomTemplate({ workspace, artifactInputs, sampleArtifacts });
  const kicad = runKiCadSample({ registry, workspace, runInstalledTools, actor });
  mirrorToolArtifacts({ workspace, result: kicad, targetDir: "pcb", sampleArtifacts, artifactInputs, defaultType: "pcb_project", defaultDomain: "pcb", required: false });
  ensureToolMetadata({ workspace, dir: "pcb", adapterId: "kicad", result: kicad, sampleArtifacts, artifactInputs, type: "inspection_report", domain: "pcb", name: "KiCad run metadata", primaryArtifactId: "artifact-pcb-metadata" });
  collectAdapterArtifacts({ workspace, result: kicad, sampleArtifacts, artifactInputs, defaultType: "pcb_project", defaultDomain: "pcb", required: false });

  const plc = runPlcSample({ registry, workspace, runInstalledTools, actor });
  mirrorToolArtifacts({ workspace, result: plc, targetDir: "plc", sampleArtifacts, artifactInputs, defaultType: "plc_program", defaultDomain: "plc", required: true });
  collectAdapterArtifacts({ workspace, result: plc, sampleArtifacts, artifactInputs, defaultType: "plc_program", defaultDomain: "plc", required: true });

  const allArtifactIds = artifactInputs.map((item) => item.id);
  addProjectManifestArtifact(artifactInputs, sampleArtifacts, workspace);
  writeTraceability({ requirements, artifactInputs, traceability, now });

  writeGateSet({
    workspace,
    gateInputs,
    gates,
    requirements,
    artifactInputs,
    freecad,
    kicad,
    plc,
    now,
  });

  const store = new IndustrialProjectStore({ workspacePath: workspace });
  const project = store.createProject({
    projectId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
    name: INDUSTRIAL_CONTROL_BOX_SAMPLE_NAME,
    type: "industrial_control_box",
    domains: SAMPLE_DOMAINS,
    requirements,
    artifacts: artifactInputs,
    qualityGates: gateInputs,
    toolchain: toolchainItems({ freecad, kicad, plc }),
    standards: domainPackStandards(ENABLED_DOMAIN_PACKS),
    releaseTargets: [{
      id: "release-industrial-control-box-demo",
      name: "Industrial Control Box Demo release package",
      type: "sample_release",
      status: "active",
      artifactIds: allArtifactIds,
      gateIds: gateInputs.map((item) => item.id),
      metadata: { version: releaseVersion },
    }],
    traceability,
    actor,
    now,
    metadata: {
      sampleProject: true,
      sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
      requestedDomainPacks: REQUESTED_DOMAIN_PACKS,
      enabledDomainPacks: ENABLED_DOMAIN_PACKS,
      domainPackAliasMappings: DOMAIN_PACK_ALIAS_MAPPINGS,
      runInstalledTools,
      generatedAt: new Date(now).toISOString(),
    },
  });
  store.addRequirementApproval({
    requirementId: "REQ-ICB-EMERGENCY-STOP",
    status: "approved",
    approver: actor,
    reason: "Sample requirement approved to demonstrate traceability and release evidence.",
    actor,
  });

  const releaseBuilder = new ReleaseBuilder({ workspacePath: workspace, now });
  const readinessBeforeRelease = releaseBuilder.getReadiness({ version: releaseVersion });
  const releaseGate = writeGateEvidence({
    workspace,
    id: "gate-release-readiness",
    type: "documentation_review",
    name: "Release readiness gate",
    status: readinessBeforeRelease.ready ? (readinessBeforeRelease.warnings.length ? "warning" : "passed") : "failed",
    message: readinessBeforeRelease.ready
      ? "Release readiness checked; simulated/dry-run evidence is visible in release notes."
      : `Release readiness blocked: ${readinessBeforeRelease.blockers.map((item) => item.message).join("; ")}`,
    artifactIds: allArtifactIds,
    requirementIds: requirements.map((item) => item.requirementId),
    releaseTargetIds: ["release-industrial-control-box-demo"],
    metadata: { readiness: readinessBeforeRelease },
  });
  store.addGateResult({ ...releaseGate, actor });
  gates.push(toSampleGate(workspace, releaseGate));

  const releasePackage = new ReleaseBuilder({ workspacePath: workspace, now }).buildRelease({
    version: releaseVersion,
    createdBy: actor,
    overwrite: true,
    includeSourceCode: false,
    includeBuildOutput: false,
    includeDocs: false,
  });
  store.addArtifact({
    id: "artifact-release-package-manifest",
    type: "release_package",
    name: "Demo release manifest",
    path: relativePath(workspace, releasePackage.manifestPath),
    status: "released",
    releaseTargetIds: ["release-industrial-control-box-demo"],
    actor,
    metadata: {
      releaseId: releasePackage.releaseId,
      releaseVersion,
      releasePath: relativePath(workspace, releasePackage.releasePath),
      checksumPath: relativePath(workspace, releasePackage.checksumPath),
      generated: true,
      simulated: false,
    },
  });
  sampleArtifacts.push(sampleArtifact({
    workspace,
    id: "artifact-release-package-manifest",
    type: "release_package",
    name: "Demo release manifest",
    relativePath: relativePath(workspace, releasePackage.manifestPath),
    simulated: false,
    generated: true,
  }));

  const finalProject = store.getProject();
  if (!finalProject) throw new Error("sample project was not persisted");
  return {
    sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
    name: INDUSTRIAL_CONTROL_BOX_SAMPLE_NAME,
    sampleRoot,
    projectPath: store.projectPath(),
    project: finalProject,
    requestedDomainPacks: [...REQUESTED_DOMAIN_PACKS],
    enabledDomainPacks: [...ENABLED_DOMAIN_PACKS],
    domainPackAliasMappings: { ...DOMAIN_PACK_ALIAS_MAPPINGS },
    artifacts: dedupeArtifacts(sampleArtifacts),
    gates,
    toolRuns: [
      toolRunSummary("freecad", freecad),
      toolRunSummary("kicad", kicad),
      toolRunSummary("openplc", plc),
    ],
    releasePackage,
    readiness: releasePackage.readiness,
    simulated: {
      cad: freecad.simulated,
      pcb: kicad.simulated,
      plcCompile: plc.simulated,
    },
  };
}

export function requiredIndustrialControlBoxFiles(): string[] {
  return [
    ".hicode/project.json",
    `${SAMPLE_ROOT}/requirements.md`,
    `${SAMPLE_ROOT}/requirements.json`,
    `${SAMPLE_ROOT}/cad/metadata.json`,
    `${SAMPLE_ROOT}/pcb/kicad-run-plan.md`,
    `${SAMPLE_ROOT}/pcb/expected-artifacts.json`,
    `${SAMPLE_ROOT}/pcb/bom-template.csv`,
    `${SAMPLE_ROOT}/plc/plc-program.st`,
    `${SAMPLE_ROOT}/plc/io-map.csv`,
    `${SAMPLE_ROOT}/plc/safety-interlocks.md`,
    `${SAMPLE_ROOT}/plc/fat-checklist.md`,
    `${SAMPLE_ROOT}/plc/sat-checklist.md`,
    `${SAMPLE_ROOT}/electrical/wiring-diagram.md`,
    `${SAMPLE_ROOT}/electrical/terminal-list.csv`,
    `${SAMPLE_ROOT}/electrical/power-budget.md`,
    `${SAMPLE_ROOT}/bom/system-bom.csv`,
    `${SAMPLE_ROOT}/docs/system-spec.md`,
    `${SAMPLE_ROOT}/docs/test-plan.md`,
    `${SAMPLE_ROOT}/docs/release-checklist.md`,
    `${SAMPLE_ROOT}/docs/manufacturing-notes.md`,
    `releases/${INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION}/release-manifest.json`,
    `releases/${INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION}/evidence-report.md`,
    `releases/${INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION}/checksums.sha256`,
  ];
}

function buildRequirements(now: number): IndustrialRequirement[] {
  const rows: Array<Pick<IndustrialRequirement, "requirementId" | "title" | "description" | "domain" | "priority" | "acceptanceCriteria" | "riskLevel" | "approvalRequired">> = [
    {
      requirementId: "REQ-ICB-ENCLOSURE",
      title: "Enclosure dimensions and DIN rail mounting",
      description: "The control box enclosure shall be 160 mm x 110 mm x 60 mm nominal, with wall thickness, lid, mounting holes, and DIN rail installation provisions.",
      domain: "cad",
      priority: "high",
      riskLevel: "medium",
      approvalRequired: true,
      acceptanceCriteria: ["External dimensions are specified in millimeters.", "DIN rail mounting is documented.", "CAD output is generated or dry-run plan is marked simulated."],
    },
    {
      requirementId: "REQ-ICB-POWER",
      title: "24 VDC power input and protection",
      description: "The system shall accept a 24 VDC industrial power input and document terminal, fuse, and power budget assumptions.",
      domain: "electrical",
      priority: "high",
      riskLevel: "medium",
      approvalRequired: true,
      acceptanceCriteria: ["Power input appears in terminal list.", "Power budget includes relays and status LEDs.", "Wiring notes include verification before commissioning."],
    },
    {
      requirementId: "REQ-ICB-DI",
      title: "Digital input set",
      description: "The control board and PLC draft shall define emergency stop, start, stop, and door interlock digital inputs.",
      domain: "plc",
      priority: "high",
      riskLevel: "high",
      approvalRequired: true,
      acceptanceCriteria: ["I/O map includes every digital input.", "PLC program references each input tag.", "Missing input descriptions are rejected by the safety gate."],
    },
    {
      requirementId: "REQ-ICB-RELAY",
      title: "Relay output set",
      description: "The control box shall include two relay outputs with fail-safe defaults and terminal assignments.",
      domain: "automation",
      priority: "high",
      riskLevel: "high",
      approvalRequired: true,
      acceptanceCriteria: ["I/O map includes two relay outputs.", "Wiring diagram draft identifies relay terminals.", "PLC draft keeps outputs de-energized until safe conditions are met."],
    },
    {
      requirementId: "REQ-ICB-EMERGENCY-STOP",
      title: "Emergency stop interlock",
      description: "Emergency stop shall be modeled as a normally closed healthy input, documented in PLC safety interlocks, and require manual approval before any field test.",
      domain: "plc",
      priority: "critical",
      riskLevel: "critical",
      approvalRequired: true,
      acceptanceCriteria: ["Safety interlocks mention emergency stop.", "PLC safety gate records human approval requirement.", "Release notes preserve not_run/simulated compile status when applicable."],
    },
    {
      requirementId: "REQ-ICB-LEDS",
      title: "Status LED indicators",
      description: "The system shall include power and fault LEDs in PCB, electrical, BOM, and test plan outputs.",
      domain: "electrical",
      priority: "medium",
      riskLevel: "low",
      approvalRequired: false,
      acceptanceCriteria: ["BOM lists status LEDs.", "Power budget includes LED current.", "Test plan verifies LED behavior."],
    },
    {
      requirementId: "REQ-ICB-ENVIRONMENT",
      title: "Operating environment",
      description: "The system shall document indoor industrial cabinet use, 0-40 C operation, and non-hazardous area assumptions.",
      domain: "manufacturing",
      priority: "medium",
      riskLevel: "medium",
      approvalRequired: true,
      acceptanceCriteria: ["System spec states environment assumptions.", "Manufacturing notes include inspection and labeling requirements.", "Release checklist calls out customer environment confirmation."],
    },
  ];
  return rows.map((row) => ({
    id: row.requirementId,
    requirementId: row.requirementId,
    title: row.title,
    description: row.description,
    domain: row.domain,
    status: "active",
    priority: row.priority,
    acceptanceCriteria: row.acceptanceCriteria,
    linkedArtifacts: [],
    linkedTests: [],
    riskLevel: row.riskLevel,
    approvalRequired: row.approvalRequired,
    source: "Industrial Control Box Demo sample generator",
    createdAt: now,
    updatedAt: now,
    metadata: { sampleProject: true },
  }));
}

function writeRequirements(input: {
  workspace: string;
  requirements: IndustrialRequirement[];
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  const mdPath = `${SAMPLE_ROOT}/requirements.md`;
  const jsonPath = `${SAMPLE_ROOT}/requirements.json`;
  writeText(input.workspace, mdPath, [
    "# Industrial Control Box Demo Requirements",
    "",
    "This file is generated by Hi Code's sample project creator. It is real project documentation with concrete sample evidence.",
    "",
    ...input.requirements.flatMap((requirement) => [
      `## ${requirement.requirementId} - ${requirement.title}`,
      "",
      requirement.description || "",
      "",
      `Domain: ${requirement.domain || "unspecified"}`,
      `Priority: ${requirement.priority || "medium"}`,
      `Risk: ${requirement.riskLevel}`,
      `Approval required: ${requirement.approvalRequired ? "yes" : "no"}`,
      "",
      "Acceptance criteria:",
      ...requirement.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      "",
    ]),
  ].join("\n"));
  writeJson(input.workspace, jsonPath, {
    schemaVersion: 1,
    sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
    requirements: input.requirements,
  });
  addArtifact(input, "artifact-requirements-md", "requirement_doc", "Requirements document", mdPath, "documentation", false);
  addArtifact(input, "artifact-requirements-json", "requirement_doc", "Structured requirements", jsonPath, "documentation", false);
}

function writeSoftwareArtifacts(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  const configPath = `${SAMPLE_ROOT}/software/io-monitor-config.json`;
  const sourcePath = `${SAMPLE_ROOT}/software/control-box-monitor.js`;
  writeJson(input.workspace, configPath, {
    schemaVersion: 1,
    sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
    digitalInputs: ["E_STOP_NC", "START_PB", "STOP_PB", "DOOR_INTERLOCK"],
    relayOutputs: ["RELAY_K1", "RELAY_K2"],
    statusIndicators: ["LED_POWER", "LED_FAULT"],
    safetyMode: "monitor-only; no device control performed by this sample script",
  });
  writeText(input.workspace, sourcePath, [
    "import fs from \"node:fs\";",
    "import path from \"node:path\";",
    "",
    "const configPath = process.argv[2] || path.join(process.cwd(), \"io-monitor-config.json\");",
    "const config = JSON.parse(fs.readFileSync(configPath, \"utf8\"));",
    "const rows = [",
    "  [\"Signal\", \"Category\", \"Safety note\"],",
    "  ...config.digitalInputs.map((tag) => [tag, \"digital_input\", tag === \"E_STOP_NC\" ? \"normally closed emergency stop healthy input\" : \"operator/input signal\"]),",
    "  ...config.relayOutputs.map((tag) => [tag, \"relay_output\", \"output remains de-energized until approved PLC logic permits it\"]),",
    "  ...config.statusIndicators.map((tag) => [tag, \"status_led\", \"indicator only\"]),",
    "];",
    "console.log(rows.map((row) => row.join(\",\")).join(\"\\n\"));",
    "",
  ].join("\n"));
  addArtifact(input, "artifact-software-monitor", "source_code", "Control box monitor source", sourcePath, "software", false);
  addArtifact(input, "artifact-software-config", "source_code", "Control box monitor config", configPath, "software", false);
}

function writeElectricalArtifacts(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  writeText(input.workspace, `${SAMPLE_ROOT}/electrical/wiring-diagram.md`, [
    "# Wiring Diagram Draft",
    "",
    "This is an engineering draft for review. It is not a certified drawing.",
    "",
    "## Terminal groups",
    "- TB1: 24 VDC power input, fused positive, 0 V return, PE/shield bond.",
    "- TB2: Digital inputs E_STOP_NC, START_PB, STOP_PB, DOOR_INTERLOCK.",
    "- TB3: Relay outputs RELAY_K1 and RELAY_K2 with dry contacts.",
    "- TB4: Status LED harness for power and fault indicators.",
    "",
    "## Safety notes",
    "- Verify emergency stop wiring with a qualified controls engineer.",
    "- Do not energize relay loads until FAT checks are complete.",
  ].join("\n"));
  writeText(input.workspace, `${SAMPLE_ROOT}/electrical/terminal-list.csv`, [
    "terminal,signal,description,voltage,notes",
    "TB1-1,+24VDC,Power input positive,24VDC,Fused upstream",
    "TB1-2,0VDC,Power return,0VDC,Common return",
    "TB1-3,PE,Protective earth/shield,,Bond per site standard",
    "TB2-1,E_STOP_NC,Emergency stop healthy input,24VDC,Normally closed",
    "TB2-2,START_PB,Start pushbutton input,24VDC,Momentary",
    "TB2-3,STOP_PB,Stop pushbutton input,24VDC,Momentary",
    "TB2-4,DOOR_INTERLOCK,Door interlock input,24VDC,Normally closed preferred",
    "TB3-1,RELAY_K1_COM,Relay K1 common,External,Customer load",
    "TB3-2,RELAY_K1_NO,Relay K1 normally open,External,Customer load",
    "TB3-3,RELAY_K2_COM,Relay K2 common,External,Customer load",
    "TB3-4,RELAY_K2_NO,Relay K2 normally open,External,Customer load",
    "TB4-1,LED_POWER,Power indicator,24VDC,Current limited",
    "TB4-2,LED_FAULT,Fault indicator,24VDC,Current limited",
  ].join("\n"));
  writeText(input.workspace, `${SAMPLE_ROOT}/electrical/power-budget.md`, [
    "# Power Budget",
    "",
    "| Load | Qty | Current each | Total |",
    "| --- | ---: | ---: | ---: |",
    "| Control PCB logic | 1 | 120 mA | 120 mA |",
    "| Relay coils | 2 | 35 mA | 70 mA |",
    "| Status LEDs | 2 | 8 mA | 16 mA |",
    "| Input sensor loop allowance | 4 | 10 mA | 40 mA |",
    "| Engineering margin | 1 | 100 mA | 100 mA |",
    "",
    "Estimated total: 346 mA at 24 VDC. Select at least a 0.75 A supply after customer load review.",
  ].join("\n"));
  addArtifact(input, "artifact-wiring-diagram", "wiring_diagram", "Wiring diagram draft", `${SAMPLE_ROOT}/electrical/wiring-diagram.md`, "electrical", false);
  addArtifact(input, "artifact-terminal-list", "wiring_diagram", "Terminal list", `${SAMPLE_ROOT}/electrical/terminal-list.csv`, "electrical", false);
  addArtifact(input, "artifact-power-budget", "simulation_report", "Power budget", `${SAMPLE_ROOT}/electrical/power-budget.md`, "electrical", false);
}

function writeBomArtifact(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  const bomPath = `${SAMPLE_ROOT}/bom/system-bom.csv`;
  writeText(input.workspace, bomPath, [
    "item,category,qty,unit,description,simulated",
    "Enclosure,mechanical,1,ea,160x110x60 mm ABS/PC industrial control box,false",
    "PCB,pcb,1,ea,Control board assembly,true",
    "Terminals,electrical,4,set,Pluggable terminal blocks for power IO and relays,false",
    "Relays,electrical,2,ea,24 VDC coil relay with dry contacts,false",
    "Status LEDs,electrical,2,ea,Power and fault LED indicators,false",
    "Power connector,electrical,1,ea,24 VDC input connector,false",
    "DIN rail mount,mechanical,1,ea,35 mm DIN rail clip or bracket,false",
    "Wiring,electrical,1,set,Internal control wiring harness,false",
  ].join("\n"));
  addArtifact(input, "artifact-system-bom", "bom", "System BOM", bomPath, "manufacturing", false);
}

function writeProjectDocs(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  const docs: Array<[string, IndustrialArtifactType, string, IndustrialDomainKey, string]> = [
    [`${SAMPLE_ROOT}/docs/system-spec.md`, "architecture_doc", "System specification", "documentation", renderSystemSpec()],
    [`${SAMPLE_ROOT}/docs/test-plan.md`, "test_plan", "Test plan", "qa", renderTestPlan()],
    [`${SAMPLE_ROOT}/docs/release-checklist.md`, "test_plan", "Release checklist", "qa", renderReleaseChecklist()],
    [`${SAMPLE_ROOT}/docs/manufacturing-notes.md`, "architecture_doc", "Manufacturing notes", "manufacturing", renderManufacturingNotes()],
  ];
  for (const [relative, type, name, domain, content] of docs) {
    writeText(input.workspace, relative, content);
    addArtifact(input, `artifact-${path.basename(relative, path.extname(relative))}`, type, name, relative, domain, false);
  }
}

function runFreeCadSample(input: { registry: IndustrialToolAdapterRegistry; workspace: string; runInstalledTools: boolean; actor: string }): ToolRunResult {
  const detection = input.registry.detectAdapter("freecad");
  const mode = detection.installed && input.runInstalledTools ? "execute" : "dry-run";
  return input.registry.runAdapterTask({
    adapterId: "freecad",
    task: "Generate Industrial Control Box control enclosure",
    workspacePath: input.workspace,
    artifactDir: `.hicode/artifacts/${SAMPLE_ROOT}/cad`,
    mode,
    userApproved: input.runInstalledTools,
    allowNetwork: false,
    actor: input.actor,
    cadRequest: {
      partType: "control_box_enclosure",
      dimensions: {
        length: 160,
        width: 110,
        height: 60,
        wallThickness: 3,
        lidThickness: 3,
        mountHoleDiameter: 4,
        mountHoleOffset: 14,
      },
      material: "ABS/PC",
      units: "mm",
      constraints: [
        "DIN rail mount clearance is reserved on the rear face.",
        "Four lid mounting holes are required.",
        "Internal cavity must leave space for PCB, terminals, relay clearance, and wire bend radius.",
      ],
      exportFormats: ["FCStd", "STEP", "STL"],
      outputDir: `.hicode/artifacts/${SAMPLE_ROOT}/cad`,
    },
  });
}

function runKiCadSample(input: { registry: IndustrialToolAdapterRegistry; workspace: string; runInstalledTools: boolean; actor: string }): ToolRunResult {
  const detection = input.registry.detectAdapter("kicad");
  const mode = detection.installed && input.runInstalledTools ? "execute" : "dry-run";
  return input.registry.runAdapterTask({
    adapterId: "kicad",
    task: "Plan KiCad PCB ERC/DRC/Gerber/BOM flow for Industrial Control Box",
    workspacePath: input.workspace,
    artifactDir: `.hicode/artifacts/${SAMPLE_ROOT}/pcb`,
    mode,
    userApproved: input.runInstalledTools,
    allowNetwork: false,
    actor: input.actor,
    pcbRequest: {
      projectPath: `${SAMPLE_ROOT}/pcb/control-box.kicad_pro`,
      schematicPath: `${SAMPLE_ROOT}/pcb/control-box.kicad_sch`,
      boardPath: `${SAMPLE_ROOT}/pcb/control-box.kicad_pcb`,
      outputDir: `.hicode/artifacts/${SAMPLE_ROOT}/pcb`,
      exportGerber: true,
      exportDrill: true,
      runErc: true,
      runDrc: true,
      bomFormat: "csv",
    },
  });
}

function writeKiCadBomTemplate(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}): void {
  const bomPath = `${SAMPLE_ROOT}/pcb/bom-template.csv`;
  writeText(input.workspace, bomPath, [
    "ref,qty,value,footprint,manufacturer_part,notes",
    "J1,1,24V input,TerminalBlock_1x03,engineering-selection,Power connector",
    "K1 K2,2,24V relay,Relay_SPDT,engineering-selection,Output relay",
    "D1,1,green LED,LED_0805,engineering-selection,Power indicator",
    "D2,1,red LED,LED_0805,engineering-selection,Fault indicator",
    "U1,1,controller,MCU_Module,engineering-selection,Controller planning line item - engineering selection required",
  ].join("\n"));
  writeText(input.workspace, `${SAMPLE_ROOT}/pcb/project-intent.md`, [
    "# KiCad Project Intent",
    "",
    "Hi Code will not create fake `.kicad_pro`, schematic, layout, Gerber, or DRC reports.",
    "If kicad-cli is unavailable or project files have not been authored, this sample records a dry-run plan and expected artifact list.",
  ].join("\n"));
  addArtifact(input, "artifact-pcb-bom-template", "bom", "PCB BOM template", bomPath, "pcb", true);
  addArtifact(input, "artifact-pcb-project-intent", "pcb_project", "KiCad project intent", `${SAMPLE_ROOT}/pcb/project-intent.md`, "pcb", true);
}

function runPlcSample(input: { registry: IndustrialToolAdapterRegistry; workspace: string; runInstalledTools: boolean; actor: string }): ToolRunResult {
  const detection = input.registry.detectAdapter("openplc");
  const mode = detection.installed && input.runInstalledTools ? "execute" : "dry-run";
  return input.registry.runAdapterTask({
    adapterId: "openplc",
    task: "Generate IEC 61131-3 Structured Text and FAT/SAT package for Industrial Control Box",
    workspacePath: input.workspace,
    artifactDir: `.hicode/artifacts/${SAMPLE_ROOT}/plc`,
    mode,
    userApproved: input.runInstalledTools,
    allowNetwork: false,
    actor: input.actor,
    plcRequest: {
      controllerType: "openplc-compatible-soft-plc",
      targetRuntime: "openplc",
      scanCycleRequirement: "100 ms nominal scan cycle; validate jitter on target hardware before commissioning",
      controlLogicDescription: "Generate a fail-safe control box draft. Relay outputs remain off unless emergency stop is healthy, door interlock is healthy, and a qualified reviewer approves commissioning logic.",
      safetyInterlocks: [
        "Emergency stop healthy input E_STOP_NC must be true before any relay output can energize.",
        "Door interlock DOOR_INTERLOCK must be true before relay outputs can energize.",
        "Stop command latches outputs off until RESET/START conditions are explicitly reviewed.",
        "Human safety approval is required before compile, simulation, FAT, SAT, or device download.",
      ],
      outputDir: `.hicode/artifacts/${SAMPLE_ROOT}/plc`,
      ioPoints: [
        { tag: "E_STOP_NC", address: "%IX0.0", direction: "input", signalType: "bool", description: "Normally closed emergency stop healthy input", failsafeState: "false" },
        { tag: "START_PB", address: "%IX0.1", direction: "input", signalType: "bool", description: "Start pushbutton", failsafeState: "false" },
        { tag: "STOP_PB", address: "%IX0.2", direction: "input", signalType: "bool", description: "Stop pushbutton", failsafeState: "true" },
        { tag: "DOOR_INTERLOCK", address: "%IX0.3", direction: "input", signalType: "bool", description: "Panel door interlock healthy input", failsafeState: "false" },
        { tag: "RELAY_K1", address: "%QX0.0", direction: "output", signalType: "bool", description: "Relay output K1", failsafeState: "false" },
        { tag: "RELAY_K2", address: "%QX0.1", direction: "output", signalType: "bool", description: "Relay output K2", failsafeState: "false" },
        { tag: "LED_POWER", address: "%QX0.2", direction: "output", signalType: "bool", description: "Power status LED", failsafeState: "false" },
        { tag: "LED_FAULT", address: "%QX0.3", direction: "output", signalType: "bool", description: "Fault status LED", failsafeState: "true" },
      ],
    },
  });
}

function ensureToolMetadata(input: {
  workspace: string;
  dir: string;
  adapterId: string;
  result: ToolRunResult;
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
  artifactInputs: ArtifactInput[];
  type: IndustrialArtifactType;
  domain: IndustrialDomainKey;
  name: string;
  primaryArtifactId: string;
}): void {
  const relativePathValue = `${SAMPLE_ROOT}/${input.dir}/metadata.json`;
  const absolutePath = safeJoin(input.workspace, relativePathValue);
  if (!fs.existsSync(absolutePath)) {
    writeJson(input.workspace, relativePathValue, {
      schemaVersion: 1,
      sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
      adapterId: input.adapterId,
      mode: input.result.mode,
      installed: input.result.detection.installed,
      simulated: input.result.simulated,
      externalToolRun: input.result.mode === "execute" && !input.result.simulated,
      summary: input.result.summary,
      diagnostics: input.result.diagnostics,
      artifacts: input.result.artifacts.map((artifact) => ({
        name: artifact.name,
        path: relativePath(input.workspace, artifact.path),
        simulated: artifact.simulated,
      })),
    });
  }
  addArtifact(input, input.primaryArtifactId, input.type, input.name, relativePathValue, input.domain, input.result.simulated);
}

function collectAdapterArtifacts(input: {
  workspace: string;
  result: ToolRunResult;
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
  artifactInputs: ArtifactInput[];
  defaultType: IndustrialArtifactType;
  defaultDomain: IndustrialDomainKey;
  required: boolean;
}): void {
  for (const artifact of input.result.artifacts || []) {
    const relative = relativePath(input.workspace, artifact.path);
    if (!fs.existsSync(artifact.path)) continue;
    const type = artifactTypeFromToolArtifact(artifact.type, artifact.name, input.defaultType);
    addArtifact(input, `artifact-${artifact.id}`, type, artifact.name, relative, input.defaultDomain, artifact.simulated, input.required);
  }
}

function mirrorToolArtifacts(input: {
  workspace: string;
  result: ToolRunResult;
  targetDir: "cad" | "pcb" | "plc";
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
  artifactInputs: ArtifactInput[];
  defaultType: IndustrialArtifactType;
  defaultDomain: IndustrialDomainKey;
  required: boolean;
}): void {
  for (const artifact of input.result.artifacts || []) {
    if (!fs.existsSync(artifact.path) || !fs.statSync(artifact.path).isFile()) continue;
    const targetRelative = `${SAMPLE_ROOT}/${input.targetDir}/${path.basename(artifact.path)}`;
    const targetAbsolute = safeJoin(input.workspace, targetRelative);
    const sourceAbsolute = path.resolve(artifact.path);
    if (sourceAbsolute !== targetAbsolute) {
      fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true, mode: 0o755 });
      fs.copyFileSync(sourceAbsolute, targetAbsolute);
    }
    addArtifact(
      input,
      `artifact-sample-${artifact.id}`,
      artifactTypeFromToolArtifact(artifact.type, artifact.name, input.defaultType),
      `${artifact.name} sample copy`,
      targetRelative,
      input.defaultDomain,
      artifact.simulated,
      input.required,
    );
  }
}

function addProjectManifestArtifact(artifactInputs: ArtifactInput[], sampleArtifacts: IndustrialControlBoxSampleArtifact[], workspace: string): void {
  const artifact: ArtifactInput = {
    id: "artifact-hicode-project-manifest",
    type: "requirement_doc",
    name: "Hi Code industrial project manifest",
    path: ".hicode/project.json",
    domain: "documentation",
    status: "active",
    requirementIds: [],
    designIds: [],
    testIds: [],
    releaseTargetIds: ["release-industrial-control-box-demo"],
    metadata: { generated: true, simulated: false, releaseRequired: true },
  };
  artifactInputs.push(artifact);
  sampleArtifacts.push(sampleArtifact({ workspace, id: artifact.id, type: artifact.type, name: artifact.name, relativePath: artifact.path!, simulated: false, generated: true }));
}

function writeTraceability(input: {
  requirements: IndustrialRequirement[];
  artifactInputs: ArtifactInput[];
  traceability: Array<Partial<TraceabilityLink> & { fromType: string; fromId: string; toType: string; toId: string }>;
  now: number;
}): void {
  const requirementToArtifacts: Record<string, string[]> = {
    "REQ-ICB-ENCLOSURE": ["artifact-cad-metadata"],
    "REQ-ICB-POWER": ["artifact-power-budget", "artifact-terminal-list"],
    "REQ-ICB-DI": ["artifact-plc-io-map"],
    "REQ-ICB-RELAY": ["artifact-plc-io-map", "artifact-wiring-diagram"],
    "REQ-ICB-EMERGENCY-STOP": ["artifact-plc-safety-interlocks", "artifact-test-plan"],
    "REQ-ICB-LEDS": ["artifact-system-bom", "artifact-power-budget"],
    "REQ-ICB-ENVIRONMENT": ["artifact-system-spec", "artifact-manufacturing-notes"],
  };
  for (const requirement of input.requirements) {
    const designId = `DES-${requirement.requirementId.replace(/^REQ-/, "")}`;
    input.traceability.push({
      id: `trace-${requirement.requirementId}-design`,
      fromType: "requirement",
      fromId: requirement.requirementId,
      toType: "design",
      toId: designId,
      createdAt: input.now,
    });
    for (const artifactId of requirementToArtifacts[requirement.requirementId] || []) {
      if (!input.artifactInputs.some((artifact) => artifact.id === artifactId)) continue;
      input.traceability.push({
        id: `trace-${designId}-${artifactId}`,
        fromType: "design",
        fromId: designId,
        toType: "artifact",
        toId: artifactId,
        createdAt: input.now,
      });
      input.traceability.push({
        id: `trace-${artifactId}-test-plan`,
        fromType: "artifact",
        fromId: artifactId,
        toType: "test",
        toId: "TEST-ICB-SYSTEM",
        createdAt: input.now,
      });
    }
  }
  input.traceability.push({
    id: "trace-test-release-readiness",
    fromType: "test",
    fromId: "TEST-ICB-SYSTEM",
    toType: "release_gate",
    toId: "gate-release-readiness",
    createdAt: input.now,
  });
}

function writeGateSet(input: {
  workspace: string;
  gateInputs: GateInput[];
  gates: IndustrialControlBoxSampleGate[];
  requirements: IndustrialRequirement[];
  artifactInputs: ArtifactInput[];
  freecad: ToolRunResult;
  kicad: ToolRunResult;
  plc: ToolRunResult;
  now: number;
}): void {
  const artifactIds = input.artifactInputs.map((item) => item.id);
  const requirementIds = input.requirements.map((item) => item.requirementId);
  const requiredReqTitles = input.requirements.map((item) => item.title.toLowerCase()).join(" ");
  const gates: GateInput[] = [
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-requirements-completeness",
      type: "documentation_review",
      name: "Requirements completeness gate",
      status: requiredReqTitles.includes("emergency stop") && requiredReqTitles.includes("operating environment") ? "passed" : "failed",
      message: "Requirements include enclosure dimensions, power input, I/O, relay outputs, emergency stop, LEDs, DIN rail mounting, operating environment, and acceptance criteria.",
      artifactIds: ["artifact-requirements-md", "artifact-requirements-json"],
      requirementIds,
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { checkedItems: ["enclosure", "power", "digital inputs", "relay outputs", "emergency stop", "status LEDs", "DIN rail", "environment"] },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-cad-artifact",
      type: "cad_validation",
      name: "CAD artifact gate",
      status: input.freecad.simulated ? "simulated" : input.freecad.ok ? "passed" : "failed",
      message: input.freecad.summary,
      artifactIds: artifactIds.filter((id) => id.includes("cad") || id.includes("freecad")),
      requirementIds: ["REQ-ICB-ENCLOSURE"],
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { adapterId: "freecad", diagnostics: input.freecad.diagnostics },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-pcb-artifact",
      type: "pcb_drc",
      name: "PCB artifact gate",
      status: input.kicad.simulated ? "simulated" : input.kicad.ok ? "passed" : "failed",
      message: input.kicad.summary,
      artifactIds: artifactIds.filter((id) => id.includes("pcb") || id.includes("kicad")),
      requirementIds: ["REQ-ICB-DI", "REQ-ICB-RELAY", "REQ-ICB-LEDS"],
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { adapterId: "kicad", diagnostics: input.kicad.diagnostics },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-plc-safety",
      type: "process_safety",
      name: "PLC safety gate",
      status: plcSafetyPassed(input.workspace) ? "warning" : "failed",
      message: plcSafetyPassed(input.workspace)
        ? "PLC draft includes I/O map, emergency stop safety interlock, FAT checklist, SAT checklist, and human approval note; final safety approval remains manual."
        : "PLC safety draft is missing required emergency stop, I/O map, FAT/SAT, or approval evidence.",
      artifactIds: artifactIds.filter((id) => id.includes("plc")),
      requirementIds: ["REQ-ICB-DI", "REQ-ICB-RELAY", "REQ-ICB-EMERGENCY-STOP"],
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { adapterId: "openplc", compileStatus: input.plc.simulated ? "not_run" : input.plc.ok ? "passed" : "failed", manualApprovalRequired: true, diagnostics: input.plc.diagnostics },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-plc-compile-status",
      type: "plc_compile",
      name: "PLC compile status gate",
      status: input.plc.simulated ? "not_run" : input.plc.ok ? "passed" : "failed",
      message: input.plc.simulated ? "OpenPLC/MATIEC compiler was not run; release marks compile status not_run." : input.plc.summary,
      artifactIds: artifactIds.filter((id) => id.includes("plc")),
      requirementIds: ["REQ-ICB-EMERGENCY-STOP"],
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { adapterId: "openplc", diagnostics: input.plc.diagnostics },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-bom-completeness",
      type: "documentation_review",
      name: "BOM completeness gate",
      status: bomComplete(input.workspace) ? "passed" : "failed",
      message: "System BOM contains enclosure, PCB, terminals, relays, LEDs, power connector, DIN rail mount, and wiring.",
      artifactIds: ["artifact-system-bom", "artifact-pcb-bom-template"],
      requirementIds: ["REQ-ICB-LEDS", "REQ-ICB-ENVIRONMENT"],
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { checkedItems: ["enclosure", "PCB", "terminals", "relays", "LEDs", "power connector", "DIN rail mount", "wiring"] },
    }),
    writeGateEvidence({
      workspace: input.workspace,
      id: "gate-documentation",
      type: "documentation_review",
      name: "Documentation gate",
      status: docsComplete(input.workspace) ? "passed" : "failed",
      message: "System spec, test plan, release checklist, and manufacturing notes are generated.",
      artifactIds: ["artifact-system-spec", "artifact-test-plan", "artifact-release-checklist", "artifact-manufacturing-notes"],
      requirementIds,
      releaseTargetIds: ["release-industrial-control-box-demo"],
      metadata: { requiredDocs: ["system-spec.md", "test-plan.md", "release-checklist.md", "manufacturing-notes.md"] },
    }),
  ];
  input.gateInputs.push(...gates);
  input.gates.push(...gates.map((gate) => toSampleGate(input.workspace, gate)));
}

function writeGateEvidence(gate: GateInput & { workspace: string }): GateInput {
  const resultPath = `${SAMPLE_ROOT}/gates/${gate.id}.json`;
  const evidence = {
    schemaVersion: 1,
    sampleId: INDUSTRIAL_CONTROL_BOX_SAMPLE_ID,
    gateId: gate.id,
    type: gate.type,
    name: gate.name,
    status: gate.status,
    message: gate.message,
    artifactIds: gate.artifactIds,
    requirementIds: gate.requirementIds,
    releaseTargetIds: gate.releaseTargetIds,
    generatedAt: new Date().toISOString(),
    metadata: gate.metadata || {},
  };
  writeJson(gate.workspace, resultPath, evidence);
  return {
    id: gate.id,
    type: gate.type,
    name: gate.name,
    status: gate.status,
    artifactIds: gate.artifactIds,
    requirementIds: gate.requirementIds,
    releaseTargetIds: gate.releaseTargetIds,
    message: gate.message,
    resultPath,
    metadata: gate.metadata,
  };
}

function toolchainItems(input: { freecad: ToolRunResult; kicad: ToolRunResult; plc: ToolRunResult }) {
  return [
    toolchainItem("tool-freecad", "FreeCAD", "freecad", input.freecad, ["mechanical", "cad"]),
    toolchainItem("tool-kicad", "KiCad", "kicad", input.kicad, ["pcb", "electrical"]),
    toolchainItem("tool-openplc", "OpenPLC / IEC 61131-3", "openplc", input.plc, ["plc", "automation", "electrical"]),
  ];
}

function toolchainItem(id: string, name: string, type: string, result: ToolRunResult, domains: IndustrialDomainKey[]) {
  return {
    id,
    name,
    type,
    command: result.commandPreview[0],
    version: result.detection.version?.version || result.detection.version?.output || undefined,
    dryRun: result.simulated,
    domains,
    metadata: {
      installed: result.detection.installed,
      mode: result.mode,
      simulated: result.simulated,
      reason: result.detection.reason,
      setupHint: result.detection.setupHint,
    },
  };
}

function domainPackStandards(packIds: string[]): IndustrialStandard[] {
  const packs = getBuiltInDomainPacks().filter((pack) => packIds.includes(pack.id));
  return packs.flatMap((pack) => pack.standards.map((standard) => ({
    id: `${pack.id}-${standard.id}`,
    name: standard.name,
    version: standard.version,
    domain: standard.domains[0],
    url: standard.url,
    notes: `${pack.name}: ${standard.notes || ""}`.trim(),
    metadata: { packId: pack.id },
  })));
}

function addArtifact(input: {
  workspace: string;
  artifactInputs: ArtifactInput[];
  sampleArtifacts: IndustrialControlBoxSampleArtifact[];
}, id: string, type: IndustrialArtifactType, name: string, relativePathValue: string, domain: IndustrialDomainKey, simulated: boolean, required = true): void {
  const artifact: ArtifactInput = {
    id,
    type,
    name,
    path: relativePathValue,
    domain,
    status: "active",
    requirementIds: [],
    designIds: [],
    testIds: [],
    releaseTargetIds: ["release-industrial-control-box-demo"],
    metadata: {
      generated: true,
      simulated,
      dryRun: simulated,
      releaseRequired: required,
      releaseSeverity: required ? "blocking" : "warning",
      sampleProject: true,
    },
  };
  input.artifactInputs.push(artifact);
  input.sampleArtifacts.push(sampleArtifact({ workspace: input.workspace, id, type, name, relativePath: relativePathValue, simulated, generated: true }));
}

function sampleArtifact(input: {
  workspace: string;
  id: string;
  type: IndustrialArtifactType;
  name: string;
  relativePath: string;
  simulated: boolean;
  generated: boolean;
  externalRequired?: boolean;
}): IndustrialControlBoxSampleArtifact {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    relativePath: input.relativePath,
    absolutePath: safeJoin(input.workspace, input.relativePath),
    simulated: input.simulated,
    generated: input.generated,
    externalRequired: input.externalRequired,
  };
}

function toSampleGate(workspace: string, gate: GateInput): IndustrialControlBoxSampleGate {
  return {
    id: gate.id,
    name: gate.name,
    type: gate.type,
    status: gate.status,
    resultPath: safeJoin(workspace, gate.resultPath || ""),
    message: gate.message || gate.status,
  };
}

function typeFromName(name: string, fallback: IndustrialArtifactType): IndustrialArtifactType {
  if (/\.st$/i.test(name)) return "plc_program";
  if (/io-map\.csv$/i.test(name)) return "io_map";
  if (/fat-checklist|sat-checklist|test-plan/i.test(name)) return "test_plan";
  if (/safety|metadata|report|expected|plan|log|preview/i.test(name)) return "inspection_report";
  if (/\.step$/i.test(name)) return "step_file";
  if (/\.stl$/i.test(name)) return "stl_file";
  if (/\.fcstd$/i.test(name)) return "cad_model";
  if (/gerber|drill/i.test(name)) return "gerber";
  if (/bom/i.test(name)) return "bom";
  if (/\.kicad_pro$/i.test(name)) return "pcb_project";
  if (/\.kicad_sch$/i.test(name)) return "schematic";
  if (/\.kicad_pcb$/i.test(name)) return "layout";
  return fallback;
}

function artifactTypeFromToolArtifact(toolType: string, name: string, fallback: IndustrialArtifactType): IndustrialArtifactType {
  if (toolType === "plc_program") return "plc_program";
  if (toolType === "io_map") return "io_map";
  if (toolType === "test_plan") return "test_plan";
  if (toolType === "cad_model") return "cad_model";
  if (toolType === "step_file") return "step_file";
  if (toolType === "stl_file") return "stl_file";
  if (toolType === "gerber") return "gerber";
  if (toolType === "bom") return "bom";
  return typeFromName(name, fallback);
}

function toolRunSummary(adapterId: "freecad" | "kicad" | "openplc", result: ToolRunResult): IndustrialControlBoxToolRunSummary {
  return {
    adapterId,
    installed: result.detection.installed,
    mode: result.mode,
    simulated: result.simulated,
    ok: result.ok,
    summary: result.summary,
    artifacts: result.artifacts.map((artifact) => artifact.path),
  };
}

function bomComplete(workspace: string): boolean {
  const text = readTextIfExists(workspace, `${SAMPLE_ROOT}/bom/system-bom.csv`).toLowerCase();
  return ["enclosure", "pcb", "terminals", "relays", "leds", "power connector", "din rail mount", "wiring"].every((item) => text.includes(item));
}

function docsComplete(workspace: string): boolean {
  return ["system-spec.md", "test-plan.md", "release-checklist.md", "manufacturing-notes.md"].every((name) => fs.existsSync(safeJoin(workspace, SAMPLE_ROOT, "docs", name)));
}

function plcSafetyPassed(workspace: string): boolean {
  const safety = readTextIfExists(workspace, `${SAMPLE_ROOT}/plc/safety-interlocks.md`).toLowerCase();
  const program = readTextIfExists(workspace, `${SAMPLE_ROOT}/plc/plc-program.st`).toLowerCase();
  const io = readTextIfExists(workspace, `${SAMPLE_ROOT}/plc/io-map.csv`).toLowerCase();
  return safety.includes("emergency stop") && program.includes("e_stop") && io.includes("e_stop");
}

function renderSystemSpec(): string {
  return [
    "# Industrial Control Box System Specification",
    "",
    "## Scope",
    "A small industrial control box with CAD enclosure, PCB control board plan, PLC safety draft, wiring draft, BOM, test plan, quality gates, and release package.",
    "",
    "## Mechanical",
    "- Enclosure: 160 x 110 x 60 mm nominal.",
    "- Mounting: DIN rail bracket/clip with lid and mounting holes.",
    "- Material target: ABS/PC for sample planning.",
    "",
    "## Electrical and controls",
    "- Power input: 24 VDC.",
    "- Digital inputs: emergency stop, start, stop, door interlock.",
    "- Outputs: two relay outputs, power LED, fault LED.",
    "",
    "## Safety boundary",
    "The generated PLC program is an engineering draft. It does not authorize field operation or device download.",
  ].join("\n");
}

function renderTestPlan(): string {
  return [
    "# Industrial Control Box Test Plan",
    "",
    "## Requirements completeness",
    "- Confirm every requirement has acceptance criteria and traceability.",
    "",
    "## Mechanical",
    "- Review CAD or FreeCAD dry-run plan for enclosure dimensions and mounting holes.",
    "",
    "## PCB",
    "- Run KiCad ERC/DRC when a real KiCad project exists.",
    "- Review Gerber and BOM export outputs before manufacturing.",
    "",
    "## PLC",
    "- Confirm I/O map tags and addresses.",
    "- Verify emergency stop and door interlock fail-safe behavior in review before any compile/simulation.",
    "",
    "## Release",
    "- Failed gates block release.",
    "- Simulated/not_run gates remain visible in release notes.",
  ].join("\n");
}

function renderReleaseChecklist(): string {
  return [
    "# Release Checklist",
    "",
    "- [x] Requirements document generated.",
    "- [x] Structured requirements generated.",
    "- [x] CAD adapter output or simulated dry-run evidence generated.",
    "- [x] PCB adapter output or simulated dry-run evidence generated.",
    "- [x] PLC ST draft, I/O map, safety interlocks, FAT, and SAT checklists generated.",
    "- [x] Electrical wiring draft, terminal list, and power budget generated.",
    "- [x] System BOM generated.",
    "- [x] Quality gate evidence generated.",
    "- [x] Release manifest, evidence report, and checksums generated.",
    "- [ ] Customer/qualified engineer approval before physical build or commissioning.",
  ].join("\n");
}

function renderManufacturingNotes(): string {
  return [
    "# Manufacturing Notes",
    "",
    "- This sample is an engineering planning package, not a certified manufacturing release.",
    "- Verify enclosure dimensions, PCB clearances, terminal torque, conductor gauge, labeling, and environment assumptions before procurement.",
    "- Mark simulated CAD/PCB evidence clearly when FreeCAD/KiCad are not installed or not authorized.",
    "- No PLC download, live I/O actuation, or site equipment control is performed by Hi Code in this sample.",
  ].join("\n");
}

function writeText(workspace: string, relative: string, content: string): void {
  const file = safeJoin(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, { mode: 0o644 });
}

function writeJson(workspace: string, relative: string, value: unknown): void {
  writeText(workspace, relative, JSON.stringify(value, null, 2));
}

function readTextIfExists(workspace: string, relative: string): string {
  const file = safeJoin(workspace, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function safeWorkspace(value: string): string {
  const workspace = path.resolve(cleanText(value));
  if (!workspace || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("workspacePath must be an existing directory");
  return realOrResolve(workspace);
}

function safeJoin(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts);
  const safeRoot = path.resolve(root);
  const rel = path.relative(safeRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("sample project path escapes workspace");
  return target;
}

function removeKnownSamplePath(workspace: string, target: string): void {
  const resolved = safeJoin(workspace, path.relative(workspace, target));
  const rel = relativePath(workspace, resolved);
  if (rel !== SAMPLE_ROOT && rel !== `releases/${INDUSTRIAL_CONTROL_BOX_RELEASE_VERSION}`) {
    throw new Error("refusing to remove non-sample path");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanVersion(value: string): string {
  const version = cleanText(value);
  if (!/^[a-zA-Z0-9._+-]{1,80}$/.test(version) || version.includes("..")) throw new Error("releaseVersion contains unsafe characters");
  return version;
}

function dedupeArtifacts(items: IndustrialControlBoxSampleArtifact[]): IndustrialControlBoxSampleArtifact[] {
  const seen = new Map<string, IndustrialControlBoxSampleArtifact>();
  for (const item of items) seen.set(item.id, item);
  return Array.from(seen.values());
}
