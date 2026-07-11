# Hi Code Program Status

Updated: 2026-07-10

Program state: Active

Current verified release candidate: `0.6.0-alpha.8`

Active development slice: `0.6.0-alpha.9`

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
| 5 | HC-RUN-203 | Completed | Runtime Engine | HC-RUN-202 |
| 6 | HC-PLAT-110 | Completed | Security And Release | HC-QA-101 |
| 7 | HC-REL-ALPHA-8 | Completed | Release Owner | HC-RUN-202, HC-RUN-203, HC-PLAT-110 |
| 8 | HC-PROV-210 | Completed | Runtime Engine | HC-RUN-202, HC-REL-ALPHA-8 integration base |
| 9 | HC-PROV-211 | Completed | Runtime Engine | HC-PROV-210 |
| 10 | HC-PROV-212 | Completed | Runtime Engine | HC-PROV-210, HC-PROV-211 |

HC-QA-101 established a real Electron responsive baseline. HC-RUN-201 introduces protocol-native assistant output and concurrency isolation. No new industrial domain module is authorized before HC-RUN-201 completes.

HC-PROG-100 captured nine baseline commands with nine passes, zero failures, and zero DoD findings. The manifest and individual log digests are committed with the task.

HC-QA-101 captured ten acceptance commands with ten passes. The real production Electron entrypoint, preload, and renderer passed interaction checks at 720, 1024, and 1440 content widths. The E2E process isolates `HOME`, `USERPROFILE`, user data, and sensitive environment variables, and uses a local slash command instead of a model request. Reviewed PNG fixtures and hashed logs are recorded in `reports/evidence/HC-QA-101/manifest.json`.

HC-RUN-201 completed in its isolated worktree. Materialized assistant delta/completed events, a filtered Runtime Event Bus, real Agent emission, durable completion content, and Electron/CLI/TUI adapters are implemented. Thirteen machine-captured gates passed, including intentionally interleaved session tests and a real Electron model turn with the stdout bridge disabled. Full context reconstruction remains assigned to HC-RUN-202.

HC-RUN-202 completed in the isolated `codex/runtime-engine/hc-run-202` worktree from verified alpha.7 commit `b044fdcecf1a153393cce29d7267eb2205c99dec`. Typed thread/event/message stores, exact hidden model-message records, idempotent non-destructive migration, stale-snapshot recovery, complete model-context replay, and interrupted-turn diagnosis passed 16 machine-captured gates. Legacy session JSON and runtime JSONL remain intact for rollback.

HC-RUN-203 completed in the isolated `codex/runtime-engine/hc-run-203` worktree from HC-RUN-202 completion commit `9245a0a57f71b6e56157260c5bcb45776bfa0f96`. The explicit turn reducer preserves bounded partial output, pairs approval decisions, restores source sessions before safe retries, and blocks automatic replay for unknown or completed mutating tool effects. Eighteen machine-captured gates passed, including append-only crash fixtures and real Electron E2E.

HC-PLAT-110 completed in the isolated `codex/security-release/hc-plat-110` worktree from HC-RUN-203 completion commit `6a27bd31980c240434d3b5e0c2b18da84f686c8d`. Electron is pinned to 43.1.0 with Chromium 150 and Node 24 runtime evidence; electron-builder 26 generates the unsigned alpha DMG through a deterministic package-manager shim. The production graph has no native Node add-on. GitHub Actions run `29116173672` passed real Electron startup on Ubuntu, macOS, and Windows. Thirteen local evidence gates also passed.

## Release Integration

The `0.6.0-alpha.7` candidate was integrated on `codex/release/0.6.0-alpha.7` from HC-RUN-201 commit `d36923bed32267a5bfb3433e4450307060cbda69`. Version metadata, backlog state, capability boundaries, migration notes, security review, E2E review, limitations, and release evidence passed the isolated candidate gate.

The `0.6.0-alpha.8` candidate passed 13 isolated release commands on `codex/release/0.6.0-alpha.8` from HC-PLAT-110 completion commit `265a69f`. It integrates only completed runtime replay, recovery, and Electron compatibility work. The full-tree DoD scan found zero findings, real Electron E2E passed, and the unsigned macOS arm64 DMG was generated. Formal tag, GitHub Release, signing, notarization, and public promotion remain approval-gated.

HC-PROV-210 completed on `codex/runtime-engine/hc-prov-210` from alpha.8 completion commit `80e6b83`. It separates Model Provider Adapter contracts from the existing external Agent Provider registry, rejects unsupported capabilities before transport execution, normalizes text/tool/usage/error semantics, records correlated provider events in Runtime Protocol, and migrates legacy model profiles through a real OpenAI-compatible adapter. Sixteen machine-captured gates passed with zero DoD findings. Concrete OpenAI Responses, Anthropic, and Ollama transports remain assigned to HC-PROV-211/212.

HC-PROV-211 completed in the isolated `codex/runtime-engine/hc-prov-211` worktree from HC-PROV-210 completion commit `06dd676`. A real OpenAI Responses HTTPS/SSE transport now preserves text, image, function-call `call_id`, tool result, usage, interruption, incomplete, and failed semantics through the shared Runtime. Existing profiles remain on Chat Completions unless `protocol: "responses"` is explicit. Nineteen machine-captured gates passed, including a real two-request Runtime tool loop, Electron config routing, security, DoD, production audit, and Electron E2E.

HC-PROV-212 completed in the isolated `codex/runtime-engine/hc-prov-212` worktree from HC-PROV-211 completion commit `7f91c76`. Dedicated Anthropic Messages SSE and Ollama native NDJSON transports now preserve text, images, tool correlation, usage, interruption, native terminal states, and normalized errors through the shared Runtime. Profiles opt in explicitly; current Chat Completions and Responses profiles are unchanged. Raw provider thinking is neither displayed nor persisted. Twenty machine-captured gates passed, including both two-request Runtime tool loops, legacy transport regressions, Electron config routing, security, DoD, production audit, and real Electron E2E.

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
- Turn recovery evidence: `reports/tasks/HC-RUN-203.md`, `reports/evidence/HC-RUN-203/manifest.json`
- Electron compatibility evidence: `reports/tasks/HC-PLAT-110.md`, `reports/evidence/HC-PLAT-110/manifest.json`, `reports/evidence/HC-PLAT-110/ci-matrix.json`
- Alpha.8 release evidence: `reports/tasks/HC-REL-ALPHA-8.md`, `reports/evidence/HC-REL-ALPHA-8/manifest.json`
- Model Provider v2 evidence: `reports/tasks/HC-PROV-210.md`, `reports/evidence/HC-PROV-210/manifest.json`
- OpenAI Responses evidence: `reports/tasks/HC-PROV-211.md`, `reports/evidence/HC-PROV-211/manifest.json`
- Anthropic and Ollama evidence: `reports/tasks/HC-PROV-212.md`, `reports/evidence/HC-PROV-212/manifest.json`
- Current risks: `reports/program/risks.json`
- Historical final acceptance: `reports/final-acceptance-historical.md`
- Historical audit policy: `reports/audit/README.md`
