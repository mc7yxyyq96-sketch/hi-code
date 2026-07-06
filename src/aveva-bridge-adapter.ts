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

export type AvevaSystemType = "aveva-engineering" | "aveva-e3d" | "aveva-net" | "aveva-pi" | "aveva-enterprise-data-platform" | "manual-external";
export type AvevaAuthMode = "sso" | "system_keychain" | "service_account_reference" | "manual_external";
export type AvevaAllowedOperation =
  | "engineering_data_exchange_plan"
  | "tag_list_import_export_plan"
  | "equipment_list_import_export_plan"
  | "piping_line_list_plan"
  | "document_register_plan"
  | "change_sync_plan";

export interface AvevaConnectionProfile {
  profileName: string;
  systemType: AvevaSystemType;
  endpoint?: string;
  authMode: AvevaAuthMode;
  projectId?: string;
  workspaceMapping: Record<string, string>;
  allowedOperations: AvevaAllowedOperation[];
  credentialRef?: string;
}

export interface AvevaProjectReference {
  projectId?: string;
  projectName?: string;
  area?: string;
  unit?: string;
  revision?: string;
}

export interface AvevaEngineeringArtifact {
  artifactType: "tag_list" | "equipment_list" | "line_list" | "document_register" | "sync_plan" | "risk_checklist" | "metadata";
  path: string;
  format: "csv" | "json" | "md";
  generated: boolean;
  simulated: boolean;
  external_required: boolean;
  manual_approval_required: boolean;
}

export interface AvevaSyncPlan {
  operations: AvevaAllowedOperation[];
  dependencies: string[];
  approvalPoints: string[];
  rollbackPlan: string[];
  risks: string[];
}

export interface AvevaDataExchangeRequest {
  connectionProfile?: AvevaConnectionProfile;
  projectReference?: AvevaProjectReference;
  requestedOperations: AvevaAllowedOperation[];
  outputDir?: string;
  sourceFormat: "csv" | "json";
  targetFormat: "csv" | "json";
  includeTemplates: boolean;
}

export interface AvevaDataExchangeResult {
  schemaVersion: number;
  simulated: boolean;
  external_required: boolean;
  manual_approval_required: boolean;
  connectionStatus: "not_configured" | "profile_configured_not_connected" | "external_connector_required";
  profile: AvevaConnectionProfile;
  projectReference: AvevaProjectReference;
  syncPlan: AvevaSyncPlan;
  artifacts: AvevaEngineeringArtifact[];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
}

interface AvevaRunInput {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  workspace: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
}

interface AvevaDetectionEvidence {
  commands: Array<{ command: string; found: boolean; path?: string }>;
  executablePaths: Array<{ path: string; found: boolean }>;
  environment: Array<{ name: string; set: boolean; path?: string; exists?: boolean; executable?: boolean }>;
  configPaths: Array<{ path: string; found: boolean }>;
}

const AVEVA_OPERATIONS: AvevaAllowedOperation[] = [
  "engineering_data_exchange_plan",
  "tag_list_import_export_plan",
  "equipment_list_import_export_plan",
  "piping_line_list_plan",
  "document_register_plan",
  "change_sync_plan",
];

const DEFAULT_PROFILE: AvevaConnectionProfile = {
  profileName: "unconfigured-aveva-dry-run",
  systemType: "manual-external",
  endpoint: undefined,
  authMode: "manual_external",
  projectId: undefined,
  workspaceMapping: {
    exportRoot: ".hicode/artifacts/aveva",
    importRoot: ".hicode/artifacts/aveva/inbound",
  },
  allowedOperations: ["engineering_data_exchange_plan", "tag_list_import_export_plan", "equipment_list_import_export_plan", "document_register_plan"],
};

const DEFAULT_AVEVA_REQUEST: AvevaDataExchangeRequest = {
  connectionProfile: DEFAULT_PROFILE,
  projectReference: {},
  requestedOperations: ["engineering_data_exchange_plan", "tag_list_import_export_plan", "equipment_list_import_export_plan", "document_register_plan"],
  sourceFormat: "csv",
  targetFormat: "csv",
  includeTemplates: true,
};

const FORBIDDEN_CREDENTIAL_FIELDS = ["password", "passphrase", "token", "apiKey", "api_key", "secret", "clientSecret", "refreshToken", "accessToken"];

export function avevaBridgeAdapterManifest(): IndustrialToolAdapter {
  return {
    id: "aveva",
    name: "AVEVA Engineering Bridge",
    vendor: "AVEVA",
    kind: "commercial",
    domains: ["process_chemical", "energy", "manufacturing", "documentation", "qa"],
    homepage: "https://www.aveva.com/",
    detection: {
      commands: ["aveva-connector", "aveva-engineering-bridge"],
      executablePaths: [],
      envVars: ["AVEVA_CONNECTOR_CONFIG", "AVEVA_HOME", "AVEVA_PROFILE_REF"],
      configPaths: ["~/.hicode/aveva-profile.json", "~/.config/hicode/aveva-profile.json"],
      setupHint: "Configure an enterprise-approved AVEVA connector profile. Do not store plaintext credentials in Hi Code; use SSO, keychain references, or a user-authorized external connector.",
    },
    capabilities: [
      avevaCapability("engineering_data_exchange_plan", "Engineering data exchange plan", ["inspection_report"], false),
      avevaCapability("tag_list_import_export_plan", "Tag list import/export plan", ["inspection_report"], false),
      avevaCapability("equipment_list_import_export_plan", "Equipment list import/export plan", ["inspection_report"], false),
      avevaCapability("piping_line_list_plan", "Piping line list plan", ["pid_diagram", "inspection_report"], false),
      avevaCapability("document_register_plan", "Document register plan", ["release_package"], false),
      avevaCapability("change_sync_plan", "Change sync plan", ["inspection_report"], false),
      avevaCapability("external_connector_required", "External connector required", ["inspection_report"], true),
    ],
    networkAccess: "forbidden-by-default",
    notes: "Sprint 6G generates AVEVA connector profiles, exchange schemas, templates, and sync plans only. It never connects to a real AVEVA system.",
  };
}

export function detectAvevaBridgeAdapter({ adapter, options = {}, env = process.env, pathEnv = env.PATH || "" }: {
  adapter: IndustrialToolAdapter;
  options?: ToolDetectionOptions;
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
}): ToolDetectionResult {
  const now = Date.now();
  const manual = normalizeManualPath(options.executablePath, env);
  const evidence = collectAvevaEvidence({ adapter, manual, env, pathEnv });
  const executablePath = evidence.commands.find((item) => item.found)?.path
    || evidence.executablePaths.find((item) => item.found)?.path;
  const profileEvidence = evidence.environment.some((item) => item.set) || evidence.configPaths.some((item) => item.found);
  const installed = !!(executablePath || profileEvidence);
  const reason = installed
    ? "AVEVA connector/profile evidence was found. No live AVEVA connection was opened or validated."
    : "AVEVA connection is not configured: no connector profile, executable bridge, or approved environment marker was found.";
  return {
    adapterId: adapter.id,
    toolName: adapter.name,
    installed,
    reason,
    setupHint: adapter.detection.setupHint,
    executablePath,
    version: installed ? { command: executablePath ? redactPath(executablePath) : undefined, version: "unknown", output: "connection profile evidence only; no AVEVA API call performed" } : undefined,
    evidence,
    diagnostics: [{
      id: diagnosticId("aveva", installed ? "profile-evidence" : "not-configured"),
      severity: installed ? "warning" : "warning",
      code: installed ? "aveva.profile.evidence_only" : "aveva.connection.not_configured",
      message: reason,
      gate: "human_approval",
      gateStatus: "not_run",
    }],
    detectedAt: now,
  };
}

export function runAvevaBridgeAdapterTask(input: AvevaRunInput): ToolRunResult {
  const { adapter, request, workspace, detection, commandPreview, inputArtifacts } = input;
  const mode = request.mode || "dry-run";
  const parsed = parseAvevaRequest(request.avevaRequest);
  if (!parsed.ok) {
    return blockedAvevaRun({ adapter, mode, detection, message: parsed.error, code: "aveva.invalid_request" });
  }
  let outputDir: string;
  try {
    outputDir = safeAvevaOutputDir(workspace, request.artifactDir || parsed.request.outputDir, mode);
  } catch (error) {
    return blockedAvevaRun({ adapter, mode, detection, message: errorMessage(error), code: "aveva.output_path_rejected" });
  }
  if (request.allowNetwork === true) {
    return blockedAvevaRun({ adapter, mode, detection, message: "AVEVA bridge forbids network access in Sprint 6G; real enterprise connector use must be explicitly configured and authorized later.", code: "aveva.network_blocked" });
  }
  if (mode === "execute") {
    if (!detection.installed) {
      return blockedAvevaRun({ adapter, mode, detection, message: "AVEVA connection is not configured; only dry-run integration planning is allowed.", code: "aveva.not_configured" });
    }
    if (request.userApproved !== true) {
      return blockedAvevaRun({ adapter, mode, detection, message: "AVEVA connector execution requires explicit enterprise/user authorization.", code: "aveva.approval_required" });
    }
    return blockedAvevaRun({ adapter, mode, detection, message: "AVEVA real connector execution is external_required in Sprint 6G. Generate the integration plan and configure an approved enterprise connector outside Hi Code.", code: "aveva.external_connector_required" });
  }
  return writeAvevaDryRun({ adapter, request, exchangeRequest: parsed.request, outputDir, detection, commandPreview, inputArtifacts, validationDiagnostics: parsed.diagnostics });
}

function avevaCapability(id: string, name: string, artifactTypes: ToolCapability["artifactTypes"], requiresInstalledTool: boolean): ToolCapability {
  return {
    id,
    name,
    description: `${name} for enterprise AVEVA connector planning.`,
    domains: ["process_chemical", "energy", "manufacturing", "documentation", "qa"],
    artifactTypes,
    qualityGates: ["process_safety", "documentation_review", "human_approval"],
    dryRunSupported: true,
    requiresInstalledTool,
  };
}

function writeAvevaDryRun({ adapter, request, exchangeRequest, outputDir, detection, commandPreview, inputArtifacts, validationDiagnostics }: {
  adapter: IndustrialToolAdapter;
  request: ToolRunRequest;
  exchangeRequest: AvevaDataExchangeRequest;
  outputDir: string;
  detection: ToolDetectionResult;
  commandPreview: string[];
  inputArtifacts: string[];
  validationDiagnostics: ToolDiagnostic[];
}): ToolRunResult {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const integrationPlanPath = path.join(outputDir, "aveva-integration-plan.md");
  const schemaPath = path.join(outputDir, "data-exchange-schema.json");
  const tagListPath = path.join(outputDir, "tag-list-template.csv");
  const equipmentPath = path.join(outputDir, "equipment-list-template.csv");
  const lineListPath = path.join(outputDir, "line-list-template.csv");
  const documentRegisterPath = path.join(outputDir, "document-register-template.csv");
  const riskChecklistPath = path.join(outputDir, "sync-risk-checklist.md");
  const metadataPath = path.join(outputDir, "metadata.json");
  const profile = sanitizeProfile(exchangeRequest.connectionProfile || DEFAULT_PROFILE);
  const syncPlan = buildSyncPlan(exchangeRequest);
  const artifacts = expectedAvevaArtifacts(outputDir);
  const dataExchangeResult: AvevaDataExchangeResult = {
    schemaVersion: 1,
    simulated: true,
    external_required: true,
    manual_approval_required: true,
    connectionStatus: profile.profileName === DEFAULT_PROFILE.profileName ? "not_configured" : "profile_configured_not_connected",
    profile,
    projectReference: exchangeRequest.projectReference || {},
    syncPlan,
    artifacts,
    diagnostics: validationDiagnostics.map((item) => ({ code: item.code || item.id, severity: item.severity, message: item.message })),
  };
  const metadata = {
    schemaVersion: 1,
    adapterId: "aveva",
    generated: true,
    simulated: true,
    external_required: true,
    manual_approval_required: true,
    connectionStatus: dataExchangeResult.connectionStatus,
    plaintextCredentialsPersisted: false,
    credentialStorage: "system_keychain_or_external_connector_required",
    profile,
    requestedOperations: exchangeRequest.requestedOperations,
    inputArtifacts,
    artifacts,
    dataExchangeResult,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(integrationPlanPath, renderIntegrationPlan({ request, exchangeRequest, detection, syncPlan, artifacts }), { mode: 0o600 });
  fs.writeFileSync(schemaPath, JSON.stringify(dataExchangeSchema(), null, 2), { mode: 0o600 });
  fs.writeFileSync(tagListPath, renderCsv(["tag", "description", "system", "service", "unit", "source_system", "change_action"]), { mode: 0o600 });
  fs.writeFileSync(equipmentPath, renderCsv(["equipment_id", "equipment_type", "description", "area", "unit", "source_system", "change_action"]), { mode: 0o600 });
  fs.writeFileSync(lineListPath, renderCsv(["line_number", "from", "to", "fluid", "spec", "diameter", "source_system", "change_action"]), { mode: 0o600 });
  fs.writeFileSync(documentRegisterPath, renderCsv(["document_number", "title", "revision", "discipline", "status", "source_system", "change_action"]), { mode: 0o600 });
  fs.writeFileSync(riskChecklistPath, renderRiskChecklist(syncPlan), { mode: 0o600 });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  const outputArtifacts = [
    artifact("aveva-integration-plan", integrationPlanPath),
    artifact("aveva-data-exchange-schema", schemaPath),
    artifact("aveva-tag-list-template", tagListPath),
    artifact("aveva-equipment-list-template", equipmentPath),
    artifact("aveva-line-list-template", lineListPath),
    artifact("aveva-document-register-template", documentRegisterPath),
    artifact("aveva-sync-risk-checklist", riskChecklistPath),
    artifact("aveva-metadata", metadataPath),
  ];
  return {
    ok: true,
    adapterId: adapter.id,
    mode: "dry-run",
    simulated: true,
    summary: "AVEVA integration dry-run generated schemas, CSV templates, sync checklist, and metadata without connecting to an enterprise system.",
    commandPreview: commandPreview.length ? commandPreview : ["aveva-external-connector", "--dry-run", "--profile", profile.profileName],
    artifacts: outputArtifacts,
    diagnostics: [
      ...detection.diagnostics,
      ...validationDiagnostics,
      diagnostic("aveva.dry_run.generated", "info", "Dry-run generated AVEVA integration plan and templates only; no AVEVA connection was opened.", "documentation_review", "simulated"),
      diagnostic("aveva.manual_approval.required", "warning", "Manual enterprise approval is required before any real AVEVA sync.", "human_approval", "not_run"),
    ],
    detection,
  };
}

function parseAvevaRequest(value: unknown): { ok: true; request: AvevaDataExchangeRequest; diagnostics: ToolDiagnostic[] } | { ok: false; error: string } {
  try {
    if (containsPlainCredential(value)) throw new Error("plaintext credentials are not allowed in AVEVA profiles; use system keychain or external connector references");
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const profile = parseProfile(raw.connectionProfile);
    const requestedOperations = normalizeOperations(raw.requestedOperations, profile.allowedOperations.length ? profile.allowedOperations : DEFAULT_PROFILE.allowedOperations);
    const unsupported = requestedOperations.filter((operation) => !profile.allowedOperations.includes(operation));
    if (unsupported.length) throw new Error(`AVEVA requested operation is not allowed by profile: ${unsupported.join(", ")}`);
    const request: AvevaDataExchangeRequest = {
      connectionProfile: profile,
      projectReference: parseProjectReference(raw.projectReference, profile),
      requestedOperations,
      outputDir: cleanText(raw.outputDir) || undefined,
      sourceFormat: normalizeFormat(raw.sourceFormat),
      targetFormat: normalizeFormat(raw.targetFormat),
      includeTemplates: raw.includeTemplates !== false,
    };
    const diagnostics = profileDiagnostics(profile, request);
    return { ok: true, request, diagnostics };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function parseProfile(value: unknown): AvevaConnectionProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PROFILE, workspaceMapping: { ...DEFAULT_PROFILE.workspaceMapping }, allowedOperations: [...DEFAULT_PROFILE.allowedOperations] };
  const raw = value as Record<string, unknown>;
  const profile: AvevaConnectionProfile = {
    profileName: safeName(raw.profileName) || DEFAULT_PROFILE.profileName,
    systemType: normalizeSystemType(raw.systemType),
    endpoint: safeEndpoint(raw.endpoint),
    authMode: normalizeAuthMode(raw.authMode),
    projectId: safeOptionalText(raw.projectId),
    workspaceMapping: normalizeWorkspaceMapping(raw.workspaceMapping),
    allowedOperations: normalizeOperations(raw.allowedOperations, DEFAULT_PROFILE.allowedOperations),
    credentialRef: safeOptionalText(raw.credentialRef),
  };
  return sanitizeProfile(profile);
}

function parseProjectReference(value: unknown, profile: AvevaConnectionProfile): AvevaProjectReference {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    projectId: safeOptionalText(raw.projectId) || profile.projectId,
    projectName: safeOptionalText(raw.projectName),
    area: safeOptionalText(raw.area),
    unit: safeOptionalText(raw.unit),
    revision: safeOptionalText(raw.revision),
  };
}

function profileDiagnostics(profile: AvevaConnectionProfile, request: AvevaDataExchangeRequest): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  diagnostics.push(diagnostic("aveva.profile.validated", "info", `Connection profile ${profile.profileName} was validated without credentials.`, "human_approval", "not_run"));
  if (!profile.endpoint) {
    diagnostics.push(diagnostic("aveva.connection.not_configured", "warning", "AVEVA endpoint is not configured; dry-run templates only.", "human_approval", "not_run"));
  } else if (!/^https:\/\//i.test(profile.endpoint)) {
    diagnostics.push(diagnostic("aveva.endpoint.non_https", "warning", "AVEVA endpoint is not HTTPS. Real connectors must use enterprise-approved secure transport.", "human_approval", "warning"));
  }
  if (!profile.allowedOperations.length) {
    diagnostics.push(diagnostic("aveva.allowed_operations.empty", "warning", "No AVEVA allowed operations are configured.", "human_approval", "not_run"));
  } else {
    diagnostics.push(diagnostic("aveva.allowed_operations.validated", "info", `Allowed operations validated: ${profile.allowedOperations.join(", ")}`, "human_approval", "not_run"));
  }
  diagnostics.push(diagnostic("aveva.credentials.not_persisted", "info", "No plaintext AVEVA password, token, or secret is persisted in dry-run artifacts.", "human_approval", "not_run"));
  diagnostics.push(diagnostic("aveva.data_fields.validated", "info", `Data exchange fields validated for ${request.requestedOperations.length} requested operations.`, "documentation_review", "simulated"));
  return diagnostics;
}

function buildSyncPlan(request: AvevaDataExchangeRequest): AvevaSyncPlan {
  return {
    operations: request.requestedOperations,
    dependencies: [
      "Approved enterprise AVEVA connector profile",
      "Identity, VPN, and license access handled outside Hi Code",
      "Project data owner review of import/export scope",
      "Backup/export snapshot before any future write-back",
    ],
    approvalPoints: [
      "Data steward approves source and target systems",
      "Engineering lead approves tag/equipment/line/document field mapping",
      "IT/security approves connector endpoint and credential storage",
      "Change manager approves sync window and rollback plan",
    ],
    rollbackPlan: [
      "Do not write to AVEVA during dry-run",
      "For future connector runs, export pre-sync snapshot",
      "Keep change manifest and imported CSV copies",
      "Escalate rollback to project data owner before production write-back",
    ],
    risks: [
      "Duplicate tag/equipment identifiers",
      "Schema drift between project databases",
      "Unauthorized endpoint or expired license",
      "Unreviewed bulk update to enterprise engineering database",
    ],
  };
}

function expectedAvevaArtifacts(outputDir: string): AvevaEngineeringArtifact[] {
  const rows: Array<[AvevaEngineeringArtifact["artifactType"], string, AvevaEngineeringArtifact["format"]]> = [
    ["sync_plan", "aveva-integration-plan.md", "md"],
    ["metadata", "data-exchange-schema.json", "json"],
    ["tag_list", "tag-list-template.csv", "csv"],
    ["equipment_list", "equipment-list-template.csv", "csv"],
    ["line_list", "line-list-template.csv", "csv"],
    ["document_register", "document-register-template.csv", "csv"],
    ["risk_checklist", "sync-risk-checklist.md", "md"],
    ["metadata", "metadata.json", "json"],
  ];
  return rows.map(([artifactType, name, format]) => ({
    artifactType,
    path: path.join(outputDir, name),
    format,
    generated: true,
    simulated: true,
    external_required: true,
    manual_approval_required: true,
  }));
}

function renderIntegrationPlan({ request, exchangeRequest, detection, syncPlan, artifacts }: {
  request: ToolRunRequest;
  exchangeRequest: AvevaDataExchangeRequest;
  detection: ToolDetectionResult;
  syncPlan: AvevaSyncPlan;
  artifacts: AvevaEngineeringArtifact[];
}): string {
  const profile = exchangeRequest.connectionProfile || DEFAULT_PROFILE;
  return [
    "# AVEVA Integration Plan",
    "",
    `Task: ${request.task}`,
    `Profile: ${profile.profileName}`,
    `System type: ${profile.systemType}`,
    `Endpoint configured: ${profile.endpoint ? "yes" : "no"}`,
    `Detection: ${detection.reason}`,
    "",
    "## Boundary",
    "",
    "- This is a dry-run bridge package.",
    "- Hi Code did not connect to AVEVA, VPN, project databases, or licensed APIs.",
    "- Credentials must use enterprise SSO, system keychain, or an external connector reference.",
    "- Any future sync requires explicit data-owner and security approval.",
    "",
    "## Requested Operations",
    "",
    ...exchangeRequest.requestedOperations.map((operation) => `- ${operation}`),
    "",
    "## Approval Points",
    "",
    ...syncPlan.approvalPoints.map((item) => `- ${item}`),
    "",
    "## Generated Dry-run Artifacts",
    "",
    ...artifacts.map((item) => `- ${path.basename(item.path)}: generated=${item.generated}; simulated=${item.simulated}; external_required=${item.external_required}; manual_approval_required=${item.manual_approval_required}`),
    "",
  ].join("\n");
}

function dataExchangeSchema(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    connectionProfile: {
      required: ["profileName", "systemType", "authMode", "projectId", "workspaceMapping", "allowedOperations"],
      credentialPolicy: "plaintext passwords/tokens/secrets are rejected; use credentialRef backed by system security storage or external connector",
    },
    tables: {
      tagList: ["tag", "description", "system", "service", "unit", "source_system", "change_action"],
      equipmentList: ["equipment_id", "equipment_type", "description", "area", "unit", "source_system", "change_action"],
      pipingLineList: ["line_number", "from", "to", "fluid", "spec", "diameter", "source_system", "change_action"],
      documentRegister: ["document_number", "title", "revision", "discipline", "status", "source_system", "change_action"],
    },
    resultFlags: {
      simulated: true,
      external_required: true,
      manual_approval_required: true,
    },
  };
}

function renderRiskChecklist(syncPlan: AvevaSyncPlan): string {
  return [
    "# AVEVA Sync Risk Checklist",
    "",
    "## Required Approval",
    "",
    ...syncPlan.approvalPoints.map((item) => `- [ ] ${item}`),
    "",
    "## Risks",
    "",
    ...syncPlan.risks.map((item) => `- [ ] ${item}`),
    "",
    "## Rollback Planning",
    "",
    ...syncPlan.rollbackPlan.map((item) => `- [ ] ${item}`),
    "",
    "No real AVEVA connection or sync is performed by this dry-run package.",
    "",
  ].join("\n");
}

function renderCsv(columns: string[]): string {
  return `${columns.join(",")}\n${columns.map(() => "").join(",")}\n`;
}

function blockedAvevaRun({ adapter, mode, detection, message, code }: { adapter: IndustrialToolAdapter; mode: "dry-run" | "execute"; detection: ToolDetectionResult; message: string; code: string }): ToolRunResult {
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

function artifact(type: string, filePath: string): ToolArtifact {
  return {
    id: `tool-artifact-${hash(`${type}:${filePath}`).slice(0, 12)}`,
    type,
    path: filePath,
    name: path.basename(filePath),
    simulated: true,
    metadata: {
      adapterId: "aveva",
      mode: "dry-run",
      generated: true,
      simulated: true,
      external_required: true,
      manual_approval_required: true,
      sha256: fileHash(filePath),
    },
  };
}

function collectAvevaEvidence({ adapter, manual, env, pathEnv }: {
  adapter: IndustrialToolAdapter;
  manual?: string;
  env: NodeJS.ProcessEnv;
  pathEnv: string;
}): AvevaDetectionEvidence {
  const commands = (adapter.detection.commands || []).map((command) => {
    const found = findCommand(command, pathEnv);
    return { command, found: !!found, path: found || undefined };
  });
  const executablePaths = (manual ? [manual] : []).map((candidate) => {
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
  return { commands, executablePaths, environment, configPaths };
}

function safeAvevaOutputDir(workspace: string, requested: string | undefined, mode: string): string {
  const artifactRoot = path.join(workspace, ".hicode", "artifacts");
  const base = requested
    ? path.resolve(workspace, requested)
    : path.join(artifactRoot, "aveva", `${mode}-${Date.now().toString(36)}`);
  assertInside(workspace, base, "AVEVA output path escapes workspace");
  assertInside(artifactRoot, base, "AVEVA output path must stay under .hicode/artifacts");
  return base;
}

function sanitizeProfile(profile: AvevaConnectionProfile): AvevaConnectionProfile {
  return {
    profileName: profile.profileName,
    systemType: profile.systemType,
    endpoint: profile.endpoint,
    authMode: profile.authMode,
    projectId: profile.projectId,
    workspaceMapping: { ...profile.workspaceMapping },
    allowedOperations: [...profile.allowedOperations],
    credentialRef: profile.credentialRef,
  };
}

function containsPlainCredential(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPlainCredential);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CREDENTIAL_FIELDS.some((field) => field.toLowerCase() === key.toLowerCase()) && entry) return true;
    if (containsPlainCredential(entry)) return true;
  }
  return false;
}

function normalizeSystemType(value: unknown): AvevaSystemType {
  const text = cleanText(value).toLowerCase();
  const allowed: AvevaSystemType[] = ["aveva-engineering", "aveva-e3d", "aveva-net", "aveva-pi", "aveva-enterprise-data-platform", "manual-external"];
  if (!text) return DEFAULT_PROFILE.systemType;
  if (allowed.includes(text as AvevaSystemType)) return text as AvevaSystemType;
  throw new Error("AVEVA systemType is invalid");
}

function normalizeAuthMode(value: unknown): AvevaAuthMode {
  const text = cleanText(value).toLowerCase();
  const allowed: AvevaAuthMode[] = ["sso", "system_keychain", "service_account_reference", "manual_external"];
  if (!text) return DEFAULT_PROFILE.authMode;
  if (allowed.includes(text as AvevaAuthMode)) return text as AvevaAuthMode;
  throw new Error("AVEVA authMode is invalid");
}

function normalizeFormat(value: unknown): "csv" | "json" {
  const text = cleanText(value).toLowerCase();
  if (!text || text === "csv") return "csv";
  if (text === "json") return "json";
  throw new Error("AVEVA exchange format must be csv or json");
}

function normalizeOperations(value: unknown, fallback: AvevaAllowedOperation[]): AvevaAllowedOperation[] {
  const values = Array.isArray(value) ? value.map((item) => cleanText(item)).filter(Boolean) : [];
  const operations = values.length ? values : fallback;
  const invalid = operations.filter((operation) => !AVEVA_OPERATIONS.includes(operation as AvevaAllowedOperation));
  if (invalid.length) throw new Error(`AVEVA allowed operation is invalid: ${invalid.join(", ")}`);
  return unique(operations as AvevaAllowedOperation[]);
}

function normalizeWorkspaceMapping(value: unknown): Record<string, string> {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : DEFAULT_PROFILE.workspaceMapping;
  const mapped: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const safeKey = safeName(key);
    const safeValue = safeOptionalText(entry);
    if (safeKey && safeValue) mapped[safeKey] = safeValue;
  }
  return Object.keys(mapped).length ? mapped : { ...DEFAULT_PROFILE.workspaceMapping };
}

function safeEndpoint(value: unknown): string | undefined {
  const text = safeOptionalText(value);
  if (!text) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) throw new Error("AVEVA endpoint must be a URL");
  return text;
}

function safeName(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  if (/[\0\r\n]/.test(text)) throw new Error("AVEVA profile fields must not contain control characters");
  return text.replace(/[^a-z0-9._:-]/gi, "-").slice(0, 120);
}

function safeOptionalText(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/[\0\r\n]/.test(text)) throw new Error("AVEVA text fields must not contain control characters");
  if (text.length > 1000) throw new Error("AVEVA text field is too long");
  return text;
}

function normalizeManualPath(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/[\0\r\n]/.test(text)) throw new Error("AVEVA connector path must not contain control characters");
  return expandPath(text, env);
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
  expanded = expanded.replace(/%([A-Z0-9_]+)%/gi, (_match, name) => env[name] || "");
  return path.resolve(expanded);
}

function assertInside(root: string, target: string, message: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(message);
}

function diagnostic(code: string, severity: "info" | "warning" | "error", message: string, gate: string, gateStatus: ToolDiagnostic["gateStatus"] = "not_run"): ToolDiagnostic {
  return {
    id: `diag-aveva-${code.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`,
    severity,
    code,
    message,
    gate,
    gateStatus,
  };
}

function diagnosticId(adapterId: string, suffix: string): string {
  return `diag-${adapterId}-${suffix}-${Date.now().toString(36)}`;
}

function fileHash(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function redactPath(value: string): string {
  const home = process.env.HOME || "";
  return home && value.startsWith(home) ? value.replace(home, "~") : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "AVEVA bridge adapter error");
}
