import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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

export interface SolidWorksBridgeDimensions {
  length: number;
  width: number;
  height: number;
  wallThickness: number;
}

export interface SolidWorksBridgeTaskRequest {
  bridgeType: "part" | "assembly" | "drawing_export" | "step_export" | "bom_export";
  partName: string;
  dimensions: SolidWorksBridgeDimensions;
  material: string;
  units: "mm";
  expectedOutputs: Array<"SLDPRT" | "SLDASM" | "SLDDRW" | "STEP" | "BOM">;
  outputDir?: string;
  bridgeScriptType: "vba";
}

interface SolidWorksRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface SolidWorksDetectionEvidence {
  commands: Array<{ command: string; found: boolean; path?: string }>;
  executablePaths: Array<{ path: string; found: boolean }>;
  environment: Array<{ name: string; set: boolean; path?: string; exists?: boolean; executable?: boolean }>;
  configPaths: Array<{ path: string; found: boolean }>;
}

const DEFAULT_SOLIDWORKS_REQUEST: SolidWorksBridgeTaskRequest = {
  bridgeType: "part",
  partName: "hicode-bridge-control-box",
  dimensions: {
    length: 120,
    width: 80,
    height: 36,
    wallThickness: 3,
  },
  material: "ABS",
  units: "mm",
  expectedOutputs: ["SLDPRT", "STEP", "BOM"],
  bridgeScriptType: "vba",
};

const SOLIDWORKS_WINDOWS_PATHS = [
  "C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe",
  "C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\sldworks.exe",
  "C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS (2)\\SLDWORKS.exe",
  "C:\\Program Files\\Dassault Systemes\\SOLIDWORKS\\SLDWORKS.exe",
  "$SOLIDWORKS_HOME\\SLDWORKS.exe",
  "$SOLIDWORKS_HOME\\SOLIDWORKS\\SLDWORKS.exe",
  "$SOLIDWORKS_EXE",
];

const SOLIDWORKS_OUTPUT_SCHEMA = {
  schemaVersion: 1,
  requiredArtifacts: [
    { name: "part.sldprt", type: "cad_model", generated: false, simulated: false, external_required: true },
    { name: "assembly.sldasm", type: "cad_model", generated: false, simulated: false, external_required: true },
    { name: "drawing.slddrw", type: "drawing", generated: false, simulated: false, external_required: true },
    { name: "export.step", type: "step_file", generated: false, simulated: false, external_required: true },
    { name: "bom.csv", type: "bom", generated: false, simulated: false, external_required: true },
  ],
};

export function solidWorksBridgeAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "solidworks",
    name: "SolidWorks Bridge",
    vendor: "Dassault Systemes",
    kind: "commercial",
    domains: ["solidworks", "mechanical", "cad"],
    homepage: "https://www.solidworks.com/",
    detection: {
      commands: ["SLDWORKS.exe", "sldworks.exe"],
      executablePaths: SOLIDWORKS_WINDOWS_PATHS,
      envVars: ["SOLIDWORKS_HOME", "SOLIDWORKS_EXE", "SOLIDWORKS_COM_BRIDGE"],
      configPaths: ["%ProgramData%\\SOLIDWORKS", "%APPDATA%\\SOLIDWORKS"],
      setupHint: "SolidWorks bridge requires Windows, a licensed local SolidWorks installation, and explicit user approval before running any COM/API bridge outside Hi Code.",
    },
    capabilities: [
      solidWorksCapability("part_generation_bridge", "Part generation bridge", ["cad_model"], true),
      solidWorksCapability("assembly_generation_bridge", "Assembly generation bridge", ["cad_model"], true),
      solidWorksCapability("drawing_export_bridge", "Drawing export bridge", ["drawing"], true),
      solidWorksCapability("step_export_bridge", "STEP export bridge", ["step_file"], true),
      solidWorksCapability("bom_export_bridge", "BOM export bridge", ["bom"], true),
      solidWorksCapability("macro_generation", "Macro generation", ["architecture_doc"], false),
      solidWorksCapability("external_execution_required", "External execution required", ["inspection_report"], false),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6F generates a safe SolidWorks bridge package and macro template only. Hi Code does not automate licensed SolidWorks sessions in this sprint.",
  };
}

export function detectSolidWorksBridgeAdapter({ adapter, options = {}, env = process.env, pathEnv = env.PATH || "" }: {
  adapter: IndustrialToolAdapter;
  options?: ToolDetectionOptions;
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
}): ToolDetectionResult {
  const now = Date.now();
  const platform = hostPlatform(env);
  const manual = normalizeManualExecutablePath(options.executablePath, env);
  const evidence = collectSolidWorksEvidence({ adapter, manual, env, pathEnv });
  if (platform !== "win32") {
    const message = "unsupported_platform: SolidWorks COM/API bridge requires Windows with a licensed local SolidWorks installation.";
    return detectionResult({ adapter, installed: false, reason: message, evidence, now, code: "solidworks.unsupported_platform", severity: "warning", platform });
  }
  const executablePath = firstExecutable(evidence);
  const installed = !!executablePath;
  const reason = installed
    ? `Detected SolidWorks executable at ${redactPath(executablePath)}. Version is unknown until a licensed local bridge validates the COM API.`
    : "SolidWorks executable was not found in common Windows paths, environment variables, or user configuration.";
  return detectionResult({
    adapter,
    installed,
    reason,
    evidence,
    now,
    code: installed ? "tool.detected" : "tool.missing",
    severity: installed ? "info" : "warning",
    platform,
    executablePath,
    version: installed ? "unknown" : undefined,
  });
}

export function runSolidWorksBridgeAdapterTask(input: SolidWorksRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const mode = request.mode || "dry-run";
  const parsed = parseSolidWorksRequest(request.solidworksRequest || request.cadRequest);
  if (!parsed.ok) {
    return blockedSolidWorksRun({ adapter, mode, detection, message: parsed.error, code: "solidworks.invalid_request" });
  }
  let outputDir: string;
  try {
    outputDir = safeSolidWorksOutputDir(workspace, request.artifactDir || parsed.request.outputDir, mode);
  } catch (error) {
    return blockedSolidWorksRun({ adapter, mode, detection, message: errorMessage(error), code: "solidworks.output_path_rejected" });
  }
  if (request.allowNetwork === true) {
    return blockedSolidWorksRun({ adapter, mode, detection, message: "SolidWorks bridge forbids network access; commercial software execution must stay local and user-authorized.", code: "solidworks.network_blocked" });
  }
  if (mode === "execute") {
    if (!detection.installed) {
      return blockedSolidWorksRun({ adapter, mode, detection, message: "SolidWorks is not installed or this platform is unsupported; only dry-run bridge package generation is allowed.", code: "solidworks.not_installed" });
    }
    if (request.userApproved !== true) {
      return blockedSolidWorksRun({ adapter, mode, detection, message: "SolidWorks COM/API bridge execution requires explicit human authorization.", code: "solidworks.approval_required" });
    }
    return blockedSolidWorksRun({ adapter, mode, detection, message: "SolidWorks real execution is external_required in Sprint 6F. Generate the bridge package and run it manually inside the licensed Windows environment.", code: "solidworks.external_execution_required" });
  }
  return writeSolidWorksDryRun({ adapter, request, bridgeRequest: parsed.request, outputDir, detection, commandPreview, inputArtifacts });
}

function solidWorksCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} through a user-authorized SolidWorks COM/API bridge package.`,
    domains: ["solidworks", "mechanical", "cad"],
    artifactTypes,
    qualityGates: ["cad_validation", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function writeSolidWorksDryRun({ adapter, request, bridgeRequest, outputDir, detection, commandPreview, inputArtifacts }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  bridgeRequest: SolidWorksBridgeTaskRequest;
  outputDir: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}): ToolRunResult {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const runPlanPath = path.join(outputDir, "solidworks-run-plan.md");
  const bridgePlanPath = path.join(outputDir, "solidworks-bridge-plan.md");
  const macroPath = path.join(outputDir, "macro-template.bas");
  const inputSchemaPath = path.join(outputDir, "solidworks-input-schema.json");
  const outputSchemaPath = path.join(outputDir, "solidworks-output-schema.json");
  const expectedArtifactsPath = path.join(outputDir, "expected-artifacts.json");
  const manualSetupPath = path.join(outputDir, "manual-setup.md");
  const metadataPath = path.join(outputDir, "metadata.json");
  const expectedArtifacts = expectedSolidWorksArtifacts(bridgeRequest, outputDir);
  const metadata = {
    schemaVersion: 1,
    adapterId: "solidworks",
    bridgeType: bridgeRequest.bridgeType,
    generated: true,
    simulated: true,
    external_required: true,
    externalRequired: true,
    executionStatus: "not_run",
    platform: hostPlatform(process.env),
    installed: detection.installed,
    version: detection.version?.version || "unknown",
    humanAuthorizationRequired: true,
    commercialLicenseRequired: true,
    artifacts: expectedArtifacts,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(runPlanPath, renderSolidWorksRunPlan({ request, bridgeRequest, detection, expectedArtifacts }), { mode: 0o600 });
  fs.writeFileSync(bridgePlanPath, renderBridgePlan({ bridgeRequest, outputDir }), { mode: 0o600 });
  fs.writeFileSync(macroPath, renderVbaMacroTemplate({ bridgeRequest, outputDir }), { mode: 0o600 });
  fs.writeFileSync(inputSchemaPath, JSON.stringify(solidWorksInputSchema(), null, 2), { mode: 0o600 });
  fs.writeFileSync(outputSchemaPath, JSON.stringify(SOLIDWORKS_OUTPUT_SCHEMA, null, 2), { mode: 0o600 });
  fs.writeFileSync(expectedArtifactsPath, JSON.stringify({ schemaVersion: 1, adapterId: "solidworks", generated: true, simulated: true, external_required: true, artifacts: expectedArtifacts }, null, 2), { mode: 0o600 });
  fs.writeFileSync(manualSetupPath, renderManualSetup({ detection, outputDir }), { mode: 0o600 });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  const artifacts = [
    artifact("solidworks-run-plan", runPlanPath, true),
    artifact("solidworks-bridge-plan", bridgePlanPath, true),
    artifact("solidworks-macro-template", macroPath, true),
    artifact("solidworks-input-schema", inputSchemaPath, true),
    artifact("solidworks-output-schema", outputSchemaPath, true),
    artifact("solidworks-expected-artifacts", expectedArtifactsPath, true),
    artifact("solidworks-manual-setup", manualSetupPath, true),
    artifact("solidworks-metadata", metadataPath, true),
  ];
  return {
    ok: true,
    adapterId: adapter.id,
    mode: "dry-run",
    simulated: true,
    summary: detection.installed
      ? "SolidWorks detected; bridge package generated without launching SolidWorks."
      : "SolidWorks is unavailable or unsupported; simulated bridge package generated for manual Windows setup.",
    commandPreview: commandPreview.length ? commandPreview : ["powershell", "-ExecutionPolicy", "Bypass", "Run-SolidWorksBridge.ps1"],
    artifacts,
    diagnostics: [
      ...detection.diagnostics,
      ...solidWorksQualityDiagnostics({ detection, bridgeRequest, expectedArtifacts }),
    ],
    detection,
  };
}

function parseSolidWorksRequest(value: unknown): { ok: true; request: SolidWorksBridgeTaskRequest } | { ok: false; error: string } {
  try {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const dimsRaw = raw.dimensions && typeof raw.dimensions === "object" && !Array.isArray(raw.dimensions)
      ? raw.dimensions as Record<string, unknown>
      : {};
    const request: SolidWorksBridgeTaskRequest = {
      bridgeType: normalizeBridgeType(raw.bridgeType),
      partName: safeName(raw.partName) || DEFAULT_SOLIDWORKS_REQUEST.partName,
      dimensions: {
        length: numberOr(dimsRaw.length, DEFAULT_SOLIDWORKS_REQUEST.dimensions.length),
        width: numberOr(dimsRaw.width, DEFAULT_SOLIDWORKS_REQUEST.dimensions.width),
        height: numberOr(dimsRaw.height, DEFAULT_SOLIDWORKS_REQUEST.dimensions.height),
        wallThickness: numberOr(dimsRaw.wallThickness, DEFAULT_SOLIDWORKS_REQUEST.dimensions.wallThickness),
      },
      material: cleanText(raw.material) || DEFAULT_SOLIDWORKS_REQUEST.material,
      units: normalizeUnits(raw.units),
      expectedOutputs: normalizeExpectedOutputs(raw.expectedOutputs),
      outputDir: cleanText(raw.outputDir) || undefined,
      bridgeScriptType: "vba",
    };
    validateSolidWorksRequest(request);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function validateSolidWorksRequest(request: SolidWorksBridgeTaskRequest): void {
  for (const [name, value] of Object.entries(request.dimensions)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`SolidWorks dimension ${name} must be a positive number`);
  }
  const { length, width, height, wallThickness } = request.dimensions;
  if (length < 10 || width < 10 || height < 5) throw new Error("SolidWorks bridge dimensions are too small for a useful CAD draft");
  if (length > 5000 || width > 5000 || height > 3000) throw new Error("SolidWorks bridge dimensions exceed safe package limits");
  if (wallThickness * 2 >= Math.min(length, width, height)) throw new Error("SolidWorks wallThickness must leave usable interior geometry");
  if (request.units !== "mm") throw new Error("SolidWorks bridge currently supports millimeter units only");
  if (!request.expectedOutputs.length) throw new Error("SolidWorks expectedOutputs must include at least one artifact type");
}

function solidWorksQualityDiagnostics({ detection, bridgeRequest, expectedArtifacts }: {
  detection: ToolDetectionResult;
  bridgeRequest: SolidWorksBridgeTaskRequest;
  expectedArtifacts: Array<Record<string, unknown>>;
}): ToolDiagnostic[] {
  return [
    diagnostic("solidworks.platform.checked", detection.diagnostics.some((item) => item.code === "solidworks.unsupported_platform") ? "warning" : "info", detection.diagnostics.some((item) => item.code === "solidworks.unsupported_platform") ? "SolidWorks bridge platform is unsupported for real execution." : "SolidWorks bridge platform check completed.", "human_approval", "not_run"),
    diagnostic("solidworks.installation.checked", detection.installed ? "info" : "warning", detection.installed ? "SolidWorks installation evidence was detected." : "SolidWorks installation evidence was not detected.", "cad_validation", "not_run"),
    diagnostic("solidworks.authorization.required", "warning", "Commercial SolidWorks COM/API execution requires explicit human authorization and a licensed Windows session.", "human_approval", "not_run"),
    diagnostic("solidworks.dimensions.valid", "info", `SolidWorks bridge dimensions are valid for ${bridgeRequest.partName}.`, "cad_validation", "simulated"),
    diagnostic("solidworks.outputs.external_required", "warning", `${expectedArtifacts.length} expected SolidWorks outputs require external manual bridge execution; no .sldprt/.sldasm/.slddrw file was generated by Hi Code.`, "cad_validation", "not_run"),
  ];
}

function expectedSolidWorksArtifacts(request: SolidWorksBridgeTaskRequest, outputDir: string): Array<Record<string, unknown>> {
  const safeBase = request.partName.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80) || "solidworks-part";
  const map: Record<string, { type: string; name: string; format: string }> = {
    SLDPRT: { type: "cad_model", name: `${safeBase}.sldprt`, format: "SLDPRT" },
    SLDASM: { type: "cad_model", name: `${safeBase}.sldasm`, format: "SLDASM" },
    SLDDRW: { type: "drawing", name: `${safeBase}.slddrw`, format: "SLDDRW" },
    STEP: { type: "step_file", name: `${safeBase}.step`, format: "STEP" },
    BOM: { type: "bom", name: `${safeBase}-bom.csv`, format: "CSV" },
  };
  return request.expectedOutputs.map((key) => ({
    ...map[key],
    path: path.join(outputDir, map[key].name),
    required: true,
    generated: false,
    simulated: false,
    external_required: true,
    externalRequired: true,
  }));
}

function renderSolidWorksRunPlan({ request, bridgeRequest, detection, expectedArtifacts }: {
  request: ToolRunRequest;
  bridgeRequest: SolidWorksBridgeTaskRequest;
  detection: ToolDetectionResult;
  expectedArtifacts: Array<Record<string, unknown>>;
}): string {
  return [
    "# SolidWorks Run Plan",
    "",
    `Task: ${request.task}`,
    `Bridge type: ${bridgeRequest.bridgeType}`,
    `Part name: ${bridgeRequest.partName}`,
    `Installed evidence: ${detection.installed ? "true" : "false"}`,
    `Detection reason: ${detection.reason}`,
    `Version: ${detection.version?.version || "unknown"}`,
    "",
    "## Dimensions",
    "",
    ...Object.entries(bridgeRequest.dimensions).map(([key, value]) => `- ${key}: ${value} ${bridgeRequest.units}`),
    "",
    "## Expected External Artifacts",
    "",
    ...expectedArtifacts.map((item) => `- ${item.name}: ${item.type}; generated=false; simulated=false; external_required=true`),
    "",
    "Hi Code generated this bridge package only. It did not launch SolidWorks and did not generate native SolidWorks files.",
    "",
  ].join("\n");
}

function renderBridgePlan({ bridgeRequest, outputDir }: { bridgeRequest: SolidWorksBridgeTaskRequest; outputDir: string }): string {
  return [
    "# SolidWorks Bridge Plan",
    "",
    "## Boundary",
    "",
    "- Run only on Windows with a licensed local SolidWorks installation.",
    "- Run only after an engineer reviews the macro and explicitly approves execution.",
    "- Hi Code does not bypass licensing, start a COM session, or claim native CAD outputs in Sprint 6F.",
    "",
    "## Input Schema",
    "",
    "See `solidworks-input-schema.json` for the bridge request shape.",
    "",
    "## Expected Output Schema",
    "",
    "See `solidworks-output-schema.json` and `expected-artifacts.json` for native CAD/BOM outputs that must be produced externally.",
    "",
    "## Manual Flow",
    "",
    "1. Copy this bridge package to the licensed Windows workstation.",
    "2. Open SolidWorks manually.",
    "3. Review `macro-template.bas` and adjust company templates/material libraries if needed.",
    "4. Run the macro from the SolidWorks macro editor.",
    "5. Save generated native files into the planned output directory.",
    "6. Bring resulting artifacts back into the project and attach them through Job Center.",
    "",
    `Planned output directory: ${redactPath(outputDir)}`,
    `Bridge type: ${bridgeRequest.bridgeType}`,
    "",
  ].join("\n");
}

function renderManualSetup({ detection, outputDir }: { detection: ToolDetectionResult; outputDir: string }): string {
  return [
    "# SolidWorks Manual Setup",
    "",
    `Detection: ${detection.reason}`,
    "",
    "Required setup:",
    "- Windows workstation with SolidWorks installed and licensed.",
    "- User account allowed to run SolidWorks macros.",
    "- Project output directory approved by the engineering owner.",
    "- Human approval recorded before COM/API execution.",
    "",
    "Validation after manual execution:",
    "- Confirm native `.sldprt`, `.sldasm`, or `.slddrw` files exist and are non-empty.",
    "- Confirm STEP/BOM exports match the requested output list.",
    "- Attach generated files to the Hi Code Job Center record.",
    "- Record reviewer approval before release.",
    "",
    `Bridge package directory: ${redactPath(outputDir)}`,
    "",
  ].join("\n");
}

function renderVbaMacroTemplate({ bridgeRequest, outputDir }: { bridgeRequest: SolidWorksBridgeTaskRequest; outputDir: string }): string {
  const d = bridgeRequest.dimensions;
  return [
    "Option Explicit",
    "' Hi Code Sprint 6F SolidWorks bridge macro template.",
    "' Review and run manually inside a licensed Windows SolidWorks session.",
    "' Hi Code does not execute this macro automatically.",
    "",
    `Const HICODE_PART_NAME As String = "${vbaString(bridgeRequest.partName)}"`,
    `Const HICODE_OUTPUT_DIR As String = "${vbaString(outputDir)}"`,
    `Const HICODE_LENGTH_MM As Double = ${d.length}`,
    `Const HICODE_WIDTH_MM As Double = ${d.width}`,
    `Const HICODE_HEIGHT_MM As Double = ${d.height}`,
    `Const HICODE_WALL_MM As Double = ${d.wallThickness}`,
    `Const HICODE_MATERIAL As String = "${vbaString(bridgeRequest.material)}"`,
    "",
    "Sub main()",
    "    Dim swApp As Object",
    "    Set swApp = Application.SldWorks",
    "    If swApp Is Nothing Then",
    "        Err.Raise vbObjectError + 6101, \"HiCodeSolidWorksBridge\", \"SolidWorks application is not available.\"",
    "    End If",
    "    MsgBox \"Hi Code bridge package loaded for \" & HICODE_PART_NAME & vbCrLf & _",
    "           \"Dimensions (mm): \" & HICODE_LENGTH_MM & \" x \" & HICODE_WIDTH_MM & \" x \" & HICODE_HEIGHT_MM & vbCrLf & _",
    "           \"Output directory: \" & HICODE_OUTPUT_DIR & vbCrLf & _",
    "           \"Review company CAD standards before creating native files.\", vbInformation, \"Hi Code SolidWorks Bridge\"",
    "End Sub",
    "",
  ].join("\r\n");
}

function solidWorksInputSchema(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "object",
    required: ["bridgeType", "partName", "dimensions", "material", "units", "expectedOutputs"],
    properties: {
      bridgeType: { enum: ["part", "assembly", "drawing_export", "step_export", "bom_export"] },
      partName: { type: "string" },
      dimensions: {
        type: "object",
        required: ["length", "width", "height", "wallThickness"],
        properties: {
          length: { type: "number", minimum: 10 },
          width: { type: "number", minimum: 10 },
          height: { type: "number", minimum: 5 },
          wallThickness: { type: "number", minimum: 0.1 },
        },
      },
      material: { type: "string" },
      units: { enum: ["mm"] },
      expectedOutputs: { type: "array", items: { enum: ["SLDPRT", "SLDASM", "SLDDRW", "STEP", "BOM"] } },
      outputDir: { type: "string" },
    },
  };
}

function detectionResult({ adapter, installed, reason, evidence, now, code, severity, platform, executablePath, version }: {
  adapter: IndustrialToolAdapter;
  installed: boolean;
  reason: string;
  evidence: SolidWorksDetectionEvidence;
  now: number;
  code: string;
  severity: "info" | "warning" | "error";
  platform: string;
  executablePath?: string;
  version?: string;
}): ToolDetectionResult {
  return {
    adapterId: adapter.id,
    toolName: adapter.name,
    installed,
    reason,
    setupHint: adapter.detection.setupHint,
    executablePath,
    version: installed ? { command: executablePath ? redactPath(executablePath) : undefined, version: version || "unknown", output: "version unknown; SolidWorks requires COM/API bridge validation" } : undefined,
    evidence,
    diagnostics: [diagnostic(code, severity, reason, "human_approval", installed ? "not_run" : "skipped", { platform })],
    detectedAt: now,
  };
}

function collectSolidWorksEvidence({ adapter, manual, env, pathEnv }: {
  adapter: IndustrialToolAdapter;
  manual?: string;
  env: NodeJS.ProcessEnv;
  pathEnv: string;
}): SolidWorksDetectionEvidence {
  const commands = (adapter.detection.commands || []).map((command) => {
    const found = findCommand(command, pathEnv);
    return { command, found: !!found, path: found || undefined };
  });
  const executableCandidates = [
    ...(manual ? [manual] : []),
    ...solidWorksEnvExecutableCandidates(env),
    ...(adapter.detection.executablePaths || []),
  ];
  const executablePaths = unique(executableCandidates).map((candidate) => {
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
    const expanded = expandWindowsEnvPath(candidate, env);
    return { path: expanded, found: fs.existsSync(expanded) };
  });
  return { commands, executablePaths, environment, configPaths };
}

function solidWorksEnvExecutableCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  if (env.SOLIDWORKS_EXE) candidates.push(env.SOLIDWORKS_EXE);
  if (env.SOLIDWORKS_HOME) {
    candidates.push(path.join(env.SOLIDWORKS_HOME, "SLDWORKS.exe"));
    candidates.push(path.join(env.SOLIDWORKS_HOME, "SOLIDWORKS", "SLDWORKS.exe"));
  }
  return candidates;
}

function firstExecutable(evidence: SolidWorksDetectionEvidence): string | undefined {
  return evidence.commands.find((item) => item.found)?.path
    || evidence.executablePaths.find((item) => item.found)?.path
    || evidence.environment.find((item) => item.executable)?.path;
}

function blockedSolidWorksRun({ adapter, mode, detection, message, code }: { adapter: IndustrialToolAdapter; mode: "dry-run" | "execute"; detection: ToolDetectionResult; message: string; code: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [diagnostic(code, "error", message, "human_approval", "failed")],
    detection,
    error: message,
  };
}

function artifact(type: string, filePath: string, simulated: boolean): ToolArtifact {
  return {
    id: `tool-artifact-${hash(`${type}:${filePath}`).slice(0, 12)}`,
    type,
    path: filePath,
    name: path.basename(filePath),
    simulated,
    metadata: {
      adapterId: "solidworks",
      mode: "dry-run",
      generated: true,
      simulated,
      external_required: true,
      externalRequired: true,
      sha256: fileHash(filePath),
    },
  };
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string, gateStatus: ToolDiagnostic["gateStatus"] = "not_run", metadata: Record<string, unknown> = {}): ToolDiagnostic {
  return {
    id: `diag-solidworks-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
    severity,
    code,
    message: Object.keys(metadata).length ? `${message} ${JSON.stringify(metadata)}` : message,
    gate,
    gateStatus,
  };
}

function safeSolidWorksOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "solidworks", `${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base, "SolidWorks output path escapes workspace");
  assertInside(artifactRoot, base, "SolidWorks output path must stay under .hicode/artifacts");
  return base;
}

function normalizeBridgeType(value: unknown): SolidWorksBridgeTaskRequest["bridgeType"] {
  const text = cleanText(value);
  if (!text) return DEFAULT_SOLIDWORKS_REQUEST.bridgeType;
  if (["part", "assembly", "drawing_export", "step_export", "bom_export"].includes(text)) return text as SolidWorksBridgeTaskRequest["bridgeType"];
  throw new Error("SolidWorks bridgeType is invalid");
}

function normalizeUnits(value: unknown): "mm" {
  const text = cleanText(value).toLowerCase();
  if (!text || text === "mm" || text === "millimeter" || text === "millimeters") return "mm";
  throw new Error("SolidWorks bridge units must be mm");
}

function normalizeExpectedOutputs(value: unknown): SolidWorksBridgeTaskRequest["expectedOutputs"] {
  const allowed = ["SLDPRT", "SLDASM", "SLDDRW", "STEP", "BOM"];
  const values = stringArray(value).map((item) => item.toUpperCase()).filter((item) => allowed.includes(item));
  return unique(values.length ? values : DEFAULT_SOLIDWORKS_REQUEST.expectedOutputs) as SolidWorksBridgeTaskRequest["expectedOutputs"];
}

function safeName(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  if (/[\0\r\n]/.test(text)) throw new Error("SolidWorks partName must not contain control characters");
  return text.replace(/[^a-z0-9._ -]/gi, "-").trim().slice(0, 80);
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim().slice(0, 200)))
    : [];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeManualExecutablePath(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/[\0\r\n]/.test(text)) throw new Error("SolidWorks executable path must not contain control characters");
  return expandPath(text, env);
}

function expandPath(value: string, env: NodeJS.ProcessEnv): string {
  let expanded = value.replace(/^~(?=$|\/|\\)/, env.HOME || process.env.HOME || "");
  expanded = expanded.replace(/\$([A-Z0-9_]+)/gi, (_match, name) => env[name] || "");
  expanded = expanded.replace(/%([A-Z0-9_]+)%/gi, (_match, name) => env[name] || "");
  return path.resolve(expanded);
}

function expandWindowsEnvPath(value: string, env: NodeJS.ProcessEnv): string {
  return expandPath(value, env);
}

function hostPlatform(env: NodeJS.ProcessEnv): NodeJS.Platform | string {
  const override = cleanText(env.HICODE_HOST_PLATFORM);
  return override || process.platform;
}

function findCommand(command: string, pathEnv: string): string | null {
  if (!command || /[\\/]/.test(command)) return isExecutable(command) ? command : null;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = ["", ".exe", ".cmd", ".bat"];
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

function assertInside(root: string, target: string, message: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(message);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function vbaString(value: string): string {
  return value.replace(/"/g, "\"\"");
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redactPath(value: string): string {
  const home = process.env.HOME || "";
  return home && value.startsWith(home) ? value.replace(home, "~") : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "SolidWorks bridge adapter error");
}
