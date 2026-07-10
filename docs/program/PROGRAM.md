# Hi Code Program Charter

Status: Active

Control-plane task: `HC-PROG-100`

Baseline source: `0.6.0-alpha.6` at `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`

## Mission

Hi Code is a product-grade, local-first AI engineering workbench. The near-term mission is a complete desktop coding loop that can plan, edit, execute, review, recover, and release work with durable evidence. Industrial workflows extend the same engine only after the coding runtime, test, recovery, security, and release foundations are reliable.

The program does not use source-code volume or copied behavior as a completion metric. It uses verified user outcomes, stable contracts, recoverable state, security boundaries, and release evidence.

## Current Product Fact

The `0.6.0-alpha.6` source baseline already provides a working Electron application, CLI/TUI runtime, tool permissions, MCP, Git, Store, Job Center, Provider registry, isolated workspaces, Patch Arena, industrial project models, adapters, gates, sample generation, and release packaging. These capabilities have automated coverage.

The current architecture is not yet the final target architecture:

- Runtime Protocol envelopes are persisted, but assistant streaming output is not yet fully routed through an injected event sink.
- Full model-context resume still depends on the legacy session JSON store.
- Desktop behavior has extensive renderer unit/smoke coverage but no real Electron Playwright responsive baseline yet.
- External providers and commercial industrial systems remain disabled, dry-run, or bridge-only unless their real local execution path is explicitly supported and authorized.

These gaps are planned work, not completed product claims.

## Sources Of Truth

When documents disagree, use this precedence order:

1. `AGENTS.md` for mandatory repository execution rules.
2. Accepted ADRs in `docs/adr/` for architectural decisions.
3. `docs/program/EXECUTION_PLAN.md` for program outcomes and sequencing.
4. `planning/backlog.json` for task definitions and dependencies.
5. `planning/release-board.json` for current scheduling and gate state.
6. `reports/evidence/` and `reports/tasks/` for observed results.
7. `reports/program/status.md` and `reports/program/risks.json` for current program status.

Files under `reports/audit/` and `reports/final-acceptance-historical.md` are historical snapshots. Their issue states are not current until revalidated against the present source tree.

## Release Train

| Release line | Required outcome | Exit condition |
| --- | --- | --- |
| `0.6.0-alpha.7` | Program control, real Electron responsive smoke, RuntimeEventSink | HC-PROG-100, HC-QA-101, and HC-RUN-201 accepted with evidence |
| `0.6.0-alpha.8` | Full event-store replay, turn recovery, Electron compatibility upgrade | Event-only conversation recovery and real Electron E2E both pass |
| `0.6.0-alpha.9` | Provider parity foundation and durable execution contracts | Configured providers report honest capability and isolated runs are recoverable |
| `0.6.0-beta` | Stable desktop coding loop across supported platforms | No open release blocker; packaging, upgrade, recovery, and security gates pass |
| Later industrial releases | Domain-specific engineering depth on the shared engine | Real tool evidence or explicit dry-run/external-required status for every claim |

The authoritative task list and later release slices remain in `planning/backlog.json`.

## Task Lifecycle

Allowed task states are `planned`, `ready`, `in_progress`, `blocked`, `in_review`, and `completed`.

A task may enter `ready` only when every dependency is `completed`. A task may enter `completed` only when:

- implementation and compatibility behavior are complete;
- focused tests and all repository gates pass;
- security and migration consequences are documented;
- task evidence names the source commit, branch, files, commands, and observed results;
- no simulated or not-run evidence is presented as real completion;
- the task has an independent commit on its task branch.

Blocked work records the exact external dependency, owner, and unblock condition. A broad statement such as "needs more work" is not a valid blocker.

## Worktree And Branch Policy

Branch names use `codex/<lane>/<task-id-lowercase>`. Task worktrees live outside the primary repository so generated files and Git metadata cannot overlap.

Current allocations:

- HC-PROG-100: branch `codex/program-control/hc-prog-100` in the primary checkout because the imported bootstrap control files were already uncommitted there.
- HC-QA-101: branch `codex/desktop-ux/hc-qa-101`, planned worktree `../worktrees/hi-code-hc-qa-101`.
- HC-RUN-201: branch `codex/runtime-engine/hc-run-201`, planned worktree `../worktrees/hi-code-hc-run-201`.

Only the task owner writes to a task worktree. Integration occurs after focused review and gate evidence. User changes and unrelated dirty files are never reset or overwritten.

## Evidence Contract

Baseline and task evidence is committed with the code it describes. Each command record includes the exact command, start/end time, exit code, log path, and SHA-256 digest. Secret-like values are redacted before logs are written.

Required baseline gates are:

- `npm run build`
- `npm run verify`
- `npm run release:check`
- `node test/feature-tests.mjs`
- `npm run test:security`
- `npm run test:dod`
- `npm run scan:dod`
- `npm run audit:prod`
- `git diff --check`

`npm run program:baseline` executes and archives this set. It exits non-zero when any gate fails.

## Stop Conditions

Work stops before adding features when any of these conditions is true:

- build, verify, release check, security, DoD, or feature tests fail;
- a change weakens `contextIsolation`, renderer sandboxing, IPC validation, path confinement, permission approval, child-process environment minimization, or credential handling;
- a migration can destroy or silently reinterpret user data;
- release evidence marks `simulated`, `not_run`, or `external_required` as passed real execution;
- concurrent work is modifying the same files without an explicit integration owner;
- a required credential, commercial license, signing identity, or irreversible external action needs user authorization.

## Industrial Scope Gate

No new industrial domain module starts before `HC-RUN-201` is complete. Existing industrial modules remain supported and tested, but deeper CAD, PCB, PLC, BIM, SolidWorks, AVEVA, mechanical, electrical, automation, energy, process, materials, and architecture work must reuse the same Runtime Protocol, Job Center, permission, artifact, gate, and release contracts.

The truthful status vocabulary is mandatory:

- `generated`: Hi Code created the artifact locally.
- `simulated`: Hi Code created a plan or dry-run artifact, not a real tool result.
- `not_run`: a required execution did not occur.
- `external_required`: a commercial or enterprise system must execute the operation.
- `passed`: real evidence satisfied the gate.

## Program Review Cadence

The Program Director updates the release board, current status, risk register, and task evidence at every completed task. Architectural changes require an ADR before implementation. Release promotion requires a fresh baseline capture from the release candidate commit and a review of open risks, not a copy of an older acceptance report.
