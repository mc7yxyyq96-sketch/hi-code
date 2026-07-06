import fs from "node:fs";
import path from "node:path";

import {
  INDUSTRIAL_ARTIFACT_TYPES,
  INDUSTRIAL_DOMAIN_KEYS,
  INDUSTRIAL_GATE_TYPES,
  INDUSTRIAL_PROJECT_JSON_SCHEMA,
  IndustrialProjectStore,
  validateIndustrialProject,
} from "../../dist/industrial-project.js";
import {
  buildArtifactPlan,
  buildRequirementFromText,
  buildSpecPackage,
  buildTestPlanOutline,
  planningRulesForDomains,
} from "../../dist/industrial-requirement-builder.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createIndustrialProjectService({ getCwd, jobStore }) {
  if (typeof getCwd !== "function") throw new Error("industrial-project-service requires getCwd");
  if (!jobStore) throw new Error("industrial-project-service requires jobStore");

  return {
    schema() {
      return {
        ok: true,
        schema: INDUSTRIAL_PROJECT_JSON_SCHEMA,
        domains: [...INDUSTRIAL_DOMAIN_KEYS],
        artifactTypes: [...INDUSTRIAL_ARTIFACT_TYPES],
        gateTypes: [...INDUSTRIAL_GATE_TYPES],
        planningRules: planningRulesForDomains([...INDUSTRIAL_DOMAIN_KEYS]),
      };
    },

    getProject() {
      try {
        const store = projectStore(getCwd());
        return { ok: true, project: store.getProject(), path: store.projectPath() };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    validateProject(payload = {}) {
      const result = validateIndustrialProject(ipcObject(payload));
      return { ok: result.ok, errors: result.errors, project: result.project || null };
    },

    saveProject(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const current = store.getProject();
        const project = current
          ? store.updateProject({ ...input, actor: ipcString(input.actor, "user") })
          : store.createProject({
              name: ipcString(input.name),
              type: ipcString(input.type),
              domains: Array.isArray(input.domains) ? input.domains : [],
              requirements: Array.isArray(input.requirements) ? input.requirements : [],
              artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
              qualityGates: Array.isArray(input.qualityGates) ? input.qualityGates : [],
              toolchain: Array.isArray(input.toolchain) ? input.toolchain : [],
              standards: Array.isArray(input.standards) ? input.standards : [],
              releaseTargets: Array.isArray(input.releaseTargets) ? input.releaseTargets : [],
              traceability: Array.isArray(input.traceability) ? input.traceability : [],
              actor: ipcString(input.actor, "user"),
              metadata: ipcObject(input.metadata),
            });
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: current ? "Update industrial project" : "Create industrial project",
          eventType: current ? "industrial.project.updated" : "industrial.project.created",
          message: `${current ? "Updated" : "Created"} industrial project ${project.name}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, path: store.projectPath(), domains: project.domains },
          projectPath: store.projectPath(),
          gate: current ? undefined : { gate: "industrial-project-schema", status: "passed", message: "project.json created and validated" },
        });
        return { ok: true, project, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    buildRequirementDraft(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.getProject();
        const draft = buildRequirementFromText({
          text: ipcString(input.text),
          domain: ipcString(input.domain, undefined),
          priority: ipcString(input.priority, undefined),
          projectDomains: project?.domains || [],
          actor: ipcString(input.actor, "user"),
        });
        return {
          ok: true,
          draft,
          artifactPlan: buildArtifactPlan(requirementLike(draft)),
          testPlan: buildTestPlanOutline(requirementLike(draft)),
        };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    addRequirement(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.addRequirement({
          id: ipcString(input.id || input.requirementId, undefined),
          requirementId: ipcString(input.requirementId || input.id, undefined),
          title: ipcString(input.title),
          description: ipcString(input.description, undefined),
          domain: ipcString(input.domain, undefined),
          priority: ipcString(input.priority, undefined),
          acceptanceCriteria: Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : input.acceptanceCriteria,
          linkedArtifacts: Array.isArray(input.linkedArtifacts) ? input.linkedArtifacts : [],
          linkedTests: Array.isArray(input.linkedTests) ? input.linkedTests : [],
          riskLevel: ipcString(input.riskLevel, undefined),
          approvalRequired: input.approvalRequired === true,
          source: ipcString(input.source, "requirement-builder"),
          metadata: ipcObject(input.metadata),
          actor: ipcString(input.actor, "user"),
        });
        const requirement = findRequirement(project, ipcString(input.requirementId || input.id)) || project.requirements[project.requirements.length - 1];
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Create industrial requirement",
          eventType: "industrial.requirement.created",
          message: `Created requirement ${requirement.requirementId}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, requirementId: requirement.requirementId, domain: requirement.domain },
          projectPath: store.projectPath(),
          gate: { gate: "requirement-structure", status: "passed", message: "requirement captured and validated" },
        });
        return { ok: true, project, requirement, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    updateRequirementCriteria(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.updateRequirementAcceptanceCriteria({
          requirementId: ipcString(input.requirementId),
          acceptanceCriteria: input.acceptanceCriteria,
          actor: ipcString(input.actor, "user"),
        });
        const requirement = findRequirement(project, ipcString(input.requirementId));
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Update requirement acceptance criteria",
          eventType: "industrial.requirement.criteria.updated",
          message: `Updated acceptance criteria for ${requirement?.requirementId || ipcString(input.requirementId)}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, requirementId: requirement?.requirementId || ipcString(input.requirementId) },
          projectPath: store.projectPath(),
        });
        return { ok: true, project, requirement, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    generateArtifactPlan(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const current = requireProject(store);
        const requirement = requireRequirement(current, ipcString(input.requirementId));
        const plan = buildArtifactPlan(requirement);
        const docs = writeGeneratedDocs(getCwd(), requirement.requirementId, {
          "artifact-plan.md": renderArtifactPlanMarkdown(requirement, plan),
          "artifact-plan.json": JSON.stringify(plan, null, 2),
        });
        let project = current;
        for (const planned of plan.artifacts) {
          project = new IndustrialProjectStore({ workspacePath: getCwd() }).linkArtifactToRequirement({
            requirementId: requirement.requirementId,
            artifact: {
              id: planned.id,
              type: planned.type,
              name: planned.name,
              path: planned.path,
              domain: planned.domain,
              status: "draft",
              metadata: { generatedBy: "requirement-builder", qualityGates: planned.qualityGates },
            },
            actor: ipcString(input.actor, "user"),
          });
        }
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Generate industrial artifact plan",
          eventType: "industrial.requirement.artifact_plan.generated",
          message: `Generated artifact plan for ${requirement.requirementId}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, requirementId: requirement.requirementId, artifactCount: plan.artifacts.length },
          projectPath: store.projectPath(),
          artifactPaths: docs.map((doc) => doc.path),
          gate: { gate: "artifact-plan", status: "passed", message: `${plan.artifacts.length} planned artifacts` },
        });
        return { ok: true, project, requirement: requireRequirement(project, requirement.requirementId), plan, generated: docs, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    generateTestPlan(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const current = requireProject(store);
        const requirement = requireRequirement(current, ipcString(input.requirementId));
        const plan = buildTestPlanOutline(requirement);
        const docs = writeGeneratedDocs(getCwd(), requirement.requirementId, {
          "test-plan-outline.md": renderTestPlanMarkdown(requirement, plan),
          "test-plan-outline.json": JSON.stringify(plan, null, 2),
        });
        const project = store.linkArtifactToRequirement({
          requirementId: requirement.requirementId,
          artifact: {
            id: `${safeSlug(requirement.requirementId)}-test-plan`,
            type: "test_plan",
            name: `${requirement.title} test plan outline`,
            path: relativeToWorkspace(getCwd(), docs[0].path),
            domain: requirement.domain,
            status: "draft",
            testIds: plan.tests.map((test) => test.id),
            metadata: { generatedBy: "requirement-builder", tests: plan.tests },
          },
          actor: ipcString(input.actor, "user"),
        });
        const updated = store.updateRequirementAcceptanceCriteria({
          requirementId: requirement.requirementId,
          acceptanceCriteria: plan.acceptanceCriteria,
          actor: ipcString(input.actor, "user"),
        });
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Generate industrial test plan",
          eventType: "industrial.requirement.test_plan.generated",
          message: `Generated test plan for ${requirement.requirementId}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: updated.projectId, requirementId: requirement.requirementId, testCount: plan.tests.length },
          projectPath: store.projectPath(),
          artifactPaths: docs.map((doc) => doc.path),
          gate: { gate: "test-plan-outline", status: "passed", message: `${plan.tests.length} planned tests` },
        });
        return { ok: true, project: updated, requirement: requireRequirement(updated, requirement.requirementId), plan, generated: docs, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    generateSpecPackage(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        let project = requireProject(store);
        const requirement = requireRequirement(project, ipcString(input.requirementId));
        const spec = buildSpecPackage(project, requirement);
        const docs = writeGeneratedDocs(getCwd(), requirement.requirementId, {
          "prd.md": spec.prd,
          "system-specification.md": spec.systemSpecification,
          "architecture-outline.md": spec.architectureOutline,
          "artifact-plan.md": spec.industrialArtifactPlan,
          "test-plan-outline.md": spec.testPlanOutline,
          "release-checklist.md": spec.releaseChecklist,
          "spec-package.json": JSON.stringify(spec, null, 2),
        });
        project = store.linkArtifactToRequirement({
          requirementId: requirement.requirementId,
          artifact: {
            id: `${safeSlug(requirement.requirementId)}-prd`,
            type: "requirement_doc",
            name: `${requirement.title} PRD`,
            path: relativeToWorkspace(getCwd(), docs.find((doc) => doc.name === "prd.md")?.path || docs[0].path),
            domain: requirement.domain,
            status: "draft",
            metadata: { generatedBy: "spec-builder" },
          },
          actor: ipcString(input.actor, "user"),
        });
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Generate industrial spec package",
          eventType: "industrial.requirement.spec_package.generated",
          message: `Generated spec package for ${requirement.requirementId}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, requirementId: requirement.requirementId, generatedDocs: docs.map((doc) => doc.name) },
          projectPath: store.projectPath(),
          artifactPaths: docs.map((doc) => doc.path),
          gate: { gate: "documentation_review", status: "warning", message: "generated specs require engineering review" },
        });
        return { ok: true, project, requirement: requireRequirement(project, requirement.requirementId), spec, generated: docs, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    approveRequirement(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.addRequirementApproval({
          requirementId: ipcString(input.requirementId),
          status: ipcString(input.status, "approved"),
          approver: ipcString(input.approver, "user"),
          reason: ipcString(input.reason, undefined),
          actor: ipcString(input.actor, ipcString(input.approver, "user")),
        });
        const requirement = requireRequirement(project, ipcString(input.requirementId));
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Record requirement approval",
          eventType: "industrial.requirement.approval.recorded",
          message: `Requirement ${requirement.requirementId} approval ${ipcString(input.status, "approved")}`,
          actor: ipcString(input.approver, "user"),
          data: { projectId: project.projectId, requirementId: requirement.requirementId, status: ipcString(input.status, "approved") },
          projectPath: store.projectPath(),
          approval: {
            status: ipcString(input.status, "approved"),
            requestedBy: "requirement-builder",
            decidedBy: ipcString(input.approver, "user"),
            scope: `requirement:${requirement.requirementId}`,
            reason: ipcString(input.reason, undefined),
            metadata: { requirementId: requirement.requirementId },
          },
        });
        return { ok: true, project, requirement, approval: job?.approvals?.[job.approvals.length - 1] || null, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    addArtifact(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.addArtifact({
          id: ipcString(input.id, undefined),
          type: ipcString(input.type),
          name: ipcString(input.name),
          path: ipcString(input.path, undefined),
          domain: ipcString(input.domain, undefined),
          status: ipcString(input.status, undefined),
          requirementIds: Array.isArray(input.requirementIds) ? input.requirementIds : [],
          designIds: Array.isArray(input.designIds) ? input.designIds : [],
          testIds: Array.isArray(input.testIds) ? input.testIds : [],
          releaseTargetIds: Array.isArray(input.releaseTargetIds) ? input.releaseTargetIds : [],
          metadata: ipcObject(input.metadata),
          actor: ipcString(input.actor, "user"),
        });
        const artifact = findRecord(project.artifacts, ipcString(input.id)) || project.artifacts[project.artifacts.length - 1];
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Add industrial artifact",
          eventType: "industrial.artifact.added",
          message: `Added artifact ${artifact.name}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, artifactId: artifact.id, artifactType: artifact.type },
          projectPath: store.projectPath(),
        });
        return { ok: true, project, artifact, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    addTraceability(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.addTraceability({
          id: ipcString(input.id, undefined),
          fromType: ipcString(input.fromType),
          fromId: ipcString(input.fromId),
          toType: ipcString(input.toType),
          toId: ipcString(input.toId),
          relation: ipcString(input.relation, undefined),
          metadata: ipcObject(input.metadata),
          actor: ipcString(input.actor, "user"),
        });
        const link = findRecord(project.traceability, ipcString(input.id)) || project.traceability[project.traceability.length - 1];
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Add industrial traceability",
          eventType: "industrial.traceability.added",
          message: `Added ${link.relation} traceability`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, traceabilityId: link.id, relation: link.relation },
          projectPath: store.projectPath(),
        });
        return { ok: true, project, traceability: link, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },

    addGateResult(payload = {}) {
      const input = ipcObject(payload);
      try {
        const store = projectStore(getCwd());
        const project = store.addGateResult({
          id: ipcString(input.id, undefined),
          type: ipcString(input.type),
          name: ipcString(input.name, undefined),
          status: ipcString(input.status, "pending"),
          artifactIds: Array.isArray(input.artifactIds) ? input.artifactIds : [],
          requirementIds: Array.isArray(input.requirementIds) ? input.requirementIds : [],
          releaseTargetIds: Array.isArray(input.releaseTargetIds) ? input.releaseTargetIds : [],
          message: ipcString(input.message, undefined),
          score: Number.isFinite(Number(input.score)) ? Number(input.score) : undefined,
          command: ipcString(input.command, undefined),
          resultPath: ipcString(input.resultPath, undefined),
          metadata: ipcObject(input.metadata),
          actor: ipcString(input.actor, "user"),
        });
        const gate = findRecord(project.qualityGates, ipcString(input.id)) || project.qualityGates[project.qualityGates.length - 1];
        const job = recordIndustrialJob({
          jobStore,
          cwd: getCwd(),
          title: "Add industrial gate result",
          eventType: "industrial.gate.result",
          message: `Gate ${gate.type}: ${gate.status}`,
          actor: ipcString(input.actor, "user"),
          data: { projectId: project.projectId, gateId: gate.id, gateType: gate.type, status: gate.status },
          projectPath: store.projectPath(),
          gate: { gate: gate.type, status: gate.status === "pending" ? "skipped" : gate.status, message: gate.message || gate.name },
        });
        return { ok: true, project, gate, path: store.projectPath(), jobId: job?.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export function registerIndustrialProjectIpc({ register, industrialProject }) {
  if (!register) throw new Error("registerIndustrialProjectIpc requires register");
  if (!industrialProject) throw new Error("registerIndustrialProjectIpc requires industrialProject service");
  register.handle("industrial-project:schema", () => industrialProject.schema());
  register.handle("industrial-project:get", () => industrialProject.getProject());
  register.handle("industrial-project:validate", (_event, payload) => industrialProject.validateProject(payload));
  register.handle("industrial-project:save", (_event, payload) => industrialProject.saveProject(payload));
  register.handle("industrial-requirement:draft", (_event, payload) => industrialProject.buildRequirementDraft(payload));
  register.handle("industrial-requirement:add", (_event, payload) => industrialProject.addRequirement(payload));
  register.handle("industrial-requirement:criteria:update", (_event, payload) => industrialProject.updateRequirementCriteria(payload));
  register.handle("industrial-requirement:artifact-plan", (_event, payload) => industrialProject.generateArtifactPlan(payload));
  register.handle("industrial-requirement:test-plan", (_event, payload) => industrialProject.generateTestPlan(payload));
  register.handle("industrial-requirement:spec-package", (_event, payload) => industrialProject.generateSpecPackage(payload));
  register.handle("industrial-requirement:approve", (_event, payload) => industrialProject.approveRequirement(payload));
  register.handle("industrial-project:artifact:add", (_event, payload) => industrialProject.addArtifact(payload));
  register.handle("industrial-project:traceability:add", (_event, payload) => industrialProject.addTraceability(payload));
  register.handle("industrial-project:gate:add", (_event, payload) => industrialProject.addGateResult(payload));
}

function projectStore(cwd) {
  return new IndustrialProjectStore({ workspacePath: path.resolve(cwd) });
}

function requireProject(store) {
  const project = store.getProject();
  if (!project) throw new Error("industrial project does not exist");
  return project;
}

function findRequirement(project, requirementId) {
  if (!project || !requirementId) return null;
  return (project.requirements || []).find((requirement) => requirement.id === requirementId || requirement.requirementId === requirementId) || null;
}

function requireRequirement(project, requirementId) {
  const requirement = findRequirement(project, requirementId);
  if (!requirement) throw new Error("requirement not found");
  return requirement;
}

function requirementLike(draft) {
  return {
    id: draft.requirementId,
    requirementId: draft.requirementId,
    title: draft.title,
    domain: draft.domain,
    acceptanceCriteria: draft.acceptanceCriteria,
  };
}

function findRecord(records, id) {
  if (!id) return null;
  return Array.isArray(records) ? records.find((record) => record?.id === id) || null : null;
}

function writeGeneratedDocs(cwd, requirementId, files) {
  const root = path.join(path.resolve(cwd), ".hicode", "generated", "requirements", safeSlug(requirementId));
  assertInside(path.resolve(cwd), root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return Object.entries(files).map(([name, content]) => {
    const filePath = path.join(root, safeGeneratedFilename(name));
    assertInside(path.resolve(cwd), filePath);
    fs.writeFileSync(filePath, String(content), { mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch {}
    return { name, path: filePath, relativePath: relativeToWorkspace(cwd, filePath), size: Buffer.byteLength(String(content)) };
  });
}

function renderArtifactPlanMarkdown(requirement, plan) {
  return [
    `# Artifact Plan`,
    "",
    `## ${requirement.requirementId}: ${requirement.title}`,
    "",
    ...plan.artifacts.map((artifact) => `- ${artifact.id}: ${artifact.type} - ${artifact.name} (${artifact.path})`),
    "",
    "## Quality Gates",
    ...plan.qualityGates.map((gate) => `- ${gate}`),
  ].join("\n");
}

function renderTestPlanMarkdown(requirement, plan) {
  return [
    `# Test Plan Outline`,
    "",
    `## ${requirement.requirementId}: ${requirement.title}`,
    "",
    "## Tests",
    ...plan.tests.map((test) => `- ${test.id}: ${test.title} [${test.gate}] -> ${test.evidence}`),
    "",
    "## Acceptance Criteria",
    ...plan.acceptanceCriteria.map((criterion) => `- ${criterion}`),
  ].join("\n");
}

function relativeToWorkspace(cwd, target) {
  const rel = path.relative(path.resolve(cwd), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("generated artifact path escapes workspace");
  return rel;
}

function safeGeneratedFilename(name) {
  const cleaned = path.basename(String(name || "generated.md")).replace(/[^a-z0-9._-]+/gi, "-");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("invalid generated filename");
  return cleaned;
}

function safeSlug(value) {
  return String(value || "requirement").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "requirement";
}

function assertInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("generated path escapes workspace");
}

function recordIndustrialJob({ jobStore, cwd, title, eventType, message, actor, data, projectPath, artifactPaths = [], gate, approval }) {
  try {
    const job = jobStore.createJob({
      title,
      source: "industrial-project",
      trigger: eventType,
      actor: actor || "user",
      executor: "industrial-project-service",
      cwd,
      tasks: [{ title, executor: "industrial-project-service" }],
      metadata: data,
    });
    jobStore.updateJob(job.id, { status: "running" });
    jobStore.appendJobEvent(job.id, { type: eventType, message, actor: actor || "user", data });
    if (projectPath) {
      jobStore.addArtifact(job.id, {
        type: "industrial-project",
        path: projectPath,
        name: "project.json",
        producedBy: { executor: "industrial-project-service" },
        metadata: data,
      });
    }
    for (const artifactPath of artifactPaths) {
      jobStore.addArtifact(job.id, {
        type: "industrial-generated-doc",
        path: artifactPath,
        name: path.basename(artifactPath),
        producedBy: { executor: "industrial-project-service" },
        metadata: data,
      });
    }
    if (gate) {
      jobStore.addGateResult(job.id, {
        gate: gate.gate,
        status: gate.status,
        message: gate.message,
        metadata: data,
      });
    }
    if (approval && typeof jobStore.addApprovalRecord === "function") {
      jobStore.addApprovalRecord(job.id, approval);
    }
    jobStore.updateJob(job.id, { status: "succeeded" });
    return jobStore.getJob(job.id);
  } catch {
    return null;
  }
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error || "industrial project operation failed");
}
