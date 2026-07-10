# Hi Code Program Status

Updated: 2026-07-10

Program state: Active

Current verified release candidate: `0.6.0-alpha.7`

Active development slice: `0.6.0-alpha.8`

## Source Baseline

- Version: `0.6.0-alpha.6`
- Commit: `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`
- Commit subject: `feat: recover tasks from runtime protocol store`
- Task branch: `codex/program-control/hc-prog-100`
- Runtime product paths (`src/`, `electron/`, `renderer/`) were clean at bootstrap.

## Baseline Result

Manual preflight passed build, verify, release check, feature, security, DoD unit, and full-tree DoD gates. The first production-audit attempt exposed a real command portability bug: the user's `npm` command delegates to pnpm, while the script used npm-only `--omit=dev`. HC-PROG-100 replaced that command with a package-lock-aware HTTPS advisory client; the corrected audit passed with 45 production package names and zero high-or-critical advisories.

The final machine-captured evidence is written by `npm run program:baseline` to `reports/evidence/baseline/manifest.json`. Command logs are redacted and hashed.

## Active Sequence

| Order | Task | State | Owner | Dependency |
| --- | --- | --- | --- | --- |
| 1 | HC-PROG-100 | Completed | Program Director | None |
| 2 | HC-QA-101 | Completed | Desktop UX | HC-PROG-100 |
| 3 | HC-RUN-201 | Completed | Runtime Engine | HC-PROG-100 |
| 4 | HC-RUN-202 | Completed | Runtime Engine | HC-RUN-201 |
| 5 | HC-RUN-203 | Ready | Runtime Engine | HC-RUN-202 |

HC-QA-101 established a real Electron responsive baseline. HC-RUN-201 introduces protocol-native assistant output and concurrency isolation. No new industrial domain module is authorized before HC-RUN-201 completes.

HC-PROG-100 captured nine baseline commands with nine passes, zero failures, and zero DoD findings. The manifest and individual log digests are committed with the task.

HC-QA-101 captured ten acceptance commands with ten passes. The real production Electron entrypoint, preload, and renderer passed interaction checks at 720, 1024, and 1440 content widths. The E2E process isolates `HOME`, `USERPROFILE`, user data, and sensitive environment variables, and uses a local slash command instead of a model request. Reviewed PNG fixtures and hashed logs are recorded in `reports/evidence/HC-QA-101/manifest.json`.

HC-RUN-201 completed in its isolated worktree. Materialized assistant delta/completed events, a filtered Runtime Event Bus, real Agent emission, durable completion content, and Electron/CLI/TUI adapters are implemented. Thirteen machine-captured gates passed, including intentionally interleaved session tests and a real Electron model turn with the stdout bridge disabled. Full context reconstruction remains assigned to HC-RUN-202.

HC-RUN-202 completed in the isolated `codex/runtime-engine/hc-run-202` worktree from verified alpha.7 commit `b044fdcecf1a153393cce29d7267eb2205c99dec`. Typed thread/event/message stores, exact hidden model-message records, idempotent non-destructive migration, stale-snapshot recovery, complete model-context replay, and interrupted-turn diagnosis passed 16 machine-captured gates. Legacy session JSON and runtime JSONL remain intact for rollback.

HC-RUN-203 is now dependency-ready. It owns the explicit turn state machine and approval-aware crash recovery; HC-RUN-202 does not claim automatic retry or side-effect replay.

## Release Integration

The `0.6.0-alpha.7` candidate was integrated on `codex/release/0.6.0-alpha.7` from HC-RUN-201 commit `d36923bed32267a5bfb3433e4450307060cbda69`. Version metadata, backlog state, capability boundaries, migration notes, security review, E2E review, limitations, and release evidence passed the isolated candidate gate. The final manifest records 11 passing commands, real Electron acceptance, zero DoD findings, and zero high-or-critical production advisories. HC-RUN-202 is the next authorized implementation task.

## Current Product Truth

- Core Electron, CLI/TUI, runtime, tool, security, Job Center, Provider, Worktree, Arena, industrial, gate, sample, and release tests pass.
- Runtime Protocol output is sink-driven, and complete normalized event streams can rebuild resumable system/user/assistant/tool context without session JSON. Older incomplete streams remain read-only.
- External Codex/Claude providers are not configured production providers.
- SolidWorks and AVEVA are bridge/external-required integrations, not automatic deep integrations.
- Real Electron multi-width and protocol-native output E2E now runs locally and in the Linux/Xvfb CI job.

## Evidence And Historical Material

- Current baseline: `reports/evidence/baseline/manifest.json`
- Current task reports: `reports/tasks/HC-PROG-100.md`, `reports/tasks/HC-QA-101.md`
- Runtime task evidence: `reports/tasks/HC-RUN-201.md`, `reports/evidence/HC-RUN-201/manifest.json`
- Runtime store evidence: `reports/tasks/HC-RUN-202.md`, `reports/evidence/HC-RUN-202/manifest.json`
- Current risks: `reports/program/risks.json`
- Historical final acceptance: `reports/final-acceptance-historical.md`
- Historical audit policy: `reports/audit/README.md`
