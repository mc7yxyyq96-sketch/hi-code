import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  INDUSTRIAL_DOMAIN_KEYS,
  INDUSTRIAL_GATE_TYPES,
  type IndustrialDomainKey,
  type IndustrialGateType,
} from "./industrial-project.js";

export const DOMAIN_PACK_MANIFEST_FILE = "hicode.domain.json";
export const DOMAIN_PACK_STATE_FILE = "domain-packs.json";

export interface DomainStandard {
  id: string;
  name: string;
  version?: string;
  domains: IndustrialDomainKey[];
  notes?: string;
  url?: string;
}

export interface DomainTemplate {
  id: string;
  name: string;
  type: string;
  path: string;
  description?: string;
  content: string;
}

export interface DomainChecklist {
  id: string;
  name: string;
  type: string;
  path: string;
  items: string[];
}

export interface DomainToolRequirement {
  id: string;
  name: string;
  type: string;
  required: boolean;
  executable?: string;
  domains: IndustrialDomainKey[];
  dryRunSupported: boolean;
  notes?: string;
  permissions: string[];
}

export interface DomainQualityGate {
  id: string;
  name: string;
  type: IndustrialGateType;
  description?: string;
  required: boolean;
  automated: boolean;
}

export interface DomainAgentProfile {
  id: string;
  name: string;
  role: string;
  domains: IndustrialDomainKey[];
  instructions: string[];
  permissions: string[];
}

export interface DomainPackManifest {
  id: string;
  name: string;
  version: string;
  domains: IndustrialDomainKey[];
  description: string;
  standards: DomainStandard[];
  templates: DomainTemplate[];
  checklists: DomainChecklist[];
  toolRequirements: DomainToolRequirement[];
  qualityGates: DomainQualityGate[];
  agentProfiles: DomainAgentProfile[];
  sampleProjects: string[];
  sha256?: string;
  signature?: string;
  signatureAlgorithm?: string;
}

export interface DomainPack {
  manifest: DomainPackManifest;
  source: "builtin" | "installed" | "remote";
  installed: boolean;
  enabled: boolean;
  path?: string;
  installedAt?: number;
  updatedAt?: number;
}

export interface DomainPackState {
  installed: Record<string, {
    id: string;
    version: string;
    enabled: boolean;
    path: string;
    source: DomainPack["source"];
    installedAt: number;
    updatedAt: number;
  }>;
}

export interface DomainPackValidationResult {
  ok: boolean;
  manifest?: DomainPackManifest;
  errors: string[];
}

export interface DomainPackManagerOptions {
  safeRoot: string;
}

export interface InstallDomainPackInput {
  id?: string;
  manifest?: unknown;
  source?: DomainPack["source"];
  sourceUrl?: string;
  actor?: string;
  allowUnverified?: boolean;
}

export class DomainPackManager {
  private readonly safeRoot: string;
  private readonly installRoot: string;
  private readonly statePath: string;

  constructor(options: DomainPackManagerOptions) {
    if (!options?.safeRoot) throw new Error("DomainPackManager requires safeRoot");
    this.safeRoot = path.resolve(options.safeRoot);
    this.installRoot = path.join(this.safeRoot, "installed");
    this.statePath = path.join(this.safeRoot, DOMAIN_PACK_STATE_FILE);
    assertInside(this.safeRoot, this.installRoot);
    assertInside(this.safeRoot, this.statePath);
  }

  listDomainPacks(): DomainPack[] {
    const state = this.loadState();
    const packs = BUILTIN_DOMAIN_PACKS.map((manifest) => this.packFromManifest(manifest, "builtin", state));
    for (const entry of Object.values(state.installed)) {
      if (packs.some((pack) => pack.manifest.id === entry.id)) continue;
      const manifest = this.readInstalledManifest(entry);
      if (manifest) packs.push(this.packFromManifest(manifest, entry.source, state));
    }
    return packs.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }

  getDomainPack(id: string): DomainPack | null {
    const clean = cleanId(id);
    return this.listDomainPacks().find((pack) => pack.manifest.id === clean) || null;
  }

  installDomainPack(input: InstallDomainPackInput): DomainPack {
    const source = normalizeSource(input.source);
    if (source === "remote") {
      validateRemoteUrl(input.sourceUrl);
    }
    let manifest: DomainPackManifest | null | undefined;
    if (input.manifest) {
      const result = validateDomainPackManifest(input.manifest, { remote: source === "remote" });
      if (!result.ok || !result.manifest) throw new Error(`invalid domain pack manifest: ${result.errors.join("; ")}`);
      manifest = result.manifest;
    } else {
      manifest = this.builtinManifest(input.id);
    }
    if (!manifest) throw new Error("domain pack manifest is required");
    if (!input.allowUnverified && source === "remote" && !manifest.sha256 && !manifest.signature) {
      throw new Error("remote domain pack requires sha256 or signature unless explicitly allowed");
    }
    const packDir = this.packInstallDir(manifest.id);
    fs.mkdirSync(packDir, { recursive: true, mode: 0o700 });
    this.writePackFiles(packDir, manifest);
    const state = this.loadState();
    const now = Date.now();
    state.installed[manifest.id] = {
      id: manifest.id,
      version: manifest.version,
      enabled: state.installed[manifest.id]?.enabled || false,
      path: packDir,
      source,
      installedAt: state.installed[manifest.id]?.installedAt || now,
      updatedAt: now,
    };
    this.saveState(state);
    return this.packFromManifest(manifest, source, state);
  }

  updateDomainPack(input: InstallDomainPackInput): DomainPack {
    return this.installDomainPack(input);
  }

  enableDomainPack(id: string): DomainPack {
    const state = this.loadState();
    const pack = this.requireInstalled(id, state);
    pack.enabled = true;
    pack.updatedAt = Date.now();
    this.saveState(state);
    const manifest = this.readInstalledManifest(pack) || this.builtinManifest(pack.id);
    if (!manifest) throw new Error("domain pack manifest not found");
    return this.packFromManifest(manifest, pack.source, state);
  }

  disableDomainPack(id: string): DomainPack {
    const state = this.loadState();
    const pack = this.requireInstalled(id, state);
    pack.enabled = false;
    pack.updatedAt = Date.now();
    this.saveState(state);
    const manifest = this.readInstalledManifest(pack) || this.builtinManifest(pack.id);
    if (!manifest) throw new Error("domain pack manifest not found");
    return this.packFromManifest(manifest, pack.source, state);
  }

  uninstallDomainPack(id: string): { ok: true; id: string } {
    const state = this.loadState();
    const clean = cleanId(id);
    const entry = state.installed[clean];
    if (!entry) throw new Error("domain pack is not installed");
    assertInside(this.safeRoot, entry.path);
    fs.rmSync(entry.path, { recursive: true, force: true });
    delete state.installed[clean];
    this.saveState(state);
    return { ok: true, id: clean };
  }

  validateDomainPack(value: unknown, options: { remote?: boolean } = {}): DomainPackValidationResult {
    return validateDomainPackManifest(value, options);
  }

  recommendForDomains(domains: string[]): DomainPack[] {
    const domainSet = new Set(domains.filter(isDomain));
    return this.listDomainPacks().filter((pack) => pack.manifest.domains.some((domain) => domainSet.has(domain)));
  }

  private packFromManifest(manifest: DomainPackManifest, source: DomainPack["source"], state: DomainPackState): DomainPack {
    const installed = state.installed[manifest.id];
    return {
      manifest,
      source,
      installed: !!installed,
      enabled: installed?.enabled === true,
      path: installed?.path,
      installedAt: installed?.installedAt,
      updatedAt: installed?.updatedAt,
    };
  }

  private builtinManifest(id: string | undefined): DomainPackManifest | null {
    const clean = cleanId(id);
    const manifest = BUILTIN_DOMAIN_PACKS.find((pack) => pack.id === clean);
    return manifest ? clone(manifest) : null;
  }

  private requireInstalled(id: string, state: DomainPackState): DomainPackState["installed"][string] {
    const clean = cleanId(id);
    const entry = state.installed[clean];
    if (!entry) throw new Error("domain pack is not installed");
    assertInside(this.safeRoot, entry.path);
    return entry;
  }

  private packInstallDir(id: string): string {
    const dir = path.join(this.installRoot, cleanId(id));
    assertInside(this.safeRoot, dir);
    return dir;
  }

  private writePackFiles(packDir: string, manifest: DomainPackManifest): void {
    const result = validateDomainPackManifest(manifest);
    if (!result.ok || !result.manifest) throw new Error(`invalid domain pack manifest: ${result.errors.join("; ")}`);
    const normalized = result.manifest;
    fs.writeFileSync(path.join(packDir, DOMAIN_PACK_MANIFEST_FILE), JSON.stringify(normalized, null, 2), { mode: 0o600 });
    for (const template of normalized.templates) writeRelativeFile(packDir, template.path, template.content);
    for (const checklist of normalized.checklists) writeRelativeFile(packDir, checklist.path, checklist.items.map((item) => `- [ ] ${item}`).join("\n"));
  }

  private readInstalledManifest(entry: DomainPackState["installed"][string]): DomainPackManifest | null {
    try {
      const file = path.join(entry.path, DOMAIN_PACK_MANIFEST_FILE);
      assertInside(this.safeRoot, file);
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const result = validateDomainPackManifest(parsed);
      return result.ok && result.manifest ? result.manifest : null;
    } catch {
      return null;
    }
  }

  private loadState(): DomainPackState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return { installed: parsed && typeof parsed.installed === "object" && !Array.isArray(parsed.installed) ? parsed.installed : {} };
    } catch {
      return { installed: {} };
    }
  }

  private saveState(state: DomainPackState): void {
    fs.mkdirSync(this.safeRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
}

export function validateDomainPackManifest(value: unknown, options: { remote?: boolean } = {}): DomainPackValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: ["manifest must be an object"] };
  const raw = value as Partial<DomainPackManifest> & Record<string, unknown>;
  rejectScriptFields(raw, errors);
  const id = cleanId(raw.id);
  if (!id) errors.push("id is required");
  const name = requiredText(raw.name, "name", errors);
  const version = requiredText(raw.version, "version", errors);
  if (version && !/^\d+\.\d+\.\d+[-+a-zA-Z0-9.]*$/.test(version)) errors.push("version must be semver-like");
  const description = requiredText(raw.description, "description", errors);
  const domains = normalizeDomains(raw.domains, errors);
  const standards = arrayOf(raw.standards, "standards", errors).map((item) => normalizeStandard(item, errors));
  const templates = arrayOf(raw.templates, "templates", errors).map((item) => normalizeTemplate(item, errors, options.remote === true));
  const checklists = arrayOf(raw.checklists, "checklists", errors).map((item) => normalizeChecklist(item, errors, options.remote === true));
  const toolRequirements = arrayOf(raw.toolRequirements, "toolRequirements", errors).map((item) => normalizeToolRequirement(item, errors));
  const qualityGates = arrayOf(raw.qualityGates, "qualityGates", errors).map((item) => normalizeQualityGate(item, errors));
  const agentProfiles = arrayOf(raw.agentProfiles, "agentProfiles", errors).map((item) => normalizeAgentProfile(item, errors));
  const sampleProjects = stringArray(raw.sampleProjects).filter((item) => validateSafeReference(item, "sampleProjects", errors, options.remote === true));
  if (!domains.length) errors.push("domains must contain at least one known domain");
  if (options.remote) rejectRemoteLocalReferences(raw, errors);
  const sha256 = optionalSha256(raw.sha256, errors);
  const signature = cleanString(raw.signature) || undefined;
  const signatureAlgorithm = cleanString(raw.signatureAlgorithm) || undefined;
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    manifest: {
      id,
      name,
      version,
      domains,
      description,
      standards,
      templates,
      checklists,
      toolRequirements,
      qualityGates,
      agentProfiles,
      sampleProjects,
      sha256,
      signature,
      signatureAlgorithm,
    },
  };
}

export function builtInDomainPacks(): DomainPackManifest[] {
  return clone(BUILTIN_DOMAIN_PACKS);
}

export function manifestHash(manifest: DomainPackManifest): string {
  return crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function pack(id: string, name: string, domains: IndustrialDomainKey[], description: string, artifacts: string[], gates: IndustrialGateType[], tools: string[], standards: string[]): DomainPackManifest {
  const checklistItems = [
    "Requirement is captured with owner and acceptance criteria",
    "Artifact plan is linked to project traceability",
    "Quality gates are recorded before release",
    "Human approval is recorded where required",
  ];
  return {
    id,
    name,
    version: "1.0.0",
    domains,
    description,
    standards: standards.map((standard, index) => ({ id: `${id}-std-${index + 1}`, name: standard, version: "current", domains, notes: "Reference standard profile; verify applicability per project." })),
    templates: [
      { id: `${id}-requirements`, name: `${name} Requirement Template`, type: "requirement_doc", path: "templates/requirements.md", description: "Requirement capture template", content: `# ${name} Requirement\n\n## Need\n\n## Acceptance Criteria\n\n## Traceability\n` },
      { id: `${id}-artifact-plan`, name: `${name} Artifact Plan`, type: "artifact_plan", path: "templates/artifact-plan.md", description: "Artifact planning template", content: `# ${name} Artifact Plan\n\n${artifacts.map((item) => `- ${item}`).join("\n")}\n` },
    ],
    checklists: [
      { id: `${id}-release`, name: `${name} Release Checklist`, type: "release", path: "checklists/release.md", items: checklistItems },
      { id: `${id}-review`, name: `${name} Engineering Review`, type: "review", path: "checklists/review.md", items: gates.map((gate) => `${gate} gate is reviewed`) },
    ],
    toolRequirements: tools.map((tool, index) => ({ id: `${id}-tool-${index + 1}`, name: tool, type: "external_tool", required: false, domains, dryRunSupported: true, notes: "Tool adapter is not executed by Sprint 5A.", permissions: ["explicit_user_approval_required"] })),
    qualityGates: gates.map((gate) => ({ id: `${id}-gate-${gate}`, name: gate.replace(/_/g, " "), type: gate, required: true, automated: false, description: "Gate is tracked but not automatically executed in Sprint 5A." })),
    agentProfiles: [
      { id: `${id}-reviewer`, name: `${name} Reviewer`, role: "domain_reviewer", domains, instructions: ["Review requirements, artifacts, checklists, and gate evidence for this domain."], permissions: ["read_project", "write_review_notes"] },
    ],
    sampleProjects: [`samples/${id}`],
  };
}

export const BUILTIN_DOMAIN_PACKS: DomainPackManifest[] = [
  pack("software-product", "Software Product", ["software", "documentation", "qa"], "Software product requirements, source, API, testing, release, and security gates.", ["source_code", "architecture_doc", "test_plan", "release_package"], ["build", "test", "lint", "security", "documentation_review"], ["Node.js", "Git", "CI runner"], ["OWASP ASVS", "Semantic Versioning"]),
  pack("mechanical-cad", "Mechanical CAD", ["mechanical", "cad", "manufacturing", "qa"], "Mechanical CAD models, drawings, STEP exports, BOMs, and inspection evidence.", ["cad_model", "drawing", "step_file", "bom", "inspection_report"], ["cad_validation", "documentation_review", "human_approval"], ["CAD system", "STEP viewer"], ["ASME Y14.5", "ISO 10303 STEP"]),
  pack("solidworks", "SolidWorks", ["solidworks", "mechanical", "cad", "manufacturing"], "SolidWorks-focused model, drawing, BOM, rebuild, and neutral export workflow.", ["cad_model", "drawing", "step_file", "bom"], ["cad_validation", "documentation_review", "human_approval"], ["SolidWorks"], ["SolidWorks modeling practices", "ASME Y14.5"]),
  pack("pcb-eda", "PCB EDA", ["pcb", "electrical", "qa"], "PCB schematic, layout, Gerber, BOM, ERC, DRC, and fabrication release workflow.", ["schematic", "layout", "gerber", "bom"], ["pcb_erc", "pcb_drc", "documentation_review", "human_approval"], ["EDA tool", "Gerber viewer"], ["IPC-2221", "IPC-A-600"]),
  pack("plc-automation", "PLC Automation", ["plc", "automation", "electrical", "qa"], "PLC program, I/O map, wiring, FAT/SAT and commissioning planning.", ["plc_program", "io_map", "wiring_diagram", "test_plan"], ["plc_compile", "test", "documentation_review", "human_approval"], ["PLC IDE", "I/O simulator"], ["IEC 61131-3", "ISA-88"]),
  pack("bim-architecture", "BIM Architecture", ["bim", "architecture", "documentation", "qa"], "BIM/architecture IFC, floor plan, code check, clash review, and release package planning.", ["ifc_model", "drawing", "architecture_doc", "inspection_report"], ["bim_check", "documentation_review", "human_approval"], ["BIM authoring tool", "IFC viewer"], ["IFC", "Local building code"]),
  pack("process-chemical", "Process Chemical", ["process_chemical", "materials", "qa"], "Process requirements, PFD/P&ID evidence, material balance, HAZOP, and safety reviews.", ["pid_diagram", "simulation_report", "material_spec", "test_plan"], ["process_safety", "documentation_review", "human_approval"], ["Process simulator", "P&ID tool"], ["HAZOP", "API process safety guidance"]),
  pack("energy-electrical", "Energy Electrical", ["energy", "electrical", "automation", "qa"], "Energy and electrical design package with load flow, single-line, protection and commissioning evidence.", ["simulation_report", "wiring_diagram", "material_spec", "inspection_report"], ["energy_simulation", "documentation_review", "human_approval"], ["Load flow tool", "Protection setting tool"], ["IEEE power systems practices", "IEC electrical safety"]),
  pack("materials-engineering", "Materials Engineering", ["materials", "manufacturing", "qa"], "Material specification, test report, supplier certificate and inspection planning workflow.", ["material_spec", "test_plan", "inspection_report"], ["test", "documentation_review", "human_approval"], ["Material test lab system"], ["ASTM material standards", "ISO 9001"]),
  pack("manufacturing-qa", "Manufacturing QA", ["manufacturing", "qa", "documentation"], "Manufacturing release, BOM, inspection, pilot build, and quality review workflow.", ["drawing", "bom", "inspection_report", "release_package"], ["test", "documentation_review", "human_approval"], ["MES/QMS", "Inspection tool"], ["ISO 9001", "APQP"]),
];

function normalizeStandard(value: unknown, errors: string[]): DomainStandard {
  const item = objectValue(value, "standard", errors);
  return {
    id: requiredId(item.id, "standard.id", errors),
    name: requiredText(item.name, "standard.name", errors),
    version: cleanString(item.version) || undefined,
    domains: normalizeDomains(item.domains, errors),
    notes: cleanString(item.notes) || undefined,
    url: safeOptionalUrl(item.url, "standard.url", errors),
  };
}

function normalizeTemplate(value: unknown, errors: string[], remote: boolean): DomainTemplate {
  const item = objectValue(value, "template", errors);
  const templatePath = requiredRelativePath(item.path, "template.path", errors, remote);
  return {
    id: requiredId(item.id, "template.id", errors),
    name: requiredText(item.name, "template.name", errors),
    type: requiredText(item.type, "template.type", errors),
    path: templatePath,
    description: cleanString(item.description) || undefined,
    content: requiredText(item.content, "template.content", errors),
  };
}

function normalizeChecklist(value: unknown, errors: string[], remote: boolean): DomainChecklist {
  const item = objectValue(value, "checklist", errors);
  return {
    id: requiredId(item.id, "checklist.id", errors),
    name: requiredText(item.name, "checklist.name", errors),
    type: requiredText(item.type, "checklist.type", errors),
    path: requiredRelativePath(item.path, "checklist.path", errors, remote),
    items: stringArray(item.items),
  };
}

function normalizeToolRequirement(value: unknown, errors: string[]): DomainToolRequirement {
  const item = objectValue(value, "toolRequirement", errors);
  if (item.command !== undefined || item.script !== undefined || item.args !== undefined) errors.push("toolRequirements cannot define executable commands or scripts");
  return {
    id: requiredId(item.id, "toolRequirement.id", errors),
    name: requiredText(item.name, "toolRequirement.name", errors),
    type: requiredText(item.type, "toolRequirement.type", errors),
    required: item.required === true,
    executable: cleanString(item.executable) || undefined,
    domains: normalizeDomains(item.domains, errors),
    dryRunSupported: item.dryRunSupported !== false,
    notes: cleanString(item.notes) || undefined,
    permissions: stringArray(item.permissions),
  };
}

function normalizeQualityGate(value: unknown, errors: string[]): DomainQualityGate {
  const item = objectValue(value, "qualityGate", errors);
  const type = cleanString(item.type);
  if (!INDUSTRIAL_GATE_TYPES.includes(type as IndustrialGateType)) errors.push(`invalid quality gate type: ${type}`);
  return {
    id: requiredId(item.id, "qualityGate.id", errors),
    name: requiredText(item.name, "qualityGate.name", errors),
    type: type as IndustrialGateType,
    description: cleanString(item.description) || undefined,
    required: item.required !== false,
    automated: item.automated === true,
  };
}

function normalizeAgentProfile(value: unknown, errors: string[]): DomainAgentProfile {
  const item = objectValue(value, "agentProfile", errors);
  return {
    id: requiredId(item.id, "agentProfile.id", errors),
    name: requiredText(item.name, "agentProfile.name", errors),
    role: requiredText(item.role, "agentProfile.role", errors),
    domains: normalizeDomains(item.domains, errors),
    instructions: stringArray(item.instructions),
    permissions: stringArray(item.permissions),
  };
}

function rejectScriptFields(value: Record<string, unknown>, errors: string[], prefix = "manifest"): void {
  for (const [key, nested] of Object.entries(value)) {
    if (/^(scripts?|postinstall|preinstall|installCommand|command|commands|exec|args)$/i.test(key)) {
      errors.push(`${prefix}.${key} is not allowed`);
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) rejectScriptFields(nested as Record<string, unknown>, errors, `${prefix}.${key}`);
  }
}

function rejectRemoteLocalReferences(value: Record<string, unknown>, errors: string[], prefix = "manifest"): void {
  for (const [key, nested] of Object.entries(value)) {
    if (["sourcePath", "sourceRoot", "localPath", "filePath"].some((field) => field.toLowerCase() === key.toLowerCase())) {
      errors.push(`${prefix}.${key} is not allowed for remote packs`);
    }
    if (typeof nested === "string" && looksLocalReference(nested)) errors.push(`${prefix}.${key} must not reference a local path`);
    if (nested && typeof nested === "object" && !Array.isArray(nested)) rejectRemoteLocalReferences(nested as Record<string, unknown>, errors, `${prefix}.${key}`);
  }
}

function validateRemoteUrl(url: unknown): void {
  const text = cleanString(url);
  if (!text) throw new Error("remote domain pack sourceUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("remote domain pack sourceUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("remote domain pack sourceUrl must use HTTPS");
}

function writeRelativeFile(root: string, filePath: string, content: string): void {
  const target = path.join(root, filePath);
  assertInside(root, target);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600 });
}

function requiredRelativePath(value: unknown, field: string, errors: string[], remote: boolean): string {
  const text = requiredText(value, field, errors);
  if (text && !validateSafeReference(text, field, errors, remote)) return "";
  return text;
}

function validateSafeReference(value: string, field: string, errors: string[], remote: boolean): boolean {
  if (path.isAbsolute(value) || value.includes("..") || value.startsWith("~") || looksLocalReference(value)) {
    errors.push(`${field} must be a safe relative reference`);
    return false;
  }
  if (remote && /^https?:/i.test(value)) {
    errors.push(`${field} must be packaged relative content, not a second remote URL`);
    return false;
  }
  return true;
}

function looksLocalReference(value: string): boolean {
  return /^file:/i.test(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\");
}

function arrayOf(value: unknown, field: string, errors: string[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return value;
}

function normalizeDomains(value: unknown, errors: string[]): IndustrialDomainKey[] {
  const domains = stringArray(value).filter((domain) => {
    if (isDomain(domain)) return true;
    errors.push(`invalid domain: ${domain}`);
    return false;
  }) as IndustrialDomainKey[];
  return Array.from(new Set(domains));
}

function objectValue(value: unknown, field: string, errors: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown, field: string, errors: string[]): string {
  const id = cleanId(value);
  if (!id) errors.push(`${field} is required`);
  return id;
}

function requiredText(value: unknown, field: string, errors: string[]): string {
  const text = cleanString(value);
  if (!text) errors.push(`${field} is required`);
  return text;
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[^a-z0-9._:-]/gi, "-").slice(0, 120) : "";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))) : [];
}

function safeOptionalUrl(value: unknown, field: string, errors: string[]): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") errors.push(`${field} must use HTTPS`);
    return text;
  } catch {
    errors.push(`${field} must be a valid URL`);
    return undefined;
  }
}

function optionalSha256(value: unknown, errors: string[]): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  if (!/^[a-fA-F0-9]{64}$/.test(text)) errors.push("sha256 must be 64 hex characters");
  return text.toLowerCase();
}

function normalizeSource(value: unknown): DomainPack["source"] {
  return value === "remote" || value === "installed" ? value : "builtin";
}

function isDomain(value: unknown): value is IndustrialDomainKey {
  return typeof value === "string" && INDUSTRIAL_DOMAIN_KEYS.includes(value as IndustrialDomainKey);
}

function assertInside(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("domain pack path escapes safe root");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
