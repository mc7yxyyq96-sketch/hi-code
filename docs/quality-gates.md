# Quality Gate Runner

Sprint 7A adds a unified Quality Gate Runner for software checks, industrial tool evidence, documentation review, security review, and human approval. Gate output is persisted as Job Center gate results and, when an Industrial Project exists, mirrored into `.hicode/project.json`.

## Gate Types

- `command_gate`: runs an approved command without shell interpolation.
- `file_exists_gate`: verifies required files exist inside the workspace.
- `schema_gate`: validates a JSON object or JSON artifact has required fields.
- `artifact_integrity_gate`: verifies artifacts exist, are files, and are non-empty unless explicitly allowed.
- `security_gate`: flags security-sensitive changed files for human review.
- `human_approval_gate`: records approval, rejection, or pending approval.
- `adapter_gate`: evaluates industrial adapter results and keeps dry-run output as `simulated`.
- `documentation_gate`: checks documentation artifacts and required review sections.

## Status Definitions

- `passed`: evidence satisfies the gate and can be considered release-positive.
- `failed`: evidence violates the gate and blocks release.
- `warning`: evidence needs review but does not automatically fail the job.
- `skipped`: inputs were intentionally absent or the check was not applicable.
- `simulated`: dry-run or simulated evidence exists, but it is not a release pass.
- `not_run`: no executable evidence was produced.
- `requires_approval`: a human decision is required before release.

## Evidence Format

Every `QualityGateResult` contains:

- `gateId`
- `status`
- `command` or `adapter` when applicable
- `startedAt`
- `endedAt`
- `stdoutSummary`
- `stderrSummary`
- `artifactLinks`
- `remediation`
- `manualApprovalRequired`

Electron writes the full `QualityGateRun` JSON to `.hicode/artifacts/quality-gates/<runId>/<gateId>-evidence.json`. The Job Center stores that file as a `quality_gate_evidence` artifact and stores the result in `job.gateResults[].metadata.qualityGate`.

## Built-In Gates

Software:

- `software.npm_build`
- `software.npm_test`
- `software.syntax_check`
- `software.package_schema`
- `software.security_sensitive_file_changed`

CAD:

- `cad.artifact_exists`
- `cad.step_stl_non_empty`
- `cad.metadata_complete`

PCB:

- `pcb.kicad_project_exists`
- `pcb.erc_result`
- `pcb.drc_result`
- `pcb.gerber_exists`
- `pcb.bom_exists`

PLC:

- `plc.st_file_exists`
- `plc.io_map_complete`
- `plc.safety_interlock_documented`
- `plc.fat_sat_checklist_exists`

BIM:

- `bim.ifc_file_exists`
- `bim.summary_exists`
- `bim.code_check_manual_approval`

Adapter:

- `adapter.result_status`

## Adding a Gate

Add a `QualityGate` definition in `src/quality-gates.ts` or provide a full gate object through the IPC payload. New gates must include a stable `id`, `type`, `category`, `severity`, `description`, and `remediation`.

Command gates must use `command` plus `args`. They run with `shell: false`, a filtered environment, timeout, and workspace cwd. Do not place shell syntax, credentials, or network side effects inside command strings.

Artifact gates must use paths inside the workspace. Path traversal and absolute paths outside the workspace are rejected.

Adapter gates must never convert dry-run or simulated output into `passed`; use `simulated` until a real approved adapter run produces evidence.

## Release Builder Consumption

Sprint 7B consumes Quality Gate evidence through Release Builder.

Release readiness rules:

- `passed` gates are acceptable evidence.
- `failed` gates block release.
- `requires_approval` gates block release.
- `simulated`, `not_run`, `skipped`, and `warning` gates are carried into `release-notes.md` and `evidence-report.md` as visible risks.

Release Builder copies project gate summaries into `releases/<version>/gates/project-gates.json`, copies Job Center gate summaries into `releases/<version>/gates/job-gates.json`, and copies gate evidence files referenced by project `resultPath` into `releases/<version>/gates/evidence/`.

## IPC API

- `quality-gate:list`
- `quality-gate:run`
- `quality-gate:approve`

Preload exposes:

- `window.hicode.listQualityGates()`
- `window.hicode.runQualityGate(payload)`
- `window.hicode.approveQualityGate(payload)`

Renderer access should go through `renderer/api/hicode-api.js`.

## Industrial Examples

For a FreeCAD enclosure release, run CAD artifact existence, STEP/STL non-empty, and metadata completeness gates after the FreeCAD adapter.

For a KiCad PCB release, run project existence, ERC, DRC, Gerber, and BOM gates. Dry-run KiCad output remains `simulated`.

For a PLC draft, require ST file, I/O map, safety interlock documentation, FAT/SAT checklist, and human approval before any device-facing work.

For BIM/IFC, run IFC file and BIM summary gates, then record manual code-check approval. Hi Code does not claim local building-code compliance automatically.
