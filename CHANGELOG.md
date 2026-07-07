# Changelog

## 0.5.1 - 2026-07-06

- Fixed release readiness reporting so `ready` and `blockers` can no longer disagree (P2-004).
- Fixed Definition-of-Done scanner to match button wiring in both directions (DOD-003); scan is now 0 blocking / 0 warning.
- Improved model "test connection" errors with actionable Chinese guidance for 401/403/404/429/5xx, network failures, and local services that are not running.
- Moved the built-in store catalog to `electron/store-catalog.mjs` and published it as `store/catalog.json`, so the GitHub Catalog store source now serves real data from this repository.
- Added `npm run store:export` to regenerate the published catalog.
- Added GitHub Actions CI: build, syntax check, all 16 test suites, and the DoD scan on every push and pull request.
- Extracted native macOS app opening into `electron/services/native-open-service.mjs`; a failed open now falls through to the agent instead of ending the turn, and phrases like "运行测试" or file paths are no longer intercepted as app launches.

Verification baseline: 16 suites, 837 checks, 0 failed (2026-07-06).

## 0.5.0 - 2026-07-04

- Added structured runtime turn events and richer tool events.
- Added visual Changes panel with Accept, Reject, History, Clear archived.
- Added Git workflow page with status, stage, unstage, generated commit messages, commit.
- Added runtime logs and recoverable task parsing.
- Added runtime progress strip in the chat workspace.
- Added queued input UX while the model or tools are busy.
- Added `RuntimeJobQueue` for main-process serialized input execution.
- Added China-friendly model provider setup flow and model switching.
- Added store foundation for Plugins, Skills, MCP, Agents with search and pagination.
- Added native macOS app open aliases for ToDesk, WPS, Word, common apps.
- Added handoff docs for Codex and Claude Code.

Verification baseline:

- `npm run build`
- `node --check renderer/renderer.js`
- `node --check electron/main.mjs`
- `node test/feature-tests.mjs`
- Last known result: `64 passed, 0 failed`

Post-handoff stabilization:

- Added Sprint 0 verification scripts and entrypoint/security baseline tests.
- Moved stale root `main.mjs`, `renderer.js`, and `index.html` to `legacy/v0.4/`.
- Hardened bash child process environment inheritance.
- Hardened Store local path and unverified download install policy.
- Enabled Electron renderer sandbox and documented the runtime security baseline.
- Exposed authoritative main-process runtime queue state to the renderer.
- Added clear queued jobs IPC for the composer queue UI.
- Added recent RuntimeJobQueue history, canceled queued job records, and optional persisted history.
- Added store download filename hardening and sha256 verification.
- Added `check:syntax` and tightened `release:check` to run build, syntax, feature, entrypoint, security, and production audit checks.
- Added preload parameter validation and normalized Electron IPC handler error handling.
- Added Store signature metadata fields and expanded security baseline coverage.
- Added `docs/engineering-baseline.md` to freeze active entrypoints, commands, release checks, and security boundaries.
- Updated feature test baseline: `67 passed, 0 failed`.

Sprint 1A main-process service split:

- Added Electron main-process service modules for runtime, queue, MCP, Store, Git, Diff, Workspace, and Security.
- Added centralized IPC registration through `electron/ipc/register-ipc-handlers.mjs` and normalized IPC helpers in `electron/ipc/ipc-utils.mjs`.
- Removed direct `ipcMain.handle(...)` registration from `electron/main.mjs`; channel names and preload APIs remain compatible.
- Added `test/main-process-services-tests.mjs` and included it in `verify` and `release:check`.
- Added `docs/main-process-services.md` with service boundaries, IPC registration rules, security boundaries, and compatibility notes.

Sprint 1B renderer structure split:

- Converted `renderer/renderer.js` into a thin ES module entrypoint and moved app wiring to `renderer/app/bootstrap.js`.
- Added renderer modules for state, routing, API wrapping, toast notifications, runtime helpers, file tree, diff viewer, capabilities/MCP metadata, Store helpers, AI Team quick cards, settings picker helpers, formatting, DOM helpers, and validation.
- Routed renderer main-process calls through `renderer/api/hicode-api.js` with user-facing error handling.
- Added `test/renderer-architecture-tests.mjs` and included it in `verify` and `release:check`.
- Added `docs/renderer-architecture.md` with module layout, state, API, and panel development rules.

Sprint 2A Job Center core:

- Added `src/job-center.ts` with Job, Task, TaskStep, Artifact, JobEvent, JobStatus, TaskStatus, GateResult, and ApprovalRecord types plus runtime validation and a persistent `JobStore`.
- Added `electron/services/job-service.mjs` and Job Center IPC channels for create/list/get/cancel/retry/pause/resume/events/artifacts.
- Linked Runtime Queue jobs to Job Center records through `metadata.jobCenterId` while preserving the existing Runtime Queue.
- Mirrored Runtime Queue status changes and runtime tool events into Job Center events; runtime diffs are recorded as artifacts.
- Added `test/job-center-tests.mjs` and included it in `verify` and `release:check`.
- Added `docs/job-center.md` with data model, status machine, IPC, artifact, and gate result rules.

Sprint 2B Job Center UI:

- Added a renderer Job Center panel with job list, job detail, task/step timeline, event log, artifacts, gate results, and error display.
- Added Job Center actions for cancel, retry, pause, resume, refresh, artifact preview, and artifact reveal.
- Added Runtime Queue to Job Center navigation through the composer queue status strip when a runtime job has `jobCenterId`.
- Added artifact preview/open IPC paths with allowed-root checks.
- Expanded renderer architecture tests for empty job list, failed job, artifact job, and Job Center API wrapper calls.
- Updated `docs/job-center.md` with UI usage notes and a lifecycle example.

Sprint 3A Agent Provider abstraction:

- Added `src/agent-provider.ts` with Provider types, Registry state, config validation, enable/disable, run, and cancel contracts.
- Added `electron/services/provider-service.mjs` with Provider IPC, `hicode-internal`, and reserved `codex-cli`, `claude-code`, and `local-model` descriptors.
- Connected `hicode-internal` to the existing Runtime Queue and Job Center instead of a mock path.
- Provider runs now create/attach Jobs, write Provider JobEvents, create provider-run artifacts, and record failed gates on setup failures.
- Added `test/provider-tests.mjs` and included it in `verify` and `release:check`.
- Added `docs/agent-providers.md` with lifecycle, safety, and reserved-provider guidance.

Sprint 3B Worktree Runner isolation:

- Added `src/worktree-runner.ts` with git worktree, copy sandbox, dry-run, patch collection, cleanup, and failure preservation primitives.
- Added `electron/services/worktree-service.mjs` and IPC channels for worktree create/run/collectChanges/cleanup.
- Updated `hicode-internal` provider to default to isolated execution and pass `executionCwd` into Runtime Queue metadata.
- Added runtime queue finalization that collects isolated workspace patches, records artifacts, and cleans successful workspaces.
- Added dirty workspace rejection, safe-root cleanup manifests, patch path escape validation, and direct-mode opt-in.
- Added `test/worktree-runner-tests.mjs` and included it in `verify` and `release:check`.
- Added `docs/worktree-runner.md` with design, safety, fallback, and failure preservation rules.
