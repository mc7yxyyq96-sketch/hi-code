import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runIndustrialCommand } from "./industrial-execution.js";

import type {
  IndustrialToolAdapter,
  ToolCapability,
  ToolArtifact,
  ToolDetectionResult,
  ToolDiagnostic,
  ToolRunRequest,
  ToolRunResult,
} from "./industrial-tool-adapters.js";

export type FreeCadExportFormat = "FCStd" | "STEP" | "STL";
export type FreeCadPartType = "control_box_enclosure";
export type FreeCadUnits = "mm";

export interface FreeCadDimensions {
  length: number;
  width: number;
  height: number;
  wallThickness: number;
  lidThickness: number;
  mountHoleDiameter: number;
  mountHoleOffset: number;
}

export interface FreeCadTaskRequest {
  partType: FreeCadPartType;
  dimensions: FreeCadDimensions;
  material: string;
  units: FreeCadUnits;
  constraints: string[];
  exportFormats: FreeCadExportFormat[];
  outputDir?: string;
}

interface FreeCadRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface QualityResult {
  ok: boolean;
  diagnostics: ToolDiagnostic[];
  metadata?: Record<string, unknown>;
}

const DEFAULT_FREECAD_REQUEST: FreeCadTaskRequest = {
  partType: "control_box_enclosure",
  dimensions: {
    length: 120,
    width: 80,
    height: 36,
    wallThickness: 3,
    lidThickness: 3,
    mountHoleDiameter: 4,
    mountHoleOffset: 12,
  },
  material: "ABS",
  units: "mm",
  constraints: [
    "Open-top control box shell with separate lid design plan",
    "Four bottom mounting holes",
    "Wall thickness must preserve internal cavity",
  ],
  exportFormats: ["FCStd", "STEP", "STL"],
};

const FREECAD_COMMON_PATHS = [
  "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd",
  "/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd",
  "/opt/homebrew/bin/FreeCADCmd",
  "/opt/homebrew/bin/freecadcmd",
  "/usr/local/bin/FreeCADCmd",
  "/usr/local/bin/freecadcmd",
  "/usr/bin/FreeCADCmd",
  "/usr/bin/freecadcmd",
  "$FREECAD_HOME/bin/FreeCADCmd",
  "$FREECAD_HOME/bin/freecadcmd",
  "$FREECAD_HOME/Contents/MacOS/FreeCADCmd",
  "$FREECADCMD_PATH",
  "C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCADCmd.exe",
  "C:\\Program Files\\FreeCAD 0.22\\bin\\FreeCADCmd.exe",
];

export function freeCadAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "freecad",
    name: "FreeCAD",
    vendor: "FreeCAD",
    kind: "open-source",
    domains: ["mechanical", "cad"],
    homepage: "https://www.freecad.org/",
    detection: {
      commands: ["FreeCADCmd", "freecadcmd"],
      versionCommand: { command: "FreeCADCmd", args: ["--version"], pattern: "([0-9]+(?:\\.[0-9]+)+[^\\s]*)" },
      executablePaths: FREECAD_COMMON_PATHS,
      envVars: ["FREECADCMD_PATH"],
      configPaths: ["~/Library/Preferences/FreeCAD", "~/.config/FreeCAD"],
      setupHint: "Install FreeCAD and make FreeCADCmd/freecadcmd available on PATH, or provide a manual executable path.",
    },
    capabilities: [
      freeCadCapability("parametric_part_generation", "Parametric part generation", ["cad_model"], true),
      freeCadCapability("enclosure_generation", "Control box enclosure generation", ["cad_model"], true),
      freeCadCapability("step_export", "STEP export", ["step_file"], true),
      freeCadCapability("stl_export", "STL export", ["stl_file"], true),
      freeCadCapability("basic_geometry_check", "Basic geometry check", ["inspection_report"], false),
      freeCadCapability("drawing_placeholder_plan", "Drawing plan", ["drawing"], false),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6B supports real local FreeCADCmd execution for a simple parameterized control box enclosure.",
  };
}

export function runFreeCadAdapterTask(input: FreeCadRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const mode = request.mode || "dry-run";
  const parsed = parseFreeCadTaskRequest(request.cadRequest);
  if (!parsed.ok) {
    return blockedFreeCadRun({ adapter, mode, detection, message: parsed.error, code: "freecad.invalid_request" });
  }
  const cadRequest = parsed.request;
  let outputDir: string;
  try {
    outputDir = safeFreeCadOutputDir(workspace, request.artifactDir || cadRequest.outputDir, mode);
  } catch (error) {
    return blockedFreeCadRun({ adapter, mode, detection, message: errorMessage(error), code: "freecad.output_path_rejected" });
  }
  if (mode === "dry-run") {
    return writeFreeCadDryRun({ adapter, request, cadRequest, workspace, outputDir, detection, commandPreview, inputArtifacts });
  }
  if (!detection.installed || !detection.executablePath) {
    return blockedFreeCadRun({ adapter, mode, detection, message: "FreeCADCmd/freecadcmd is not installed; only dry-run is allowed.", code: "freecad.not_installed" });
  }
  if (request.userApproved !== true) {
    return blockedFreeCadRun({ adapter, mode, detection, message: "FreeCAD execution requires explicit user approval", code: "freecad.approval_required" });
  }
  if (request.allowNetwork === true) {
    return blockedFreeCadRun({ adapter, mode, detection, message: "FreeCAD adapter does not need network access and blocks it by default", code: "freecad.network_blocked" });
  }
  return runFreeCadCommand({ adapter, request, cadRequest, workspace, outputDir, detection, inputArtifacts });
}

function freeCadCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} through the FreeCAD adapter.`,
    domains: ["mechanical", "cad"],
    artifactTypes,
    qualityGates: ["cad_validation"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function writeFreeCadDryRun({ adapter, request, cadRequest, outputDir, detection, commandPreview, inputArtifacts }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  cadRequest: FreeCadTaskRequest;
  workspace: string;
  outputDir: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}): ToolRunResult {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const planPath = path.join(outputDir, "freecad-run-plan.md");
  const inputPath = path.join(outputDir, "expected-input.json");
  const artifactsPath = path.join(outputDir, "expected-artifacts.json");
  const expectedArtifacts = expectedFreeCadArtifacts(cadRequest, outputDir, true);
  fs.writeFileSync(planPath, renderFreeCadPlan({ request, cadRequest, detection, expectedArtifacts }), { mode: 0o600 });
  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 1, adapterId: "freecad", simulated: true, request: cadRequest, inputArtifacts }, null, 2), { mode: 0o600 });
  fs.writeFileSync(artifactsPath, JSON.stringify({ schemaVersion: 1, adapterId: "freecad", simulated: true, artifacts: expectedArtifacts }, null, 2), { mode: 0o600 });
  const artifacts = [
    artifact("freecad-dry-run-plan", planPath, true, { adapterId: "freecad", mode: "dry-run" }),
    artifact("freecad-expected-input", inputPath, true, { adapterId: "freecad", mode: "dry-run" }),
    artifact("freecad-expected-artifacts", artifactsPath, true, { adapterId: "freecad", mode: "dry-run" }),
  ];
  return {
    ok: true,
    adapterId: adapter.id,
    mode: "dry-run",
    simulated: true,
    summary: detection.installed
      ? "FreeCAD detected; dry-run plan generated without executing FreeCAD."
      : "FreeCADCmd/freecadcmd is not installed; simulated FreeCAD dry-run plan generated.",
    commandPreview: commandPreview.length ? commandPreview : ["FreeCADCmd", "hicode-freecad-control-box.py", "expected-input.json"],
    artifacts,
    diagnostics: [
      ...detection.diagnostics,
      diagnostic("freecad.dimensions.valid", "info", "FreeCAD control box dimensions are valid.", "cad_validation"),
      diagnostic("freecad.dry_run", "info", "Dry-run wrote the plan, expected input, and expected artifacts only.", "documentation_review"),
    ],
    detection,
  };
}

function runFreeCadCommand({ adapter, request, cadRequest, workspace, outputDir, detection, inputArtifacts }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  cadRequest: FreeCadTaskRequest;
  workspace: string;
  outputDir: string;
  detection: ToolDetectionResult;
  inputArtifacts: string[];
}): ToolRunResult {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const executablePath = requiredText(detection.executablePath, "FreeCAD executable");
  const requestPath = path.join(outputDir, "freecad-input.json");
  const scriptPath = path.join(outputDir, "hicode-freecad-control-box.py");
  const logPath = path.join(outputDir, "freecad-run.log");
  const metadataPath = path.join(outputDir, "metadata.json");
  const drawingPlanPath = path.join(outputDir, "drawing-plan.md");
  fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, adapterId: "freecad", simulated: false, request: cadRequest, inputArtifacts }, null, 2), { mode: 0o600 });
  fs.writeFileSync(scriptPath, FREECAD_CONTROL_BOX_SCRIPT, { mode: 0o700 });
  fs.writeFileSync(drawingPlanPath, renderDrawingPlan(cadRequest), { mode: 0o600 });
  const startedAt = Date.now();
  const result = runIndustrialCommand({
    id: "freecad.generate-control-box",
    executable: executablePath,
    args: [scriptPath, requestPath, outputDir],
    cwd: outputDir,
    workspaceRoot: workspace,
    timeoutMs: 120000,
    environment: process.env,
    extraEnvironment: { HICODE_FREECAD_OUTPUT_DIR: outputDir },
    userApproved: request.userApproved === true,
    network: "deny",
  });
  const logText = redactText([
    `$ ${redactPath(executablePath)} ${path.basename(scriptPath)} ${path.basename(requestPath)} ${redactPath(outputDir)}`,
    `exitCode=${result.status ?? "null"} signal=${result.signal || ""}`,
    result.stdout || "",
    result.stderr || "",
    `executionIsolation=${result.executionPolicy.strength}`,
    ...result.executionPolicy.warnings,
  ].join("\n")).slice(0, 100000);
  fs.writeFileSync(logPath, logText, { mode: 0o600 });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      adapterId: adapter.id,
      mode: "execute",
      simulated: false,
      summary: "FreeCAD execution failed.",
      commandPreview: [redactPath(executablePath), redactPath(scriptPath), redactPath(requestPath)],
      artifacts: [
        artifact("freecad-input", requestPath, false, { adapterId: "freecad", mode: "execute" }),
        artifact("freecad-script", scriptPath, false, { adapterId: "freecad", mode: "execute" }),
        artifact("freecad-log", logPath, false, { adapterId: "freecad", mode: "execute" }),
      ],
      diagnostics: [
        ...detection.diagnostics,
        diagnostic("freecad.execution.failed", "error", result.error ? errorMessage(result.error) : `FreeCAD exited with code ${result.status}.`, "cad_validation"),
      ],
      detection,
      executionPolicy: result.executionPolicy,
      error: result.error ? errorMessage(result.error) : `FreeCAD exited with code ${result.status}.`,
    };
  }
  const quality = evaluateFreeCadQuality({ outputDir, metadataPath, cadRequest });
  const outputArtifacts = collectFreeCadArtifacts(outputDir, quality.metadata, [
    requestPath,
    scriptPath,
    logPath,
    metadataPath,
    drawingPlanPath,
  ]);
  const ok = quality.ok;
  return {
    ok,
    adapterId: adapter.id,
    mode: "execute",
    simulated: false,
    summary: ok
      ? `FreeCAD generated a parameterized ${cadRequest.partType} in ${Date.now() - startedAt} ms.`
      : "FreeCAD ran, but quality gates found invalid or missing artifacts.",
    commandPreview: [redactPath(executablePath), redactPath(scriptPath), redactPath(requestPath)],
    artifacts: outputArtifacts,
    diagnostics: [...detection.diagnostics, ...quality.diagnostics],
    detection,
    executionPolicy: result.executionPolicy,
    error: ok ? undefined : quality.diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; "),
  };
}

function parseFreeCadTaskRequest(value: unknown): { ok: true; request: FreeCadTaskRequest } | { ok: false; error: string } {
  try {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const dimsRaw = raw.dimensions && typeof raw.dimensions === "object" && !Array.isArray(raw.dimensions)
      ? raw.dimensions as Record<string, unknown>
      : {};
    const request: FreeCadTaskRequest = {
      partType: normalizePartType(raw.partType),
      dimensions: {
        length: numberOr(dimsRaw.length, DEFAULT_FREECAD_REQUEST.dimensions.length),
        width: numberOr(dimsRaw.width, DEFAULT_FREECAD_REQUEST.dimensions.width),
        height: numberOr(dimsRaw.height, DEFAULT_FREECAD_REQUEST.dimensions.height),
        wallThickness: numberOr(dimsRaw.wallThickness, DEFAULT_FREECAD_REQUEST.dimensions.wallThickness),
        lidThickness: numberOr(dimsRaw.lidThickness, DEFAULT_FREECAD_REQUEST.dimensions.lidThickness),
        mountHoleDiameter: numberOr(dimsRaw.mountHoleDiameter, DEFAULT_FREECAD_REQUEST.dimensions.mountHoleDiameter),
        mountHoleOffset: numberOr(dimsRaw.mountHoleOffset, DEFAULT_FREECAD_REQUEST.dimensions.mountHoleOffset),
      },
      material: cleanText(raw.material) || DEFAULT_FREECAD_REQUEST.material,
      units: normalizeUnits(raw.units),
      constraints: stringArray(raw.constraints).length ? stringArray(raw.constraints) : [...DEFAULT_FREECAD_REQUEST.constraints],
      exportFormats: normalizeExportFormats(raw.exportFormats),
      outputDir: cleanText(raw.outputDir) || undefined,
    };
    validateFreeCadRequest(request);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function validateFreeCadRequest(request: FreeCadTaskRequest): void {
  const { length, width, height, wallThickness, lidThickness, mountHoleDiameter, mountHoleOffset } = request.dimensions;
  for (const [name, value] of Object.entries(request.dimensions)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`FreeCAD dimension ${name} must be a positive number`);
  }
  if (length < 20 || width < 20 || height < 10) throw new Error("FreeCAD enclosure dimensions are too small for a manufacturable control box");
  if (length > 2000 || width > 2000 || height > 1000) throw new Error("FreeCAD enclosure dimensions exceed safe demo limits");
  if (wallThickness * 2 >= Math.min(length, width)) throw new Error("FreeCAD wallThickness must leave an internal cavity");
  if (wallThickness >= height) throw new Error("FreeCAD wallThickness must be smaller than height");
  if (lidThickness >= height / 2) throw new Error("FreeCAD lidThickness must be less than half the enclosure height");
  if (mountHoleDiameter >= Math.min(length, width) / 4) throw new Error("FreeCAD mountHoleDiameter is too large");
  if (mountHoleOffset <= mountHoleDiameter || mountHoleOffset >= Math.min(length, width) / 2) {
    throw new Error("FreeCAD mountHoleOffset must place holes inside the enclosure footprint");
  }
  if (request.units !== "mm") throw new Error("FreeCAD adapter currently supports millimeter units only");
  if (!request.exportFormats.includes("FCStd")) request.exportFormats.unshift("FCStd");
}

function normalizePartType(value: unknown): FreeCadPartType {
  const text = cleanText(value);
  if (!text || text === "control_box_enclosure" || text === "enclosure") return "control_box_enclosure";
  throw new Error("FreeCAD partType must be control_box_enclosure");
}

function normalizeUnits(value: unknown): FreeCadUnits {
  const text = cleanText(value).toLowerCase();
  if (!text || text === "mm" || text === "millimeter" || text === "millimeters") return "mm";
  throw new Error("FreeCAD units must be mm");
}

function normalizeExportFormats(value: unknown): FreeCadExportFormat[] {
  const formats = stringArray(value).map((item) => item.toUpperCase()).filter((item) => ["FCSTD", "STEP", "STL"].includes(item));
  const normalized = formats.map((item) => item === "FCSTD" ? "FCStd" : item as FreeCadExportFormat);
  return unique(["FCStd", ...normalized]);
}

function safeFreeCadOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "freecad", `${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base);
  assertInsideArtifactRoot(artifactRoot, base);
  return base;
}

function expectedFreeCadArtifacts(request: FreeCadTaskRequest, outputDir: string, simulated: boolean): Array<Record<string, unknown>> {
  const items = [
    { type: "cad_model", format: "FCStd", name: "control-box-enclosure.FCStd", path: path.join(outputDir, "control-box-enclosure.FCStd"), required: true },
    { type: "inspection_report", format: "json", name: "metadata.json", path: path.join(outputDir, "metadata.json"), required: true },
    { type: "drawing", format: "md", name: "drawing-plan.md", path: path.join(outputDir, "drawing-plan.md"), required: false },
  ];
  if (request.exportFormats.includes("STEP")) items.push({ type: "step_file", format: "STEP", name: "control-box-enclosure.step", path: path.join(outputDir, "control-box-enclosure.step"), required: false });
  if (request.exportFormats.includes("STL")) items.push({ type: "stl_file", format: "STL", name: "control-box-enclosure.stl", path: path.join(outputDir, "control-box-enclosure.stl"), required: false });
  return items.map((item) => ({ ...item, simulated }));
}

function evaluateFreeCadQuality({ outputDir, metadataPath, cadRequest }: { outputDir: string; metadataPath: string; cadRequest: FreeCadTaskRequest }): QualityResult {
  const diagnostics: ToolDiagnostic[] = [diagnostic("freecad.dimensions.valid", "info", "FreeCAD dimensions passed validation.", "cad_validation")];
  let metadata: Record<string, unknown> | undefined;
  if (!fs.existsSync(metadataPath)) {
    diagnostics.push(diagnostic("freecad.metadata.missing", "error", "metadata.json was not generated.", "cad_validation"));
    return { ok: false, diagnostics };
  }
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
  } catch {
    diagnostics.push(diagnostic("freecad.metadata.invalid", "error", "metadata.json is not valid JSON.", "cad_validation"));
    return { ok: false, diagnostics };
  }
  for (const field of ["adapterId", "partType", "dimensions", "material", "units", "artifacts", "generatedAt"]) {
    if (metadata[field] === undefined) diagnostics.push(diagnostic(`freecad.metadata.${field}.missing`, "error", `metadata.json is missing ${field}.`, "cad_validation"));
  }
  const requiredFcstd = path.join(outputDir, "control-box-enclosure.FCStd");
  if (!nonEmptyFile(requiredFcstd)) {
    diagnostics.push(diagnostic("freecad.fcstd.missing", "error", "control-box-enclosure.FCStd is missing or empty.", "cad_validation"));
  }
  for (const format of cadRequest.exportFormats) {
    if (format === "FCStd") continue;
    const file = path.join(outputDir, `control-box-enclosure.${format === "STEP" ? "step" : "stl"}`);
    if (fs.existsSync(file) && !nonEmptyFile(file)) {
      diagnostics.push(diagnostic(`freecad.${format.toLowerCase()}.empty`, "error", `${path.basename(file)} exists but is empty.`, "cad_validation"));
    } else if (!fs.existsSync(file)) {
      diagnostics.push(diagnostic(`freecad.${format.toLowerCase()}.skipped`, "warning", `${format} export was requested but not produced by this FreeCAD environment.`, "cad_validation"));
    }
  }
  if (!nonEmptyFile(path.join(outputDir, "drawing-plan.md"))) {
    diagnostics.push(diagnostic("freecad.drawing_plan.missing", "warning", "drawing-plan.md is missing.", "documentation_review"));
  }
  const ok = diagnostics.every((item) => item.severity !== "error");
  if (ok) diagnostics.push(diagnostic("freecad.quality.passed", "info", "FreeCAD artifact quality gates passed.", "cad_validation"));
  return { ok, diagnostics, metadata };
}

function collectFreeCadArtifacts(outputDir: string, metadata: Record<string, unknown> | undefined, paths: string[]): ToolArtifact[] {
  const files = unique([
    ...paths,
    path.join(outputDir, "control-box-enclosure.FCStd"),
    path.join(outputDir, "control-box-enclosure.step"),
    path.join(outputDir, "control-box-enclosure.stl"),
  ]).filter((item) => fs.existsSync(item));
  return files.map((file) => artifact(typeForFreeCadFile(file), file, false, {
    adapterId: "freecad",
    mode: "execute",
    size: fs.statSync(file).size,
    sha256: fileHash(file),
    freecadMetadata: metadata ? { partType: metadata.partType, units: metadata.units, material: metadata.material } : undefined,
  }));
}

function renderFreeCadPlan({ request, cadRequest, detection, expectedArtifacts }: {
  request: ToolRunRequest;
  cadRequest: FreeCadTaskRequest;
  detection: ToolDetectionResult;
  expectedArtifacts: Array<Record<string, unknown>>;
}): string {
  return [
    "# FreeCAD Run Plan",
    "",
    `Task: ${request.task}`,
    `Installed: ${detection.installed ? "true" : "false"}`,
    `Reason: ${detection.reason}`,
    `Part type: ${cadRequest.partType}`,
    `Units: ${cadRequest.units}`,
    `Material: ${cadRequest.material}`,
    "",
    "## Dimensions",
    "",
    ...Object.entries(cadRequest.dimensions).map(([key, value]) => `- ${key}: ${value} ${cadRequest.units}`),
    "",
    "## Export Formats",
    "",
    ...cadRequest.exportFormats.map((item) => `- ${item}`),
    "",
    "## Expected Artifacts",
    "",
    ...expectedArtifacts.map((item) => `- ${item.name}: ${item.type} (${item.required ? "required" : "optional"})`),
    "",
    "This is a simulated dry-run. No FreeCAD process was started.",
    "",
  ].join("\n");
}

function renderDrawingPlan(request: FreeCadTaskRequest): string {
  return [
    "# Drawing Plan",
    "",
    `Part: ${request.partType}`,
    `Material: ${request.material}`,
    `Units: ${request.units}`,
    "",
    "Recommended drawing views:",
    "- Top view with mounting-hole dimensions",
    "- Front view with enclosure height and wall thickness",
    "- Section view showing internal cavity",
    "- Lid detail with thickness callout",
    "",
  ].join("\n");
}

function blockedFreeCadRun({ adapter, mode, detection, message, code }: { adapter: IndustrialToolAdapter; mode: "dry-run" | "execute"; detection: ToolDetectionResult; message: string; code: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [diagnostic(code, "error", message, "cad_validation")],
    detection,
    error: message,
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

function typeForFreeCadFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".fcstd")) return "cad_model";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step_file";
  if (lower.endsWith(".stl")) return "stl_file";
  if (lower.endsWith("metadata.json")) return "inspection_report";
  if (lower.endsWith(".md")) return "drawing";
  if (lower.endsWith(".log")) return "tool_log";
  if (lower.endsWith(".py")) return "tool_script";
  return "tool_artifact";
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string): ToolDiagnostic {
  return {
    id: `diag-freecad-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
    severity,
    code,
    message,
    gate,
  };
}

function assertInside(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("FreeCAD output path escapes workspace");
}

function assertInsideArtifactRoot(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("FreeCAD output path must stay under .hicode/artifacts");
}

function nonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(value: unknown, field: string): string {
  const text = cleanText(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "FreeCAD adapter error");
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

const FREECAD_CONTROL_BOX_SCRIPT = String.raw`import json
import os
import sys
import time
import traceback

def artifact_info(path, artifact_type, fmt):
    return {
        "type": artifact_type,
        "format": fmt,
        "name": os.path.basename(path),
        "path": path,
        "size": os.path.getsize(path) if os.path.exists(path) else 0,
    }

def main():
    request_path = sys.argv[1]
    output_dir = sys.argv[2]
    with open(request_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    request = payload["request"]
    dims = request["dimensions"]
    export_formats = request.get("exportFormats", ["FCStd"])

    import FreeCAD as App
    import Part
    try:
        import Mesh
    except Exception:
        Mesh = None

    length = float(dims["length"])
    width = float(dims["width"])
    height = float(dims["height"])
    wall = float(dims["wallThickness"])
    lid_thickness = float(dims["lidThickness"])
    hole_diameter = float(dims["mountHoleDiameter"])
    hole_offset = float(dims["mountHoleOffset"])

    doc = App.newDocument("HiCodeControlBox")
    outer = Part.makeBox(length, width, height)
    inner = Part.makeBox(length - 2 * wall, width - 2 * wall, max(height - wall, wall))
    inner.translate(App.Vector(wall, wall, wall))
    shell = outer.cut(inner)

    hole_radius = hole_diameter / 2.0
    for x in (hole_offset, length - hole_offset):
        for y in (hole_offset, width - hole_offset):
            hole = Part.makeCylinder(hole_radius, wall + 2.0, App.Vector(x, y, -1.0), App.Vector(0, 0, 1))
            shell = shell.cut(hole)

    lid = Part.makeBox(length, width, lid_thickness)
    lid.translate(App.Vector(0, 0, height + 2.0))

    shell_obj = doc.addObject("Part::Feature", "ControlBoxShell")
    shell_obj.Shape = shell
    lid_obj = doc.addObject("Part::Feature", "ControlBoxLid")
    lid_obj.Shape = lid
    doc.recompute()

    artifacts = []
    export_errors = []
    fcstd_path = os.path.join(output_dir, "control-box-enclosure.FCStd")
    doc.saveAs(fcstd_path)
    artifacts.append(artifact_info(fcstd_path, "cad_model", "FCStd"))

    if "STEP" in export_formats:
        step_path = os.path.join(output_dir, "control-box-enclosure.step")
        try:
            Part.export([shell_obj, lid_obj], step_path)
            artifacts.append(artifact_info(step_path, "step_file", "STEP"))
        except Exception as exc:
            export_errors.append({"format": "STEP", "error": str(exc)})

    if "STL" in export_formats:
        stl_path = os.path.join(output_dir, "control-box-enclosure.stl")
        try:
            if Mesh is None:
                raise RuntimeError("FreeCAD Mesh module is unavailable")
            Mesh.export([shell_obj, lid_obj], stl_path)
            artifacts.append(artifact_info(stl_path, "stl_file", "STL"))
        except Exception as exc:
            export_errors.append({"format": "STL", "error": str(exc)})

    metadata = {
        "schemaVersion": 1,
        "adapterId": "freecad",
        "simulated": False,
        "partType": request["partType"],
        "dimensions": dims,
        "material": request.get("material", ""),
        "units": request.get("units", "mm"),
        "constraints": request.get("constraints", []),
        "exportFormats": export_formats,
        "artifacts": artifacts,
        "exportErrors": export_errors,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(os.path.join(output_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    print(json.dumps({"ok": True, "artifacts": artifacts, "exportErrors": export_errors}))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
`;
