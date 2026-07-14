import fs from "node:fs";
import path from "node:path";

import { runManagedExecution } from "./execution-runner.js";

export const QUALITY_GATE_STATUSES = [
  "passed",
  "failed",
  "warning",
  "skipped",
  "simulated",
  "not_run",
  "requires_approval",
] as const;

export const QUALITY_GATE_TYPES = [
  "command_gate",
  "file_exists_gate",
  "schema_gate",
  "artifact_integrity_gate",
  "security_gate",
  "human_approval_gate",
  "adapter_gate",
  "documentation_gate",
] as const;

export const GATE_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

export type QualityGateStatus = (typeof QUALITY_GATE_STATUSES)[number];
export type QualityGateType = (typeof QUALITY_GATE_TYPES)[number];
export type GateSeverity = (typeof GATE_SEVERITIES)[number];

export interface GateRemediation {
  summary: string;
  steps: string[];
}

export interface GateEvidence {
  gateId: string;
  status: QualityGateStatus;
  command?: string;
  adapter?: string;
  startedAt: number;
  endedAt: number;
  stdoutSummary: string;
  stderrSummary: string;
  artifactLinks: string[];
  remediation: GateRemediation;
  manualApprovalRequired: boolean;
  metadata?: Record<string, unknown>;
}

export interface QualityGateResult {
  gateId: string;
  gateName: string;
  type: QualityGateType;
  category: QualityGate["category"];
  status: QualityGateStatus;
  severity: GateSeverity;
  message: string;
  evidence: GateEvidence;
  remediation: GateRemediation;
}

export interface QualityGateRun {
  id: string;
  gateId: string;
  status: QualityGateStatus;
  startedAt: number;
  endedAt: number;
  result: QualityGateResult;
}

export interface QualityGate {
  id: string;
  name: string;
  type: QualityGateType;
  category: "software" | "cad" | "pcb" | "plc" | "bim" | "security" | "documentation" | "approval" | "adapter";
  severity: GateSeverity;
  description: string;
  command?: string;
  args?: string[];
  filePath?: string;
  artifactType?: string;
  mustBeNonEmpty?: boolean;
  schemaPath?: string;
  requiredFields?: string[];
  artifactPaths?: string[];
  adapterId?: string;
  requiredSections?: string[];
  sensitivePatterns?: string[];
  requiresApproval?: boolean;
  remediation: GateRemediation;
}

export interface QualityGateRunInput {
  workspacePath: string;
  gate: QualityGate | string;
  artifactPaths?: string[];
  changedFiles?: string[];
  schemaValue?: unknown;
  adapterResult?: Record<string, unknown>;
  approval?: {
    status?: "approved" | "rejected" | "denied" | "pending";
    actor?: string;
    reason?: string;
  };
  context?: Record<string, unknown>;
  now?: number;
}

export interface QualityGateRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  outputLimit?: number;
  approvalGranted?: boolean;
}

export class QualityGateRunner {
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly outputLimit: number;
  private readonly approvalGranted: boolean;

  constructor(options: QualityGateRunnerOptions = {}) {
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.env = options.env || process.env;
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs || 30_000));
    this.outputLimit = Math.max(2_000, Number(options.outputLimit || 20_000));
    this.approvalGranted = options.approvalGranted === true;
  }

  listBuiltInGates(): QualityGate[] {
    return builtInQualityGates();
  }

  getGate(gate: QualityGate | string): QualityGate {
    if (typeof gate !== "string") return normalizeGate(gate);
    const builtIn = builtInQualityGates().find((item) => item.id === gate);
    if (!builtIn) throw new Error(`quality gate not found: ${gate}`);
    return builtIn;
  }

  async runGate(input: QualityGateRunInput): Promise<QualityGateRun> {
    const gate = this.getGate(input.gate);
    const workspace = safeWorkspace(input.workspacePath || this.cwd);
    const startedAt = input.now || Date.now();
    const result = await this.runByType({ gate, workspace, input, startedAt });
    const endedAt = result.evidence.endedAt;
    return {
      id: newId("gate-run"),
      gateId: gate.id,
      status: result.status,
      startedAt,
      endedAt,
      result,
    };
  }

  private async runByType({ gate, workspace, input, startedAt }: { gate: QualityGate; workspace: string; input: QualityGateRunInput; startedAt: number }): Promise<QualityGateResult> {
    switch (gate.type) {
      case "command_gate":
        return this.runCommandGate(gate, workspace, input, startedAt);
      case "file_exists_gate":
        return this.runFileExistsGate(gate, workspace, input, startedAt);
      case "schema_gate":
        return this.runSchemaGate(gate, workspace, input, startedAt);
      case "artifact_integrity_gate":
        return this.runArtifactIntegrityGate(gate, workspace, input, startedAt);
      case "security_gate":
        return this.runSecurityGate(gate, input, startedAt);
      case "human_approval_gate":
        return this.runHumanApprovalGate(gate, input, startedAt);
      case "adapter_gate":
        return this.runAdapterGate(gate, input, startedAt);
      case "documentation_gate":
        return this.runDocumentationGate(gate, workspace, input, startedAt);
      default:
        return this.makeResult({ gate, status: "not_run", startedAt, message: `Unsupported gate type ${gate.type}` });
    }
  }

  private async runCommandGate(gate: QualityGate, workspace: string, input: QualityGateRunInput, startedAt: number): Promise<QualityGateResult> {
    const command = requiredString(gate.command, "gate.command");
    const args = Array.isArray(gate.args) ? gate.args.map((item) => requiredString(item, "gate.args")) : [];
    if (hasShellSyntax(command) || args.some(hasShellSyntax)) {
      return this.makeResult({ gate, status: "failed", startedAt, message: "Command gate rejected unsafe shell syntax.", command: [command, ...args].join(" ") });
    }
    const completed = await runManagedExecution({
      id: `quality-gate:${gate.id}`,
      surface: "quality-gate",
      executable: command,
      args,
      cwd: workspace,
      allowedRoots: [workspace],
      filesystem: "workspace-write",
      network: "allow",
      environment: { source: this.env },
      limits: { timeoutMs: this.timeoutMs, outputBytes: this.outputLimit },
      approval: { required: true, granted: this.approvalGranted },
      processTree: { required: true },
      enforcementMode: "report-only",
    });
    const status: QualityGateStatus = completed.exitCode === 0 ? "passed" : "failed";
    return this.makeResult({
      gate,
      status,
      startedAt,
      endedAt: completed.endedAt,
      message: completed.exitCode === 0 ? `${gate.name} passed` : `${gate.name} failed${completed.error ? `: ${completed.error}` : ` with exit code ${completed.exitCode}`}`,
      command: [command, ...args].join(" "),
      stdoutSummary: summarize(completed.stdout),
      stderrSummary: summarize(completed.stderr),
      artifactLinks: input.artifactPaths,
      metadata: {
        exitCode: completed.exitCode,
        signal: completed.signal,
        timedOut: completed.timedOut,
        executionPolicy: completed.policy,
      },
    });
  }

  private runFileExistsGate(gate: QualityGate, workspace: string, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const candidates = candidatePaths(gate, input);
    if (!candidates.length) {
      return this.makeResult({ gate, status: "not_run", startedAt, message: "No artifact path was supplied for file existence gate." });
    }
    const resolved = candidates.map((candidate) => safePath(workspace, candidate));
    const missing = resolved.filter((item) => !fs.existsSync(item));
    const empty = resolved.filter((item) => fs.existsSync(item) && gate.mustBeNonEmpty && fs.statSync(item).size <= 0);
    const status: QualityGateStatus = missing.length || empty.length ? "failed" : "passed";
    const message = status === "passed" ? `${resolved.length} file artifact(s) found` : `${missing.length} missing and ${empty.length} empty artifact(s)`;
    return this.makeResult({ gate, status, startedAt, message, artifactLinks: resolved, metadata: { missing, empty } });
  }

  private runSchemaGate(gate: QualityGate, workspace: string, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    let value = input.schemaValue;
    const schemaPath = gate.schemaPath || firstString(input.artifactPaths);
    let artifactLinks: string[] = [];
    if (value === undefined && schemaPath) {
      const resolved = safePath(workspace, schemaPath);
      artifactLinks = [resolved];
      if (!fs.existsSync(resolved)) {
        return this.makeResult({ gate, status: "failed", startedAt, message: `Schema input does not exist: ${path.basename(resolved)}`, artifactLinks });
      }
      try {
        value = JSON.parse(fs.readFileSync(resolved, "utf8"));
      } catch (error) {
        return this.makeResult({ gate, status: "failed", startedAt, message: `Schema input is not valid JSON: ${errorMessage(error)}`, artifactLinks });
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return this.makeResult({ gate, status: "failed", startedAt, message: "Schema gate requires a JSON object.", artifactLinks });
    }
    const required = gate.requiredFields || [];
    const missing = required.filter((field) => !hasNestedField(value as Record<string, unknown>, field));
    const status: QualityGateStatus = missing.length ? "failed" : "passed";
    return this.makeResult({
      gate,
      status,
      startedAt,
      message: missing.length ? `Missing required field(s): ${missing.join(", ")}` : "Schema fields are present.",
      artifactLinks,
      metadata: { requiredFields: required, missingFields: missing },
    });
  }

  private runArtifactIntegrityGate(gate: QualityGate, workspace: string, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const candidates = candidatePaths(gate, input);
    if (!candidates.length) {
      return this.makeResult({ gate, status: "not_run", startedAt, message: "No artifacts supplied for integrity gate." });
    }
    const resolved = candidates.map((candidate) => safePath(workspace, candidate));
    const problems: string[] = [];
    for (const file of resolved) {
      if (!fs.existsSync(file)) problems.push(`${path.basename(file)} missing`);
      else if (!fs.statSync(file).isFile()) problems.push(`${path.basename(file)} is not a file`);
      else if (gate.mustBeNonEmpty !== false && fs.statSync(file).size <= 0) problems.push(`${path.basename(file)} empty`);
    }
    if (gate.requiredFields?.length) {
      const metadataFile = resolved.find((item) => path.basename(item).toLowerCase() === "metadata.json");
      if (!metadataFile) problems.push("metadata.json missing");
      else {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
          for (const field of gate.requiredFields) {
            if (!hasNestedField(metadata, field)) problems.push(`metadata.${field} missing`);
          }
        } catch {
          problems.push("metadata.json invalid");
        }
      }
    }
    return this.makeResult({
      gate,
      status: problems.length ? "failed" : "passed",
      startedAt,
      message: problems.length ? problems.join("; ") : "Artifact integrity checks passed.",
      artifactLinks: resolved,
      metadata: { problems },
    });
  }

  private runSecurityGate(gate: QualityGate, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const changed = Array.isArray(input.changedFiles) ? input.changedFiles.filter((item) => typeof item === "string") : [];
    if (!changed.length) {
      return this.makeResult({ gate, status: "skipped", startedAt, message: "No changed files were supplied for security-sensitive scan." });
    }
    const patterns = (gate.sensitivePatterns?.length ? gate.sensitivePatterns : defaultSensitivePatterns()).map((item) => new RegExp(item, "i"));
    const sensitive = changed.filter((file) => patterns.some((pattern) => pattern.test(file)));
    return this.makeResult({
      gate,
      status: sensitive.length ? "warning" : "passed",
      startedAt,
      message: sensitive.length ? `Security-sensitive file(s) changed: ${sensitive.join(", ")}` : "No security-sensitive files changed.",
      artifactLinks: changed,
      metadata: { sensitiveFiles: sensitive },
    });
  }

  private runHumanApprovalGate(gate: QualityGate, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const approval = input.approval || {};
    const approved = approval.status === "approved";
    const rejected = approval.status === "rejected" || approval.status === "denied";
    const status: QualityGateStatus = approved ? "passed" : rejected ? "failed" : "requires_approval";
    return this.makeResult({
      gate,
      status,
      startedAt,
      message: approved ? "Human approval recorded." : rejected ? "Human approval rejected." : "Human approval is required before release.",
      manualApprovalRequired: !approved,
      metadata: { approval: sanitizeMetadata(approval) },
    });
  }

  private runAdapterGate(gate: QualityGate, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const adapterResult = input.adapterResult;
    if (!adapterResult) {
      return this.makeResult({ gate, status: "not_run", startedAt, message: "Adapter result was not supplied.", adapter: gate.adapterId });
    }
    const simulated = adapterResult.simulated === true || adapterResult.mode === "dry-run";
    const ok = adapterResult.ok !== false;
    const status: QualityGateStatus = simulated ? "simulated" : ok ? "passed" : "failed";
    const artifacts = Array.isArray(adapterResult.artifacts)
      ? adapterResult.artifacts.map((artifact) => typeof artifact === "string" ? artifact : String((artifact as Record<string, unknown>).path || "")).filter(Boolean)
      : [];
    return this.makeResult({
      gate,
      status,
      startedAt,
      message: simulated ? "Adapter result is simulated and cannot pass release gate." : ok ? "Adapter gate passed." : String(adapterResult.error || "Adapter gate failed."),
      adapter: String(adapterResult.adapterId || gate.adapterId || ""),
      artifactLinks: artifacts,
      metadata: sanitizeMetadata(adapterResult),
    });
  }

  private runDocumentationGate(gate: QualityGate, workspace: string, input: QualityGateRunInput, startedAt: number): QualityGateResult {
    const candidates = candidatePaths(gate, input);
    if (!candidates.length) {
      return this.makeResult({ gate, status: "not_run", startedAt, message: "No documentation artifact was supplied." });
    }
    const resolved = candidates.map((candidate) => safePath(workspace, candidate));
    const missing = resolved.filter((item) => !fs.existsSync(item));
    if (missing.length) {
      return this.makeResult({ gate, status: "failed", startedAt, message: `Documentation artifact missing: ${missing.map((item) => path.basename(item)).join(", ")}`, artifactLinks: resolved });
    }
    const required = gate.requiredSections || [];
    const missingSections: string[] = [];
    for (const file of resolved) {
      const text = fs.readFileSync(file, "utf8").toLowerCase();
      for (const section of required) {
        if (!text.includes(section.toLowerCase())) missingSections.push(`${path.basename(file)}:${section}`);
      }
    }
    return this.makeResult({
      gate,
      status: missingSections.length ? "warning" : "passed",
      startedAt,
      message: missingSections.length ? `Documentation needs review: ${missingSections.join(", ")}` : "Documentation review fields are present.",
      artifactLinks: resolved,
      metadata: { missingSections },
    });
  }

  private makeResult(input: {
    gate: QualityGate;
    status: QualityGateStatus;
    startedAt: number;
    endedAt?: number;
    message: string;
    command?: string;
    adapter?: string;
    stdoutSummary?: string;
    stderrSummary?: string;
    artifactLinks?: string[];
    manualApprovalRequired?: boolean;
    metadata?: Record<string, unknown>;
  }): QualityGateResult {
    const endedAt = input.endedAt || Date.now();
    const remediation = input.gate.remediation;
    return {
      gateId: input.gate.id,
      gateName: input.gate.name,
      type: input.gate.type,
      category: input.gate.category,
      status: input.status,
      severity: input.gate.severity,
      message: input.message,
      remediation,
      evidence: {
        gateId: input.gate.id,
        status: input.status,
        command: input.command,
        adapter: input.adapter,
        startedAt: input.startedAt,
        endedAt,
        stdoutSummary: input.stdoutSummary || "",
        stderrSummary: input.stderrSummary || "",
        artifactLinks: Array.isArray(input.artifactLinks) ? input.artifactLinks : [],
        remediation,
        manualApprovalRequired: input.manualApprovalRequired ?? (input.gate.requiresApproval === true || input.status === "requires_approval"),
        metadata: sanitizeMetadata(input.metadata),
      },
    };
  }
}

export function builtInQualityGates(): QualityGate[] {
  return [
    commandGate("software.npm_build", "npm build", "software", "npm", ["run", "build"], "Run npm build before release."),
    commandGate("software.npm_test", "npm test", "software", "npm", ["run", "test"], "Run npm test before release."),
    commandGate("software.syntax_check", "syntax check", "software", "npm", ["run", "check:syntax"], "Run JavaScript/Electron syntax checks."),
    {
      id: "software.package_schema",
      name: "package schema",
      type: "schema_gate",
      category: "software",
      severity: "medium",
      description: "Validate a supplied JSON object or package-like artifact has required release fields.",
      requiredFields: ["name", "version"],
      remediation: remediation("Provide valid package/release metadata.", ["Include name and version.", "Attach the JSON artifact or schema value."]),
    },
    {
      id: "software.security_sensitive_file_changed",
      name: "security sensitive file changed",
      type: "security_gate",
      category: "security",
      severity: "high",
      description: "Warns when security-sensitive files changed and need manual review.",
      sensitivePatterns: defaultSensitivePatterns(),
      remediation: remediation("Review changed security-sensitive files, permissions, IPC boundaries, and credential handling.", ["Open the diff for every flagged file.", "Record human review before release."]),
    },
    {
      id: "adapter.result_status",
      name: "adapter result status",
      type: "adapter_gate",
      category: "adapter",
      severity: "high",
      description: "Evaluate an industrial adapter result without treating dry-run or simulated output as passed.",
      remediation: remediation("Attach a real adapter result or keep the release gate marked simulated/not_run.", ["Do not mark dry-run adapter output passed.", "Run the approved tool path when available."]),
    },
    fileGate("cad.artifact_exists", "CAD artifact exists", "cad", "cad_model", "CAD model artifact must exist."),
    artifactGate("cad.step_stl_non_empty", "STEP/STL non-empty", "cad", ["step_file", "stl_file"], "STEP/STL export files must be present and non-empty."),
    artifactGate("cad.metadata_complete", "metadata complete", "cad", ["metadata"], "CAD metadata must include generation status.", ["generated", "simulated"]),
    fileGate("pcb.kicad_project_exists", "KiCad project exists", "pcb", "pcb_project", "KiCad .kicad_pro project must exist."),
    artifactGate("pcb.erc_result", "ERC result", "pcb", ["inspection_report"], "ERC result must be recorded."),
    artifactGate("pcb.drc_result", "DRC result", "pcb", ["inspection_report"], "DRC result must be recorded."),
    artifactGate("pcb.gerber_exists", "Gerber exists", "pcb", ["gerber"], "Gerber output must exist."),
    artifactGate("pcb.bom_exists", "BOM exists", "pcb", ["bom"], "BOM output must exist."),
    fileGate("plc.st_file_exists", "ST file exists", "plc", "plc_program", "Structured Text program must exist."),
    artifactGate("plc.io_map_complete", "I/O map complete", "plc", ["io_map"], "I/O map must exist and be non-empty."),
    documentationGate("plc.safety_interlock_documented", "safety interlock documented", "plc", ["emergency stop", "manual approval"], "Safety interlock documentation must be present."),
    documentationGate("plc.fat_sat_checklist_exists", "FAT/SAT checklist exists", "plc", ["FAT", "SAT"], "FAT/SAT checklist must be present."),
    fileGate("bim.ifc_file_exists", "IFC file exists", "bim", "ifc_model", "IFC input/model must exist."),
    documentationGate("bim.summary_exists", "BIM summary exists", "bim", ["summary"], "BIM summary must exist."),
    {
      id: "bim.code_check_manual_approval",
      name: "code check manual approval",
      type: "human_approval_gate",
      category: "approval",
      severity: "critical",
      description: "Building code checks require licensed professional or responsible engineer approval.",
      requiresApproval: true,
      remediation: remediation("Record manual code-check approval before release.", ["Attach reviewer identity and scope.", "Do not claim local-code compliance from automated checks alone."]),
    },
  ];
}

function commandGate(id: string, name: string, category: QualityGate["category"], command: string, args: string[], description: string): QualityGate {
  return {
    id,
    name,
    type: "command_gate",
    category,
    severity: "high",
    description,
    command,
    args,
    remediation: remediation(`Fix ${name} failures and rerun the gate.`, ["Inspect stdout/stderr evidence.", "Commit or package only after the command exits with code 0."]),
  };
}

function fileGate(id: string, name: string, category: QualityGate["category"], artifactType: string, description: string): QualityGate {
  return {
    id,
    name,
    type: "file_exists_gate",
    category,
    severity: "high",
    description,
    artifactType,
    mustBeNonEmpty: true,
    remediation: remediation(`${name} must be generated or linked before release.`, ["Run the relevant adapter or attach the artifact.", "Verify the artifact path stays inside the workspace."]),
  };
}

function artifactGate(id: string, name: string, category: QualityGate["category"], artifactPaths: string[], description: string, requiredFields: string[] = []): QualityGate {
  return {
    id,
    name,
    type: "artifact_integrity_gate",
    category,
    severity: "high",
    description,
    artifactPaths,
    mustBeNonEmpty: true,
    requiredFields,
    remediation: remediation(`${name} needs valid artifact evidence.`, ["Regenerate missing or empty artifacts.", "Attach metadata and tool diagnostic evidence."]),
  };
}

function documentationGate(id: string, name: string, category: QualityGate["category"], requiredSections: string[], description: string): QualityGate {
  return {
    id,
    name,
    type: "documentation_gate",
    category,
    severity: "medium",
    description,
    requiredSections,
    remediation: remediation(`${name} requires documentation evidence.`, ["Generate or update the required checklist.", "Have the responsible engineer review the document."]),
  };
}

function remediation(summary: string, steps: string[]): GateRemediation {
  return { summary, steps };
}

function normalizeGate(input: QualityGate): QualityGate {
  if (!input || typeof input !== "object") throw new Error("quality gate must be an object");
  if (!QUALITY_GATE_TYPES.includes(input.type)) throw new Error("invalid quality gate type");
  if (!GATE_SEVERITIES.includes(input.severity)) throw new Error("invalid gate severity");
  return {
    ...input,
    id: requiredString(input.id, "gate.id"),
    name: requiredString(input.name, "gate.name"),
    category: input.category || "software",
    description: requiredString(input.description || input.name, "gate.description"),
    remediation: input.remediation || remediation("Review gate failure.", ["Fix the evidence and rerun the gate."]),
  };
}

function candidatePaths(gate: QualityGate, input: QualityGateRunInput): string[] {
  return [
    ...(Array.isArray(input.artifactPaths) ? input.artifactPaths : []),
    ...(Array.isArray(gate.artifactPaths) ? gate.artifactPaths : []),
    gate.filePath,
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function safeWorkspace(workspacePath: string): string {
  const workspace = path.resolve(requiredString(workspacePath, "workspacePath"));
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("workspacePath must be an existing directory");
  return realOrResolve(workspace);
}

function safePath(workspace: string, candidate: string): string {
  const raw = requiredString(candidate, "artifactPath");
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  const realWorkspace = realOrResolve(workspace);
  const realTarget = fs.existsSync(resolved) ? realOrResolve(resolved) : path.resolve(resolved);
  const relative = path.relative(realWorkspace, realTarget);
  if (relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))) return realTarget;
  throw new Error(`gate path escapes workspace: ${raw}`);
}

function realOrResolve(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item) => typeof item === "string" && item.trim()) : undefined;
}

function hasShellSyntax(value: string): boolean {
  return /[;&|`$<>]/.test(value);
}

function summarize(value: string): string {
  const text = String(value || "").replace(/\r/g, "").trim();
  if (text.length <= 2_000) return text;
  return `${text.slice(0, 1_000)}\n...\n${text.slice(-900)}`;
}

function hasNestedField(value: Record<string, unknown>, field: string): boolean {
  let cursor: unknown = value;
  for (const part of field.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(part in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor !== undefined && cursor !== null && cursor !== "";
}

function defaultSensitivePatterns(): string[] {
  return [
    "^electron/",
    "^renderer/index\\.html$",
    "^package(-lock)?\\.json$",
    "^\\.env",
    "secret",
    "credential",
    "auth",
    "permission",
    "security",
  ];
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/password|token|secret|api[_-]?key|credential|authorization/i.test(key)) return "[REDACTED]";
    if (typeof item === "function" || typeof item === "symbol") return undefined;
    return item;
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "quality gate failed");
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
