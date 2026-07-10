# Hi Code Program Status

Updated: 2026-07-10

Program state: Active

Current release slice: `0.6.0-alpha.7`

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
| 2 | HC-QA-101 | Ready | Desktop UX | HC-PROG-100 |
| 3 | HC-RUN-201 | Planned | Runtime Engine | HC-PROG-100 |

HC-QA-101 establishes a real Electron responsive baseline. HC-RUN-201 introduces protocol-native assistant output and concurrency isolation. No new industrial domain module is authorized before HC-RUN-201 completes.

HC-PROG-100 captured nine baseline commands with nine passes, zero failures, and zero DoD findings. The manifest and individual log digests are committed with the task.

## Current Product Truth

- Core Electron, CLI/TUI, runtime, tool, security, Job Center, Provider, Worktree, Arena, industrial, gate, sample, and release tests pass.
- Runtime Protocol JSONL persistence is implemented, but assistant output is not yet fully sink-driven and full context resume still uses session JSON.
- External Codex/Claude providers are not configured production providers.
- SolidWorks and AVEVA are bridge/external-required integrations, not automatic deep integrations.
- Real Electron multi-width E2E remains the next quality task.

## Evidence And Historical Material

- Current baseline: `reports/evidence/baseline/manifest.json`
- Current task report: `reports/tasks/HC-PROG-100.md`
- Current risks: `reports/program/risks.json`
- Historical final acceptance: `reports/final-acceptance-historical.md`
- Historical audit policy: `reports/audit/README.md`
