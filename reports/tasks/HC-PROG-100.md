# HC-PROG-100 Task Evidence

Status: Completed

Owner: Program Director

Release: `0.6.0-alpha.7`

Branch: `codex/program-control/hc-prog-100`

Baseline commit: `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`

## Problem

Program sequencing, current status, risk, ADR decisions, and gate evidence were split across imported planning text and ignored historical reports. The production audit script also assumed a real npm executable even though the development machine maps `npm` to pnpm, causing the documented baseline command to fail before dependency analysis.

## Outcome

- Defined the program charter and current/target architecture without presenting planned work as implemented.
- Established ADR numbering and accepted the program-control and staged runtime-protocol decisions.
- Added a machine-readable release board with dependencies, owners, branches, worktree paths, and gates.
- Added current program status and structured risks.
- Marked prior acceptance and audit material as historical.
- Added a package-manager-independent production audit that reads `package-lock.json`, excludes development-only packages, requires HTTPS, and blocks high/critical advisories.
- Added repeatable baseline capture with minimal child environment, output redaction, command logs, exit codes, durations, and SHA-256 digests.
- Added focused tests for required artifacts, board dependencies, historical labeling, evidence integrity, and production-audit behavior.

## Scope Boundaries

No runtime, Electron IPC, renderer behavior, user-data path, industrial adapter, provider, or release package behavior was changed. HC-QA-101 and HC-RUN-201 remain separate tasks.

## Security Review

- Baseline subprocesses receive a minimal development environment rather than all parent variables.
- Evidence redacts authorization headers and secret-like assignments.
- Production audit sends only package names and versions to the HTTPS npm advisory endpoint.
- No credentials or commercial tool configuration is read or written.

## Compatibility And Rollback

The new audit script supports package-lock v2/v3 and Node 18+. Rollback consists of reverting this task commit; no user data or schema migration is involved. Reverting would also remove the corrected audit path and committed evidence, so it must not be used to bypass a failing gate.

## Acceptance Evidence

Authoritative command results and log hashes: `reports/evidence/baseline/manifest.json`.

Required acceptance:

- Source commit recorded: `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`.
- All current gates archived: machine capture runs build, verify, release check, feature, security, DoD, full-tree scan, production audit, and Git whitespace validation.
- Historical audits marked: `reports/final-acceptance-historical.md` and `reports/audit/README.md`.

Final machine capture: 9 commands passed, 0 failed. Full-tree DoD scan reported 0 findings. Production audit reported 0 high-or-critical advisories.

## Review Checklist

- JSON files parse successfully.
- Required control-plane artifacts are tracked and non-empty.
- HC-QA-101 and HC-RUN-201 remain dependent on HC-PROG-100.
- Audit fixtures prove dev-only packages are excluded and high findings block.
- Full-tree DoD scan has no blocking finding.
- Git diff contains no whitespace error.
