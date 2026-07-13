import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runIndustrialCommand, type IndustrialExecutionResult } from "./industrial-execution.js";

import type {
  IndustrialToolAdapter,
  ToolArtifact,
  ToolCapability,
  ToolDetectionOptions,
  ToolDetectionResult,
  ToolDiagnostic,
  ToolRunRequest,
  ToolRunResult,
} from "./industrial-tool-adapters.js";

export interface BimIfcTaskRequest {
  ifcPath?: string;
  outputDir?: string;
  checkProperties: boolean;
  generateDeliveryChecklist: boolean;
  targetStandard?: string;
}

interface BimIfcRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface ResolvedBimIfcRequest {
  request: BimIfcTaskRequest;
  ifcFile?: string;
  ifcExists: boolean;
  outputDir: string;
}

interface IfcInspectionData {
  schemaVersion: number;
  elementCount: number;
  spaceCount: number;
  elementTypes: Record<string, number>;
  spaces: Array<Record<string, unknown>>;
  propertySamples: Array<Record<string, unknown>>;
  warnings: string[];
}

interface IfcDetectionProbe {
  pythonPath?: string;
  cliPath?: string;
  moduleAvailable: boolean;
  cliAvailable: boolean;
  version?: string;
  output?: string;
}

const DEFAULT_BIM_REQUEST: BimIfcTaskRequest = {
  ifcPath: undefined,
  outputDir: ".hicode/artifacts/bim/ifc-dry-run",
  checkProperties: true,
  generateDeliveryChecklist: true,
  targetStandard: undefined,
};

const IFC_COMMON_PATHS = [
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "/opt/homebrew/bin/IfcConvert",
  "/usr/local/bin/IfcConvert",
  "/usr/bin/IfcConvert",
  "$IFCOPENSHELL_PYTHON",
  "$IFCOPENSHELL_HOME/bin/python",
  "$IFCOPENSHELL_HOME/bin/IfcConvert",
  "C:\\IfcOpenShell\\IfcConvert.exe",
];

const PYTHON_PROBE = [
  "import json, sys",
  "try:",
  "    import ifcopenshell",
  "    version = getattr(ifcopenshell, 'version', None) or getattr(ifcopenshell, '__version__', '')",
  "    print(json.dumps({'ok': True, 'version': str(version)}))",
  "except Exception as exc:",
  "    print(json.dumps({'ok': False, 'error': str(exc)}))",
  "    sys.exit(3)",
].join("\n");
const PYTHON_VERSION_PROBE = "import ifcopenshell, json; print(json.dumps({'version': str(getattr(ifcopenshell, 'version', getattr(ifcopenshell, '__version__', '')))}))";

const IFC_INSPECT_SCRIPT = [
  "import json, sys",
  "import ifcopenshell",
  "try:",
  "    from ifcopenshell.util.element import get_psets",
  "except Exception:",
  "    get_psets = None",
  "ifc_path = sys.argv[1]",
  "check_properties = sys.argv[2].lower() == 'true'",
  "model = ifcopenshell.open(ifc_path)",
  "products = list(model.by_type('IfcProduct'))",
  "spaces = list(model.by_type('IfcSpace'))",
  "element_types = {}",
  "for product in products:",
  "    element_types[product.is_a()] = element_types.get(product.is_a(), 0) + 1",
  "property_samples = []",
  "warnings = []",
  "if check_properties:",
  "    for product in products[:50]:",
  "        sample = {'type': product.is_a(), 'globalId': getattr(product, 'GlobalId', None), 'name': getattr(product, 'Name', None)}",
  "        if get_psets:",
  "            try:",
  "                psets = get_psets(product) or {}",
  "                sample['propertySetCount'] = len(psets)",
  "                sample['propertySets'] = sorted(list(psets.keys()))[:10]",
  "                if not psets:",
  "                    warnings.append('Element has no property sets: ' + str(sample.get('globalId') or sample.get('name') or product.is_a()))",
  "            except Exception as exc:",
  "                sample['propertyError'] = str(exc)",
  "        else:",
  "            sample['propertyError'] = 'ifcopenshell.util.element.get_psets unavailable'",
  "        property_samples.append(sample)",
  "space_rows = []",
  "for space in spaces[:200]:",
  "    space_rows.append({'globalId': getattr(space, 'GlobalId', None), 'name': getattr(space, 'Name', None), 'longName': getattr(space, 'LongName', None)})",
  "print(json.dumps({'schemaVersion': 1, 'elementCount': len(products) - len(spaces), 'spaceCount': len(spaces), 'elementTypes': element_types, 'spaces': space_rows, 'propertySamples': property_samples, 'warnings': warnings[:100]}))",
].join("\n");

export function bimIfcAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "ifcopenshell",
    name: "IfcOpenShell / IFC",
    vendor: "IfcOpenShell",
    kind: "open-source",
    domains: ["bim", "architecture"],
    homepage: "https://ifcopenshell.org/",
    detection: {
      commands: ["python3", "python", "ifcopenshell", "IfcConvert"],
      versionCommand: { command: "python3", args: ["-c", PYTHON_VERSION_PROBE], pattern: "\"version\"\\s*:\\s*\"([^\"]+)\"" },
      executablePaths: IFC_COMMON_PATHS,
      envVars: ["IFCOPENSHELL_PYTHON", "IFCOPENSHELL_HOME"],
      configPaths: ["~/.ifcopenshell", "~/.config/ifcopenshell"],
      setupHint: "Install IfcOpenShell for Python, or provide a Python executable that can import ifcopenshell. IfcConvert CLI is detected as supporting evidence only.",
    },
    capabilities: [
      bimCapability("ifc_inspection", "IFC inspection", ["ifc_model", "inspection_report"], true),
      bimCapability("element_count", "Element count", ["inspection_report"], true),
      bimCapability("space_count", "Space count", ["inspection_report"], true),
      bimCapability("property_extract", "Property extraction", ["inspection_report"], true),
      bimCapability("clash_check_plan", "Clash check plan", ["inspection_report"], false),
      bimCapability("code_check_checklist", "Code check checklist", ["inspection_report"], false),
      bimCapability("bim_delivery_checklist", "BIM delivery checklist", ["release_package"], false),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6E supports IFC dry-run planning and real local IfcOpenShell Python inspection when installed. It does not make building-code compliance conclusions.",
  };
}

export function detectBimIfcAdapter({ adapter, options = {}, env = process.env, pathEnv = env.PATH || "" }: {
  adapter: IndustrialToolAdapter;
  options?: ToolDetectionOptions;
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
}): ToolDetectionResult {
  const now = Date.now();
  const manual = normalizeManualExecutablePath(options.executablePath, env);
  const commands = (adapter.detection.commands || []).map((command) => {
    const found = findCommand(command, pathEnv);
    return { command, found: !!found, path: found || undefined };
  });
  const executableCandidates = [
    ...(manual ? [manual] : []),
    ...(adapter.detection.executablePaths || []),
  ];
  const executablePaths = executableCandidates.map((candidate) => {
    const expanded = expandPath(candidate, env);
    return { path: expanded, found: isExecutable(expanded) };
  });
  const environment = (adapter.detection.envVars || []).map((name) => {
    const value = env[name];
    const expanded = value ? expandPath(value, env) : undefined;
    return {
      name,
      set: !!value,
      path: expanded,
      exists: expanded ? fs.existsSync(expanded) : undefined,
      executable: expanded ? isExecutable(expanded) : undefined,
    };
  });
  const configPaths = (adapter.detection.configPaths || []).map((candidate) => {
    const expanded = expandPath(candidate, env);
    return { path: expanded, found: fs.existsSync(expanded) };
  });
  const probe = detectIfcOpenShellProbe({ manual, commands, executablePaths, environment, pathEnv });
  const installed = probe.moduleAvailable || probe.cliAvailable;
  const executablePath = probe.pythonPath || probe.cliPath;
  const reason = installed
    ? `Detected ${adapter.name}${probe.moduleAvailable ? " Python module" : " CLI only"}${executablePath ? ` at ${redactPath(executablePath)}` : ""}.`
    : `No IfcOpenShell Python module, CLI, executable path, or environment marker was found for ${adapter.name}.`;
  const diagnostics: ToolDiagnostic[] = [{
    id: diagnosticId("ifcopenshell", installed ? "detected" : "missing"),
    severity: installed ? "info" : "warning",
    code: installed ? "tool.detected" : "tool.missing",
    message: reason,
    gate: "bim_check",
  }];
  if (probe.cliAvailable && !probe.moduleAvailable) {
    diagnostics.push(diagnostic("bim.ifc.cli_only", "warning", "IfcOpenShell CLI was detected, but Python module inspection is unavailable; real IFC statistics require the Python module.", "bim_check"));
  }
  return {
    adapterId: adapter.id,
    toolName: adapter.name,
    installed,
    reason,
    setupHint: adapter.detection.setupHint,
    executablePath,
    version: installed ? { command: executablePath ? redactPath(executablePath) : undefined, output: probe.output, version: probe.version } : undefined,
    evidence: { commands, executablePaths, environment, configPaths },
    diagnostics,
    detectedAt: now,
  };
}

export function runBimIfcAdapterTask(input: BimIfcRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const parsed = parseBimIfcTaskRequest(request.bimRequest);
  const requestedMode = request.mode || "dry-run";
  if (!parsed.ok) {
    return blockedBimRun({ adapter, detection, mode: requestedMode, message: parsed.error, code: "bim.ifc.invalid_request" });
  }
  let resolved: ResolvedBimIfcRequest;
  try {
    resolved = resolveBimIfcRequest({ workspace, request: parsed.request, artifactDir: request.artifactDir, mode: requestedMode });
  } catch (error) {
    return blockedBimRun({ adapter, detection, mode: requestedMode, message: errorMessage(error), code: "bim.ifc.path_rejected" });
  }
  const hasPythonModule = !!(detection.executablePath && isPythonExecutable(detection.executablePath) && probePythonModule(detection.executablePath).moduleAvailable);
  const shouldDryRun = requestedMode === "dry-run" || !hasPythonModule;
  if (request.allowNetwork === true) {
    return blockedBimRun({ adapter, detection, mode: requestedMode, message: "BIM/IFC adapter forbids network access in Sprint 6E", code: "bim.ifc.network_blocked" });
  }
  if (requestedMode === "execute" && hasPythonModule && request.userApproved !== true) {
    return blockedBimRun({ adapter, detection, mode: "execute", message: "IfcOpenShell inspection requires explicit user approval", code: "bim.ifc.approval_required" });
  }
  if (shouldDryRun) {
    return writeBimDryRun({ adapter, request, resolved, detection, commandPreview, inputArtifacts, reason: hasPythonModule ? "dry-run requested" : "IfcOpenShell Python module is not installed" });
  }
  return runIfcInspection({ adapter, resolved, detection, pythonPath: detection.executablePath || "python3", inputArtifacts, workspace, userApproved: request.userApproved === true });
}

function bimCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} for BIM / IFC workflows.`,
    domains: ["bim", "architecture"],
    artifactTypes,
    qualityGates: ["bim_check", "documentation_review", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function writeBimDryRun({ adapter, request, resolved, detection, commandPreview, inputArtifacts, reason }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  resolved: ResolvedBimIfcRequest;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
  reason: string;
}): ToolRunResult {
  fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
  const planPath = path.join(resolved.outputDir, "ifc-check-plan.md");
  const inputPath = path.join(resolved.outputDir, "expected-input.json");
  const artifactsPath = path.join(resolved.outputDir, "expected-artifacts.json");
  const previewPath = path.join(resolved.outputDir, "command-preview.sh");
  const metadataPath = path.join(resolved.outputDir, "metadata.json");
  const checklistPath = resolved.request.generateDeliveryChecklist ? path.join(resolved.outputDir, "bim-delivery-checklist.md") : undefined;
  const command = inspectionCommand(detection.executablePath || "python3", resolved);
  fs.writeFileSync(planPath, renderIfcPlan({ request, resolved, detection, reason }), { mode: 0o600 });
  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 1, adapterId: "ifcopenshell", simulated: true, request: resolved.request, inputArtifacts }, null, 2), { mode: 0o600 });
  fs.writeFileSync(artifactsPath, JSON.stringify(expectedBimArtifacts(resolved, true), null, 2), { mode: 0o600 });
  fs.writeFileSync(previewPath, renderCommandPreview(command), { mode: 0o700 });
  if (checklistPath) fs.writeFileSync(checklistPath, renderDeliveryChecklist(resolved.request, true), { mode: 0o600 });
  fs.writeFileSync(metadataPath, JSON.stringify(bimMetadata({ resolved, detection, inputArtifacts, simulated: true, inspection: null, reason }), null, 2), { mode: 0o600 });
  const diagnostics = [
    ...detection.diagnostics,
    ...bimGateDiagnostics(resolved, "simulated"),
    diagnostic("bim.ifc.dry_run", "info", "Dry-run wrote IFC check plan, expected artifacts, and command preview only.", "documentation_review", "simulated"),
  ];
  return {
    ok: true,
    adapterId: adapter.id,
    mode: "dry-run",
    simulated: true,
    summary: `IfcOpenShell inspection was not run; BIM dry-run artifacts generated (${reason}).`,
    commandPreview: commandPreview.length ? commandPreview : command.map(redactPath),
    artifacts: [
      artifact("bim-ifc-check-plan", planPath, true, { adapterId: "ifcopenshell", mode: "dry-run" }),
      artifact("bim-expected-input", inputPath, true, { adapterId: "ifcopenshell", mode: "dry-run" }),
      artifact("bim-expected-artifacts", artifactsPath, true, { adapterId: "ifcopenshell", mode: "dry-run" }),
      artifact("bim-command-preview", previewPath, true, { adapterId: "ifcopenshell", mode: "dry-run" }),
      ...(checklistPath ? [artifact("bim-delivery-checklist", checklistPath, true, { adapterId: "ifcopenshell", mode: "dry-run" })] : []),
      artifact("bim-metadata", metadataPath, true, { adapterId: "ifcopenshell", mode: "dry-run", simulated: true }),
    ],
    diagnostics,
    detection,
  };
}

function runIfcInspection({ adapter, resolved, detection, pythonPath, inputArtifacts, workspace, userApproved }: {
  adapter: IndustrialToolAdapter;
  resolved: ResolvedBimIfcRequest;
  detection: ToolDetectionResult;
  pythonPath: string;
  inputArtifacts: string[];
  workspace: string;
  userApproved: boolean;
}): ToolRunResult {
  fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
  const diagnostics = [...detection.diagnostics, ...bimGateDiagnostics(resolved, undefined)];
  const fatal = diagnostics.find((item) => item.severity === "error");
  const reportPath = path.join(resolved.outputDir, "bim-inspection-report.json");
  const summaryPath = path.join(resolved.outputDir, "bim-summary.md");
  const metadataPath = path.join(resolved.outputDir, "metadata.json");
  const logPath = path.join(resolved.outputDir, "ifc-inspection.log");
  const checklistPath = resolved.request.generateDeliveryChecklist ? path.join(resolved.outputDir, "bim-delivery-checklist.md") : undefined;
  if (fatal) {
    fs.writeFileSync(logPath, fatal.message, { mode: 0o600 });
    fs.writeFileSync(metadataPath, JSON.stringify(bimMetadata({ resolved, detection, inputArtifacts, simulated: false, inspection: null, reason: fatal.message }), null, 2), { mode: 0o600 });
    return {
      ok: false,
      adapterId: adapter.id,
      mode: "execute",
      simulated: false,
      summary: "IFC inspection blocked by invalid inputs.",
      commandPreview: [],
      artifacts: [artifact("tool_log", logPath, false, { adapterId: "ifcopenshell" }), artifact("bim-metadata", metadataPath, false, { adapterId: "ifcopenshell" })],
      diagnostics,
      detection,
      error: fatal.message,
    };
  }
  const command = inspectionCommand(pythonPath, resolved);
  const result = runIndustrialCommand({
    id: "ifcopenshell.inspect",
    executable: pythonPath,
    args: ["-c", IFC_INSPECT_SCRIPT, resolved.ifcFile || "", String(resolved.request.checkProperties)],
    cwd: resolved.outputDir,
    workspaceRoot: workspace,
    timeoutMs: 120000,
    environment: bimProcessEnv(),
    userApproved,
    network: "deny",
  });
  fs.writeFileSync(logPath, renderInspectionLog(command, result), { mode: 0o600 });
  if (result.status !== 0) {
    const message = redactText(result.stderr || result.stdout || result.error?.message || "IfcOpenShell inspection failed");
    diagnostics.push(diagnostic("bim.ifc.inspection_failed", "error", message, "bim_check", "failed"));
    fs.writeFileSync(metadataPath, JSON.stringify({ ...bimMetadata({ resolved, detection, inputArtifacts, simulated: false, inspection: null, reason: message }), executionPolicy: result.executionPolicy }, null, 2), { mode: 0o600 });
    return {
      ok: false,
      adapterId: adapter.id,
      mode: "execute",
      simulated: false,
      summary: "IfcOpenShell inspection failed.",
      commandPreview: command.map(redactPath),
      artifacts: [artifact("tool_log", logPath, false, { adapterId: "ifcopenshell" }), artifact("bim-metadata", metadataPath, false, { adapterId: "ifcopenshell" })],
      diagnostics,
      detection,
      executionPolicy: result.executionPolicy,
      error: message,
    };
  }
  const inspection = parseInspectionOutput(result.stdout);
  fs.writeFileSync(reportPath, JSON.stringify({ ...inspection, targetStandard: resolved.request.targetStandard || null, complianceConclusion: null }, null, 2), { mode: 0o600 });
  fs.writeFileSync(summaryPath, renderBimSummary({ resolved, inspection }), { mode: 0o600 });
  if (checklistPath) fs.writeFileSync(checklistPath, renderDeliveryChecklist(resolved.request, false), { mode: 0o600 });
  fs.writeFileSync(metadataPath, JSON.stringify({ ...bimMetadata({ resolved, detection, inputArtifacts, simulated: false, inspection, reason: "inspection completed" }), executionPolicy: result.executionPolicy }, null, 2), { mode: 0o600 });
  diagnostics.push(...inspectionDiagnostics(inspection));
  const ok = diagnostics.every((item) => item.severity !== "error");
  return {
    ok,
    adapterId: adapter.id,
    mode: "execute",
    simulated: false,
    summary: ok ? "IfcOpenShell inspection completed." : "IfcOpenShell inspection completed with failed gates.",
    commandPreview: command.map(redactPath),
    artifacts: [
      artifact("inspection_report", reportPath, false, { adapterId: "ifcopenshell" }),
      artifact("inspection_report", summaryPath, false, { adapterId: "ifcopenshell" }),
      ...(checklistPath ? [artifact("bim-delivery-checklist", checklistPath, false, { adapterId: "ifcopenshell" })] : []),
      artifact("bim-metadata", metadataPath, false, { adapterId: "ifcopenshell" }),
      artifact("tool_log", logPath, false, { adapterId: "ifcopenshell" }),
    ],
    diagnostics,
    detection,
    executionPolicy: result.executionPolicy,
    error: ok ? undefined : diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; "),
  };
}

function parseBimIfcTaskRequest(value: unknown): { ok: true; request: BimIfcTaskRequest } | { ok: false; error: string } {
  try {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const request: BimIfcTaskRequest = {
      ifcPath: cleanText(raw.ifcPath) || DEFAULT_BIM_REQUEST.ifcPath,
      outputDir: cleanText(raw.outputDir) || undefined,
      checkProperties: typeof raw.checkProperties === "boolean" ? raw.checkProperties : DEFAULT_BIM_REQUEST.checkProperties,
      generateDeliveryChecklist: typeof raw.generateDeliveryChecklist === "boolean" ? raw.generateDeliveryChecklist : DEFAULT_BIM_REQUEST.generateDeliveryChecklist,
      targetStandard: cleanText(raw.targetStandard) || undefined,
    };
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function resolveBimIfcRequest({ workspace, request, artifactDir, mode }: { workspace: string; request: BimIfcTaskRequest; artifactDir?: string; mode: string }): ResolvedBimIfcRequest {
  const outputDir = safeBimOutputDir(workspace, artifactDir || request.outputDir, mode);
  const ifcFile = request.ifcPath ? resolveInside(workspace, request.ifcPath) : undefined;
  if (ifcFile && !/\.(ifc|ifczip)$/i.test(ifcFile)) throw new Error("BIM ifcPath must point to an .ifc or .ifczip file");
  return {
    request: { ...request, outputDir },
    ifcFile,
    ifcExists: !!(ifcFile && fs.existsSync(ifcFile) && fs.statSync(ifcFile).isFile()),
    outputDir,
  };
}

function bimGateDiagnostics(resolved: ResolvedBimIfcRequest, gateStatus?: ToolDiagnostic["gateStatus"]): ToolDiagnostic[] {
  const missingSeverity = gateStatus ? "warning" : "error";
  const diagnostics: ToolDiagnostic[] = [];
  diagnostics.push(resolved.ifcFile
    ? diagnostic("bim.ifc.path.safe", "info", "IFC path resolves inside the workspace.", "bim_check", gateStatus)
    : diagnostic("bim.ifc.path.missing", missingSeverity, "IFC path is required for real inspection.", "bim_check", gateStatus || "warning"));
  diagnostics.push(resolved.ifcExists
    ? diagnostic("bim.ifc.file.exists", "info", "IFC file exists.", "bim_check", gateStatus)
    : diagnostic("bim.ifc.file.missing", missingSeverity, "IFC file is missing; real BIM inspection cannot run.", "bim_check", gateStatus || "warning"));
  diagnostics.push(resolved.request.targetStandard
    ? diagnostic("bim.ifc.target_standard.declared", "info", "Target standard is declared for checklist planning only.", "documentation_review", gateStatus)
    : diagnostic("bim.ifc.target_standard.missing", "warning", "Target standard is not declared; code or delivery checklist must be confirmed by a human.", "documentation_review", gateStatus || "warning"));
  return diagnostics;
}

function inspectionDiagnostics(inspection: IfcInspectionData): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [
    diagnostic("bim.ifc.inspection.completed", "info", "IfcOpenShell inspection completed and produced element/space statistics.", "bim_check", "passed"),
  ];
  if (inspection.warnings.length) {
    diagnostics.push(diagnostic("bim.ifc.properties.warning", "warning", `IfcOpenShell reported property warnings for ${inspection.warnings.length} sampled elements.`, "documentation_review", "warning"));
  }
  return diagnostics;
}

function renderIfcPlan({ request, resolved, detection, reason }: { request: ToolRunRequest; resolved: ResolvedBimIfcRequest; detection: ToolDetectionResult; reason: string }): string {
  return [
    "# IFC Check Plan",
    "",
    `Task: ${request.task}`,
    `Installed: ${detection.installed ? "true" : "false"}`,
    `Reason: ${detection.reason}`,
    `Dry-run reason: ${reason}`,
    `IFC file: ${resolved.ifcFile || "(not provided)"}`,
    `IFC exists: ${resolved.ifcExists}`,
    `Target standard: ${resolved.request.targetStandard || "(not declared)"}`,
    `Output: ${resolved.outputDir}`,
    "",
    "## Planned Checks",
    "",
    "- IFC file existence and path safety",
    "- Element count by IFC type",
    "- Space count",
    "- Basic property extraction when IfcOpenShell Python module is available",
    "- Clash check planning only; no geometric clash result is claimed in Sprint 6E",
    "- Code-check checklist only; no local building-code compliance conclusion is claimed",
    "",
  ].join("\n");
}

function renderBimSummary({ resolved, inspection }: { resolved: ResolvedBimIfcRequest; inspection: IfcInspectionData }): string {
  const topTypes = Object.entries(inspection.elementTypes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return [
    "# BIM IFC Summary",
    "",
    `IFC file: ${resolved.ifcFile}`,
    `Target standard: ${resolved.request.targetStandard || "Not declared"}`,
    `Element count: ${inspection.elementCount}`,
    `Space count: ${inspection.spaceCount}`,
    "",
    "## Element Types",
    "",
    ...topTypes.map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Human Confirmation",
    "",
    "This report does not conclude compliance with local building codes. Use it as inspection evidence and complete jurisdiction-specific review manually.",
    "",
  ].join("\n");
}

function renderDeliveryChecklist(request: BimIfcTaskRequest, simulated: boolean): string {
  return [
    "# BIM Delivery Checklist",
    "",
    `Mode: ${simulated ? "dry-run planning" : "inspection evidence"}`,
    `Target standard: ${request.targetStandard || "Not declared; confirm manually"}`,
    "",
    "- Confirm IFC schema and model authoring source.",
    "- Confirm project, site, building, storey, and space structure.",
    "- Confirm required property sets and classification fields.",
    "- Confirm coordinate system, units, and model origin requirements.",
    "- Plan clash checks in an approved BIM coordination tool.",
    "- Confirm local building-code review scope with a qualified professional.",
    "- Package IFC, BIM summary, issue log, and approval evidence for release.",
    "",
    "No local building-code compliance conclusion is generated by Hi Code in Sprint 6E.",
    "",
  ].join("\n");
}

function expectedBimArtifacts(resolved: ResolvedBimIfcRequest, simulated: boolean): Record<string, unknown> {
  return {
    schemaVersion: 1,
    adapterId: "ifcopenshell",
    simulated,
    artifacts: [
      { type: "inspection_report", name: "bim-inspection-report.json", path: path.join(resolved.outputDir, "bim-inspection-report.json"), simulated },
      { type: "inspection_report", name: "bim-summary.md", path: path.join(resolved.outputDir, "bim-summary.md"), simulated },
      { type: "inspection_report", name: "metadata.json", path: path.join(resolved.outputDir, "metadata.json"), simulated },
      { type: "inspection_report", name: "bim-delivery-checklist.md", path: path.join(resolved.outputDir, "bim-delivery-checklist.md"), simulated },
    ],
  };
}

function bimMetadata({ resolved, detection, inputArtifacts, simulated, inspection, reason }: {
  resolved: ResolvedBimIfcRequest;
  detection: ToolDetectionResult;
  inputArtifacts: string[];
  simulated: boolean;
  inspection: IfcInspectionData | null;
  reason: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    adapterId: "ifcopenshell",
    generatedAt: new Date().toISOString(),
    simulated,
    reason,
    ifcFile: resolved.ifcFile,
    ifcExists: resolved.ifcExists,
    targetStandard: resolved.request.targetStandard || null,
    complianceConclusion: null,
    humanCodeReviewRequired: true,
    detection: {
      installed: detection.installed,
      toolName: detection.toolName,
      version: detection.version,
      executablePath: detection.executablePath ? redactPath(detection.executablePath) : undefined,
    },
    inputArtifacts,
    inspection,
  };
}

function parseInspectionOutput(stdout: string): IfcInspectionData {
  const parsed = JSON.parse(stdout || "{}") as Partial<IfcInspectionData>;
  return {
    schemaVersion: 1,
    elementCount: Number(parsed.elementCount || 0),
    spaceCount: Number(parsed.spaceCount || 0),
    elementTypes: parsed.elementTypes && typeof parsed.elementTypes === "object" ? parsed.elementTypes : {},
    spaces: Array.isArray(parsed.spaces) ? parsed.spaces : [],
    propertySamples: Array.isArray(parsed.propertySamples) ? parsed.propertySamples : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}

function detectIfcOpenShellProbe({ manual, commands, executablePaths, environment, pathEnv }: {
  manual?: string;
  commands: Array<{ command: string; found: boolean; path?: string }>;
  executablePaths: Array<{ path: string; found: boolean }>;
  environment: Array<{ name: string; set: boolean; path?: string; exists?: boolean; executable?: boolean }>;
  pathEnv: string;
}): IfcDetectionProbe {
  const pythonCandidates = unique([
    ...(manual && isPythonExecutable(manual) ? [manual] : []),
    ...environment.filter((item) => item.executable && item.name.includes("PYTHON") && item.path).map((item) => item.path as string),
    ...executablePaths.filter((item) => item.found && isPythonExecutable(item.path)).map((item) => item.path),
    findCommand("python3", pathEnv),
    findCommand("python", pathEnv),
  ].filter(Boolean) as string[]);
  for (const pythonPath of pythonCandidates) {
    const probe = probePythonModule(pythonPath);
    if (probe.moduleAvailable) return probe;
  }
  const cliCandidates = unique([
    ...(manual && !isPythonExecutable(manual) ? [manual] : []),
    ...commands.filter((item) => item.found && /ifcconvert|ifcopenshell/i.test(item.command)).map((item) => item.path as string),
    ...executablePaths.filter((item) => item.found && /ifcconvert|ifcopenshell/i.test(item.path)).map((item) => item.path),
  ].filter(Boolean) as string[]);
  for (const cliPath of cliCandidates) {
    const result = runIndustrialCommand({
      id: "ifcopenshell.version",
      executable: cliPath,
      args: ["--version"],
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5000,
      outputBytes: 2000,
      environment: { PATH: pathEnv },
      mutating: false,
      network: "deny",
    });
    const output = redactText([result.stdout, result.stderr].filter(Boolean).join("\n").trim()).slice(0, 2000);
    return { cliPath, cliAvailable: true, moduleAvailable: false, output, version: /([0-9]+(?:\.[0-9]+)+[^\s]*)/.exec(output)?.[1] };
  }
  return { moduleAvailable: false, cliAvailable: false };
}

function probePythonModule(pythonPath: string): IfcDetectionProbe {
  try {
    const result = runIndustrialCommand({
      id: "ifcopenshell.python-probe",
      executable: pythonPath,
      args: ["-c", PYTHON_PROBE],
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5000,
      outputBytes: 2000,
      environment: bimProcessEnv(),
      mutating: false,
      network: "deny",
    });
    const output = redactText([result.stdout, result.stderr].filter(Boolean).join("\n").trim()).slice(0, 2000);
    const parsed = JSON.parse(result.stdout || "{}") as { ok?: boolean; version?: string; error?: string };
    return {
      pythonPath,
      moduleAvailable: parsed.ok === true && result.status === 0,
      cliAvailable: false,
      version: parsed.version,
      output,
    };
  } catch {
    return { pythonPath, moduleAvailable: false, cliAvailable: false, output: "IfcOpenShell Python probe failed" };
  }
}

function inspectionCommand(pythonPath: string, resolved: ResolvedBimIfcRequest): string[] {
  return [pythonPath, "-c", "import ifcopenshell; inspect_ifc(...)", resolved.ifcFile || "<ifc-file>", String(resolved.request.checkProperties)];
}

function renderCommandPreview(command: string[]): string {
  return ["#!/bin/sh", "set -eu", command.map(shellQuote).join(" ")].join("\n") + "\n";
}

function renderInspectionLog(command: string[], result: IndustrialExecutionResult): string {
  return [
    `$ ${command.map(shellQuote).join(" ")}`,
    `status=${result.status ?? "null"} signal=${result.signal || ""}`,
    "stdout:",
    redactText(String(result.stdout || "")),
    "stderr:",
    redactText(String(result.stderr || result.error?.message || "")),
  ].join("\n");
}

function blockedBimRun({ adapter, detection, mode, message, code }: { adapter: IndustrialToolAdapter; detection: ToolDetectionResult; mode: "dry-run" | "execute"; message: string; code: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [diagnostic(code, "error", message, "bim_check")],
    detection,
    error: message,
  };
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string, gateStatus?: ToolDiagnostic["gateStatus"]): ToolDiagnostic {
  return {
    id: `diag-bim-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
    severity,
    code,
    message,
    gate,
    gateStatus,
  };
}

function artifact(type: string, filePath: string, simulated: boolean, metadata: Record<string, unknown>): ToolArtifact {
  return {
    id: `tool-artifact-${hash(`${type}:${filePath}`).slice(0, 12)}`,
    type,
    path: filePath,
    name: path.basename(filePath),
    simulated,
    metadata,
  };
}

function safeBimOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "bim", `ifc-${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base, "BIM output path escapes workspace");
  assertInside(artifactRoot, base, "BIM output path must stay under .hicode/artifacts");
  return base;
}

function resolveInside(workspace: string, value: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error("BIM path must be a safe string");
  const resolved = path.resolve(workspace, value);
  assertInside(workspace, resolved, "BIM IFC path escapes workspace");
  return resolved;
}

function assertInside(root: string, target: string, message: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(message);
}

function findCommand(command: string, pathEnv: string): string | null {
  if (!command || /[\\/]/.test(command)) return isExecutable(command) ? command : null;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile() && !stat.isSymbolicLink()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isPythonExecutable(value: string): boolean {
  return /(^|[\\/])python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(value);
}

function expandPath(value: string, env: NodeJS.ProcessEnv): string {
  if (!value) return value;
  const expanded = value
    .replace(/^~/, env.HOME || process.env.HOME || "")
    .replace(/\$([A-Z0-9_]+)/gi, (_match, name) => env[name] || "");
  return path.resolve(expanded);
}

function normalizeManualExecutablePath(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/[\0\r\n]/.test(value)) throw new Error("manual executable path contains unsafe characters");
  return expandPath(value.trim(), env);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/[\0]/.test(text)) throw new Error("BIM text fields must not contain control characters");
  if (text.length > 2000) throw new Error("BIM text field is too long");
  return text;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:%=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function diagnosticId(adapterId: string, suffix: string): string {
  return `diag-${adapterId}-${suffix}-${Date.now().toString(36)}`;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "BIM IFC adapter error");
}

function redactText(value: string): string {
  return String(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[^\s,'"]+/gi, "$1=[REDACTED]");
}

function redactPath(value: string): string {
  const home = process.env.HOME || "";
  return home && value.startsWith(home) ? value.replace(home, "~") : value;
}

function bimProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const safeKeys = new Set(["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "PYTHONPATH"]);
  for (const key of safeKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("IFCOPENSHELL") || /TOKEN|SECRET|PASSWORD|API[_-]?KEY/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}
