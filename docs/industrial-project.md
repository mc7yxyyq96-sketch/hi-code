# Industrial Project

Sprint 4A adds the core project model for industrial product development. Sprint 4B adds Requirement Builder and Spec Builder for converting natural-language needs into structured requirements, engineering plans, generated specifications, and Job Center evidence. Sprint 6A adds Industrial Tool Adapter detection and dry-run planning. Sprint 6B adds real FreeCAD execution for a simple parameterized control box enclosure. Sprint 6C adds real KiCad CLI execution for PCB project inspection, ERC/DRC, Gerber/drill, and BOM flow evidence when KiCad is installed. Sprint 6D adds PLC/OpenPLC Structured Text draft, I/O map, FAT/SAT checklist, and compile-status evidence. Sprint 6E adds IfcOpenShell/IFC local inspection, element/space statistics, property extraction, and BIM delivery checklist evidence when the Python module is installed. Sprint 6F adds SolidWorks bridge package generation for licensed Windows manual execution. Sprint 6G adds AVEVA / enterprise industrial data exchange planning with schemas, CSV templates, and sync risk gates. Chemical process, energy, and other commercial/deep integrations remain dry-run-only unless explicitly promoted by a sprint.

## Storage

Each workspace can contain:

```text
.hicode/project.json
.hicode/generated/requirements/<requirementId>/
```

`project.json` is intended to live with the project repository so project configuration, requirements, traceability, and quality gate definitions can move with the engineering work. Generated requirement/specification documents are written under `.hicode/generated/requirements/<requirementId>/`.

## Project Model

Core types and validation live in `src/industrial-project.ts`.

Required top-level fields:

- `projectId`
- `name`
- `type`
- `domains`
- `requirements`
- `artifacts`
- `qualityGates`
- `toolchain`
- `standards`
- `releaseTargets`
- `traceability`

The model also records local project `events`, `createdAt`, and `updatedAt`.

Requirements include:

- `requirementId`
- `title`
- `description`
- `domain`
- `priority`
- `acceptanceCriteria`
- `linkedArtifacts`
- `linkedTests`
- `riskLevel`
- `approvalRequired`

## Domains

Built-in domain keys:

- `software`
- `mechanical`
- `cad`
- `solidworks`
- `pcb`
- `plc`
- `bim`
- `architecture`
- `process_chemical`
- `energy`
- `materials`
- `electrical`
- `automation`
- `manufacturing`
- `documentation`
- `qa`

Unknown domains are rejected during validation.

## Artifact Types

Supported artifact types:

- `source_code`
- `requirement_doc`
- `architecture_doc`
- `test_plan`
- `cad_model`
- `drawing`
- `step_file`
- `stl_file`
- `pcb_project`
- `schematic`
- `layout`
- `gerber`
- `bom`
- `plc_program`
- `io_map`
- `wiring_diagram`
- `ifc_model`
- `pid_diagram`
- `simulation_report`
- `material_spec`
- `inspection_report`
- `release_package`

Artifact paths are project-relative paths or absolute paths inside the current workspace. Paths containing `..` are rejected by the core model, and `IndustrialProjectStore` rejects artifact paths or gate `resultPath` values that resolve outside the workspace.

## Traceability

Traceability links connect engineering evidence:

- `requirement -> design`
- `design -> artifact`
- `artifact -> test`
- `test -> release_gate`

The model stores these as:

```json
{
  "relation": "requirement_design",
  "fromType": "requirement",
  "fromId": "REQ-001",
  "toType": "design",
  "toId": "DES-001"
}
```

The relation must match the node pair.

## Quality Gates

Supported gate types:

- `build`
- `test`
- `lint`
- `security`
- `cad_validation`
- `pcb_erc`
- `pcb_drc`
- `plc_compile`
- `bim_check`
- `process_safety`
- `energy_simulation`
- `documentation_review`
- `human_approval`

Gate statuses:

- `pending`
- `passed`
- `failed`
- `warning`
- `skipped`

The Electron service records gate additions both in `.hicode/project.json` and in Job Center gate results when possible.

## Toolchain

`project.toolchain` declares the project-level tools needed for delivery. A toolchain item can include:

- `id`
- `name`
- `type`
- `command`
- `version`
- `dryRun`
- `domains`

Sprint 6A uses these declarations for visibility in the Toolchain panel. Real adapter detection and dry-run planning live in `src/industrial-tool-adapters.ts` and `electron/services/industrial-tool-service.mjs`. Toolchain declarations never authorize execution by themselves; external tool execution requires explicit user approval. Sprint 6G permits real execution only for the FreeCAD, KiCad, OpenPLC/IEC, and IfcOpenShell/IFC adapters. PLC/OpenPLC execution never authorizes device download and records compile status as `not_run`, `passed`, or `failed`. BIM/IFC execution records inspection evidence only; local building-code compliance remains a human approval gate. SolidWorks outputs are bridge-planned as external-required native CAD artifacts until a licensed Windows bridge runner is implemented. AVEVA outputs are dry-run data exchange templates until an enterprise-approved connector is implemented.

## Requirement Builder

Core requirement parsing lives in `src/industrial-requirement-builder.ts`.

The builder accepts natural-language text plus optional `domain` and `priority`. It deterministically creates a structured requirement:

- Generates a stable-looking `REQ-<DOMAIN>-<HASH>` requirement id.
- Detects or applies the engineering domain.
- Derives priority and risk level from keywords and domain criticality.
- Creates acceptance criteria when the input does not include explicit criteria.
- Marks `approvalRequired` for high/critical or explicitly approval-gated requirements.

The Electron service persists accepted requirements into `.hicode/project.json` through `IndustrialProjectStore.addRequirement`. Acceptance criteria updates use `updateRequirementAcceptanceCriteria`; artifact links use `linkArtifactToRequirement`, which also creates `requirement -> design -> artifact` traceability.

## Spec Builder

Spec Builder generates these files under `.hicode/generated/requirements/<requirementId>/`:

- `prd.md`
- `system-specification.md`
- `architecture-outline.md`
- `artifact-plan.md`
- `test-plan-outline.md`
- `release-checklist.md`
- `spec-package.json`

Generated docs are recorded as Job Center artifacts. Generated artifact plans can also create planned project artifacts and traceability links. Test plan generation creates a `test_plan` artifact and updates the requirement's acceptance criteria when needed.

## Domain-Aware Planning

Domain planning is rule-based and lives in `DOMAIN_PLANNING_RULES`.

- `software`: source code, architecture docs, tests, release package; gates include build/test/lint/security.
- `mechanical`, `cad`, `solidworks`: CAD model, drawing, STEP/STL, BOM, inspection evidence; gates include CAD validation and human approval.
- `pcb`: schematic, layout, Gerber, BOM; gates include ERC/DRC.
- `plc`, `automation`: PLC program, I/O map, wiring diagram, FAT/SAT test plan; gates include PLC compile and test.
- `bim`, `architecture`: IFC, drawing/floor plan, code or clash checks.
- `process_chemical`: PFD/P&ID-style evidence, material balance, HAZOP/process safety review.
- `energy`, `electrical`: single-line/wiring diagrams, load flow/protection evidence.
- `materials`: material spec, test report, inspection plan.

## Electron IPC

Implementation lives in `electron/services/industrial-project-service.mjs`.

IPC channels:

- `industrial-project:schema`
- `industrial-project:get`
- `industrial-project:validate`
- `industrial-project:save`
- `industrial-requirement:draft`
- `industrial-requirement:add`
- `industrial-requirement:criteria:update`
- `industrial-requirement:artifact-plan`
- `industrial-requirement:test-plan`
- `industrial-requirement:spec-package`
- `industrial-requirement:approve`
- `industrial-project:artifact:add`
- `industrial-project:traceability:add`
- `industrial-project:gate:add`

All channels use the standard IPC registrar for normalized errors and redacted logging.
Renderer API wrappers must fail closed when these preload methods are unavailable. The explicit demo mode in `renderer/app/bootstrap.js` can still provide sample data for browser-only development, but production Electron paths must go through the preload IPC methods above.

## Renderer

The basic UI lives in `renderer/components/industrial-project-panel.js`.

It supports:

- Creating or editing `.hicode/project.json`
- Viewing project type and domains
- Viewing artifact list
- Viewing requirement list
- Viewing traceability links
- Viewing quality gate status
- Adding a basic artifact, traceability link, or gate result
- Generating a requirement draft from natural language
- Editing acceptance criteria
- Generating artifact plans, test plan outlines, spec packages, and release checklist documents
- Recording a requirement approval
- Viewing Toolchain adapter install status, capabilities, setup hints, project/Domain Pack requirements, and dry-run artifacts
- Running Quality Gates, viewing evidence, rerunning checks, and approving/rejecting human approval gates
- Viewing Release Center readiness and building release packages under `releases/<version>/`

## Domain Pack Integration

Sprint 5A adds Domain Packs as the extension point for industrial knowledge. Packs extend this model rather than creating separate project stores.

A Domain Pack provides:

- Domain-specific artifact templates
- Standards and validation profiles
- Checklists for release and engineering review
- Tool requirements that are descriptive only in Sprint 5A
- Quality gates that are written into `qualityGates` as pending project gates
- Agent profiles for domain review behavior

When a pack is enabled, Hi Code writes pack standards into `project.standards`, records pack templates and checklists in `project.metadata.domainPacks`, adds pack gates with `metadata.domainPackId`, records a project event, and writes a Job Center audit event. Real industrial tool adapters must still clearly report simulated or dry-run execution when a tool is not installed; Sprint 6A adds that adapter framework but does not execute those tools.

Details are in `docs/domain-packs.md`.

## Industrial Tool Adapter Integration

Tool adapters connect project `toolchain` declarations and Domain Pack `toolRequirements` to safe detection and dry-run planning. Detection can inspect commands, version output, executable paths, environment variables, and config paths. Dry-run writes simulated artifacts under `.hicode/generated/tool-adapters/*` and records Job Center events, artifacts, and gate diagnostics.

Details are in `docs/industrial-tool-adapters.md`.

## Quality Gate Runner Integration

Sprint 7A adds `src/quality-gates.ts` and `electron/services/quality-gate-service.mjs`.

Gate runs write evidence under `.hicode/artifacts/quality-gates/*`, write a Job Center `gateResults` record, and mirror a project `qualityGates` entry when `.hicode/project.json` exists. The mirrored project gate stores the evidence path in `resultPath` and the full release-readable evidence in `metadata`.

The project model now accepts `passed`, `failed`, `warning`, `skipped`, `simulated`, `not_run`, and `requires_approval`. `simulated`, `not_run`, and `requires_approval` are not release passes.

Details are in `docs/quality-gates.md`.

## Release Builder Integration

Sprint 7B adds `src/release-builder.ts`, `electron/services/release-service.mjs`, and the Release Center renderer panel.

Release Builder reads `.hicode/project.json`, project artifacts, project quality gates, Job Center gate results, and approval records. It writes:

- `releases/<version>/release-manifest.json`
- `releases/<version>/release-notes.md`
- `releases/<version>/evidence-report.md`
- `releases/<version>/checksums.sha256`
- packaged `artifacts/`, `docs/`, and `gates/`

Release readiness is strict:

- `failed` gates block release.
- `requires_approval` gates block release until approval is recorded by rerunning the gate.
- `simulated`, `not_run`, `skipped`, and `warning` gates remain visible risks.
- Missing project artifacts block release unless marked warning-only in artifact metadata.
- Simulated artifacts and dry-run adapter outputs are allowed only when clearly marked in release notes.

Release builds create a Job Center job and store the manifest as a `release_package` artifact.

Details are in `docs/release-builder.md`.

## Sample Project Integration

Sprint 8A adds the `Industrial Control Box Demo` sample. It is available from the Industrial Project panel's Sample Project area and through IPC channel `sample:industrial-control-box:create`.

The sample creates `.hicode/project.json`, requirements, software scaffold, FreeCAD/KiCad adapter outputs or dry-run evidence, PLC engineering drafts, electrical docs, BOM, gate evidence, and a Release Builder package under `releases/industrial-control-box-demo/`.

Detailed rules for generated artifacts, dry-run behavior, and release verification are in `docs/samples/industrial-control-box.md`.

## Validation

```bash
npm run build
npm run verify
node test/feature-tests.mjs
node test/industrial-project-tests.mjs
node test/domain-pack-tests.mjs
node test/industrial-tool-tests.mjs
node test/quality-gate-tests.mjs
node test/release-builder-tests.mjs
node test/industrial-control-box-sample-tests.mjs
```
