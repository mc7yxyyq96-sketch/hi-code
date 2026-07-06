# Definition of Done and Skeleton Detector

Sprint 8B adds a product-grade delivery guardrail for Hi Code. The guardrail is not a prompt convention; it is executable code in `src/definition-of-done.ts`, wired into Release Builder, Patch Arena, Job Center telemetry, and renderer panels.

## Definition of Done

Every deliverable is checked for:

- real entry: executable entry point, Electron entry, CLI entry, or `.hicode/project.json`
- core implementation: executable code or real generated artifacts
- tests: automated tests, verification scripts, test plan artifacts, or test gate evidence
- documentation: requirement, architecture, test, inspection, or release documentation
- artifacts: required project artifacts exist on disk
- quality gates: gate results exist and blocking gates are not unresolved
- evidence: gate evidence files are persisted and linked
- error handling: code has explicit failure paths or normalized error returns
- security boundary: path, permission, IPC, approval, or redaction controls are present
- no skeleton delivery: Skeleton Detector has no blocking findings

The result is persisted under `.hicode/artifacts/definition-of-done/*.json` unless the caller explicitly disables evidence persistence.

## Skeleton Detector Rules

The detector flags:

- empty directories that look like deliverable folders
- empty files
- files that contain only TODO/FIXME/TBD/placeholder text
- placeholder production content such as `return null`, "not implemented", or "coming soon"
- production paths that are mock-only or demo-only
- code files that declare only types/interfaces with no executable implementation
- HTML buttons without detectable behavior wiring
- gates marked `passed` while their message or metadata says dry-run, simulated, mock, not-run, or fake
- simulated artifacts marked as real or released without warning metadata
- required artifacts declared in `.hicode/project.json` but missing on disk

Warnings are allowed to proceed when they are intentionally non-blocking. Blocking findings fail Definition of Done and prevent release readiness.

## Release Blocking

Release Builder runs Definition of Done during readiness checks. It adds the DoD result as a release gate named `definition-of-done`.

Release is blocked when:

- Skeleton Detector has a blocking finding
- DoD checklist has a failed item
- a production path is mock-only
- a required artifact is missing
- a simulated artifact is marked as real/released
- a fake pass gate is detected

Simulated and dry-run artifacts are allowed only when they stay visibly marked as simulated and appear in release notes and known risks.

## Patch Arena

Patch Arena runs Skeleton Detector for every candidate in its isolated workspace. Candidate DoD evidence is saved as `definition-of-done.json`.

Candidate scoring is reduced when skeleton findings exist. Blocking skeleton findings fail the candidate, so the UI cannot present an empty/TODO/mock-only patch as a ready solution.

Patch Arena uses a scoped DoD profile: release-level checks such as final artifacts and full release evidence are skipped for candidate scoring, while skeleton, error-handling, and security-boundary signals remain visible.

## Job Center Evidence

Release builds write:

- `definition-of-done.checked` JobEvent
- `definition-of-done` GateResult
- remediation details in gate metadata

Patch Arena candidates write:

- `definition-of-done.checked` JobEvent
- `skeleton detector` candidate gate
- `definition-of-done.json` candidate artifact

## Renderer Surfaces

- Release Center shows the DoD checklist and skeleton findings.
- Patch Arena shows candidate skeleton risk and DoD evidence path.
- Industrial Project shows artifact completeness: total, complete real artifacts, simulated/dry-run artifacts, missing paths, release-required artifacts, and gate-linked artifacts.

## Agent Guidance

Codex, Claude, local models, and internal providers should treat this as a hard delivery contract:

- do not create empty files or empty directories as "progress"
- do not ship TODO-only, placeholder, or mock-only production paths
- keep dry-run and simulated outputs explicitly marked
- attach artifacts, gate results, and evidence to Job Center or project records
- run release readiness before claiming a deliverable is customer-ready
- use remediation from DoD evidence as the next repair plan when a candidate fails
