import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  INDUSTRIAL_PROJECT_FILE,
  IndustrialProjectStore,
  type IndustrialArtifact,
  type IndustrialProject,
  type IndustrialQualityGate,
} from "./industrial-project.js";
import { runDefinitionOfDone, type DefinitionOfDoneResult } from "./definition-of-done.js";
import type { ApprovalRecord, GateResult, GateStatus, Job } from "./job-center.js";
import { buildSafeChildEnv } from "./process-env.js";

export const RELEASE_BUILDER_SCHEMA_VERSION = 1;
export const RELEASE_GATE_BLOCKING_STATUSES = ["failed", "requires_approval"] as const;
export const RELEASE_GATE_VISIBLE_RISK_STATUSES = ["simulated", "not_run", "warning", "skipped"] as const;

export type ReleaseArtifactCategory =
  | "source_code"
  | "build_output"
  | "test_report"
  | "quality_gate_report"
  | "requirement_doc"
  | "architecture_doc"
  | "cad_artifact"
  | "pcb_artifact"
  | "plc_artifact"
  | "bim_artifact"
  | "industrial_artifact"
  | "bom"
  | "release_file";

export type ReleaseRiskSeverity = "info" | "warning" | "blocking";

export interface ReleaseArtifact {
  id: string;
  type: string;
  name: string;
  category: ReleaseArtifactCategory;
  sourcePath?: string;
  packagePath?: string;
  relativePath?: string;
  size?: number;
  sha256?: string;
  missing?: boolean;
  simulated?: boolean;
  severity?: ReleaseRiskSeverity;
  metadata?: Record<string, unknown>;
}

export interface ReleaseEvidence {
  id: string;
  gateId: string;
  name: string;
  status: GateStatus | "pending";
  source: "industrial_project" | "job_center";
  severity: ReleaseRiskSeverity;
  message?: string;
  evidencePath?: string;
  artifactLinks: string[];
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ReleaseChecklist {
  id: string;
  title: string;
  status: "complete" | "warning" | "blocked";
  items: Array<{
    id: string;
    label: string;
    status: "complete" | "warning" | "blocked";
    message?: string;
  }>;
}

export interface ReleaseApproval {
  id: string;
  status: string;
  scope?: string;
  requestedBy?: string;
  decidedBy?: string;
  requestedAt?: number;
  decidedAt?: number;
  reason?: string;
  source: "industrial_project" | "job_center";
}

export interface ReleaseRisk {
  id: string;
  severity: ReleaseRiskSeverity;
  title: string;
  message: string;
  source: "artifact" | "gate" | "approval" | "release" | "source";
  relatedId?: string;
}

export interface ReleaseManifest {
  schemaVersion: typeof RELEASE_BUILDER_SCHEMA_VERSION;
  releaseId: string;
  projectId: string;
  version: string;
  createdAt: string;
  createdBy: string;
  sourceCommit: string | null;
  includedArtifacts: ReleaseArtifact[];
  gateResults: ReleaseEvidence[];
  approvals: ReleaseApproval[];
  knownRisks: ReleaseRisk[];
  checksums: Record<string, string>;
}

export interface ReleasePackage {
  schemaVersion: typeof RELEASE_BUILDER_SCHEMA_VERSION;
  releaseId: string;
  version: string;
  projectId: string;
  releasePath: string;
  manifestPath: string;
  notesPath: string;
  evidenceReportPath: string;
  checksumPath: string;
  manifest: ReleaseManifest;
  readiness: ReleaseReadiness;
  artifacts: ReleaseArtifact[];
  checksums: Record<string, string>;
}

export interface ReleaseReadiness {
  ready: boolean;
  version: string;
  releasePath: string;
  project: {
    projectId: string;
    name: string;
    type: string;
    domains: string[];
  } | null;
  gateSummary: Record<string, number>;
  artifactSummary: {
    total: number;
    included: number;
    missing: number;
    simulated: number;
  };
  approvals: ReleaseApproval[];
  blockers: ReleaseRisk[];
  warnings: ReleaseRisk[];
  risks: ReleaseRisk[];
  simulatedGates: ReleaseEvidence[];
  missingArtifacts: ReleaseArtifact[];
  gateResults: ReleaseEvidence[];
  definitionOfDone: DefinitionOfDoneResult | null;
}

export interface ReleaseBuilderInput {
  version: string;
  createdBy?: string;
  overwrite?: boolean;
  includeSourceCode?: boolean;
  includeBuildOutput?: boolean;
  includeDocs?: boolean;
}

export interface ReleaseBuilderOptions {
  workspacePath: string;
  jobs?: Job[];
  now?: number;
  maxFileBytes?: number;
}

type CopyAccumulator = {
  artifacts: ReleaseArtifact[];
  risks: ReleaseRisk[];
};

export class ReleaseBuilder {
  private readonly workspacePath: string;
  private readonly jobs: Job[];
  private readonly now: number;
  private readonly maxFileBytes: number;

  constructor(options: ReleaseBuilderOptions) {
    if (!options?.workspacePath) throw new Error("ReleaseBuilder requires workspacePath");
    this.workspacePath = safeExistingDirectory(options.workspacePath, "workspacePath");
    this.jobs = Array.isArray(options.jobs) ? options.jobs : [];
    this.now = options.now || Date.now();
    this.maxFileBytes = Math.max(1024, Number(options.maxFileBytes || 50 * 1024 * 1024));
  }

  getReadiness(input: Partial<ReleaseBuilderInput> = {}): ReleaseReadiness {
    const version = sanitizeVersion(input.version || defaultVersion(this.workspacePath));
    const releasePath = assertInside(this.workspacePath, path.join(this.workspacePath, "releases", version), "releasePath");
    const project = this.readProject();
    const gateResults = collectGateEvidence(project, this.relevantJobs());
    const approvals = collectApprovals(project, this.relevantJobs());
    const artifacts = collectProjectArtifacts(project, this.workspacePath);
    const definitionOfDone = project
      ? runDefinitionOfDone({
          workspacePath: this.workspacePath,
          project,
          source: "release-builder",
          evidenceName: `release-${version}.json`,
          persistEvidence: true,
          now: this.now,
        })
      : null;
    if (definitionOfDone) gateResults.push(definitionOfDoneToEvidence(definitionOfDone));
    const risks: ReleaseRisk[] = [];

    if (!project) {
      risks.push(risk("release.project.missing", "blocking", "Industrial project is required", `${INDUSTRIAL_PROJECT_FILE} must exist before building an auditable release package.`, "release"));
    }

    for (const gate of gateResults) {
      if (RELEASE_GATE_BLOCKING_STATUSES.includes(gate.status as "failed" | "requires_approval")) {
        const title = gate.status === "requires_approval" ? "Gate requires approval" : "Gate failed";
        risks.push(risk(`gate.${gate.gateId}.${gate.status}`, "blocking", title, `${gate.name}: ${gate.message || gate.status}`, "gate", gate.gateId));
      } else if (RELEASE_GATE_VISIBLE_RISK_STATUSES.includes(gate.status as "simulated" | "not_run" | "warning" | "skipped")) {
        const severity: ReleaseRiskSeverity = gate.status === "warning" ? "warning" : "warning";
        risks.push(risk(`gate.${gate.gateId}.${gate.status}`, severity, `Gate ${gate.status}`, `${gate.name}: ${gate.message || gate.status}`, "gate", gate.gateId));
      }
    }

    for (const artifact of artifacts) {
      if (artifact.missing) {
        risks.push(risk(
          `artifact.${artifact.id}.missing`,
          artifact.severity === "warning" ? "warning" : "blocking",
          "Missing release artifact",
          `${artifact.name} (${artifact.type}) does not exist at ${artifact.sourcePath || artifact.relativePath || "unknown path"}.`,
          "artifact",
          artifact.id,
        ));
      }
      if (artifact.simulated) {
        risks.push(risk(`artifact.${artifact.id}.simulated`, "warning", "Simulated artifact", `${artifact.name} is simulated/dry-run output and must be visible in release notes.`, "artifact", artifact.id));
      }
    }

    if (definitionOfDone) {
      for (const finding of definitionOfDone.skeleton.findings) {
        risks.push(risk(
          `dod.skeleton.${finding.id}`,
          finding.severity === "blocking" ? "blocking" : "warning",
          finding.severity === "blocking" ? "Skeleton delivery blocks release" : "Skeleton delivery warning",
          finding.message,
          "release",
          finding.path || finding.relatedId,
        ));
      }
      for (const item of definitionOfDone.checklist) {
        if (item.status === "failed" || item.status === "warning") {
          risks.push(risk(
            `dod.checklist.${item.id}`,
            item.status === "failed" ? "blocking" : "warning",
            item.status === "failed" ? "Definition of Done failed" : "Definition of Done warning",
            item.message,
            "release",
            item.id,
          ));
        }
      }
    }

    const blockers = risks.filter((item) => item.severity === "blocking");
    const warnings = risks.filter((item) => item.severity !== "blocking");
    return {
      ready: blockers.length === 0,
      version,
      releasePath,
      project: project ? {
        projectId: project.projectId,
        name: project.name,
        type: project.type,
        domains: project.domains,
      } : null,
      gateSummary: summarizeGates(gateResults),
      artifactSummary: {
        total: artifacts.length,
        included: artifacts.filter((item) => !item.missing).length,
        missing: artifacts.filter((item) => item.missing).length,
        simulated: artifacts.filter((item) => item.simulated).length,
      },
      approvals,
      blockers,
      warnings,
      risks,
      simulatedGates: gateResults.filter((gate) => gate.status === "simulated"),
      missingArtifacts: artifacts.filter((artifact) => artifact.missing),
      gateResults,
      definitionOfDone,
    };
  }

  buildRelease(input: ReleaseBuilderInput): ReleasePackage {
    const version = sanitizeVersion(input.version);
    const readiness = this.getReadiness({ ...input, version });
    if (!readiness.ready) {
      throw new Error(`release is not ready: ${readiness.blockers.map((item) => item.message).join("; ")}`);
    }
    const project = this.readProject();
    if (!project) throw new Error("industrial project is required");

    const releasePath = readiness.releasePath;
    if (fs.existsSync(releasePath)) {
      if (!input.overwrite) throw new Error(`release output already exists: releases/${version}`);
      const safeReleaseRoot = assertInside(this.workspacePath, releasePath, "releasePath");
      fs.rmSync(safeReleaseRoot, { recursive: true, force: true });
    }
    const dirs = {
      artifacts: path.join(releasePath, "artifacts"),
      docs: path.join(releasePath, "docs"),
      gates: path.join(releasePath, "gates"),
    };
    for (const dir of [releasePath, dirs.artifacts, dirs.docs, dirs.gates]) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

    const accumulator: CopyAccumulator = { artifacts: [], risks: [...readiness.risks] };
    const includeSource = input.includeSourceCode !== false;
    const includeBuild = input.includeBuildOutput !== false;
    const includeDocs = input.includeDocs !== false;
    if (includeSource) this.copySourceCode(path.join(dirs.artifacts, "source-code"), accumulator);
    if (includeBuild) this.copyBuildOutput(path.join(dirs.artifacts, "build-output"), accumulator);
    if (includeDocs) this.copyDocs(dirs.docs, accumulator);
    this.copyProjectArtifacts(project, path.join(dirs.artifacts, "project-artifacts"), accumulator);
    this.writeGateEvidence(project, this.relevantJobs(), dirs.gates, accumulator);
    this.writeDefinitionOfDoneEvidence(readiness.definitionOfDone, dirs.gates, accumulator);

    const releaseId = `release-${version}-${this.now.toString(36)}`;
    const createdAt = new Date(this.now).toISOString();
    const createdBy = cleanString(input.createdBy) || "user";
    const sourceCommit = readSourceCommit(this.workspacePath);
    if (!sourceCommit) {
      accumulator.risks.push(risk("source.commit.unavailable", "warning", "Source commit unavailable", "Git commit could not be resolved; release remains reproducible by packaged source files but has no commit pointer.", "source"));
    }

    const notesPath = path.join(releasePath, "release-notes.md");
    const evidenceReportPath = path.join(releasePath, "evidence-report.md");
    const manifestPath = path.join(releasePath, "release-manifest.json");
    const checksumPath = path.join(releasePath, "checksums.sha256");
    writeText(notesPath, renderReleaseNotes({ project, version, createdAt, readiness, risks: accumulator.risks, artifacts: accumulator.artifacts, sourceCommit }));
    writeText(evidenceReportPath, renderEvidenceReport({ project, version, readiness, artifacts: accumulator.artifacts, risks: accumulator.risks }));

    const checksumsBeforeManifest = computeChecksums(releasePath, ["checksums.sha256", "release-manifest.json"]);
    const manifest: ReleaseManifest = {
      schemaVersion: RELEASE_BUILDER_SCHEMA_VERSION,
      releaseId,
      projectId: project.projectId,
      version,
      createdAt,
      createdBy,
      sourceCommit,
      includedArtifacts: accumulator.artifacts,
      gateResults: readiness.gateResults,
      approvals: readiness.approvals,
      knownRisks: accumulator.risks,
      checksums: checksumsBeforeManifest,
    };
    writeJson(manifestPath, manifest);
    const finalChecksums = computeChecksums(releasePath, ["checksums.sha256"]);
    writeText(checksumPath, renderChecksumFile(finalChecksums));

    const finalManifest = { ...manifest, checksums: checksumsBeforeManifest };
    return {
      schemaVersion: RELEASE_BUILDER_SCHEMA_VERSION,
      releaseId,
      version,
      projectId: project.projectId,
      releasePath,
      manifestPath,
      notesPath,
      evidenceReportPath,
      checksumPath,
      manifest: finalManifest,
      readiness: finalizeReadiness(readiness, accumulator.risks),
      artifacts: accumulator.artifacts,
      checksums: finalChecksums,
    };
  }

  private readProject(): IndustrialProject | null {
    const store = new IndustrialProjectStore({ workspacePath: this.workspacePath });
    return store.getProject();
  }

  private relevantJobs(): Job[] {
    return this.jobs.filter((job) => isRelevantJob(job, this.workspacePath));
  }

  private copySourceCode(destRoot: string, accumulator: CopyAccumulator): void {
    const candidates = ["src", "electron", "renderer", "package.json", "package-lock.json", "tsconfig.json", "README.md", "HI.md", "CHANGELOG.md", "VERSION"];
    const copied = copyCandidates({
      workspace: this.workspacePath,
      candidates,
      destRoot,
      category: "source_code",
      maxFileBytes: this.maxFileBytes,
      accumulator,
      excludeNames: new Set(["node_modules", ".git", "releases", "release", "dist"]),
    });
    if (copied.files > 0) {
      accumulator.artifacts.push({
        id: "source-code",
        type: "source_code",
        name: "Source code snapshot",
        category: "source_code",
        packagePath: relativePath(this.workspacePath, destRoot),
        relativePath: "artifacts/source-code",
        size: copied.bytes,
        metadata: { files: copied.files },
      });
    }
  }

  private copyBuildOutput(destRoot: string, accumulator: CopyAccumulator): void {
    const dist = path.join(this.workspacePath, "dist");
    if (!fs.existsSync(dist)) {
      accumulator.risks.push(risk("build.output.missing", "warning", "Build output missing", "dist/ was not found; run npm run build before creating a final customer release.", "artifact", "dist"));
      return;
    }
    const copied = copyPath({
      workspace: this.workspacePath,
      source: dist,
      dest: path.join(destRoot, "dist"),
      maxFileBytes: this.maxFileBytes,
      excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
      accumulator,
    });
    accumulator.artifacts.push({
      id: "build-output-dist",
      type: "build_output",
      name: "Compiled dist output",
      category: "build_output",
      sourcePath: relativePath(this.workspacePath, dist),
      packagePath: relativePath(this.workspacePath, path.join(destRoot, "dist")),
      relativePath: "artifacts/build-output/dist",
      size: copied.bytes,
      metadata: { files: copied.files },
    });
  }

  private copyDocs(destRoot: string, accumulator: CopyAccumulator): void {
    const docs = path.join(this.workspacePath, "docs");
    const generated = path.join(this.workspacePath, ".hicode", "generated");
    const projectFile = path.join(this.workspacePath, INDUSTRIAL_PROJECT_FILE);
    if (fs.existsSync(docs)) {
      const copied = copyPath({
        workspace: this.workspacePath,
        source: docs,
        dest: path.join(destRoot, "project-docs"),
        maxFileBytes: this.maxFileBytes,
        excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
        accumulator,
      });
      accumulator.artifacts.push({
        id: "docs-project-docs",
        type: "documentation",
        name: "Project docs",
        category: "architecture_doc",
        sourcePath: "docs",
        packagePath: relativePath(this.workspacePath, path.join(destRoot, "project-docs")),
        relativePath: "docs/project-docs",
        size: copied.bytes,
        metadata: { files: copied.files },
      });
    }
    if (fs.existsSync(generated)) {
      const copied = copyPath({
        workspace: this.workspacePath,
        source: generated,
        dest: path.join(destRoot, "generated"),
        maxFileBytes: this.maxFileBytes,
        excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
        accumulator,
      });
      accumulator.artifacts.push({
        id: "docs-generated",
        type: "generated_docs",
        name: "Generated requirement and spec docs",
        category: "requirement_doc",
        sourcePath: ".hicode/generated",
        packagePath: relativePath(this.workspacePath, path.join(destRoot, "generated")),
        relativePath: "docs/generated",
        size: copied.bytes,
        metadata: { files: copied.files },
      });
    }
    if (fs.existsSync(projectFile)) {
      copyPath({
        workspace: this.workspacePath,
        source: projectFile,
        dest: path.join(destRoot, "project.json"),
        maxFileBytes: this.maxFileBytes,
        excludeNames: new Set(),
        accumulator,
      });
      accumulator.artifacts.push({
        id: "docs-project-json",
        type: "project_manifest",
        name: ".hicode project manifest",
        category: "requirement_doc",
        sourcePath: INDUSTRIAL_PROJECT_FILE,
        packagePath: relativePath(this.workspacePath, path.join(destRoot, "project.json")),
        relativePath: "docs/project.json",
        size: fileSize(path.join(destRoot, "project.json")),
      });
    }
  }

  private copyProjectArtifacts(project: IndustrialProject, destRoot: string, accumulator: CopyAccumulator): void {
    for (const artifact of project.artifacts) {
      const releaseArtifact = projectArtifactToReleaseArtifact(artifact, this.workspacePath);
      if (releaseArtifact.missing || !releaseArtifact.sourcePath) continue;
      const source = path.isAbsolute(releaseArtifact.sourcePath) ? releaseArtifact.sourcePath : path.join(this.workspacePath, releaseArtifact.sourcePath);
      const dest = path.join(destRoot, safeFileName(`${artifact.id}-${path.basename(source) || artifact.name}`));
      const copied = copyPath({
        workspace: this.workspacePath,
        source,
        dest,
        maxFileBytes: this.maxFileBytes,
        excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
        accumulator,
      });
      accumulator.artifacts.push({
        ...releaseArtifact,
        packagePath: relativePath(this.workspacePath, dest),
        relativePath: relativePath(path.dirname(path.dirname(destRoot)), dest),
        size: copied.bytes,
        sha256: fs.existsSync(dest) && fs.statSync(dest).isFile() ? sha256File(dest) : undefined,
        metadata: {
          ...(releaseArtifact.metadata || {}),
          files: copied.files,
        },
      });
    }
  }

  private writeGateEvidence(project: IndustrialProject, jobs: Job[], gatesRoot: string, accumulator: CopyAccumulator): void {
    const projectGateFile = path.join(gatesRoot, "project-gates.json");
    writeJson(projectGateFile, project.qualityGates);
    accumulator.artifacts.push({
      id: "gates-project",
      type: "quality_gate_report",
      name: "Industrial project gate results",
      category: "quality_gate_report",
      packagePath: relativePath(this.workspacePath, projectGateFile),
      relativePath: "gates/project-gates.json",
      size: fileSize(projectGateFile),
      sha256: sha256File(projectGateFile),
    });
    const jobGateFile = path.join(gatesRoot, "job-gates.json");
    const jobGates = jobs.flatMap((job) => job.gateResults.map((gate) => ({ jobId: job.id, jobTitle: job.title, ...gate })));
    writeJson(jobGateFile, jobGates);
    accumulator.artifacts.push({
      id: "gates-jobs",
      type: "quality_gate_report",
      name: "Job Center gate results",
      category: "quality_gate_report",
      packagePath: relativePath(this.workspacePath, jobGateFile),
      relativePath: "gates/job-gates.json",
      size: fileSize(jobGateFile),
      sha256: sha256File(jobGateFile),
    });
    for (const gate of project.qualityGates) {
      if (!gate.resultPath) continue;
      const source = resolveWorkspacePath(this.workspacePath, gate.resultPath, `gate ${gate.id} resultPath`);
      if (!fs.existsSync(source)) continue;
      const dest = path.join(gatesRoot, "evidence", safeFileName(`${gate.id}-${path.basename(source)}`));
      const copied = copyPath({
        workspace: this.workspacePath,
        source,
        dest,
        maxFileBytes: this.maxFileBytes,
        excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
        accumulator,
      });
      accumulator.artifacts.push({
        id: `gate-evidence-${gate.id}`,
        type: "gate_evidence",
        name: `${gate.name} evidence`,
        category: "quality_gate_report",
        sourcePath: relativePath(this.workspacePath, source),
        packagePath: relativePath(this.workspacePath, dest),
        relativePath: relativePath(path.dirname(gatesRoot), dest),
        size: copied.bytes,
        sha256: fs.existsSync(dest) && fs.statSync(dest).isFile() ? sha256File(dest) : undefined,
        metadata: { gateId: gate.id, status: gate.status },
      });
    }
  }

  private writeDefinitionOfDoneEvidence(definitionOfDone: DefinitionOfDoneResult | null, gatesRoot: string, accumulator: CopyAccumulator): void {
    if (!definitionOfDone?.evidencePath) return;
    const source = resolveWorkspacePath(this.workspacePath, definitionOfDone.evidencePath, "definitionOfDone.evidencePath");
    if (!fs.existsSync(source)) return;
    const dest = path.join(gatesRoot, "evidence", "definition-of-done.json");
    const copied = copyPath({
      workspace: this.workspacePath,
      source,
      dest,
      maxFileBytes: this.maxFileBytes,
      excludeNames: new Set(["node_modules", ".git", "releases", "release"]),
      accumulator,
    });
    accumulator.artifacts.push({
      id: "gate-evidence-definition-of-done",
      type: "gate_evidence",
      name: "Definition of Done evidence",
      category: "quality_gate_report",
      sourcePath: relativePath(this.workspacePath, source),
      packagePath: relativePath(this.workspacePath, dest),
      relativePath: relativePath(path.dirname(gatesRoot), dest),
      size: copied.bytes,
      sha256: fs.existsSync(dest) && fs.statSync(dest).isFile() ? sha256File(dest) : undefined,
      metadata: {
        gateId: "definition-of-done",
        status: definitionOfDone.status,
        skeletonSummary: definitionOfDone.skeleton.summary,
      },
    });
  }
}

/**
 * Rebuild the readiness view from the final risk list. Build steps may append
 * risks after getReadiness(), so `ready`/`blockers`/`warnings` must be derived
 * from the same final list to stay consistent with each other.
 */
function finalizeReadiness(readiness: ReleaseReadiness, finalRisks: ReleaseRisk[]): ReleaseReadiness {
  const blockers = finalRisks.filter((item) => item.severity === "blocking");
  return {
    ...readiness,
    ready: blockers.length === 0,
    risks: finalRisks,
    blockers,
    warnings: finalRisks.filter((item) => item.severity !== "blocking"),
  };
}

function collectProjectArtifacts(project: IndustrialProject | null, workspace: string): ReleaseArtifact[] {
  if (!project) return [];
  return project.artifacts.map((artifact) => projectArtifactToReleaseArtifact(artifact, workspace));
}

function projectArtifactToReleaseArtifact(artifact: IndustrialArtifact, workspace: string): ReleaseArtifact {
  const sourcePath = artifact.path ? normalizeWorkspacePath(workspace, artifact.path) : undefined;
  const exists = sourcePath ? fs.existsSync(sourcePath) : false;
  return {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    category: releaseCategoryForArtifactType(artifact.type),
    sourcePath: sourcePath ? relativePath(workspace, sourcePath) : undefined,
    relativePath: artifact.path,
    missing: !!artifact.path && !exists,
    simulated: metadataBoolean(artifact.metadata, "simulated") || metadataBoolean(artifact.metadata, "dryRun"),
    severity: missingSeverity(artifact),
    metadata: artifact.metadata,
  };
}

function collectGateEvidence(project: IndustrialProject | null, jobs: Job[]): ReleaseEvidence[] {
  const projectGates = (project?.qualityGates || []).map((gate) => projectGateToEvidence(gate));
  const jobGates = jobs.flatMap((job) => job.gateResults.map((gate) => jobGateToEvidence(gate, job)));
  return [...projectGates, ...jobGates];
}

function definitionOfDoneToEvidence(result: DefinitionOfDoneResult): ReleaseEvidence {
  return {
    id: "project-definition-of-done",
    gateId: "definition-of-done",
    name: "Definition of Done",
    status: result.status as GateStatus,
    source: "industrial_project",
    severity: result.status === "failed" ? "blocking" : result.status === "passed" ? "info" : "warning",
    message: `${result.summary.failed} failed check(s), ${result.summary.warning} warning check(s), ${result.skeleton.summary.total} skeleton risk(s).`,
    evidencePath: result.evidencePath,
    artifactLinks: [],
    createdAt: result.checkedAt,
    metadata: {
      checklist: result.checklist,
      skeletonSummary: result.skeleton.summary,
      remediation: result.remediation,
    },
  };
}

function projectGateToEvidence(gate: IndustrialQualityGate): ReleaseEvidence {
  return {
    id: `project-${gate.id}`,
    gateId: gate.id,
    name: gate.name || gate.type,
    status: gate.status === "pending" ? "pending" : gate.status,
    source: "industrial_project",
    severity: gate.status === "failed" || gate.status === "requires_approval" ? "blocking" : gate.status === "passed" ? "info" : "warning",
    message: gate.message,
    evidencePath: gate.resultPath,
    artifactLinks: gate.artifactIds,
    createdAt: gate.updatedAt || gate.createdAt,
    metadata: gate.metadata,
  };
}

function jobGateToEvidence(gate: GateResult, job: Job): ReleaseEvidence {
  const evidencePath = typeof gate.metadata?.evidencePath === "string" ? gate.metadata.evidencePath : undefined;
  return {
    id: `job-${job.id}-${gate.id}`,
    gateId: gate.gate,
    name: gate.gate,
    status: gate.status,
    source: "job_center",
    severity: gate.status === "failed" || gate.status === "requires_approval" ? "blocking" : gate.status === "passed" ? "info" : "warning",
    message: gate.message,
    evidencePath,
    artifactLinks: gate.artifacts,
    createdAt: gate.createdAt,
    metadata: {
      jobId: job.id,
      jobTitle: job.title,
      ...(gate.metadata || {}),
    },
  };
}

function collectApprovals(project: IndustrialProject | null, jobs: Job[]): ReleaseApproval[] {
  const projectApprovals = (project?.events || [])
    .filter((event) => /approval/i.test(event.type))
    .map((event) => ({
      id: event.id,
      status: String(event.data?.status || "recorded"),
      scope: String(event.data?.requirementId || event.data?.scope || event.type),
      decidedBy: typeof event.data?.approver === "string" ? event.data.approver : event.actor,
      decidedAt: event.createdAt,
      reason: typeof event.data?.reason === "string" ? event.data.reason : undefined,
      source: "industrial_project" as const,
    }));
  const jobApprovals = jobs.flatMap((job) => job.approvals.map((approval) => jobApprovalToReleaseApproval(approval, job)));
  return [...projectApprovals, ...jobApprovals];
}

function jobApprovalToReleaseApproval(approval: ApprovalRecord, job: Job): ReleaseApproval {
  return {
    id: approval.id,
    status: approval.status,
    scope: approval.scope || `job:${job.id}`,
    requestedBy: approval.requestedBy,
    decidedBy: approval.decidedBy,
    requestedAt: approval.requestedAt,
    decidedAt: approval.decidedAt,
    reason: approval.reason,
    source: "job_center",
  };
}

function summarizeGates(gates: ReleaseEvidence[]): Record<string, number> {
  const summary: Record<string, number> = { total: gates.length };
  for (const gate of gates) summary[gate.status] = (summary[gate.status] || 0) + 1;
  return summary;
}

function isRelevantJob(job: Job, workspace: string): boolean {
  if (job.cwd && samePathOrInside(workspace, job.cwd)) return true;
  if (job.metadata?.releaseReadable === true || job.metadata?.projectId) return true;
  return job.gateResults.some((gate) => gate.metadata?.releaseReadable === true);
}

function samePathOrInside(root: string, candidate: string): boolean {
  try {
    return pathInside(realOrResolve(root), realOrResolve(candidate));
  } catch {
    return false;
  }
}

function copyCandidates(input: {
  workspace: string;
  candidates: string[];
  destRoot: string;
  category: ReleaseArtifactCategory;
  maxFileBytes: number;
  accumulator: CopyAccumulator;
  excludeNames: Set<string>;
}): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const candidate of input.candidates) {
    const source = path.join(input.workspace, candidate);
    if (!fs.existsSync(source)) continue;
    const dest = path.join(input.destRoot, candidate);
    const copied = copyPath({
      workspace: input.workspace,
      source,
      dest,
      maxFileBytes: input.maxFileBytes,
      excludeNames: input.excludeNames,
      accumulator: input.accumulator,
    });
    files += copied.files;
    bytes += copied.bytes;
  }
  return { files, bytes };
}

function copyPath(input: {
  workspace: string;
  source: string;
  dest: string;
  maxFileBytes: number;
  excludeNames: Set<string>;
  accumulator: CopyAccumulator;
}): { files: number; bytes: number } {
  const source = resolveWorkspacePath(input.workspace, input.source, "source");
  const dest = assertInside(input.workspace, input.dest, "destination");
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    let files = 0;
    let bytes = 0;
    fs.mkdirSync(dest, { recursive: true, mode: 0o755 });
    for (const dirent of fs.readdirSync(source, { withFileTypes: true })) {
      if (input.excludeNames.has(dirent.name)) continue;
      const child = copyPath({
        ...input,
        source: path.join(source, dirent.name),
        dest: path.join(dest, dirent.name),
      });
      files += child.files;
      bytes += child.bytes;
    }
    return { files, bytes };
  }
  if (!stat.isFile()) return { files: 0, bytes: 0 };
  if (stat.size > input.maxFileBytes) {
    input.accumulator.risks.push(risk(`file.${relativePath(input.workspace, source)}.skipped`, "warning", "Large file skipped", `${relativePath(input.workspace, source)} is larger than ${input.maxFileBytes} bytes and was not copied into the release package.`, "artifact"));
    return { files: 0, bytes: 0 };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
  fs.copyFileSync(source, dest);
  return { files: 1, bytes: stat.size };
}

function renderReleaseNotes(input: {
  project: IndustrialProject;
  version: string;
  createdAt: string;
  readiness: ReleaseReadiness;
  risks: ReleaseRisk[];
  artifacts: ReleaseArtifact[];
  sourceCommit: string | null;
}): string {
  const simulated = [
    ...input.readiness.simulatedGates.map((gate) => `${gate.name} (${gate.status})`),
    ...input.artifacts.filter((artifact) => artifact.simulated).map((artifact) => `${artifact.name} (${artifact.type})`),
  ];
  return [
    `# Release ${input.version}`,
    "",
    `Project: ${input.project.name} (${input.project.projectId})`,
    `Created: ${input.createdAt}`,
    `Source commit: ${input.sourceCommit || "unavailable"}`,
    "",
    "## Release Readiness",
    input.readiness.ready ? "Ready: yes" : "Ready: no",
    `Gates: ${JSON.stringify(input.readiness.gateSummary)}`,
    `Artifacts: ${input.artifacts.length} packaged`,
    `Definition of Done: ${input.readiness.definitionOfDone?.status || "not_run"}`,
    input.readiness.definitionOfDone
      ? `Skeleton risks: ${input.readiness.definitionOfDone.skeleton.summary.total} total, ${input.readiness.definitionOfDone.skeleton.summary.blocking} blocking`
      : "Skeleton risks: not checked",
    "",
    "## SIMULATED / DRY-RUN EVIDENCE",
    simulated.length ? simulated.map((item) => `- ${item}`).join("\n") : "- None",
    "",
    "## Known Risks",
    input.risks.length ? input.risks.map((item) => `- [${item.severity}] ${item.title}: ${item.message}`).join("\n") : "- None",
    "",
    "## Included Artifact Summary",
    input.artifacts.length ? input.artifacts.map((artifact) => `- ${artifact.name} (${artifact.type}) -> ${artifact.relativePath || artifact.packagePath || "not copied"}`).join("\n") : "- No artifacts packaged",
    "",
  ].join("\n");
}

function renderEvidenceReport(input: {
  project: IndustrialProject;
  version: string;
  readiness: ReleaseReadiness;
  artifacts: ReleaseArtifact[];
  risks: ReleaseRisk[];
}): string {
  return [
    `# Evidence Report ${input.version}`,
    "",
    `Project: ${input.project.name}`,
    "",
    "## Gate Results",
    input.readiness.gateResults.length
      ? input.readiness.gateResults.map((gate) => `- ${gate.name}: ${gate.status}${gate.message ? ` - ${gate.message}` : ""}`).join("\n")
      : "- No gate results recorded",
    "",
    "## Definition of Done",
    input.readiness.definitionOfDone
      ? [
          `Status: ${input.readiness.definitionOfDone.status}`,
          `Skeleton risks: ${input.readiness.definitionOfDone.skeleton.summary.total} total, ${input.readiness.definitionOfDone.skeleton.summary.blocking} blocking, ${input.readiness.definitionOfDone.skeleton.summary.warning} warning`,
          ...input.readiness.definitionOfDone.checklist.map((item) => `- ${item.title}: ${item.status} - ${item.message}`),
        ].join("\n")
      : "- Not checked",
    "",
    "## Approvals",
    input.readiness.approvals.length
      ? input.readiness.approvals.map((approval) => `- ${approval.scope || approval.id}: ${approval.status}${approval.decidedBy ? ` by ${approval.decidedBy}` : ""}`).join("\n")
      : "- No approval records",
    "",
    "## Artifacts",
    input.artifacts.length
      ? input.artifacts.map((artifact) => `- ${artifact.name}: ${artifact.packagePath || artifact.relativePath || "not copied"}${artifact.sha256 ? ` sha256=${artifact.sha256}` : ""}`).join("\n")
      : "- No artifacts packaged",
    "",
    "## Risks",
    input.risks.length ? input.risks.map((riskItem) => `- [${riskItem.severity}] ${riskItem.message}`).join("\n") : "- None",
    "",
  ].join("\n");
}

function renderChecksumFile(checksums: Record<string, string>): string {
  return Object.entries(checksums)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, hash]) => `${hash}  ${file}`)
    .join("\n") + "\n";
}

function computeChecksums(root: string, excludeFiles: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const excluded = new Set(excludeFiles);
  walk(root, (file) => {
    const rel = relativePath(root, file);
    if (excluded.has(rel)) return;
    result[rel] = sha256File(file);
  });
  return result;
}

function walk(root: string, visit: (file: string) => void): void {
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    const item = path.join(root, dirent.name);
    if (dirent.isDirectory()) walk(item, visit);
    else if (dirent.isFile()) visit(item);
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o644 });
}

function writeText(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(file, value, { mode: 0o644 });
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readSourceCommit(workspace: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      env: buildSafeChildEnv(),
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && /^[a-f0-9]{40}$/i.test(result.stdout.trim())) return result.stdout.trim();
  } catch {
    return null;
  }
  return null;
}

function defaultVersion(workspace: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version.trim();
  } catch {
    /* use date fallback */
  }
  return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}

function releaseCategoryForArtifactType(type: string): ReleaseArtifactCategory {
  if (type === "source_code") return "source_code";
  if (type === "requirement_doc") return "requirement_doc";
  if (type === "test_plan") return "test_report";
  if (type === "architecture_doc") return "architecture_doc";
  if (type === "bom") return "bom";
  if (["cad_model", "drawing", "step_file", "stl_file"].includes(type)) return "cad_artifact";
  if (["pcb_project", "schematic", "layout", "gerber"].includes(type)) return "pcb_artifact";
  if (["plc_program", "io_map", "wiring_diagram"].includes(type)) return "plc_artifact";
  if (type === "ifc_model") return "bim_artifact";
  if (type === "inspection_report" || type === "simulation_report") return "quality_gate_report";
  return "industrial_artifact";
}

function missingSeverity(artifact: IndustrialArtifact): ReleaseRiskSeverity {
  const severity = typeof artifact.metadata?.releaseSeverity === "string" ? artifact.metadata.releaseSeverity : undefined;
  const required = artifact.metadata?.releaseRequired;
  if (severity === "warning" || required === false) return "warning";
  return "blocking";
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function risk(id: string, severity: ReleaseRiskSeverity, title: string, message: string, source: ReleaseRisk["source"], relatedId?: string): ReleaseRisk {
  return { id, severity, title, message, source, relatedId };
}

function sanitizeVersion(value: unknown): string {
  const version = cleanString(value);
  if (!version) throw new Error("release version is required");
  if (!/^[a-zA-Z0-9._+-]{1,80}$/.test(version) || version.includes("..")) throw new Error("release version contains unsafe characters");
  return version;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeFileName(value: string): string {
  const clean = value.replace(/[^a-zA-Z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 160) || "artifact";
}

function normalizeWorkspacePath(workspace: string, candidate: string): string {
  return resolveWorkspacePath(workspace, candidate, "workspace path");
}

function resolveWorkspacePath(workspace: string, candidate: string, field: string): string {
  const raw = cleanString(candidate);
  if (!raw) throw new Error(`${field} is required`);
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  return assertInside(workspace, resolved, field);
}

function assertInside(root: string, target: string, field: string): string {
  const safeRoot = realOrResolve(root);
  const resolved = path.resolve(target);
  const safeTarget = fs.existsSync(resolved) ? realOrResolve(resolved) : resolved;
  if (!pathInside(safeRoot, safeTarget)) throw new Error(`${field} escapes workspace`);
  return safeTarget;
}

function pathInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function safeExistingDirectory(value: string, field: string): string {
  const dir = path.resolve(value);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${field} must be an existing directory`);
  return realOrResolve(dir);
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

function fileSize(file: string): number {
  return fs.statSync(file).size;
}
