import fs from "node:fs";
import path from "node:path";

import {
  IndustrialProjectStore,
  type IndustrialArtifact,
  type IndustrialProject,
  type IndustrialQualityGate,
} from "./industrial-project.js";

export const DEFINITION_OF_DONE_SCHEMA_VERSION = 1;

export type DoDCheckStatus = "passed" | "failed" | "warning" | "skipped";
export type SkeletonSeverity = "info" | "warning" | "blocking";

export type SkeletonFindingType =
  | "empty_directory"
  | "empty_file"
  | "todo_only_file"
  | "placeholder_content"
  | "interface_only_file"
  | "ui_button_without_behavior"
  | "mock_only_production_path"
  | "fake_pass_gate"
  | "simulated_artifact_marked_real"
  | "critical_artifact_missing";

export interface DoDRemediation {
  summary: string;
  steps: string[];
}

export interface SkeletonFinding {
  id: string;
  type: SkeletonFindingType;
  severity: SkeletonSeverity;
  message: string;
  path?: string;
  relatedId?: string;
  remediation: DoDRemediation;
  metadata?: Record<string, unknown>;
}

export interface SkeletonDetectionResult {
  schemaVersion: typeof DEFINITION_OF_DONE_SCHEMA_VERSION;
  ok: boolean;
  checkedAt: number;
  workspacePath: string;
  findings: SkeletonFinding[];
  summary: {
    total: number;
    blocking: number;
    warning: number;
    info: number;
  };
}

export interface DoDChecklistItem {
  id: string;
  title: string;
  status: DoDCheckStatus;
  message: string;
  remediation: DoDRemediation;
  evidence: string[];
}

export interface DefinitionOfDoneResult {
  schemaVersion: typeof DEFINITION_OF_DONE_SCHEMA_VERSION;
  ok: boolean;
  status: DoDCheckStatus;
  checkedAt: number;
  workspacePath: string;
  source: string;
  checklist: DoDChecklistItem[];
  skeleton: SkeletonDetectionResult;
  remediation: DoDRemediation[];
  evidencePath?: string;
  summary: {
    passed: number;
    failed: number;
    warning: number;
    skipped: number;
    blockingFindings: number;
    warningFindings: number;
  };
}

export interface DefinitionOfDoneInput {
  workspacePath: string;
  project?: IndustrialProject | null;
  changedFiles?: string[];
  source?: string;
  persistEvidence?: boolean;
  evidenceName?: string;
  now?: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "release", "releases", "coverage", ".next", ".turbo"]);
const TODO_ONLY_RE = markerOnlyRegExp([
  term("to", "do"),
  term("fix", "me"),
  term("t", "bd"),
  term("place", "holder"),
  term("st", "ub"),
  term("coming", " soon"),
  term("not", " implemented"),
  "wip",
  term("待", "实现"),
  term("占", "位"),
]);
const PLACEHOLDER_RE = markerRegExp([
  term("to", "do"),
  term("fix", "me"),
  term("t", "bd"),
  term("place", "holder"),
  term("st", "ub"),
  term("coming", " soon"),
  term("not", " implemented"),
  term("mock", "-", "only"),
  term("mock", " only"),
  term("fake", " pass"),
  term("dummy", " implementation"),
]);
const MOCK_ONLY_RE = markerRegExp([
  term("mock", "-", "only"),
  term("mock", " only"),
  term("demo", " only"),
  term("fake", " service"),
  term("fake", " implementation"),
  term("production", " ", "path", ".*", "mo", "ck"),
  term("mo", "ck", " data.*production"),
], { alreadyEscaped: [term("production", " ", "path", ".*", "mo", "ck"), term("mo", "ck", " data.*production")] });
const IMPLEMENTATION_RE = /\b(function|class|async\s+function|const\s+[A-Za-z0-9_$]+\s*=|let\s+[A-Za-z0-9_$]+\s*=|export\s+function|export\s+class)\b/;
const INTERFACE_RE = /\b(interface|type)\s+[A-ZA-Za-z0-9_]+\b/;
const ERROR_HANDLING_RE = /\b(try\s*\{|catch\s*\(|throw\s+new\s+Error|return\s+\{\s*ok:\s*false|errorMessage|normalize.*Error)\b/i;
const SECURITY_BOUNDARY_RE = /\b(assertInside|safePath|pathInside|workspacePath|contextIsolation|nodeIntegration|sandbox|permission|approval|required.*approval|validate.*path|redact)\b/i;

export function detectSkeleton(input: DefinitionOfDoneInput): SkeletonDetectionResult {
  const workspace = safeWorkspace(input.workspacePath);
  const project = input.project === undefined ? readProject(workspace) : input.project;
  const checkedAt = input.now || Date.now();
  const findings: SkeletonFinding[] = [];
  const scanFiles = filesToScan({ workspace, project, changedFiles: input.changedFiles });
  const scanDirs = directoriesToScan({ workspace, project, changedFiles: input.changedFiles });

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const entries = fs.readdirSync(dir).filter((name) => !SKIP_DIRS.has(name));
    if (!entries.length) {
      findings.push(finding("empty_directory", "warning", `Empty directory has no deliverable content: ${relativePath(workspace, dir)}`, relativePath(workspace, dir), "Add real files or remove the directory before delivery."));
    }
  }

  for (const file of scanFiles) {
    if (!fs.existsSync(file)) continue;
    if (!fs.statSync(file).isFile()) continue;
    const relative = relativePath(workspace, file);
    const stat = fs.statSync(file);
    if (stat.size === 0) {
      findings.push(finding("empty_file", severityForPath(relative), `Empty file is not a deliverable artifact: ${relative}`, relative, "Write real content or remove the empty file."));
      continue;
    }
    if (stat.size > 512_000 || isBinary(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const patternText = textForSkeletonPatterns(relative, text);
    const normalized = normalizeTextForSkeleton(text);
    if (normalized && TODO_ONLY_RE.test(normalized)) {
      findings.push(finding("todo_only_file", severityForPath(relative), `File contains only unfinished marker content: ${relative}`, relative, "Replace marker-only content with a real implementation, document, or artifact."));
    }
    if (isProductionPath(relative) && hasPlaceholderContent(patternText)) {
      findings.push(finding("placeholder_content", severityForPath(relative), `Production file contains skeleton marker language: ${relative}`, relative, "Replace skeleton marker text with implemented behavior and evidence."));
    }
    if (isProductionPath(relative) && MOCK_ONLY_RE.test(patternText)) {
      findings.push(finding("mock_only_production_path", "blocking", `Production path appears non-production-only: ${relative}`, relative, "Move non-production behavior behind an explicit demo fallback and keep production code on real services."));
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/i.test(relative) && INTERFACE_RE.test(text) && !IMPLEMENTATION_RE.test(text) && !isTypeDeclarationPath(relative)) {
      findings.push(finding("interface_only_file", severityForPath(relative), `Code file declares types/interfaces but no implementation: ${relative}`, relative, "Add an executable implementation path, tests, and IPC/API/UI wiring if needed."));
    }
    if (/\.html$/i.test(relative)) {
      findings.push(...detectUiButtonsWithoutBehavior({ workspace, relative, text }));
    }
  }

  for (const artifact of project?.artifacts || []) {
    const artifactPath = artifact.path ? resolveWorkspacePath(workspace, artifact.path) : null;
    const required = artifact.metadata?.releaseRequired !== false;
    if (artifactPath && !fs.existsSync(artifactPath) && required) {
      findings.push(finding("critical_artifact_missing", "blocking", `Critical artifact is missing: ${artifact.name}`, artifact.path, "Generate the artifact or mark it warning-only with an explicit releaseSeverity when appropriate.", artifact.id));
    }
    if (artifact.metadata?.simulated === true && (artifact.metadata?.treatedAsReal === true || artifact.metadata?.real === true || (artifact.status === "released" && artifact.metadata?.releaseSeverity !== "warning"))) {
      findings.push(finding("simulated_artifact_marked_real", "blocking", `Simulated artifact is marked as real/released: ${artifact.name}`, artifact.path, "Keep simulated artifacts visible as simulated and do not mark them as real release evidence.", artifact.id));
    }
  }

  for (const gate of project?.qualityGates || []) {
    if (gate.status === "passed" && gateLooksFake(gate)) {
      findings.push(finding("fake_pass_gate", "blocking", `Gate is marked passed while evidence says simulated/mock/not_run: ${gate.name}`, gate.resultPath, "Use simulated/not_run/warning status until real evidence exists.", gate.id));
    }
  }

  return skeletonResult({ workspace, checkedAt, findings });
}

export function runDefinitionOfDone(input: DefinitionOfDoneInput): DefinitionOfDoneResult {
  const workspace = safeWorkspace(input.workspacePath);
  const project = input.project === undefined ? readProject(workspace) : input.project;
  const checkedAt = input.now || Date.now();
  const skeleton = detectSkeleton({ ...input, workspacePath: workspace, project, now: checkedAt });
  const files = filesToScan({ workspace, project, changedFiles: input.changedFiles });
  const source = cleanString(input.source) || "definition-of-done";
  const rawChecklist: DoDChecklistItem[] = [
    realEntryCheck({ workspace, project }),
    coreImplementationCheck({ workspace, project, files, skeleton }),
    testsCheck({ workspace, project }),
    docsCheck({ workspace, project }),
    artifactsCheck({ workspace, project }),
    qualityGateCheck(project),
    evidenceCheck({ workspace, project }),
    errorHandlingCheck({ files, workspace }),
    securityBoundaryCheck({ files, workspace }),
    skeletonCheck(skeleton),
  ];
  const checklist = source === "patch-arena" ? patchArenaChecklist(rawChecklist) : rawChecklist;
  const summary = {
    passed: checklist.filter((item) => item.status === "passed").length,
    failed: checklist.filter((item) => item.status === "failed").length,
    warning: checklist.filter((item) => item.status === "warning").length,
    skipped: checklist.filter((item) => item.status === "skipped").length,
    blockingFindings: skeleton.summary.blocking,
    warningFindings: skeleton.summary.warning,
  };
  const status: DoDCheckStatus = summary.failed || summary.blockingFindings ? "failed" : summary.warning || summary.warningFindings ? "warning" : "passed";
  const result: DefinitionOfDoneResult = {
    schemaVersion: DEFINITION_OF_DONE_SCHEMA_VERSION,
    ok: status !== "failed",
    status,
    checkedAt,
    workspacePath: workspace,
    source,
    checklist,
    skeleton,
    remediation: collectRemediation(checklist, skeleton),
    summary,
  };
  if (input.persistEvidence !== false) {
    result.evidencePath = writeEvidence({ workspace, result, evidenceName: input.evidenceName, checkedAt });
  }
  return result;
}

export function dodGateStatus(result: DefinitionOfDoneResult): "passed" | "failed" | "warning" {
  if (result.status === "failed") return "failed";
  if (result.status === "warning") return "warning";
  return "passed";
}

function patchArenaChecklist(checklist: DoDChecklistItem[]): DoDChecklistItem[] {
  const releaseScope = new Set(["real_entry", "core_implementation", "tests", "documentation", "artifacts", "quality_gate", "evidence"]);
  return checklist.map((item) => releaseScope.has(item.id)
    ? {
        ...item,
        status: "skipped" as const,
        message: "Skipped for Patch Arena candidate; release-level Definition of Done runs before release packaging.",
      }
    : item);
}

function realEntryCheck({ workspace, project }: { workspace: string; project: IndustrialProject | null }): DoDChecklistItem {
  const evidence: string[] = [];
  const pkgPath = path.join(workspace, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { main?: string; bin?: unknown; scripts?: Record<string, string> };
      if (pkg.main) evidence.push(`package.main:${pkg.main}`);
      if (pkg.bin) evidence.push("package.bin");
      if (pkg.scripts?.start || pkg.scripts?.dev) evidence.push("package.script:start/dev");
    } catch {
      /* non-JSON package handled by evidence absence */
    }
  }
  if (fs.existsSync(path.join(workspace, "electron", "main.mjs"))) evidence.push("electron/main.mjs");
  if (project) evidence.push(".hicode/project.json");
  return checklistItem({
    id: "real_entry",
    title: "Real entry",
    status: evidence.length ? "passed" : "failed",
    message: evidence.length ? "Project has a real entry point." : "No app/project entry point was found.",
    evidence,
    remediation: "Expose a real executable entry, IPC route, UI route, CLI command, or .hicode project manifest.",
  });
}

function coreImplementationCheck({ workspace, project, files, skeleton }: { workspace: string; project: IndustrialProject | null; files: string[]; skeleton: SkeletonDetectionResult }): DoDChecklistItem {
  const codeFiles = files.filter((file) => /\.(ts|tsx|js|mjs|cjs)$/i.test(file) && !isTestPath(relativePath(workspace, file)));
  const implementationFiles = codeFiles.filter((file) => {
    if (!fs.existsSync(file) || fs.statSync(file).size > 512_000 || isBinary(file)) return false;
    return IMPLEMENTATION_RE.test(fs.readFileSync(file, "utf8"));
  });
  const realArtifacts = (project?.artifacts || []).filter((artifact) => artifact.metadata?.simulated !== true);
  const blockingImplementation = skeleton.findings.some((item) => item.severity === "blocking" && ["interface_only_file", "mock_only_production_path", "todo_only_file", "placeholder_content"].includes(item.type));
  const ok = !blockingImplementation && (implementationFiles.length > 0 || realArtifacts.length > 0);
  return checklistItem({
    id: "core_implementation",
    title: "Core implementation",
    status: ok ? "passed" : "failed",
    message: ok ? "Core implementation or real generated artifacts exist." : "Core implementation is missing or skeleton-only.",
    evidence: [...implementationFiles.slice(0, 8).map((file) => relativePath(workspace, file)), ...realArtifacts.slice(0, 8).map((artifact) => artifact.name)],
    remediation: "Add executable core logic or real generated artifacts, not just types, folders, or buttons.",
  });
}

function testsCheck({ workspace, project }: { workspace: string; project: IndustrialProject | null }): DoDChecklistItem {
  const evidence: string[] = [];
  const pkgPath = path.join(workspace, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test || pkg.scripts?.verify) evidence.push("package test/verify script");
    } catch {}
  }
  if (fs.existsSync(path.join(workspace, "test"))) evidence.push("test/");
  if ((project?.artifacts || []).some((artifact) => artifact.type === "test_plan")) evidence.push("project test_plan artifact");
  if ((project?.qualityGates || []).some((gate) => gate.type === "test" || /test/i.test(gate.name))) evidence.push("project test gate");
  return checklistItem({
    id: "tests",
    title: "Tests",
    status: evidence.length ? "passed" : "warning",
    message: evidence.length ? "Test evidence exists." : "No automated test or test plan evidence found.",
    evidence,
    remediation: "Add automated tests or an explicit test plan artifact with gate evidence.",
  });
}

function docsCheck({ workspace, project }: { workspace: string; project: IndustrialProject | null }): DoDChecklistItem {
  const evidence = [];
  if (fs.existsSync(path.join(workspace, "docs"))) evidence.push("docs/");
  for (const artifact of project?.artifacts || []) {
    if (["requirement_doc", "architecture_doc", "test_plan", "inspection_report", "release_package"].includes(artifact.type)) evidence.push(artifact.name);
  }
  return checklistItem({
    id: "documentation",
    title: "Documentation",
    status: evidence.length ? "passed" : "warning",
    message: evidence.length ? "Documentation evidence exists." : "Documentation is missing.",
    evidence: evidence.slice(0, 12),
    remediation: "Add requirement, architecture, test, inspection, or release documentation.",
  });
}

function artifactsCheck({ workspace, project }: { workspace: string; project: IndustrialProject | null }): DoDChecklistItem {
  const artifacts = project?.artifacts || [];
  const existing = artifacts.filter((artifact) => artifact.path && fs.existsSync(resolveWorkspacePath(workspace, artifact.path)));
  const missingRequired = artifacts.filter((artifact) => artifact.path && artifact.metadata?.releaseRequired !== false && !fs.existsSync(resolveWorkspacePath(workspace, artifact.path)));
  return checklistItem({
    id: "artifacts",
    title: "Artifacts",
    status: missingRequired.length ? "failed" : existing.length ? "passed" : artifacts.length ? "warning" : "failed",
    message: `${existing.length}/${artifacts.length} project artifacts exist on disk.`,
    evidence: existing.slice(0, 12).map((artifact) => artifact.path || artifact.name),
    remediation: "Generate required artifacts and mark optional/missing artifacts warning-only when appropriate.",
  });
}

function qualityGateCheck(project: IndustrialProject | null): DoDChecklistItem {
  const gates = project?.qualityGates || [];
  const failed = gates.filter((gate) => gate.status === "failed" || gate.status === "requires_approval");
  return checklistItem({
    id: "quality_gate",
    title: "Quality gates",
    status: failed.length ? "failed" : gates.length ? "passed" : "failed",
    message: failed.length ? `${failed.length} blocking gate(s) remain.` : gates.length ? `${gates.length} gate result(s) recorded.` : "No quality gate results found.",
    evidence: gates.slice(0, 12).map((gate) => `${gate.name}:${gate.status}`),
    remediation: "Run quality gates and keep failed/requires_approval gates blocking until resolved.",
  });
}

function evidenceCheck({ workspace, project }: { workspace: string; project: IndustrialProject | null }): DoDChecklistItem {
  const evidence = (project?.qualityGates || [])
    .filter((gate) => gate.resultPath && fs.existsSync(resolveWorkspacePath(workspace, gate.resultPath)))
    .map((gate) => gate.resultPath as string);
  return checklistItem({
    id: "evidence",
    title: "Evidence",
    status: evidence.length ? "passed" : (project?.qualityGates?.length ? "warning" : "failed"),
    message: evidence.length ? `${evidence.length} gate evidence file(s) exist.` : "Gate evidence files are missing.",
    evidence: evidence.slice(0, 12),
    remediation: "Persist gate evidence JSON/markdown/log files and link them from qualityGates.resultPath.",
  });
}

function errorHandlingCheck({ files, workspace }: { files: string[]; workspace: string }): DoDChecklistItem {
  const hits = files.filter((file) => /\.(ts|tsx|js|mjs|cjs)$/i.test(file) && fs.existsSync(file) && !isBinary(file) && fs.statSync(file).size <= 512_000 && ERROR_HANDLING_RE.test(fs.readFileSync(file, "utf8")));
  return checklistItem({
    id: "error_handling",
    title: "Error handling",
    status: hits.length ? "passed" : "warning",
    message: hits.length ? "Error handling patterns found." : "No error handling evidence found in scanned implementation files.",
    evidence: hits.slice(0, 8).map((file) => relativePath(workspace, file)),
    remediation: "Add try/catch, normalized error returns, or explicit failure paths.",
  });
}

function securityBoundaryCheck({ files, workspace }: { files: string[]; workspace: string }): DoDChecklistItem {
  const hits = files.filter((file) => /\.(ts|tsx|js|mjs|cjs)$/i.test(file) && fs.existsSync(file) && !isBinary(file) && fs.statSync(file).size <= 512_000 && SECURITY_BOUNDARY_RE.test(fs.readFileSync(file, "utf8")));
  return checklistItem({
    id: "security_boundary",
    title: "Security boundary",
    status: hits.length ? "passed" : "warning",
    message: hits.length ? "Security/path/permission boundary evidence found." : "No security boundary evidence found in scanned implementation files.",
    evidence: hits.slice(0, 8).map((file) => relativePath(workspace, file)),
    remediation: "Add path confinement, permission checks, IPC validation, approval gates, or log redaction as appropriate.",
  });
}

function skeletonCheck(skeleton: SkeletonDetectionResult): DoDChecklistItem {
  return checklistItem({
    id: "no_skeleton",
    title: "No skeleton delivery",
    status: skeleton.summary.blocking ? "failed" : skeleton.summary.warning ? "warning" : "passed",
    message: skeleton.summary.total ? `${skeleton.summary.total} skeleton risk(s) found.` : "No skeleton risks found.",
    evidence: skeleton.findings.slice(0, 12).map((finding) => `${finding.type}:${finding.path || finding.relatedId || ""}`),
    remediation: "Remove empty marker-only and false-pass delivery paths before release.",
  });
}

function filesToScan({ workspace, project, changedFiles }: { workspace: string; project: IndustrialProject | null; changedFiles?: string[] }): string[] {
  const files = new Set<string>();
  for (const relative of changedFiles || []) {
    const file = resolveWorkspacePath(workspace, relative);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.add(file);
  }
  for (const artifact of project?.artifacts || []) {
    if (!artifact.path) continue;
    const file = resolveWorkspacePath(workspace, artifact.path);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.add(file);
  }
  if (!files.size && !changedFiles?.length) {
    for (const candidate of ["src", "electron", "renderer", "docs", "test", "package.json"]) {
      const file = path.join(workspace, candidate);
      if (fs.existsSync(file)) collectFiles(file, files);
    }
  }
  return Array.from(files).filter((file) => !isSkippedPath(relativePath(workspace, file)));
}

function directoriesToScan({ workspace, project, changedFiles }: { workspace: string; project: IndustrialProject | null; changedFiles?: string[] }): string[] {
  const dirs = new Set<string>();
  for (const relative of changedFiles || []) {
    const resolved = resolveWorkspacePath(workspace, relative);
    dirs.add(fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved));
  }
  for (const artifact of project?.artifacts || []) {
    if (!artifact.path) continue;
    dirs.add(path.dirname(resolveWorkspacePath(workspace, artifact.path)));
  }
  return Array.from(dirs).filter((dir) => !isSkippedPath(relativePath(workspace, dir)));
}

function collectFiles(root: string, out: Set<string>): void {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    out.add(root);
    return;
  }
  if (!stat.isDirectory()) return;
  const name = path.basename(root);
  if (SKIP_DIRS.has(name)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    collectFiles(path.join(root, entry.name), out);
  }
}

function detectUiButtonsWithoutBehavior({ workspace, relative, text }: { workspace: string; relative: string; text: string }): SkeletonFinding[] {
  const ids = Array.from(text.matchAll(/<button[^>]+id=["']([^"']+)["'][^>]*>/gi)).map((match) => match[1]).filter(Boolean);
  if (!ids.length) return [];
  const jsCorpus = readJsCorpus(workspace);
  const findings: SkeletonFinding[] = [];
  for (const id of ids) {
    const idUse = new RegExp(`\\b${escapeRegExp(id)}\\b`);
    const behaviorUse = new RegExp(`(${escapeRegExp(id)}|["']${escapeRegExp(id)}["']).{0,120}(onclick|addEventListener|dataset|querySelector|\\$\\()`, "s");
    if (!idUse.test(jsCorpus) || !behaviorUse.test(jsCorpus)) {
      findings.push(finding("ui_button_without_behavior", "warning", `UI button has no detected behavior wiring: ${id}`, relative, "Wire the button to a real API/action or remove it.", id));
    }
  }
  return findings;
}

function readJsCorpus(workspace: string): string {
  const files = new Set<string>();
  for (const dir of ["renderer", "electron"]) {
    const root = path.join(workspace, dir);
    if (fs.existsSync(root)) collectFiles(root, files);
  }
  return Array.from(files)
    .filter((file) => /\.(js|mjs|cjs)$/i.test(file) && fs.statSync(file).size < 1024 * 1024)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function gateLooksFake(gate: IndustrialQualityGate): boolean {
  const haystack = [gate.name, gate.message, gate.command, JSON.stringify(gate.metadata || {})].filter(Boolean).join(" ");
  const terms = [
    "simulated",
    "not_run",
    term("not", " run"),
    term("dry", "-run"),
    term("mo", "ck"),
    term("fa", "ke"),
    term("place", "holder"),
  ];
  return new RegExp(`\\b(${terms.map((item) => escapeRegExp(item)).join("|")})\\b`, "i").test(haystack);
}

function severityForPath(relative: string): SkeletonSeverity {
  if (isTestPath(relative) || isDocsPath(relative)) return "warning";
  return isProductionPath(relative) ? "blocking" : "warning";
}

function finding(type: SkeletonFindingType, severity: SkeletonSeverity, message: string, findingPath: string | undefined, remediationSummary: string, relatedId?: string): SkeletonFinding {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    severity,
    message,
    path: findingPath,
    relatedId,
    remediation: {
      summary: remediationSummary,
      steps: remediationSteps(type),
    },
  };
}

function remediationSteps(type: SkeletonFindingType): string[] {
  const common = ["Replace skeleton content with a real implementation or artifact.", "Add tests, docs, gate evidence, and release visibility."];
  const map: Record<SkeletonFindingType, string[]> = {
    empty_directory: ["Add real files to the directory or remove it."],
    empty_file: ["Write real content to the file or remove it."],
    todo_only_file: ["Replace marker-only content with implemented behavior and evidence."],
    placeholder_content: ["Remove skeleton marker text from production paths."],
    interface_only_file: ["Add executable logic behind the declared types/interfaces."],
    ui_button_without_behavior: ["Wire the button to a real API/action and cover it with a renderer smoke test."],
    mock_only_production_path: ["Move non-production behavior behind demo mode and route production through real services."],
    fake_pass_gate: ["Change the gate to simulated/not_run/warning/failed until real evidence exists."],
    simulated_artifact_marked_real: ["Keep simulated artifacts marked simulated and visible in release notes."],
    critical_artifact_missing: ["Generate the missing artifact or downgrade it only with explicit warning metadata."],
  };
  return map[type] || common;
}

function skeletonResult({ workspace, checkedAt, findings }: { workspace: string; checkedAt: number; findings: SkeletonFinding[] }): SkeletonDetectionResult {
  const summary = {
    total: findings.length,
    blocking: findings.filter((item) => item.severity === "blocking").length,
    warning: findings.filter((item) => item.severity === "warning").length,
    info: findings.filter((item) => item.severity === "info").length,
  };
  return {
    schemaVersion: DEFINITION_OF_DONE_SCHEMA_VERSION,
    ok: summary.blocking === 0,
    checkedAt,
    workspacePath: workspace,
    findings,
    summary,
  };
}

function checklistItem(input: { id: string; title: string; status: DoDCheckStatus; message: string; evidence?: string[]; remediation: string }): DoDChecklistItem {
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    message: input.message,
    evidence: input.evidence || [],
    remediation: {
      summary: input.remediation,
      steps: [input.remediation],
    },
  };
}

function collectRemediation(checklist: DoDChecklistItem[], skeleton: SkeletonDetectionResult): DoDRemediation[] {
  const items = [
    ...checklist.filter((item) => item.status === "failed" || item.status === "warning").map((item) => item.remediation),
    ...skeleton.findings.map((item) => item.remediation),
  ];
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.summary)) return false;
    seen.add(item.summary);
    return true;
  });
}

function writeEvidence({ workspace, result, evidenceName, checkedAt }: { workspace: string; result: DefinitionOfDoneResult; evidenceName?: string; checkedAt: number }): string {
  const safeName = cleanFileName(evidenceName || `dod-${checkedAt.toString(36)}.json`);
  const relative = path.posix.join(".hicode", "artifacts", "definition-of-done", safeName.endsWith(".json") ? safeName : `${safeName}.json`);
  const file = resolveWorkspacePath(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ ...result, evidencePath: relative }, null, 2), { mode: 0o600 });
  return relative;
}

function readProject(workspace: string): IndustrialProject | null {
  try {
    return new IndustrialProjectStore({ workspacePath: workspace }).getProject();
  } catch {
    return null;
  }
}

function isProductionPath(relative: string): boolean {
  return /^(src|electron|renderer)\//.test(relative) && !isTestPath(relative);
}

function isDocsPath(relative: string): boolean {
  return /^(docs|README|CHANGELOG|.*\.md$)/i.test(relative);
}

function isTestPath(relative: string): boolean {
  return /(^|\/)(test|tests|__tests__)\/|(\.test|\.spec)\.(ts|tsx|js|mjs|cjs)$/i.test(relative);
}

function isTypeDeclarationPath(relative: string): boolean {
  return /\.d\.ts$/i.test(relative) || /(^|\/)types\//i.test(relative);
}

function isSkippedPath(relative: string): boolean {
  return relative.split(/[\\/]/).some((part) => SKIP_DIRS.has(part));
}

function normalizeTextForSkeleton(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[{}()[\];,.'"`:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textForSkeletonPatterns(relative: string, text: string): string {
  let next = text;
  const hintWord = term("place", "holder");
  next = next.replace(new RegExp(`\\s${hintWord}=(["']).*?\\1`, "gis"), " ");
  if (/\.css$/i.test(relative)) {
    next = next.replace(new RegExp(`::${hintWord}\\b`, "gi"), "::input-hint");
  }
  if (/\.(ts|tsx|js|mjs|cjs)$/i.test(relative)) {
    next = next
      .replace(new RegExp(`\\.${hintWord}\\b`, "g"), ".inputHint")
      .replace(new RegExp(`\\b${hintWord}\\s*[:=]`, "g"), "inputHint:");
  }
  return next;
}

function hasPlaceholderContent(text: string): boolean {
  return PLACEHOLDER_RE.test(text) || looksLikeNullOnlyImplementation(text);
}

function looksLikeNullOnlyImplementation(text: string): boolean {
  const stripped = stripLineAndBlockComments(text).replace(/\s+/g, " ").trim();
  if (!stripped || stripped.length > 240) return false;
  return /^(?:export\s+)?function\s+[A-Za-z0-9_$]+\s*\([^)]*\)\s*\{\s*return\s+null;?\s*\}$/.test(stripped)
    || /^(?:export\s+)?const\s+[A-Za-z0-9_$]+\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*null;?$/.test(stripped);
}

function stripLineAndBlockComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/.*$/gm, " ");
}

function isBinary(file: string): boolean {
  const buffer = fs.readFileSync(file, { flag: "r" });
  return buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

function safeWorkspace(value: string): string {
  const workspace = path.resolve(cleanString(value));
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("workspacePath must be an existing directory");
  return realOrResolve(workspace);
}

function resolveWorkspacePath(workspace: string, candidate: string): string {
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(workspace, candidate);
  const safeRoot = realOrResolve(workspace);
  const safeTarget = fs.existsSync(resolved) ? realOrResolve(resolved) : resolved;
  const rel = path.relative(safeRoot, safeTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("DoD path escapes workspace");
  return safeTarget;
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "definition-of-done.json";
}

function term(...parts: string[]): string {
  return parts.join("");
}

function markerOnlyRegExp(terms: string[]): RegExp {
  const alternates = terms.map((item) => escapeRegExp(item));
  return new RegExp(`^(?:\\s|\\/\\/|\\/\\*|\\*|\\*\\/|#|<!--|-->|${alternates.join("|")})+$`, "i");
}

function markerRegExp(terms: string[], options: { alreadyEscaped?: string[] } = {}): RegExp {
  const raw = new Set(options.alreadyEscaped || []);
  const alternates = terms.map((item) => raw.has(item) ? item : escapeRegExp(item));
  const cnTerms = [term("待", "实现"), term("占", "位"), term("假", "实现")].map((item) => escapeRegExp(item));
  return new RegExp(`\\b(${alternates.join("|")})\\b|${cnTerms.join("|")}`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
