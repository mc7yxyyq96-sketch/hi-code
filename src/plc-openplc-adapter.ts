import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runIndustrialCommand } from "./industrial-execution.js";
import type { ManagedExecutionPolicyResult } from "./execution-runner.js";

import type {
  IndustrialToolAdapter,
  ToolArtifact,
  ToolCapability,
  ToolDetectionResult,
  ToolDiagnostic,
  ToolRunRequest,
  ToolRunResult,
} from "./industrial-tool-adapters.js";

export type PlcDirection = "input" | "output";
export type PlcSignalType = "bool" | "digital" | "analog" | "int" | "real";
export type PlcCompileStatus = "not_run" | "passed" | "failed";

export interface PlcIoPoint {
  tag: string;
  address: string;
  direction: PlcDirection;
  signalType: PlcSignalType;
  description?: string;
  failsafeState?: string;
}

export interface PlcTaskRequest {
  controllerType: string;
  ioPoints: PlcIoPoint[];
  controlLogicDescription: string;
  safetyInterlocks: string[];
  scanCycleRequirement: string;
  outputDir?: string;
  targetRuntime: string;
}

interface PlcRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface ResolvedPlcRequest {
  request: PlcTaskRequest;
  outputDir: string;
}

interface PlcGeneratedFiles {
  programPath: string;
  ioMapPath: string;
  safetyPath: string;
  fatPath: string;
  satPath: string;
  metadataPath: string;
  compilePlanPath?: string;
  commandPreviewPath?: string;
  expectedArtifactsPath?: string;
  compileLogPath?: string;
}

interface PlcCompileResult {
  status: PlcCompileStatus;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  reason?: string;
  executionPolicy?: ManagedExecutionPolicyResult;
}

const DEFAULT_PLC_REQUEST: PlcTaskRequest = {
  controllerType: "openplc-compatible-soft-plc",
  targetRuntime: "openplc",
  scanCycleRequirement: "100ms nominal scan cycle; validate jitter on target hardware before commissioning",
  controlLogicDescription: "Generate a fail-safe Structured Text scaffold only; all outputs remain de-energized until a controls engineer approves final logic.",
  safetyInterlocks: [
    "Emergency stop healthy input must be true before any output can be considered for commissioning.",
    "Manual safety review and lockout/tagout procedure are required before field testing.",
  ],
  ioPoints: [
    {
      tag: "E_STOP_NC",
      address: "%IX0.0",
      direction: "input",
      signalType: "bool",
      description: "Normally closed emergency stop healthy signal",
      failsafeState: "false",
    },
    {
      tag: "RESET_PB",
      address: "%IX0.1",
      direction: "input",
      signalType: "bool",
      description: "Operator reset pushbutton",
      failsafeState: "false",
    },
    {
      tag: "RUN_PERMIT",
      address: "%QX0.0",
      direction: "output",
      signalType: "bool",
      description: "Run permit output; draft forces this off until approved commissioning logic is added",
      failsafeState: "false",
    },
  ],
};

const OPENPLC_COMMON_PATHS = [
  "/usr/local/bin/iec2c",
  "/opt/homebrew/bin/iec2c",
  "/usr/bin/iec2c",
  "/usr/local/bin/openplc",
  "/opt/homebrew/bin/openplc",
  "$IEC2C_PATH",
  "$OPENPLC_HOME/iec2c",
  "$OPENPLC_HOME/openplc",
  "$OPENPLC_HOME/OpenPLC_Editor",
  "C:\\OpenPLC\\iec2c.exe",
  "C:\\OpenPLC\\openplc.exe",
];

export function openPlcAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "openplc",
    name: "OpenPLC / IEC 61131-3",
    vendor: "OpenPLC / MATIEC",
    kind: "open-source",
    domains: ["plc", "automation", "electrical"],
    homepage: "https://openplcproject.com/",
    detection: {
      commands: ["iec2c", "iec2iec", "openplc", "openplc_editor"],
      versionCommand: { command: "iec2c", args: ["--version"], pattern: "([0-9]+(?:\\.[0-9]+)+[^\\s]*)" },
      executablePaths: OPENPLC_COMMON_PATHS,
      envVars: ["IEC2C_PATH", "OPENPLC_HOME", "MATIEC_HOME"],
      configPaths: ["~/.config/openplc", "~/OpenPLC_v3"],
      setupHint: "Install OpenPLC Editor/runtime or MATIEC iec2c, then expose iec2c/openplc on PATH or provide a manual executable path.",
    },
    capabilities: [
      plcCapability("structured_text_generation", "Structured Text generation", ["plc_program"], true),
      plcCapability("io_map_generation", "I/O map generation", ["io_map"], false),
      plcCapability("plc_project_scaffold", "PLC project scaffold", ["plc_program", "io_map"], false),
      plcCapability("syntax_check_plan", "Syntax check plan", ["inspection_report"], true),
      plcCapability("fat_sat_checklist", "FAT/SAT checklist", ["test_plan"], false),
      plcCapability("safety_review_required", "Safety review required", ["inspection_report"], false),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6D generates IEC 61131-3 Structured Text engineering drafts and dry-run compile plans. It never downloads logic to PLC hardware.",
  };
}

export function runOpenPlcAdapterTask(input: PlcRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const requestedMode = request.mode || "dry-run";
  const parsed = parsePlcTaskRequest(request.plcRequest);
  if (!parsed.ok) {
    return blockedPlcRun({ adapter, detection, mode: requestedMode, message: parsed.error, code: "plc.invalid_request" });
  }
  let resolved: ResolvedPlcRequest;
  try {
    resolved = {
      request: parsed.request,
      outputDir: safePlcOutputDir(workspace, request.artifactDir || parsed.request.outputDir, requestedMode),
    };
  } catch (error) {
    return blockedPlcRun({ adapter, detection, mode: requestedMode, message: errorMessage(error), code: "plc.path_rejected" });
  }

  const safeDiagnostics = safetyDiagnostics(resolved, requestedMode === "dry-run" || !detection.installed ? "not_run" : undefined);
  const completenessDiagnostics = ioCompletenessDiagnostics(resolved, requestedMode === "dry-run" || !detection.installed ? "not_run" : undefined);
  const approvalDiagnostic = diagnostic(
    "plc.human_approval.required",
    "warning",
    "PLC draft requires human safety approval before compile, simulation, field test, or device download.",
    "human_approval",
    requestedMode === "dry-run" || !detection.installed ? "not_run" : "warning",
  );

  if (requestedMode === "execute" && detection.installed && request.userApproved !== true) {
    return blockedPlcRun({ adapter, detection, mode: requestedMode, message: "PLC/OpenPLC execution requires explicit user approval", code: "plc.approval_required" });
  }
  if (request.allowNetwork === true) {
    return blockedPlcRun({ adapter, detection, mode: requestedMode, message: "PLC adapter forbids network/device access in Sprint 6D", code: "plc.network_blocked" });
  }

  const compileAllowed = requestedMode === "execute" && detection.installed && request.userApproved === true;
  const compileCommand = compileAllowed ? compilerCommand(detection.executablePath) : null;
  const effectiveMode: "dry-run" | "execute" = compileAllowed ? "execute" : "dry-run";
  if (compileCommand) {
    fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(resolved.outputDir, "plc-program.st"), renderStructuredText(resolved.request), { mode: 0o600 });
  }
  const compileResult = compileCommand
    ? runPlcSyntaxCheck({ executablePath: compileCommand, outputDir: resolved.outputDir, programPath: path.join(resolved.outputDir, "plc-program.st"), workspace, userApproved: request.userApproved === true })
    : {
      status: "not_run" as PlcCompileStatus,
      command: compilePreviewCommand(detection.executablePath || "iec2c", resolved),
      stdout: "",
      stderr: "",
      exitCode: null,
      reason: detection.installed ? "detected tool is not an IEC 61131-3 compiler command" : "OpenPLC/MATIEC compiler is not installed",
    };

  const files = writePlcArtifacts({
    resolved,
    detection,
    commandPreview,
    inputArtifacts,
    compileResult,
    writeCompilePlan: compileResult.status === "not_run" || effectiveMode === "dry-run",
  });

  const compileDiagnostic = compileStatusDiagnostic(compileResult);
  const diagnostics = [
    ...detection.diagnostics,
    ...completenessDiagnostics,
    ...safeDiagnostics,
    approvalDiagnostic,
    compileDiagnostic,
  ];
  const ok = compileResult.status !== "failed";
  return {
    ok,
    adapterId: adapter.id,
    mode: effectiveMode,
    simulated: compileResult.status === "not_run",
    summary: summaryForCompileStatus(compileResult.status, detection.installed),
    commandPreview: compileResult.command.map(redactPath),
    artifacts: artifactList(files, compileResult.status),
    diagnostics,
    detection,
    executionPolicy: compileResult.executionPolicy,
    error: ok ? undefined : compileDiagnostic.message,
  };
}

function plcCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} for OpenPLC / IEC 61131-3 workflows.`,
    domains: ["plc", "automation", "electrical"],
    artifactTypes,
    qualityGates: ["plc_compile", "documentation_review", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function parsePlcTaskRequest(value: unknown): { ok: true; request: PlcTaskRequest } | { ok: false; error: string } {
  try {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const ioPoints = Array.isArray(raw.ioPoints)
      ? raw.ioPoints.map(normalizeIoPoint)
      : DEFAULT_PLC_REQUEST.ioPoints;
    const request: PlcTaskRequest = {
      controllerType: cleanText(raw.controllerType) || DEFAULT_PLC_REQUEST.controllerType,
      targetRuntime: cleanText(raw.targetRuntime) || DEFAULT_PLC_REQUEST.targetRuntime,
      scanCycleRequirement: cleanText(raw.scanCycleRequirement) || DEFAULT_PLC_REQUEST.scanCycleRequirement,
      controlLogicDescription: cleanText(raw.controlLogicDescription) || DEFAULT_PLC_REQUEST.controlLogicDescription,
      safetyInterlocks: stringList(raw.safetyInterlocks, DEFAULT_PLC_REQUEST.safetyInterlocks),
      outputDir: cleanText(raw.outputDir) || undefined,
      ioPoints,
    };
    validateIoPoints(request.ioPoints);
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function normalizeIoPoint(value: unknown): PlcIoPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PLC ioPoints entries must be objects");
  const raw = value as Record<string, unknown>;
  const tag = cleanText(raw.tag);
  const address = cleanText(raw.address).toUpperCase();
  const directionText = cleanText(raw.direction).toLowerCase();
  const signalText = cleanText(raw.signalType).toLowerCase();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(tag)) throw new Error("PLC I/O tag must be a safe IEC identifier");
  if (!/^%[IQ][XWDBL]?[0-9]+(?:\.[0-9]+)?$/.test(address)) throw new Error("PLC I/O address must be a safe %I/%Q address");
  if (directionText !== "input" && directionText !== "output") throw new Error("PLC I/O direction must be input or output");
  const direction = directionText as PlcDirection;
  if (direction === "input" && !address.startsWith("%I")) throw new Error("PLC input point address must start with %I");
  if (direction === "output" && !address.startsWith("%Q")) throw new Error("PLC output point address must start with %Q");
  const signalType = ["bool", "digital", "analog", "int", "real"].includes(signalText) ? signalText as PlcSignalType : "bool";
  return {
    tag,
    address,
    direction,
    signalType,
    description: cleanText(raw.description) || undefined,
    failsafeState: cleanText(raw.failsafeState) || undefined,
  };
}

function validateIoPoints(points: PlcIoPoint[]): void {
  if (!points.length) throw new Error("PLC request requires at least one I/O point");
  const tags = new Set<string>();
  const addresses = new Set<string>();
  for (const point of points) {
    const tagKey = point.tag.toUpperCase();
    const addressKey = point.address.toUpperCase();
    if (tags.has(tagKey)) throw new Error(`duplicate PLC I/O tag: ${point.tag}`);
    if (addresses.has(addressKey)) throw new Error(`duplicate PLC I/O address: ${point.address}`);
    tags.add(tagKey);
    addresses.add(addressKey);
  }
}

function writePlcArtifacts({ resolved, detection, commandPreview, inputArtifacts, compileResult, writeCompilePlan }: {
  resolved: ResolvedPlcRequest;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
  compileResult: PlcCompileResult;
  writeCompilePlan: boolean;
}): PlcGeneratedFiles {
  fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
  const files: PlcGeneratedFiles = {
    programPath: path.join(resolved.outputDir, "plc-program.st"),
    ioMapPath: path.join(resolved.outputDir, "io-map.csv"),
    safetyPath: path.join(resolved.outputDir, "safety-interlocks.md"),
    fatPath: path.join(resolved.outputDir, "fat-checklist.md"),
    satPath: path.join(resolved.outputDir, "sat-checklist.md"),
    metadataPath: path.join(resolved.outputDir, "metadata.json"),
  };
  fs.writeFileSync(files.programPath, renderStructuredText(resolved.request), { mode: 0o600 });
  fs.writeFileSync(files.ioMapPath, renderIoMapCsv(resolved.request.ioPoints), { mode: 0o600 });
  fs.writeFileSync(files.safetyPath, renderSafetyInterlocks(resolved.request), { mode: 0o600 });
  fs.writeFileSync(files.fatPath, renderFatChecklist(resolved.request), { mode: 0o600 });
  fs.writeFileSync(files.satPath, renderSatChecklist(resolved.request), { mode: 0o600 });
  if (compileResult.status !== "not_run") {
    files.compileLogPath = path.join(resolved.outputDir, "plc-compile.log");
    fs.writeFileSync(files.compileLogPath, renderCompileLog(compileResult), { mode: 0o600 });
  }
  if (writeCompilePlan) {
    files.compilePlanPath = path.join(resolved.outputDir, "plc-compile-plan.md");
    files.commandPreviewPath = path.join(resolved.outputDir, "command-preview.sh");
    files.expectedArtifactsPath = path.join(resolved.outputDir, "expected-artifacts.json");
    fs.writeFileSync(files.compilePlanPath, renderCompilePlan({ resolved, detection, compileResult, commandPreview }), { mode: 0o600 });
    fs.writeFileSync(files.commandPreviewPath, renderCommandPreview(compileResult.command), { mode: 0o700 });
    fs.writeFileSync(files.expectedArtifactsPath, JSON.stringify(expectedArtifacts(resolved, compileResult.status), null, 2), { mode: 0o600 });
  }
  fs.writeFileSync(files.metadataPath, JSON.stringify(metadata({ resolved, detection, inputArtifacts, compileResult, files }), null, 2), { mode: 0o600 });
  return files;
}

function renderStructuredText(request: PlcTaskRequest): string {
  const outputPoints = request.ioPoints.filter((point) => point.direction === "output");
  return [
    "(*",
    "  Hi Code PLC Engineering Draft",
    "  Safety notice: this Structured Text draft is not compiled, simulated, or approved for device download.",
    "  Outputs are forced to their fail-safe state until a qualified controls engineer completes logic and approval.",
    "*)",
    "",
    "VAR_GLOBAL",
    ...request.ioPoints.map((point) => `  ${point.tag} AT ${point.address} : ${iecType(point)}; (* ${sanitizeComment(point.description || `${point.direction} ${point.signalType}`)} *)`),
    "END_VAR",
    "",
    "PROGRAM PLC_PRG",
    "VAR",
    "  emergencyStopHealthy : BOOL := FALSE;",
    "  manualApprovalRequired : BOOL := TRUE;",
    "END_VAR",
    "",
    `(* Controller: ${sanitizeComment(request.controllerType)}; Target runtime: ${sanitizeComment(request.targetRuntime)} *)`,
    `(* Scan-cycle requirement: ${sanitizeComment(request.scanCycleRequirement)} *)`,
    `(* Control intent: ${sanitizeComment(request.controlLogicDescription)} *)`,
    "",
    `emergencyStopHealthy := ${emergencyStopExpression(request)};`,
    "manualApprovalRequired := TRUE;",
    ...outputPoints.flatMap((point) => [
      `${point.tag} := ${safeOutputValue(point)};`,
    ]),
    "",
    "IF NOT emergencyStopHealthy THEN",
    ...outputPoints.map((point) => `  ${point.tag} := ${safeOutputValue(point)};`),
    "END_IF;",
    "",
    "IF manualApprovalRequired THEN",
    ...outputPoints.map((point) => `  ${point.tag} := ${safeOutputValue(point)};`),
    "END_IF;",
    "",
    "END_PROGRAM",
    "",
  ].join("\n");
}

function renderIoMapCsv(points: PlcIoPoint[]): string {
  const rows = ["tag,address,direction,signalType,failsafeState,description"];
  for (const point of points) {
    rows.push([
      point.tag,
      point.address,
      point.direction,
      point.signalType,
      point.failsafeState || "",
      point.description || "",
    ].map(csvCell).join(","));
  }
  return rows.join("\n") + "\n";
}

function renderSafetyInterlocks(request: PlcTaskRequest): string {
  return [
    "# PLC Safety Interlocks",
    "",
    "This file is engineering evidence for review. It is not permission to compile, simulate, or download logic to a device.",
    "",
    "## Required Human Approval",
    "",
    "- Controls engineer review",
    "- Safety engineer review",
    "- FAT approval before shop-floor testing",
    "- SAT approval before field operation",
    "",
    "## Interlocks",
    "",
    ...request.safetyInterlocks.map((item) => `- ${item}`),
    "",
    "## Emergency Stop",
    "",
    hasEmergencyStop(request)
      ? "Emergency stop language was detected in the request and must still be verified against wiring and risk assessment."
      : "Emergency stop requirement is missing or unclear. This must be resolved before any compile, simulation, or commissioning activity.",
    "",
  ].join("\n");
}

function renderFatChecklist(request: PlcTaskRequest): string {
  return [
    "# Factory Acceptance Test Checklist",
    "",
    "- Verify I/O map against electrical drawings.",
    "- Verify emergency stop and safety interlock behavior with a safety engineer present.",
    "- Confirm outputs remain de-energized on startup, loss of input, and emergency stop.",
    "- Review Structured Text against approved control narrative.",
    `- Verify scan-cycle requirement: ${request.scanCycleRequirement}.`,
    "- Record compiler/tool version and attach logs.",
    "- Obtain written approval before any SAT or field device activity.",
    "",
  ].join("\n");
}

function renderSatChecklist(request: PlcTaskRequest): string {
  return [
    "# Site Acceptance Test Checklist",
    "",
    "- Confirm lockout/tagout and permit-to-work conditions.",
    "- Verify I/O labels against field devices before energizing outputs.",
    "- Test emergency stop and safety interlocks before normal sequence checks.",
    "- Run only approved commissioning steps with responsible personnel present.",
    "- Record deviations and stop testing on unsafe behavior.",
    `- Confirm target runtime: ${request.targetRuntime}.`,
    "- Capture final approval record before release.",
    "",
  ].join("\n");
}

function renderCompilePlan({ resolved, detection, compileResult, commandPreview }: {
  resolved: ResolvedPlcRequest;
  detection: ToolDetectionResult;
  compileResult: PlcCompileResult;
  commandPreview: string[];
}): string {
  return [
    "# PLC Compile Plan",
    "",
    `Installed: ${detection.installed ? "true" : "false"}`,
    `Reason: ${detection.reason}`,
    `Compile status: ${compileResult.status}`,
    `Compile reason: ${compileResult.reason || "not applicable"}`,
    `Output: ${resolved.outputDir}`,
    "",
    "## Command Preview",
    "",
    `- ${compileResult.command.map(shellQuote).join(" ")}`,
    ...(commandPreview.length ? [`- Registry preview: ${commandPreview.map(shellQuote).join(" ")}`] : []),
    "",
    "## Safety Boundary",
    "",
    "- This plan does not download logic to PLC hardware.",
    "- Human approval is required before compile, simulation, FAT, SAT, or commissioning.",
    "- Missing compiler means `compileStatus` remains `not_run`.",
    "",
  ].join("\n");
}

function renderCommandPreview(command: string[]): string {
  return ["#!/bin/sh", "set -eu", "# Review safety gates before running manually.", command.map(shellQuote).join(" ")].join("\n") + "\n";
}

function expectedArtifacts(resolved: ResolvedPlcRequest, compileStatus: PlcCompileStatus): Record<string, unknown> {
  return {
    schemaVersion: 1,
    adapterId: "openplc",
    compileStatus,
    simulated: true,
    artifacts: [
      { type: "plc_program", name: "plc-program.st", path: path.join(resolved.outputDir, "plc-program.st"), simulated: false },
      { type: "io_map", name: "io-map.csv", path: path.join(resolved.outputDir, "io-map.csv"), simulated: false },
      { type: "inspection_report", name: "safety-interlocks.md", path: path.join(resolved.outputDir, "safety-interlocks.md"), simulated: false },
      { type: "test_plan", name: "fat-checklist.md", path: path.join(resolved.outputDir, "fat-checklist.md"), simulated: false },
      { type: "test_plan", name: "sat-checklist.md", path: path.join(resolved.outputDir, "sat-checklist.md"), simulated: false },
      { type: "inspection_report", name: "metadata.json", path: path.join(resolved.outputDir, "metadata.json"), simulated: false },
      { type: "inspection_report", name: "plc-compile-plan.md", path: path.join(resolved.outputDir, "plc-compile-plan.md"), simulated: true },
    ],
  };
}

function metadata({ resolved, detection, inputArtifacts, compileResult, files }: {
  resolved: ResolvedPlcRequest;
  detection: ToolDetectionResult;
  inputArtifacts: string[];
  compileResult: PlcCompileResult;
  files: PlcGeneratedFiles;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    adapterId: "openplc",
    generatedAt: new Date().toISOString(),
    compileStatus: compileResult.status,
    compileReason: compileResult.reason,
    controllerType: resolved.request.controllerType,
    targetRuntime: resolved.request.targetRuntime,
    scanCycleRequirement: resolved.request.scanCycleRequirement,
    ioPointCount: resolved.request.ioPoints.length,
    safetyInterlocks: resolved.request.safetyInterlocks,
    emergencyStopPresent: hasEmergencyStop(resolved.request),
    humanApprovalRequired: true,
    deviceDownloadPerformed: false,
    detection: {
      installed: detection.installed,
      toolName: detection.toolName,
      version: detection.version,
      executablePath: detection.executablePath ? redactPath(detection.executablePath) : undefined,
    },
    inputArtifacts,
    executionPolicy: compileResult.executionPolicy,
    artifacts: Object.fromEntries(Object.entries(files).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, value])),
  };
}

function runPlcSyntaxCheck({ executablePath, outputDir, programPath, workspace, userApproved }: { executablePath: string; outputDir: string; programPath: string; workspace: string; userApproved: boolean }): PlcCompileResult {
  const command = compilePreviewCommand(executablePath, { outputDir });
  const result = runIndustrialCommand({
    id: "openplc.syntax-check",
    executable: executablePath,
    args: [programPath],
    cwd: outputDir,
    workspaceRoot: workspace,
    timeoutMs: 120000,
    environment: plcProcessEnv(),
    userApproved,
    network: "deny",
  });
  return {
    status: result.status === 0 ? "passed" : "failed",
    command,
    stdout: redactText(result.stdout || ""),
    stderr: redactText(result.stderr || result.error?.message || ""),
    exitCode: result.status,
    signal: result.signal,
    reason: result.status === 0 ? "compiler command exited successfully" : "compiler command failed",
    executionPolicy: result.executionPolicy,
  };
}

function compilerCommand(executablePath: string | undefined): string | null {
  if (!executablePath) return null;
  const base = path.basename(executablePath).toLowerCase();
  return base.includes("iec2c") || base.includes("iec2iec") || base.includes("matiec") ? executablePath : null;
}

function compilePreviewCommand(executablePath: string, resolved: Pick<ResolvedPlcRequest, "outputDir">): string[] {
  return [executablePath || "iec2c", path.join(resolved.outputDir, "plc-program.st")];
}

function safetyDiagnostics(resolved: ResolvedPlcRequest, gateStatus?: ToolDiagnostic["gateStatus"]): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  diagnostics.push(resolved.request.safetyInterlocks.length
    ? diagnostic("plc.safety.interlocks_present", "info", "Safety interlock list is present.", "human_approval", gateStatus)
    : diagnostic("plc.safety.interlocks_missing", "warning", "Safety interlock list is missing.", "human_approval", gateStatus || "warning"));
  diagnostics.push(hasEmergencyStop(resolved.request)
    ? diagnostic("plc.safety.emergency_stop_present", "info", "Emergency stop requirement is present and must be verified by a human.", "human_approval", gateStatus)
    : diagnostic("plc.safety.emergency_stop_missing", "warning", "Emergency stop requirement is missing or unclear; safety gate cannot pass.", "human_approval", gateStatus || "warning"));
  return diagnostics;
}

function ioCompletenessDiagnostics(resolved: ResolvedPlcRequest, gateStatus?: ToolDiagnostic["gateStatus"]): ToolDiagnostic[] {
  const hasInputs = resolved.request.ioPoints.some((point) => point.direction === "input");
  const hasOutputs = resolved.request.ioPoints.some((point) => point.direction === "output");
  const diagnostics = [diagnostic("plc.io.complete", "info", "I/O points passed tag, address, direction, and duplicate checks.", "documentation_review", gateStatus)];
  if (!hasInputs) diagnostics.push(diagnostic("plc.io.no_inputs", "warning", "I/O map has no inputs.", "documentation_review", gateStatus || "warning"));
  if (!hasOutputs) diagnostics.push(diagnostic("plc.io.no_outputs", "warning", "I/O map has no outputs.", "documentation_review", gateStatus || "warning"));
  return diagnostics;
}

function compileStatusDiagnostic(result: PlcCompileResult): ToolDiagnostic {
  if (result.status === "passed") return diagnostic("plc.compile.passed", "info", "IEC 61131-3 compiler command completed successfully.", "plc_compile", "passed");
  if (result.status === "failed") return diagnostic("plc.compile.failed", "error", `IEC 61131-3 compiler command failed: ${result.reason || "unknown error"}`, "plc_compile", "failed");
  return diagnostic("plc.compile.not_run", "warning", `PLC compile was not run: ${result.reason || "compiler unavailable"}`, "plc_compile", "not_run");
}

function artifactList(files: PlcGeneratedFiles, compileStatus: PlcCompileStatus): ToolArtifact[] {
  const items: Array<{ type: string; path?: string; simulated: boolean }> = [
    { type: "plc_program", path: files.programPath, simulated: false },
    { type: "io_map", path: files.ioMapPath, simulated: false },
    { type: "inspection_report", path: files.safetyPath, simulated: false },
    { type: "test_plan", path: files.fatPath, simulated: false },
    { type: "test_plan", path: files.satPath, simulated: false },
    { type: "inspection_report", path: files.metadataPath, simulated: false },
    { type: "tool_log", path: files.compileLogPath, simulated: false },
    { type: "inspection_report", path: files.compilePlanPath, simulated: true },
    { type: "plc-command-preview", path: files.commandPreviewPath, simulated: true },
    { type: "plc-expected-artifacts", path: files.expectedArtifactsPath, simulated: true },
  ];
  return items
    .filter((item): item is { type: string; path: string; simulated: boolean } => !!item.path && fs.existsSync(item.path))
    .map((item) => artifact(item.type, item.path, item.simulated, { adapterId: "openplc", compileStatus }));
}

function blockedPlcRun({ adapter, detection, mode, message, code }: { adapter: IndustrialToolAdapter; detection: ToolDetectionResult; mode: "dry-run" | "execute"; message: string; code: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [diagnostic(code, "error", message, "plc_compile")],
    detection,
    error: message,
  };
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string, gateStatus?: ToolDiagnostic["gateStatus"]): ToolDiagnostic {
  return {
    id: `diag-plc-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
    severity,
    code,
    message,
    gate,
    gateStatus,
  };
}

function artifact(type: string, filePath: string, simulated: boolean, metadataValue: Record<string, unknown>): ToolArtifact {
  return {
    id: `tool-artifact-${hash(`${type}:${filePath}`).slice(0, 12)}`,
    type,
    path: filePath,
    name: path.basename(filePath),
    simulated,
    metadata: metadataValue,
  };
}

function safePlcOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "plc", `openplc-${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base, "PLC output path escapes workspace");
  assertInside(artifactRoot, base, "PLC output path must stay under .hicode/artifacts");
  return base;
}

function assertInside(root: string, target: string, message: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(message);
}

function hasEmergencyStop(request: PlcTaskRequest): boolean {
  const haystack = [
    request.controlLogicDescription,
    ...request.safetyInterlocks,
    ...request.ioPoints.flatMap((point) => [point.tag, point.description || ""]),
  ].join(" ").toLowerCase();
  return /emergency|e[-_ ]?stop|estop|e_stop|急停/.test(haystack);
}

function emergencyStopExpression(request: PlcTaskRequest): string {
  const point = request.ioPoints.find((item) => /emergency|e[-_ ]?stop|estop|e_stop/i.test([item.tag, item.description || ""].join(" ")) && item.direction === "input");
  return point ? point.tag : "FALSE";
}

function safeOutputValue(point: PlcIoPoint): string {
  if (point.signalType === "real" || point.signalType === "analog") return "0.0";
  if (point.signalType === "int") return "0";
  return "FALSE";
}

function iecType(point: PlcIoPoint): string {
  if (point.signalType === "real" || point.signalType === "analog") return "REAL";
  if (point.signalType === "int") return "INT";
  return "BOOL";
}

function renderCompileLog(result: PlcCompileResult): string {
  return [
    `$ ${result.command.map(shellQuote).join(" ")}`,
    `status=${result.status} exitCode=${result.exitCode ?? "null"} signal=${result.signal || ""}`,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr,
  ].join("\n");
}

function summaryForCompileStatus(status: PlcCompileStatus, installed: boolean): string {
  if (status === "passed") return "PLC engineering draft generated and IEC syntax check completed.";
  if (status === "failed") return "PLC engineering draft generated, but IEC syntax check failed.";
  return installed
    ? "PLC engineering draft generated; compile was not run because no IEC compiler command was available for this detected tool."
    : "OpenPLC/MATIEC compiler is not installed; PLC engineering draft and dry-run compile plan generated.";
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value.map(cleanText).filter(Boolean);
  return out;
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/[\0]/.test(text)) throw new Error("PLC text fields must not contain control characters");
  if (text.length > 2000) throw new Error("PLC text field is too long");
  return text;
}

function sanitizeComment(value: string): string {
  return value.replace(/\*\)/g, "* /").replace(/\r?\n/g, " ").slice(0, 500);
}

function csvCell(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:%=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "PLC adapter error");
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

function plcProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const safeKeys = new Set(["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE"]);
  for (const key of safeKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(OPENPLC|IEC|MATIEC)/.test(key) || /TOKEN|SECRET|PASSWORD|API[_-]?KEY/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}
