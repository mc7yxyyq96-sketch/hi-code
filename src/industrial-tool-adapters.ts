import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { runIndustrialCommand } from "./industrial-execution.js";

import {
  INDUSTRIAL_ARTIFACT_TYPES,
  INDUSTRIAL_DOMAIN_KEYS,
  INDUSTRIAL_GATE_TYPES,
  type IndustrialArtifactType,
  type IndustrialDomainKey,
  type IndustrialGateType,
} from "./industrial-project.js";
import { freeCadAdapterManifest, runFreeCadAdapterTask } from "./freecad-adapter.js";
import { kiCadAdapterManifest, runKiCadAdapterTask } from "./kicad-adapter.js";
import { openPlcAdapterManifest, runOpenPlcAdapterTask } from "./plc-openplc-adapter.js";
import { bimIfcAdapterManifest, detectBimIfcAdapter, runBimIfcAdapterTask } from "./bim-ifc-adapter.js";
import { solidWorksBridgeAdapterManifest, detectSolidWorksBridgeAdapter, runSolidWorksBridgeAdapterTask } from "./solidworks-bridge-adapter.js";
import { avevaBridgeAdapterManifest, detectAvevaBridgeAdapter, runAvevaBridgeAdapterTask } from "./aveva-bridge-adapter.js";

export const INDUSTRIAL_TOOL_ADAPTER_SCHEMA_VERSION = 1;

export interface ToolCapability {
  id: string;
  name: string;
  description: string;
  domains: IndustrialDomainKey[];
  artifactTypes: IndustrialArtifactType[];
  qualityGates: IndustrialGateType[];
  dryRunSupported: boolean;
  requiresInstalledTool: boolean;
}

export interface ToolVersionInfo {
  version?: string;
  command?: string;
  output?: string;
  executionPolicy?: import("./execution-runner.js").ManagedExecutionPolicyResult;
}

export interface ToolDiagnostic {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  code?: string;
  gate?: IndustrialGateType | string;
  gateStatus?: "passed" | "failed" | "warning" | "skipped" | "simulated" | "not_run";
}

export interface ToolDetectionResult {
  adapterId: string;
  toolName: string;
  installed: boolean;
  reason: string;
  setupHint: string;
  executablePath?: string;
  version?: ToolVersionInfo;
  evidence: {
    commands: Array<{ command: string; found: boolean; path?: string }>;
    executablePaths: Array<{ path: string; found: boolean }>;
    environment: Array<{ name: string; set: boolean; path?: string; exists?: boolean; executable?: boolean }>;
    configPaths: Array<{ path: string; found: boolean }>;
  };
  diagnostics: ToolDiagnostic[];
  detectedAt: number;
}

export interface ToolArtifact {
  id: string;
  type: string;
  path: string;
  name: string;
  simulated: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolRunRequest {
  adapterId: string;
  task: string;
  mode?: "dry-run" | "execute";
  workspacePath: string;
  artifactDir?: string;
  inputArtifacts?: string[];
  args?: string[];
  executablePath?: string;
  cadRequest?: unknown;
  pcbRequest?: unknown;
  plcRequest?: unknown;
  bimRequest?: unknown;
  solidworksRequest?: unknown;
  avevaRequest?: unknown;
  userApproved?: boolean;
  allowNetwork?: boolean;
  actor?: string;
}

export interface ToolRunResult {
  ok: boolean;
  adapterId: string;
  mode: "dry-run" | "execute";
  simulated: boolean;
  summary: string;
  commandPreview: string[];
  artifacts: ToolArtifact[];
  diagnostics: ToolDiagnostic[];
  detection: ToolDetectionResult;
  executionPolicy?: import("./execution-runner.js").ManagedExecutionPolicyResult;
  error?: string;
}

export interface ToolDetectionConfig {
  commands?: string[];
  versionCommand?: { command: string; args?: string[]; pattern?: string };
  executablePaths?: string[];
  envVars?: string[];
  configPaths?: string[];
  setupHint: string;
}

export interface ToolDetectionOptions {
  executablePath?: string;
}

export interface IndustrialToolAdapter {
  id: string;
  name: string;
  vendor: string;
  kind: "open-source" | "commercial" | "standard" | "runtime";
  domains: IndustrialDomainKey[];
  homepage?: string;
  detection: ToolDetectionConfig;
  capabilities: ToolCapability[];
  networkAccess: "forbidden-by-default" | "requires-explicit-approval";
  notes?: string;
}

export interface AdapterRegistryOptions {
  adapters?: IndustrialToolAdapter[];
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
}

export class IndustrialToolAdapterRegistry {
  private readonly adapters = new Map<string, IndustrialToolAdapter>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly pathEnv: string;

  constructor(options: AdapterRegistryOptions = {}) {
    this.env = options.env || process.env;
    this.pathEnv = options.pathEnv || this.env.PATH || "";
    for (const adapter of options.adapters || BUILTIN_TOOL_ADAPTERS) {
      this.registerAdapter(adapter);
    }
  }

  registerAdapter(adapter: IndustrialToolAdapter): IndustrialToolAdapter {
    const normalized = normalizeAdapter(adapter);
    this.adapters.set(normalized.id, normalized);
    return clone(normalized);
  }

  listAdapters(): IndustrialToolAdapter[] {
    return Array.from(this.adapters.values()).sort((a, b) => a.name.localeCompare(b.name)).map(clone);
  }

  getAdapter(adapterId: string): IndustrialToolAdapter | null {
    const adapter = this.adapters.get(cleanId(adapterId));
    return adapter ? clone(adapter) : null;
  }

  validateAdapterConfig(adapter: unknown): { ok: boolean; errors: string[]; adapter?: IndustrialToolAdapter } {
    try {
      const normalized = normalizeAdapter(adapter);
      return { ok: true, errors: [], adapter: normalized };
    } catch (error) {
      return { ok: false, errors: [errorMessage(error)] };
    }
  }

  getAdapterCapabilities(adapterId: string): ToolCapability[] {
    return this.requireAdapter(adapterId).capabilities.map(clone);
  }

  detectAdapter(adapterId: string, options: ToolDetectionOptions = {}): ToolDetectionResult {
    const adapter = this.requireAdapter(adapterId);
    if (adapter.id === "ifcopenshell") {
      return detectBimIfcAdapter({ adapter, options, env: this.env, pathEnv: this.pathEnv });
    }
    if (adapter.id === "solidworks") {
      return detectSolidWorksBridgeAdapter({ adapter, options, env: this.env, pathEnv: this.pathEnv });
    }
    if (adapter.id === "aveva") {
      return detectAvevaBridgeAdapter({ adapter, options, env: this.env, pathEnv: this.pathEnv });
    }
    const now = Date.now();
    const manualExecutablePath = normalizeManualExecutablePath(options.executablePath, this.env);
    const commands = (adapter.detection.commands || []).map((command) => {
      const found = findCommand(command, this.pathEnv);
      return { command, found: !!found, path: found || undefined };
    });
    const executableCandidates = [
      ...(manualExecutablePath ? [manualExecutablePath] : []),
      ...(adapter.detection.executablePaths || []),
    ];
    const executablePaths = executableCandidates.map((candidate) => {
      const expanded = expandPath(candidate, this.env);
      return { path: expanded, found: isExecutable(expanded) };
    });
    const environment = (adapter.detection.envVars || []).map((name) => {
      const value = this.env[name];
      const expanded = value ? expandPath(value, this.env) : undefined;
      return {
        name,
        set: !!value,
        path: expanded,
        exists: expanded ? fs.existsSync(expanded) : undefined,
        executable: expanded ? isExecutable(expanded) : undefined,
      };
    });
    const configPaths = (adapter.detection.configPaths || []).map((candidate) => {
      const expanded = expandPath(candidate, this.env);
      return { path: expanded, found: fs.existsSync(expanded) };
    });
    const commandHit = commands.find((item) => item.found);
    const executableHit = executablePaths.find((item) => item.found);
    const envHit = environment.find((item) => item.set && item.executable);
    const configHit = configPaths.find((item) => item.found);
    const executablePath = commandHit?.path || executableHit?.path || envHit?.path;
    const installed = !!(commandHit || executableHit || envHit);
    const version = installed ? detectVersion(adapter, executablePath, this.pathEnv) : undefined;
    const reason = installed
      ? `Detected ${adapter.name}${executablePath ? ` at ${redactPath(executablePath)}` : ""}.`
      : `No command, executable path, or environment marker was found for ${adapter.name}.`;
    const diagnostics: ToolDiagnostic[] = [
      {
        id: diagnosticId(adapter.id, installed ? "detected" : "missing"),
        severity: installed ? "info" : "warning",
        code: installed ? "tool.detected" : "tool.missing",
        message: reason,
        gate: adapter.capabilities[0]?.qualityGates[0] || "documentation_review",
      },
    ];
    if (!installed && configHit) {
      diagnostics.push({
        id: diagnosticId(adapter.id, "config-only"),
        severity: "warning",
        code: "tool.config_without_executable",
        message: `${adapter.name} config exists, but no executable was detected.`,
      });
    }
    return {
      adapterId: adapter.id,
      toolName: adapter.name,
      installed,
      reason,
      setupHint: adapter.detection.setupHint,
      executablePath,
      version,
      evidence: { commands, executablePaths, environment, configPaths },
      diagnostics,
      detectedAt: now,
    };
  }

  runAdapterTask(request: ToolRunRequest): ToolRunResult {
    const adapter = this.requireAdapter(request.adapterId);
    const workspace = assertWorkspacePath(request.workspacePath);
    const mode = request.mode || "dry-run";
    const detection = this.detectAdapter(adapter.id, { executablePath: request.executablePath });
    const args = validateArgs(request.args || []);
    const inputArtifacts = validateInputArtifacts(request.inputArtifacts || [], workspace);
    const artifactDir = safeArtifactDir(workspace, request.artifactDir, adapter.id);
    const commandPreview = buildCommandPreview(adapter, request.task, args, detection);
    if (adapter.id === "freecad") {
      return runFreeCadAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (adapter.id === "kicad") {
      return runKiCadAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (adapter.id === "openplc") {
      return runOpenPlcAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (adapter.id === "ifcopenshell") {
      return runBimIfcAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (adapter.id === "solidworks") {
      return runSolidWorksBridgeAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (adapter.id === "aveva") {
      return runAvevaBridgeAdapterTask({
        adapter,
        request,
        workspace,
        detection,
        commandPreview,
        inputArtifacts,
      });
    }
    if (mode === "execute") {
      if (!detection.installed) {
        return failedRun({ adapter, mode, detection, message: `${adapter.name} is not installed; only dry-run is allowed.` });
      }
      if (request.userApproved !== true) {
        return failedRun({ adapter, mode, detection, message: "external industrial tool execution requires explicit user approval" });
      }
      if (request.allowNetwork === true && adapter.networkAccess === "forbidden-by-default") {
        return failedRun({ adapter, mode, detection, message: "adapter network access is forbidden unless a future adapter explicitly supports it" });
      }
      return failedRun({ adapter, mode, detection, message: "real industrial tool execution is unavailable for this adapter in Sprint 6G; use dry-run" });
    }
    fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
    const artifactPath = path.join(artifactDir, `${adapter.id}-dry-run.json`);
    assertInside(workspace, artifactPath);
    const dryRun = {
      schemaVersion: INDUSTRIAL_TOOL_ADAPTER_SCHEMA_VERSION,
      adapterId: adapter.id,
      toolName: adapter.name,
      task: requiredText(request.task, "task"),
      mode: "dry-run",
      simulated: true,
      installed: detection.installed,
      commandPreview,
      inputArtifacts,
      expectedOutputs: adapter.capabilities.flatMap((capability) => capability.artifactTypes),
      requiredApproval: "external tool execution requires explicit user approval",
      networkAccess: "not allowed in dry-run",
      diagnostics: detection.diagnostics,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(dryRun, null, 2), { mode: 0o600 });
    const artifact: ToolArtifact = {
      id: `tool-artifact-${hash(`${adapter.id}:${artifactPath}`).slice(0, 12)}`,
      type: "industrial-tool-dry-run",
      path: artifactPath,
      name: path.basename(artifactPath),
      simulated: true,
      metadata: { adapterId: adapter.id, mode: "dry-run" },
    };
    return {
      ok: true,
      adapterId: adapter.id,
      mode: "dry-run",
      simulated: true,
      summary: detection.installed
        ? `${adapter.name} detected; dry-run plan generated without executing the tool.`
        : `${adapter.name} is not installed; simulated dry-run plan generated.`,
      commandPreview,
      artifacts: [artifact],
      diagnostics: [
        ...detection.diagnostics,
        {
          id: diagnosticId(adapter.id, "dry-run"),
          severity: "info",
          code: "tool.dry_run",
          message: "Dry-run generated command preview and expected artifact plan only.",
        },
      ],
      detection,
    };
  }

  private requireAdapter(adapterId: string): IndustrialToolAdapter {
    const adapter = this.adapters.get(cleanId(adapterId));
    if (!adapter) throw new Error("industrial tool adapter not found");
    return adapter;
  }
}

export function builtInIndustrialToolAdapters(): IndustrialToolAdapter[] {
  return clone(BUILTIN_TOOL_ADAPTERS);
}

const BUILTIN_TOOL_ADAPTERS: IndustrialToolAdapter[] = [
  freeCadAdapterManifest(),
  kiCadAdapterManifest(),
  openPlcAdapterManifest(),
  bimIfcAdapterManifest(),
  solidWorksBridgeAdapterManifest(),
  avevaBridgeAdapterManifest(),
  adapter("plcopen", "PLCopen XML", "PLCopen", "standard", ["plc", "automation"], ["plcopen"], ["PLCOPEN_HOME"], [], ["plc_program", "io_map"], ["plc_compile", "documentation_review"], "Configure a PLCopen-compatible CLI/exporter path. Sprint 6A only validates detection and dry-run plans."),
  adapter("altium", "Altium Designer", "Altium", "commercial", ["pcb", "electrical"], [], ["ALTIUM_HOME"], ["/Applications/Altium Designer.app"], ["schematic", "layout", "gerber", "bom"], ["pcb_erc", "pcb_drc", "human_approval"], "Install Altium Designer and set ALTIUM_HOME. Sprint 6A does not automate Altium."),
  adapter("revit", "Revit", "Autodesk", "commercial", ["bim", "architecture"], [], ["REVIT_HOME"], ["/Applications/Autodesk Revit.app"], ["ifc_model", "drawing", "inspection_report"], ["bim_check", "human_approval"], "Install Revit and set REVIT_HOME. Sprint 6A only supports detection metadata."),
  adapter("codesys", "CODESYS", "CODESYS", "commercial", ["plc", "automation"], ["codesys"], ["CODESYS_HOME"], [], ["plc_program", "io_map"], ["plc_compile", "human_approval"], "Install CODESYS and expose a command or CODESYS_HOME."),
  adapter("twincat", "TwinCAT", "Beckhoff", "commercial", ["plc", "automation", "electrical"], [], ["TWINCAT3DIR", "TWINCAT_HOME"], [], ["plc_program", "io_map"], ["plc_compile", "human_approval"], "Install TwinCAT and set TWINCAT3DIR/TWINCAT_HOME. Sprint 6A only detects configuration."),
];

function adapter(id: string, name: string, vendor: string, kind: IndustrialToolAdapter["kind"], domains: IndustrialDomainKey[], commands: string[], envVars: string[], configPaths: string[], artifactTypes: IndustrialArtifactType[], gates: IndustrialGateType[], setupHint: string): IndustrialToolAdapter {
  return {
    id,
    name,
    vendor,
    kind,
    domains,
    detection: {
      commands,
      versionCommand: commands[0] ? { command: commands[0], args: ["--version"], pattern: "([0-9]+(?:\\.[0-9]+)+[^\\s]*)" } : undefined,
      executablePaths: [],
      envVars,
      configPaths,
      setupHint,
    },
    capabilities: [{
      id: `${id}-dry-run-plan`,
      name: `${name} dry-run planning`,
      description: `Generate command preview and expected artifact plan for ${name}.`,
      domains,
      artifactTypes,
      qualityGates: gates,
      dryRunSupported: true,
      requiresInstalledTool: false,
    }],
    networkAccess: "requires-explicit-approval",
    notes: "Sprint 6A only supports detection and dry-run planning.",
  };
}

function normalizeAdapter(value: unknown): IndustrialToolAdapter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("adapter must be an object");
  const raw = value as Partial<IndustrialToolAdapter>;
  const id = requiredId(raw.id, "adapter.id");
  const detection = (raw.detection || {}) as Partial<ToolDetectionConfig>;
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.map(normalizeCapability) : [];
  if (!capabilities.length) throw new Error("adapter capabilities are required");
  return {
    id,
    name: requiredText(raw.name, "adapter.name"),
    vendor: requiredText(raw.vendor, "adapter.vendor"),
    kind: ["open-source", "commercial", "standard", "runtime"].includes(String(raw.kind)) ? raw.kind as IndustrialToolAdapter["kind"] : "commercial",
    domains: normalizeDomains(raw.domains),
    homepage: cleanString(raw.homepage) || undefined,
    detection: {
      commands: stringArray(detection.commands),
      versionCommand: detection.versionCommand ? {
        command: requiredText(detection.versionCommand.command, "versionCommand.command"),
        args: validateArgs(detection.versionCommand.args || []),
        pattern: cleanString(detection.versionCommand.pattern) || undefined,
      } : undefined,
      executablePaths: stringArray(detection.executablePaths),
      envVars: stringArray(detection.envVars),
      configPaths: stringArray(detection.configPaths),
      setupHint: requiredText(detection.setupHint, "detection.setupHint"),
    },
    capabilities,
    networkAccess: raw.networkAccess === "forbidden-by-default" ? "forbidden-by-default" : "requires-explicit-approval",
    notes: cleanString(raw.notes) || undefined,
  };
}

function normalizeCapability(value: unknown): ToolCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("capability must be an object");
  const raw = value as Partial<ToolCapability>;
  return {
    id: requiredId(raw.id, "capability.id"),
    name: requiredText(raw.name, "capability.name"),
    description: requiredText(raw.description, "capability.description"),
    domains: normalizeDomains(raw.domains),
    artifactTypes: stringArray(raw.artifactTypes).filter(isArtifactType) as IndustrialArtifactType[],
    qualityGates: stringArray(raw.qualityGates).filter(isGateType) as IndustrialGateType[],
    dryRunSupported: raw.dryRunSupported !== false,
    requiresInstalledTool: raw.requiresInstalledTool === true,
  };
}

function detectVersion(adapter: IndustrialToolAdapter, executablePath: string | undefined, pathEnv: string): ToolVersionInfo | undefined {
  const versionCommand = adapter.detection.versionCommand;
  if (!versionCommand) return undefined;
  const command = executablePath && isExecutable(executablePath)
    ? executablePath
    : findCommand(versionCommand.command, pathEnv);
  if (!command) return undefined;
  try {
    const result = runIndustrialCommand({
      id: `${adapter.id}.version`,
      executable: command,
      args: validateArgs(versionCommand.args || []),
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      timeoutMs: 5000,
      outputBytes: 2000,
      environment: { PATH: pathEnv },
      mutating: false,
      network: "deny",
    });
    const output = redactText([result.stdout, result.stderr].filter(Boolean).join("\n").trim()).slice(0, 2000);
    const version = versionCommand.pattern ? new RegExp(versionCommand.pattern).exec(output)?.[1] : undefined;
    return { command: redactPath(command), output, version, executionPolicy: result.executionPolicy };
  } catch {
    return { command: redactPath(command), output: "version command failed" };
  }
}

function buildCommandPreview(adapter: IndustrialToolAdapter, task: string, args: string[], detection: ToolDetectionResult): string[] {
  const command = detection.executablePath || adapter.detection.commands?.[0] || adapter.id;
  return [
    redactPath(command),
    "--dry-run",
    "--task",
    summarize(task),
    ...args,
  ];
}

function failedRun({ adapter, mode, detection, message }: { adapter: IndustrialToolAdapter; mode: "dry-run" | "execute"; detection: ToolDetectionResult; message: string }): ToolRunResult {
  return {
    ok: false,
    adapterId: adapter.id,
    mode,
    simulated: mode === "dry-run",
    summary: message,
    commandPreview: [],
    artifacts: [],
    diagnostics: [{
      id: diagnosticId(adapter.id, "run-failed"),
      severity: "error",
      code: "tool.run_blocked",
      message,
    }],
    detection,
    error: message,
  };
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

function expandPath(value: string, env: NodeJS.ProcessEnv): string {
  let expanded = value.replace(/^~(?=$|\/|\\)/, env.HOME || process.env.HOME || "");
  expanded = expanded.replace(/\$([A-Z0-9_]+)/gi, (_match, name) => env[name] || "");
  return path.resolve(expanded);
}

function normalizeManualExecutablePath(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  if (/[\0\r\n]/.test(text)) throw new Error("manual executable path must not contain control characters");
  return expandPath(text, env);
}

function safeArtifactDir(workspace: string, requested: string | undefined, adapterId: string): string {
  const dir = requested ? path.resolve(workspace, requested) : path.join(workspace, ".hicode", "generated", "tool-adapters", cleanId(adapterId));
  assertInside(workspace, dir);
  return dir;
}

function assertWorkspacePath(workspacePath: string): string {
  const workspace = path.resolve(requiredText(workspacePath, "workspacePath"));
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("workspacePath must be an existing directory");
  return workspace;
}

function validateInputArtifacts(values: string[], workspace: string): string[] {
  return values.map((value) => {
    const resolved = path.resolve(workspace, value);
    assertInside(workspace, resolved);
    return resolved;
  });
}

function validateArgs(values: unknown[]): string[] {
  return values.map((value) => {
    const text = requiredText(value, "arg");
    if (/[\0\r\n]/.test(text)) throw new Error("command arguments must not contain control characters");
    if (text.length > 500) throw new Error("command argument is too long");
    return text;
  });
}

function assertInside(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("industrial tool path escapes workspace");
}

function normalizeDomains(values: unknown): IndustrialDomainKey[] {
  const domains = stringArray(values).filter(isDomain) as IndustrialDomainKey[];
  if (!domains.length) throw new Error("adapter domains are required");
  return unique(domains);
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

function requiredId(value: unknown, field: string): string {
  const id = cleanId(value);
  if (!id) throw new Error(`${field} is required`);
  return id;
}

function requiredText(value: unknown, field: string): string {
  const text = cleanString(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[^a-z0-9._:-]/gi, "-").slice(0, 120) : "";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim())) : [];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function summarize(value: string): string {
  const text = requiredText(value, "task").replace(/\s+/g, " ");
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function diagnosticId(adapterId: string, suffix: string): string {
  return `diag-${cleanId(adapterId)}-${suffix}-${Date.now().toString(36)}`;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "adapter error");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
