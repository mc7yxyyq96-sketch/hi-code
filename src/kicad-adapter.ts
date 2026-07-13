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

export type KiCadBomFormat = "csv" | "xml" | "json" | "none";

export interface KiCadTaskRequest {
  projectPath?: string;
  schematicPath?: string;
  boardPath?: string;
  outputDir?: string;
  exportGerber: boolean;
  exportDrill: boolean;
  runErc: boolean;
  runDrc: boolean;
  bomFormat: KiCadBomFormat;
}

interface KiCadRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface ResolvedKiCadRequest {
  request: KiCadTaskRequest;
  projectFile?: string;
  schematicFile?: string;
  boardFile?: string;
  outputDir: string;
  projectExists: boolean;
  schematicExists: boolean;
  boardExists: boolean;
}

interface KiCadCommandResult {
  id: string;
  label: string;
  command: string[];
  status: "passed" | "failed" | "skipped";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string | null;
  outputPath?: string;
  executionPolicy?: ManagedExecutionPolicyResult;
}

const DEFAULT_KICAD_REQUEST: KiCadTaskRequest = {
  projectPath: ".",
  schematicPath: undefined,
  boardPath: undefined,
  outputDir: ".hicode/artifacts/kicad/dry-run",
  exportGerber: true,
  exportDrill: true,
  runErc: true,
  runDrc: true,
  bomFormat: "csv",
};

const KICAD_COMMON_PATHS = [
  "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
  "/Applications/KiCad/kicad-cli",
  "/opt/homebrew/bin/kicad-cli",
  "/usr/local/bin/kicad-cli",
  "/usr/bin/kicad-cli",
  "$KICAD_CLI_PATH",
  "$KICAD_HOME/bin/kicad-cli",
  "C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
  "C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe",
];

export function kiCadAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "kicad",
    name: "KiCad",
    vendor: "KiCad",
    kind: "open-source",
    domains: ["pcb", "electrical"],
    homepage: "https://www.kicad.org/",
    detection: {
      commands: ["kicad-cli"],
      versionCommand: { command: "kicad-cli", args: ["--version"], pattern: "([0-9]+(?:\\.[0-9]+)+[^\\s]*)" },
      executablePaths: KICAD_COMMON_PATHS,
      envVars: ["KICAD_CLI_PATH"],
      configPaths: ["~/Library/Preferences/kicad", "~/.config/kicad"],
      setupHint: "Install KiCad 7+ and make kicad-cli available on PATH, or provide a manual executable path.",
    },
    capabilities: [
      kiCadCapability("project_inspection", "Project inspection", ["pcb_project", "inspection_report"], false),
      kiCadCapability("schematic_check", "Schematic ERC", ["schematic", "inspection_report"], true),
      kiCadCapability("pcb_drc", "PCB DRC", ["layout", "inspection_report"], true),
      kiCadCapability("gerber_export", "Gerber export", ["gerber"], true),
      kiCadCapability("drill_export", "Drill export", ["gerber"], true),
      kiCadCapability("bom_export_plan", "BOM export plan", ["bom"], false),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6C supports local kicad-cli detection, dry-run planning, and real ERC/DRC/Gerber/Drill/BOM command attempts when installed.",
  };
}

export function runKiCadAdapterTask(input: KiCadRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const mode = request.mode || "dry-run";
  const parsed = parseKiCadTaskRequest(request.pcbRequest || request.cadRequest);
  if (!parsed.ok) {
    return blockedKiCadRun({ adapter, mode, detection, message: parsed.error, code: "kicad.invalid_request" });
  }
  let resolved: ResolvedKiCadRequest;
  try {
    resolved = resolveKiCadRequest({ workspace, request: parsed.request, artifactDir: request.artifactDir, mode });
  } catch (error) {
    return blockedKiCadRun({ adapter, mode, detection, message: errorMessage(error), code: "kicad.path_rejected" });
  }
  if (mode === "dry-run") {
    return writeKiCadDryRun({ adapter, request, resolved, detection, commandPreview, inputArtifacts });
  }
  if (!detection.installed || !detection.executablePath) {
    return blockedKiCadRun({ adapter, mode, detection, message: "kicad-cli is not installed; only dry-run is allowed.", code: "kicad.not_installed" });
  }
  if (request.userApproved !== true) {
    return blockedKiCadRun({ adapter, mode, detection, message: "KiCad execution requires explicit user approval", code: "kicad.approval_required" });
  }
  if (request.allowNetwork === true) {
    return blockedKiCadRun({ adapter, mode, detection, message: "KiCad adapter does not need network access and blocks it by default", code: "kicad.network_blocked" });
  }
  return runKiCadCli({ adapter, resolved, detection, executablePath: detection.executablePath, inputArtifacts, workspace, userApproved: request.userApproved === true });
}

function kiCadCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} through the KiCad adapter.`,
    domains: ["pcb", "electrical"],
    artifactTypes,
    qualityGates: ["pcb_erc", "pcb_drc", "documentation_review"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function writeKiCadDryRun({ adapter, request, resolved, detection, commandPreview, inputArtifacts }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  resolved: ResolvedKiCadRequest;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}): ToolRunResult {
  fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
  const planPath = path.join(resolved.outputDir, "kicad-run-plan.md");
  const inputPath = path.join(resolved.outputDir, "expected-input.json");
  const artifactsPath = path.join(resolved.outputDir, "expected-artifacts.json");
  const previewPath = path.join(resolved.outputDir, "command-preview.sh");
  const commands = buildKiCadCommands({ executablePath: detection.executablePath || "kicad-cli", resolved, dryRun: true });
  fs.writeFileSync(planPath, renderKiCadPlan({ request, resolved, detection, commands }), { mode: 0o600 });
  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 1, adapterId: "kicad", simulated: true, request: resolved.request, inputArtifacts }, null, 2), { mode: 0o600 });
  fs.writeFileSync(artifactsPath, JSON.stringify({ schemaVersion: 1, adapterId: "kicad", simulated: true, artifacts: expectedKiCadArtifacts(resolved, true) }, null, 2), { mode: 0o600 });
  fs.writeFileSync(previewPath, renderCommandPreview(commands), { mode: 0o700 });
  return {
    ok: true,
    adapterId: adapter.id,
    mode: "dry-run",
    simulated: true,
    summary: detection.installed
      ? "KiCad detected; dry-run plan generated without executing kicad-cli."
      : "kicad-cli is not installed; simulated KiCad dry-run plan generated.",
    commandPreview: commandPreview.length ? commandPreview : commands.map((command) => command.join(" ")),
    artifacts: [
      artifact("kicad-dry-run-plan", planPath, true, { adapterId: "kicad", mode: "dry-run" }),
      artifact("kicad-expected-input", inputPath, true, { adapterId: "kicad", mode: "dry-run" }),
      artifact("kicad-expected-artifacts", artifactsPath, true, { adapterId: "kicad", mode: "dry-run" }),
      artifact("kicad-command-preview", previewPath, true, { adapterId: "kicad", mode: "dry-run" }),
    ],
    diagnostics: [
      ...detection.diagnostics,
      ...projectDiagnostics(resolved, "simulated"),
      diagnostic("kicad.dry_run", "info", "Dry-run wrote KiCad plan, expected input, expected artifacts, and command preview only.", "documentation_review", "simulated"),
    ],
    detection,
  };
}

function runKiCadCli({ adapter, resolved, detection, executablePath, inputArtifacts, workspace, userApproved }: {
  adapter: IndustrialToolAdapter;
  resolved: ResolvedKiCadRequest;
  detection: ToolDetectionResult;
  executablePath: string;
  inputArtifacts: string[];
  workspace: string;
  userApproved: boolean;
}): ToolRunResult {
  fs.mkdirSync(resolved.outputDir, { recursive: true, mode: 0o700 });
  const diagnostics = [...projectDiagnostics(resolved, "execute")];
  const fatal = diagnostics.find((item) => item.severity === "error");
  const metadataPath = path.join(resolved.outputDir, "metadata.json");
  const inputPath = path.join(resolved.outputDir, "kicad-input.json");
  const logPath = path.join(resolved.outputDir, "kicad-cli.log");
  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 1, adapterId: "kicad", simulated: false, request: resolved.request, inputArtifacts }, null, 2), { mode: 0o600 });
  if (fatal) {
    fs.writeFileSync(logPath, fatal.message, { mode: 0o600 });
    const metadata = writeKiCadMetadata({ resolved, metadataPath, commands: [], commandResults: [], diagnostics, inputArtifacts, simulated: false });
    return {
      ok: false,
      adapterId: adapter.id,
      mode: "execute",
      simulated: false,
      summary: "KiCad execution blocked by invalid project inputs.",
      commandPreview: [],
      artifacts: collectKiCadArtifacts(resolved.outputDir, metadata, [inputPath, logPath, metadataPath]),
      diagnostics: [...detection.diagnostics, ...diagnostics],
      detection,
      error: fatal.message,
    };
  }
  const commands = buildKiCadCommands({ executablePath, resolved, dryRun: false });
  const commandResults: KiCadCommandResult[] = commands.map((command) => runKiCadCommand(command, { workspace, cwd: resolved.outputDir, userApproved }));
  const log = commandResults.map((result) => renderCommandResultLog(result)).join("\n\n");
  fs.writeFileSync(logPath, redactText(log).slice(0, 200000), { mode: 0o600 });
  for (const result of commandResults) {
    diagnostics.push(commandDiagnostic(result));
  }
  diagnostics.push(...evaluateKiCadOutputs(resolved, commandResults));
  const metadata = writeKiCadMetadata({ resolved, metadataPath, commands, commandResults, diagnostics, inputArtifacts, simulated: false });
  const ok = diagnostics.every((item) => item.severity !== "error");
  return {
    ok,
    adapterId: adapter.id,
    mode: "execute",
    simulated: false,
    summary: ok ? "KiCad CLI flow completed." : "KiCad CLI flow completed with failed gates.",
    commandPreview: commands.map((command) => command.map(redactPath).join(" ")),
    artifacts: collectKiCadArtifacts(resolved.outputDir, metadata, [inputPath, logPath, metadataPath]),
    diagnostics: [...detection.diagnostics, ...diagnostics],
    detection,
    executionPolicy: commandResults[0]?.executionPolicy,
    error: ok ? undefined : diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; "),
  };
}

function parseKiCadTaskRequest(value: unknown): { ok: true; request: KiCadTaskRequest } | { ok: false; error: string } {
  try {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const request: KiCadTaskRequest = {
      projectPath: cleanText(raw.projectPath) || DEFAULT_KICAD_REQUEST.projectPath,
      schematicPath: cleanText(raw.schematicPath) || undefined,
      boardPath: cleanText(raw.boardPath) || undefined,
      outputDir: cleanText(raw.outputDir) || undefined,
      exportGerber: boolOr(raw.exportGerber, DEFAULT_KICAD_REQUEST.exportGerber),
      exportDrill: boolOr(raw.exportDrill, DEFAULT_KICAD_REQUEST.exportDrill),
      runErc: boolOr(raw.runErc, DEFAULT_KICAD_REQUEST.runErc),
      runDrc: boolOr(raw.runDrc, DEFAULT_KICAD_REQUEST.runDrc),
      bomFormat: normalizeBomFormat(raw.bomFormat),
    };
    return { ok: true, request };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function resolveKiCadRequest({ workspace, request, artifactDir, mode }: { workspace: string; request: KiCadTaskRequest; artifactDir?: string; mode: string }): ResolvedKiCadRequest {
  const outputDir = safeKiCadOutputDir(workspace, artifactDir || request.outputDir, mode);
  const projectCandidate = resolveInside(workspace, request.projectPath || ".");
  const projectFile = resolveProjectFile(projectCandidate);
  const projectBase = projectFile ? path.dirname(projectFile) : (fs.existsSync(projectCandidate) && fs.statSync(projectCandidate).isDirectory() ? projectCandidate : path.dirname(projectCandidate));
  const stem = projectFile ? path.basename(projectFile, ".kicad_pro") : "";
  const schematicFile = request.schematicPath ? resolveInside(workspace, request.schematicPath) : inferExistingPath(projectBase, stem, ".kicad_sch");
  const boardFile = request.boardPath ? resolveInside(workspace, request.boardPath) : inferExistingPath(projectBase, stem, ".kicad_pcb");
  if (schematicFile && path.extname(schematicFile) !== ".kicad_sch") throw new Error("KiCad schematicPath must point to a .kicad_sch file");
  if (boardFile && path.extname(boardFile) !== ".kicad_pcb") throw new Error("KiCad boardPath must point to a .kicad_pcb file");
  return {
    request: { ...request, outputDir },
    projectFile,
    schematicFile,
    boardFile,
    outputDir,
    projectExists: !!(projectFile && fs.existsSync(projectFile)),
    schematicExists: !!(schematicFile && fs.existsSync(schematicFile)),
    boardExists: !!(boardFile && fs.existsSync(boardFile)),
  };
}

function resolveProjectFile(candidate: string): string | undefined {
  if (candidate.endsWith(".kicad_pro")) return candidate;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    const projectFiles = fs.readdirSync(candidate).filter((name) => name.endsWith(".kicad_pro")).sort();
    return projectFiles[0] ? path.join(candidate, projectFiles[0]) : path.join(candidate, "project.kicad_pro");
  }
  return candidate.endsWith(path.sep) ? path.join(candidate, "project.kicad_pro") : `${candidate}.kicad_pro`;
}

function inferExistingPath(projectBase: string, stem: string, ext: ".kicad_sch" | ".kicad_pcb"): string | undefined {
  const primary = stem ? path.join(projectBase, `${stem}${ext}`) : undefined;
  if (primary && fs.existsSync(primary)) return primary;
  if (fs.existsSync(projectBase) && fs.statSync(projectBase).isDirectory()) {
    const matches = fs.readdirSync(projectBase).filter((name) => name.endsWith(ext)).sort();
    if (matches[0]) return path.join(projectBase, matches[0]);
  }
  return primary;
}

function projectDiagnostics(resolved: ResolvedKiCadRequest, mode: "simulated" | "execute"): ToolDiagnostic[] {
  const gateStatus = mode === "simulated" ? "simulated" : undefined;
  const missingSeverity = mode === "simulated" ? "warning" : "error";
  const diagnostics: ToolDiagnostic[] = [];
  diagnostics.push(resolved.projectExists
    ? diagnostic("kicad.project.exists", "info", ".kicad_pro project file exists.", "documentation_review", gateStatus)
    : diagnostic("kicad.project.missing", missingSeverity, ".kicad_pro project file is missing.", "documentation_review", gateStatus));
  if (resolved.request.runErc) {
    diagnostics.push(resolved.schematicExists
      ? diagnostic("kicad.schematic.exists", "info", "Schematic path exists.", "pcb_erc", gateStatus)
      : diagnostic("kicad.schematic.missing", missingSeverity, "Schematic path is missing for ERC.", "pcb_erc", gateStatus));
  }
  if (resolved.request.runDrc || resolved.request.exportGerber || resolved.request.exportDrill) {
    diagnostics.push(resolved.boardExists
      ? diagnostic("kicad.board.exists", "info", "Board path exists.", "pcb_drc", gateStatus)
      : diagnostic("kicad.board.missing", missingSeverity, "Board path is missing for DRC/Gerber/Drill.", "pcb_drc", gateStatus));
  }
  return diagnostics;
}

function buildKiCadCommands({ executablePath, resolved, dryRun }: { executablePath: string; resolved: ResolvedKiCadRequest; dryRun: boolean }): string[][] {
  const exe = executablePath || "kicad-cli";
  const commands: string[][] = [];
  const ercReport = path.join(resolved.outputDir, "erc-report.json");
  const drcReport = path.join(resolved.outputDir, "drc-report.json");
  const gerberDir = path.join(resolved.outputDir, "gerber");
  const drillDir = path.join(resolved.outputDir, "drill");
  const bomPath = path.join(resolved.outputDir, `bom.${resolved.request.bomFormat === "none" ? "csv" : resolved.request.bomFormat}`);
  if (resolved.request.runErc && resolved.schematicFile) commands.push([exe, "sch", "erc", "--format", "json", "--output", ercReport, resolved.schematicFile]);
  if (resolved.request.runDrc && resolved.boardFile) commands.push([exe, "pcb", "drc", "--format", "json", "--output", drcReport, resolved.boardFile]);
  if (resolved.request.exportGerber && resolved.boardFile) commands.push([exe, "pcb", "export", "gerbers", "--output", gerberDir, resolved.boardFile]);
  if (resolved.request.exportDrill && resolved.boardFile) commands.push([exe, "pcb", "export", "drill", "--output", drillDir, resolved.boardFile]);
  if (resolved.request.bomFormat !== "none" && resolved.schematicFile) commands.push([exe, "sch", "export", "bom", "--output", bomPath, resolved.schematicFile]);
  if (dryRun && !commands.length) commands.push([exe, "version"]);
  return commands;
}

function runKiCadCommand(command: string[], context: { workspace: string; cwd: string; userApproved: boolean }): KiCadCommandResult {
  const id = command.slice(1, 4).join(".");
  const outputIndex = command.indexOf("--output");
  const outputPath = outputIndex >= 0 ? command[outputIndex + 1] : undefined;
  const result = runIndustrialCommand({
    id: `kicad.${id || "command"}`,
    executable: command[0],
    args: command.slice(1),
    cwd: context.cwd,
    workspaceRoot: context.workspace,
    timeoutMs: 120000,
    environment: kiCadProcessEnv(),
    userApproved: context.userApproved,
    network: "deny",
  });
  return {
    id,
    label: command.slice(1, 4).join(" "),
    command,
    status: result.status === 0 ? "passed" : "failed",
    stdout: redactText(result.stdout || ""),
    stderr: redactText(result.stderr || result.error?.message || ""),
    exitCode: result.status,
    signal: result.signal,
    outputPath,
    executionPolicy: result.executionPolicy,
  };
}

function commandDiagnostic(result: KiCadCommandResult): ToolDiagnostic {
  const gate = result.id.startsWith("sch.erc") ? "pcb_erc" : result.id.startsWith("pcb.drc") ? "pcb_drc" : "documentation_review";
  return diagnostic(
    `kicad.command.${result.id}.${result.status}`,
    result.status === "passed" ? "info" : "error",
    result.status === "passed" ? `${result.label} completed.` : `${result.label} failed with exit code ${result.exitCode}.`,
    gate,
  );
}

function evaluateKiCadOutputs(resolved: ResolvedKiCadRequest, commandResults: KiCadCommandResult[]): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  const metadataRequired = commandResults.length > 0;
  if (metadataRequired) diagnostics.push(diagnostic("kicad.metadata.pending", "info", "metadata.json will be written after command execution.", "documentation_review"));
  if (resolved.request.exportGerber) {
    const gerberDir = path.join(resolved.outputDir, "gerber");
    diagnostics.push(directoryHasFiles(gerberDir)
      ? diagnostic("kicad.gerber.exists", "info", "Gerber export directory contains files.", "documentation_review")
      : diagnostic("kicad.gerber.missing", "error", "Gerber export was requested but no files were produced.", "documentation_review"));
  }
  if (resolved.request.exportDrill) {
    const drillDir = path.join(resolved.outputDir, "drill");
    diagnostics.push(directoryHasFiles(drillDir)
      ? diagnostic("kicad.drill.exists", "info", "Drill export directory contains files.", "documentation_review")
      : diagnostic("kicad.drill.missing", "error", "Drill export was requested but no files were produced.", "documentation_review"));
  }
  if (resolved.request.bomFormat !== "none") {
    const bomPath = path.join(resolved.outputDir, `bom.${resolved.request.bomFormat}`);
    if (fs.existsSync(bomPath) && fs.statSync(bomPath).size > 0) {
      diagnostics.push(diagnostic("kicad.bom.exists", "info", "BOM export exists.", "documentation_review"));
    } else {
      diagnostics.push(diagnostic("kicad.bom.not_generated", "warning", "BOM export was requested but not generated by this KiCad CLI environment.", "documentation_review"));
    }
  }
  return diagnostics;
}

function writeKiCadMetadata({ resolved, metadataPath, commands, commandResults, diagnostics, inputArtifacts, simulated }: {
  resolved: ResolvedKiCadRequest;
  metadataPath: string;
  commands: string[][];
  commandResults: KiCadCommandResult[];
  diagnostics: ToolDiagnostic[];
  inputArtifacts: string[];
  simulated: boolean;
}): Record<string, unknown> {
  const metadata = {
    schemaVersion: 1,
    adapterId: "kicad",
    simulated,
    projectFile: resolved.projectFile,
    schematicFile: resolved.schematicFile,
    boardFile: resolved.boardFile,
    request: resolved.request,
    commands: commands.map((command) => command.map(redactPath)),
    commandResults: commandResults.map((result) => ({
      id: result.id,
      label: result.label,
      status: result.status,
      exitCode: result.exitCode,
      outputPath: result.outputPath,
      executionPolicy: result.executionPolicy,
    })),
    diagnostics,
    inputArtifacts,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  return metadata;
}

function expectedKiCadArtifacts(resolved: ResolvedKiCadRequest, simulated: boolean): Array<Record<string, unknown>> {
  const artifacts = [
    { type: "inspection_report", name: "metadata.json", path: path.join(resolved.outputDir, "metadata.json"), required: true },
    { type: "tool_log", name: "kicad-cli.log", path: path.join(resolved.outputDir, "kicad-cli.log"), required: true },
  ];
  if (resolved.request.runErc) artifacts.push({ type: "inspection_report", name: "erc-report.json", path: path.join(resolved.outputDir, "erc-report.json"), required: false });
  if (resolved.request.runDrc) artifacts.push({ type: "inspection_report", name: "drc-report.json", path: path.join(resolved.outputDir, "drc-report.json"), required: false });
  if (resolved.request.exportGerber) artifacts.push({ type: "gerber", name: "gerber/", path: path.join(resolved.outputDir, "gerber"), required: false });
  if (resolved.request.exportDrill) artifacts.push({ type: "gerber", name: "drill/", path: path.join(resolved.outputDir, "drill"), required: false });
  if (resolved.request.bomFormat !== "none") artifacts.push({ type: "bom", name: `bom.${resolved.request.bomFormat}`, path: path.join(resolved.outputDir, `bom.${resolved.request.bomFormat}`), required: false });
  return artifacts.map((item) => ({ ...item, simulated }));
}

function collectKiCadArtifacts(outputDir: string, metadata: Record<string, unknown>, alwaysInclude: string[]): ToolArtifact[] {
  const files = new Set(alwaysInclude.filter((item) => fs.existsSync(item)));
  for (const name of ["erc-report.json", "drc-report.json", "bom.csv", "bom.xml", "bom.json"]) {
    const file = path.join(outputDir, name);
    if (fs.existsSync(file)) files.add(file);
  }
  for (const dirName of ["gerber", "drill"]) {
    const dir = path.join(outputDir, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const file of listFilesRecursive(dir)) files.add(file);
  }
  return Array.from(files).map((file) => artifact(typeForKiCadFile(file), file, false, {
    adapterId: "kicad",
    mode: "execute",
    size: fs.statSync(file).isFile() ? fs.statSync(file).size : 0,
    sha256: fs.statSync(file).isFile() ? fileHash(file) : undefined,
    kicadMetadata: { projectFile: metadata.projectFile, boardFile: metadata.boardFile, schematicFile: metadata.schematicFile },
  }));
}

function renderKiCadPlan({ request, resolved, detection, commands }: {
  request: ToolRunRequest;
  resolved: ResolvedKiCadRequest;
  detection: ToolDetectionResult;
  commands: string[][];
}): string {
  return [
    "# KiCad Run Plan",
    "",
    `Task: ${request.task}`,
    `Installed: ${detection.installed ? "true" : "false"}`,
    `Reason: ${detection.reason}`,
    `Project: ${resolved.projectFile || "(not found)"}`,
    `Schematic: ${resolved.schematicFile || "(not found)"}`,
    `Board: ${resolved.boardFile || "(not found)"}`,
    `Output: ${resolved.outputDir}`,
    "",
    "## Requested Flow",
    "",
    `- ERC: ${resolved.request.runErc}`,
    `- DRC: ${resolved.request.runDrc}`,
    `- Gerber export: ${resolved.request.exportGerber}`,
    `- Drill export: ${resolved.request.exportDrill}`,
    `- BOM format: ${resolved.request.bomFormat}`,
    "",
    "## Command Preview",
    "",
    ...commands.map((command) => `- ${command.map(shellQuote).join(" ")}`),
    "",
    "This is a simulated dry-run. No kicad-cli process was started.",
    "",
  ].join("\n");
}

function renderCommandPreview(commands: string[][]): string {
  return ["#!/bin/sh", "set -eu", ...commands.map((command) => command.map(shellQuote).join(" "))].join("\n") + "\n";
}

function renderCommandResultLog(result: KiCadCommandResult): string {
  return [
    `$ ${result.command.map(shellQuote).join(" ")}`,
    `status=${result.status} exitCode=${result.exitCode ?? "null"} signal=${result.signal || ""}`,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr,
  ].join("\n");
}

function blockedKiCadRun({ adapter, mode, detection, message, code }: { adapter: IndustrialToolAdapter; mode: "dry-run" | "execute"; detection: ToolDetectionResult; message: string; code: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [diagnostic(code, "error", message, "pcb_drc")],
    detection,
    error: message,
  };
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string, gateStatus?: "simulated"): ToolDiagnostic {
  return {
    id: `diag-kicad-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
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

function typeForKiCadFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".gbr") || lower.endsWith(".gbl") || lower.endsWith(".gtl") || lower.includes(`${path.sep}gerber${path.sep}`)) return "gerber";
  if (lower.endsWith(".drl") || lower.includes(`${path.sep}drill${path.sep}`)) return "gerber";
  if (lower.endsWith("erc-report.json") || lower.endsWith("drc-report.json") || lower.endsWith("metadata.json")) return "inspection_report";
  if (lower.includes("bom.")) return "bom";
  if (lower.endsWith(".log")) return "tool_log";
  return "tool_artifact";
}

function safeKiCadOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "kicad", `${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base, "KiCad output path escapes workspace");
  assertInside(artifactRoot, base, "KiCad output path must stay under .hicode/artifacts");
  return base;
}

function resolveInside(workspace: string, value: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error("KiCad path must be a safe string");
  const resolved = path.resolve(workspace, value);
  assertInside(workspace, resolved, "KiCad path escapes workspace");
  return resolved;
}

function assertInside(root: string, target: string, message: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(message);
}

function directoryHasFiles(dir: string): boolean {
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() && listFilesRecursive(dir).some((file) => fs.statSync(file).isFile() && fs.statSync(file).size > 0);
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeBomFormat(value: unknown): KiCadBomFormat {
  const text = cleanText(value).toLowerCase();
  if (!text) return DEFAULT_KICAD_REQUEST.bomFormat;
  if (["csv", "xml", "json", "none"].includes(text)) return text as KiCadBomFormat;
  throw new Error("KiCad bomFormat must be csv, xml, json, or none");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "KiCad adapter error");
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

function kiCadProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const safeKeys = new Set(["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE"]);
  for (const key of safeKeys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("KICAD") || /TOKEN|SECRET|PASSWORD|API[_-]?KEY/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}
