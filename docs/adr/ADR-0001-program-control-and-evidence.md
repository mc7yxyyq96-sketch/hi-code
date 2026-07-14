# ADR-0001: Program Control And Committed Evidence

Status: Accepted

Date: 2026-07-10

Owners: Program Director, Security/Release

## Context

Hi Code has extensive implementation and test coverage, but historical Sprint reports and acceptance files were copied between development environments and could be mistaken for current state. The repository also ignored most of `reports/`, so a passing statement could exist without committed command evidence. Concurrent development requires one dependency-aware board and task-specific evidence.

The immutable source baseline for this decision is commit `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`.

## Decision

- `planning/backlog.json` is the task/dependency source of truth.
- `planning/release-board.json` is the current scheduling and release-gate projection.
- `reports/program/status.md` and `reports/program/risks.json` describe current status and risk.
- `reports/tasks/<task-id>.md` records task scope, files, review, tests, evidence, and rollback.
- `reports/evidence/` stores machine-generated command evidence and digests.
- Program, task, and evidence paths are explicitly tracked even though ad-hoc reports remain ignored.
- Historical audits remain available under explicitly historical names and archive policy. Their issue statuses are not current facts.
- A task completes only after implementation, tests, evidence, review, and an independent task-branch commit.

## Consequences

Positive:

- Release claims can be traced to exact commands and source commits.
- Dependencies and ownership are visible before parallel work starts.
- Old audit results cannot silently block or approve a new source state.
- Evidence survives machine restarts and handoffs.

Costs:

- Evidence logs add repository size and must be kept scoped to release/task gates.
- The Program Director must update board, status, and risks at task completion.
- Logs require redaction before commit.

Security:

- Baseline capture uses a minimal environment and redacts secret-like output.
- Evidence never stores environment values, credentials, API keys, or authorization headers.

Compatibility:

- No runtime, IPC, UI, or user-data contract changes.
- Existing historical report files remain readable.

## Rejected Alternatives

- Issue state only in prose: rejected because it is not machine-readable or dependency-aware.
- Untracked local evidence: rejected because it cannot support review, handoff, or release audit.
- Treat all old issues as open or fixed: rejected because both choices ignore current-source revalidation.
- Rewrite the project around a new management framework: rejected as unnecessary scope.

## Verification

- `npm run test:program`
- `npm run program:baseline`
- `npm run verify`
- `npm run release:check`
- `git diff --check`
