# Hi Code Program Status

Updated: 2026-07-13

Program state: Active

Current verified release candidate: `0.6.0-alpha.8`

Active development slice: `0.6.0-beta.2`

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
| 11 | HC-RUN-220 | Completed | Runtime Engine | HC-PROV-210 |
| 12 | HC-UI-301 | Completed | Desktop UX | HC-RUN-201, HC-QA-101 |
| 13 | HC-UI-302 | Completed | Desktop UX | HC-UI-301, HC-RUN-202 |
| 14 | HC-UI-310 | Completed | Desktop UX | HC-UI-302 |
| 15 | HC-UI-311 | Completed | Desktop UX | HC-UI-301, HC-PLAT-110 |
| 16 | HC-UI-312 | Completed | Desktop UX | HC-UI-301, HC-PLAT-110 |
| 17 | HC-GIT-320 | Completed | Runtime Engine | HC-RUN-203, HC-UI-310 |
| 18 | HC-SEC-401 | Completed | Security And Release | HC-PLAT-110 |
| 19 | HC-SEC-402 | Completed | Security And Release | HC-PLAT-110 |
| 20 | HC-REL-420 | Completed | Security And Release | HC-PLAT-110, HC-SEC-401 |
| 21 | HC-MCP-410 | Completed | Runtime Engine | HC-SEC-401 |
| 22 | HC-PROV-301 | Completed | Runtime Engine | HC-PROV-212, HC-SEC-401, HC-SEC-402, HC-MCP-410 |

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

HC-RUN-220 completed in the isolated `codex/runtime-engine/hc-run-220` worktree from HC-PROV-212 completion commit `12ff24e`. App-data attachment records and content-addressed blobs now survive restart without modifying the workspace; Runtime persists opaque references, verifies hashes, and materializes supported image/text content only after capability negotiation. Unsupported PDF/file transport fails visibly before network I/O. One Command Registry resolves shell, slash, native, and agent input across Runtime and Electron with alias/conflict rejection. Twenty-four machine-captured gates passed, including real Runtime/provider materialization, Electron IPC/Renderer coverage, security, DoD, production audit, and Electron E2E.

HC-UI-301 completed in the isolated `codex/desktop-ux/hc-ui-301` worktree from HC-RUN-220 completion commit `fd46ac7`. A production React 18/TypeScript/Vite App Shell now owns the typed route and compact-navigation boundary while the Legacy Panel Adapter preserves every existing panel and invokes its real trigger. Thirteen machine-captured gates passed, including build, verify, release check, security, DoD, production audit, and real Electron navigation at 720, 1024, 1440, and 1920 widths. Business panels remain on the compatibility path for incremental migration in HC-UI-302 and later tasks.

HC-UI-302 completed in the isolated `codex/desktop-ux/hc-ui-302` worktree from HC-UI-301 completion commit `35754d0`. Session Sidebar, Conversation, Timeline/recovery, Diff Inspector, and responsive drawer controls now use one immutable typed workspace store while existing session, Runtime, attachment, approval, and Diff services remain authoritative. A 10,000-message transcript mounts at most 160 rows; background turns finalize their source snapshot; unavailable actions fail closed. Fourteen machine-captured gates passed, including build, verify, release check, security, DoD, production audit, and real Electron acceptance at 720, 1024, 1440, and 1920 widths.

HC-UI-310 completed in the isolated `codex/desktop-ux/hc-ui-310` worktree from HC-UI-302 completion commit `8b13b88`. A lazy local CodeMirror editor now opens, edits, saves, and reloads bounded UTF-8 workspace files. SHA-256 revision comparison, atomic sibling replacement, sticky conflict state, and explicit confirmed force overwrite prevent silent stale writes. Typed line comments enter the existing conversation and Runtime revision path. Fifteen machine-captured gates passed from clean source commit `cfd75e1`, including build, verify, release check, security, DoD, production audit, and real Electron acceptance at 720 px with an external disk mutation. The completed ten-hour HC-RUN-220 evidence was reused rather than rerun.

HC-UI-311 completed in the isolated `codex/desktop-ux/hc-ui-311` worktree from HC-UI-310 completion commit `115ea61`. A real xterm/node-pty terminal now runs through typed IPC, explicit Runtime-policy authorization, owner/workspace confinement, trusted profile-free shells, minimal child environment, bounded non-persisted output, and deterministic process-tree cleanup. Stale starts are cancelled if the owner closes or workspace changes. Eighteen machine-captured gates passed from clean source commit `d970367`, including 12/12 terminal service checks, 188/188 security checks, real Electron keyboard/compact-layout acceptance, macOS native package inspection, production audit, release check, and a zero-finding DoD scan. GitHub Actions run `29167924876` then passed the general test job and real Electron smoke on Ubuntu, macOS, and Windows for Draft PR #15. The completed ten-hour HC-RUN-220 evidence was not rerun. App preview and Git/PR workflow features remain separate tasks.

HC-UI-312 completed in the isolated `codex/desktop-ux/hc-ui-312` worktree from HC-UI-311 completion commit `549fc62`. A loopback-only App Preview now opens local applications in unique non-persistent sandboxed BrowserWindows with no preload, Node integration, DevTools, permissions, downloads, popups, webviews, external navigation, or cross-origin network access. Typed lifecycle controls support reload, close, reopen, and removal; owner/workspace/app/crash cleanup is deterministic. DOM selector checks and PNG/JSON evidence remain explicitly passed or failed. Fifteen local gates passed from clean implementation commit `d1138ab`, including 12/12 service checks, 8/8 renderer checks, 196/196 security checks, release check, zero-finding DoD scan, production audit, and real Electron compact-layout acceptance. GitHub Actions run `29181437110` also passed general tests and real Electron smoke on Ubuntu, macOS, and Windows for Draft PR #16. Server startup, remote browsing, Git/PR orchestration, and industrial modules remain outside this task.

HC-GIT-320 completed in the isolated `codex/runtime-engine/hc-git-320` worktree from HC-UI-312 completion commit `e802c15`. Plan mode now enforces a read-only tool boundary, the main process owns queued prompt order, and Steer persists cancellation before prioritizing a follow-up. Local Git delivery adds dirty-worktree-protected branches, existing stage/commit behavior, native-confirmed Draft PR creation, minimal Git/gh environments, and truthful failed/pending CI projection. Fifteen local evidence gates passed from clean implementation commit `9fad4bf`, including real Electron Plan/queue/Steer and Git stage/commit/branch acceptance at 720 and 1024 px. GitHub Actions run `29189513590` then passed the general test job and real Electron smoke on Ubuntu, macOS, and Windows for Draft PR #17. No merge, release publication, credential storage, force push, or automatic merge was performed.

HC-SEC-401 completed in the isolated `codex/security-release/hc-sec-401` worktree from HC-GIT-320 completion commit `6059a6d`. Model, sensitive MCP, and Agent Provider credentials now persist as validated references; Electron `safeStorage` encrypts values and rejects unavailable or Linux `basic_text` storage. Startup migration is atomic and exactly reversible through an encrypted snapshot, CLI fallback is environment-only, and Renderer/preload receive status rather than values. Sixteen local evidence commands passed from clean source commit `c107121`, including a zero-finding DoD scan and real Electron E2E. GitHub Actions run `29196545587` passed general tests and real Electron smoke on Ubuntu, macOS, and Windows for Draft PR #18.

HC-SEC-402 completed in the isolated `codex/security-release/hc-sec-402` worktree from HC-SEC-401 completion commit `3a2328c`. A versioned policy kernel now governs command, filesystem, environment, network, limit, approval, audit, and process-tree semantics for Runtime Bash, terminal, Worktree, Patch Arena, Quality Gate, MCP, and real industrial adapter launches. Unsupported strict controls fail closed and weak/report-only isolation remains explicit. Nineteen local evidence commands passed from clean source commit `f45415f`, including 100/100 industrial tool checks and real Electron navigation at compact widths. GitHub Actions run `29221844706` passed general tests and real Electron smoke on Ubuntu, macOS, and Windows for Draft PR #19.

HC-REL-420 completed in the isolated `codex/security-release/hc-rel-420` worktree from HC-SEC-402 completion commit `14c5380`. A fail-closed release policy now controls macOS DMG/ZIP, Windows NSIS/ZIP, and Linux AppImage/DEB packaging; update channels, user-confirmed packaged-app updates, CycloneDX SBOM, provenance, checksums, and native package lifecycle smoke are part of the same contract. Twenty local evidence commands passed from clean implementation commit `6e42ce3`. Draft PR #20 passed Release Packaging run `29239107911` and CI run `29239108094`, including native package smoke on all three target platforms and real Electron startup on Ubuntu, macOS, and Windows. These are unsigned, update-disabled CI/development artifacts: no formal release, tag, publication, notarization, or credential-backed signing was performed, and `RISK-REL-001` remains open.

HC-MCP-410 completed in the isolated `codex/runtime-engine/hc-mcp-410` worktree from accepted HC-REL-420 commit `630b19d`. The existing MCP manager now preserves managed stdio while adding HTTPS Streamable HTTP, protocol and capability negotiation, session recovery, reconnect, timeout, cancellation, streaming results, graceful shutdown, normalized errors, and bearer/OAuth expiry, discovery, PKCE, refresh, rotation, secret-reference, and redaction boundaries. Rotated OAuth credentials and matching expiry metadata persist through one secure config transaction. Desktop exposes validated lifecycle controls without credentials; CLI and TUI retain the compatibility API and await graceful shutdown. Real loopback JSON/SSE, service, security, Renderer, feature, Electron, and Program Control checks passed across all 14 captured evidence commands. Interactive OAuth browser/callback consent remains an explicit host responsibility and is not claimed as completed authorization.

The `0.6.0` Stable Release Gate was re-executed after HC-PROV-301 in the isolated `codex/security-release/0.6.0-stable-gate-provider` worktree from Provider commit `7a5d054`. Eleven engineering conditions pass: Runtime Protocol authority, turn replay/recovery, client isolation, three-platform Electron and package smoke, Code Studio, MCP, Provider production hardening, latest full-tree DoD, explicit zero open P0/P1 work, and truthful documentation. `RISK-PROV-001` is CLOSED and the sole remaining blocker is OPEN `RISK-REL-001`, so the internal status is **PASS_INTERNAL_ONLY**. Formal promotion remains **blocked**: Apple signing/notarization, Windows code-signing, and stable update-chain evidence are external prerequisites. The package stays `0.6.0-alpha.8`; no Release, tag, signature claim, publication, updater enablement, or industrial task was created.

HC-PROV-301 completed in the isolated `codex/runtime-engine/hc-prov-301` worktree from the post-Stable-Gate control commit `bc208d1`. A versioned Provider control plane now keeps Model Providers and External Agent Providers semantically distinct while unifying discovery, capability, health, enabled state, version, credential lifecycle, failure policy, privacy, and aggregate usage. OpenAI Responses, Anthropic, OpenAI-compatible, and Ollama profiles are discovered as models; Hi Code internal runtime, configured Codex CLI, configured Claude Code CLI, and configured custom Agent workers are autonomous Agents. External CLIs require an absolute executable, native authorization, no-shell managed execution, Worktree Runner isolation by default, bounded timeout/output, cancellation, Job events, gates, patches, artifacts, and truthful simulated dry-run. Credential values stay in the OS-backed secret store while Provider JSON, IPC, logs, usage, and artifacts carry references/status only. Sixteen machine-captured gates passed, including real Electron E2E and a zero-finding DoD scan, so `RISK-PROV-001` is CLOSED. The prior Stable Gate result remains historical until its required post-task rerun; `RISK-REL-001` remains OPEN.

## Current Product Truth

- Core Electron, CLI/TUI, runtime, tool, security, Job Center, Provider, Worktree, Arena, industrial, gate, sample, and release tests pass.
- Runtime Protocol output is sink-driven, and complete normalized event streams can rebuild resumable system/user/assistant/tool context without session JSON. Older incomplete streams remain read-only.
- Codex CLI, Claude Code CLI, and custom Agent Worker are production-capable external Agent adapters only after the user supplies a valid local executable/configuration and approves isolated execution. Adapter presence does not claim that any external product is installed, licensed, authenticated, or healthy.
- SolidWorks and AVEVA are bridge/external-required integrations, not automatic deep integrations.
- Real Electron multi-width and protocol-native output E2E now runs locally and in the Linux/Xvfb CI job.
- Desktop config and Agent Provider state contain secret references rather than
  plaintext credentials; OS secure storage or explicit CLI environment fallback
  is required.
- MCP supports managed stdio and HTTPS Streamable HTTP through one lifecycle. Remote bearer/OAuth values remain in the desktop secret store, refreshed credentials and expiry metadata commit atomically, and a generated OAuth authorization request is never presented as completed user consent.

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
- Attachment and command routing evidence: `reports/tasks/HC-RUN-220.md`, `reports/evidence/HC-RUN-220/manifest.json`
- Typed App Shell evidence: `reports/tasks/HC-UI-301.md`, `reports/evidence/HC-UI-301/manifest.json`
- Integrated editor evidence: `reports/tasks/HC-UI-310.md`, `reports/evidence/HC-UI-310/manifest.json`
- Integrated terminal evidence: `reports/tasks/HC-UI-311.md`, `reports/evidence/HC-UI-311/manifest.json`, `reports/evidence/HC-UI-311/ci-matrix.json`
- Secure App Preview evidence: `reports/tasks/HC-UI-312.md`, `reports/evidence/HC-UI-312/manifest.json`, `reports/evidence/HC-UI-312/ci-matrix.json`
- Coding and Git delivery evidence: `reports/tasks/HC-GIT-320.md`, `reports/evidence/HC-GIT-320/manifest.json`, `reports/evidence/HC-GIT-320/ci-matrix.json`
- Credential storage evidence: `reports/tasks/HC-SEC-401.md`, `reports/evidence/HC-SEC-401/manifest.json`, `reports/evidence/HC-SEC-401/ci-matrix.json`
- Cross-platform execution policy evidence: `reports/tasks/HC-SEC-402.md`, `reports/evidence/HC-SEC-402/manifest.json`, `reports/evidence/HC-SEC-402/ci-matrix.json`
- Controlled release pipeline evidence: `reports/tasks/HC-REL-420.md`, `reports/evidence/HC-REL-420/manifest.json`, `reports/evidence/HC-REL-420/ci-matrix.json`
- MCP connection layer evidence: `reports/tasks/HC-MCP-410.md`, `reports/evidence/HC-MCP-410/manifest.json`
- Provider production-hardening evidence: `reports/tasks/HC-PROV-301.md`, `reports/evidence/HC-PROV-301/manifest.json`
- Stable release gate evidence: `reports/tasks/HC-REL-STABLE-GATE.md`, `reports/evidence/HC-REL-STABLE-GATE/manifest.json`, `reports/evidence/HC-REL-STABLE-GATE/gate-result.json`, `reports/releases/0.6.0-stable/gate-report.md`
- Current risks: `reports/program/risks.json`
- Historical final acceptance: `reports/final-acceptance-historical.md`
- Historical audit policy: `reports/audit/README.md`
