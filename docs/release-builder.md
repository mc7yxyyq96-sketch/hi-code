# Release Builder

Release Builder turns a Hi Code workspace into an auditable delivery package. It is designed for software and industrial projects where the customer needs code, engineering artifacts, evidence, approvals, and checksums in one reproducible folder.

## Release Structure

Release output is always written inside the current workspace:

```text
releases/<version>/
  release-manifest.json
  release-notes.md
  evidence-report.md
  checksums.sha256
  artifacts/
    source-code/
    build-output/
    project-artifacts/
  docs/
    project-docs/
    generated/
    project.json
  gates/
    project-gates.json
    job-gates.json
    evidence/
```

The version is sanitized and may only contain letters, numbers, dots, underscores, plus signs, and hyphens. Release paths and copied artifact paths are confined to the workspace; paths that escape the workspace are rejected.

## Manifest Fields

`release-manifest.json` contains:

- `releaseId`: generated release identifier.
- `projectId`: `.hicode/project.json` project id.
- `version`: package version.
- `createdAt`: ISO timestamp.
- `createdBy`: user or process that built the package.
- `sourceCommit`: current git commit when available, otherwise `null` with a warning risk.
- `includedArtifacts`: copied source, docs, build output, industrial artifacts, gate reports, and release files.
- `gateResults`: project and Job Center gate results.
- `approvals`: project and Job Center approval records.
- `knownRisks`: blocking and warning risks.
- `checksums`: SHA-256 checksums for packaged files generated before manifest finalization.

`checksums.sha256` includes hashes for package files, including the final manifest.

## Release Readiness

Release Builder reads:

- `.hicode/project.json`
- `IndustrialProject.qualityGates`
- workspace-relevant `Job.gateResults`
- `IndustrialProject.artifacts`
- project and job approval records

Rules:

- `failed` gate blocks release.
- `requires_approval` gate blocks release until the gate is rerun with approval and reaches `passed`.
- `simulated`, `not_run`, `warning`, and `skipped` gates do not become `passed`; they are listed as visible release risks.
- Missing artifacts block by default.
- Missing artifacts can be warning-only only when their metadata marks `releaseSeverity: "warning"` or `releaseRequired: false`.
- Simulated or dry-run artifacts are allowed only as explicit risks and are highlighted in `release-notes.md`.

## Evidence Report

`evidence-report.md` summarizes:

- Gate results and messages.
- Approval records.
- Packaged artifact paths and checksums.
- Known release risks.

Gate evidence files produced by Quality Gate Runner are copied from `.hicode/artifacts/quality-gates/` into `gates/evidence/` when project gate `resultPath` points to them.

## Job Center Integration

Building a release through Electron IPC creates a `release-builder` Job. The service writes events for:

- readiness check start/completion
- package build start/completion
- failure details when blocked

The release manifest is stored as a Job artifact with type `release_package`. A `release.readiness` Job gate result is added as `passed`, `warning`, or `failed`.

## Release Center UI

Release Center is available in the Industrial Project view. It shows:

- release readiness
- gate summary
- artifact summary
- risk summary
- approval list
- gate evidence list
- build release package action
- open release folder action

The UI calls `release:readiness`, `release:build`, and `release:open` through preload and the renderer API wrapper.

## Industrial Package Example

A mixed software/CAD/PCB/PLC/BIM package can include:

- source code and compiled `dist/`
- requirement and architecture docs
- generated requirement/spec plans
- CAD, PCB, PLC, BIM artifacts registered in `.hicode/project.json`
- Quality Gate evidence from software commands and industrial adapters
- release notes with simulated or dry-run evidence clearly marked
- checksum manifest for customer-side verification
