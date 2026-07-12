# HC-GIT-320 Plan, Queue, And Git Delivery Loop

Status: In progress

Branch: `codex/runtime-engine/hc-git-320`

Parent commit: `e802c15cfb27402b3d0a88bcad5fcc9b1715b1a7`

Started: `2026-07-12T06:16:00Z`

## Scope

Complete the remaining beta.2 coding loop inside the existing Electron workbench. The main process becomes the single authority for plan-mode runs, queued follow-up prompts, and recoverable steer requests. The existing Git panel gains protected branch, commit, pull-request, and CI-status operations without bypassing workspace policy or exposing credentials.

This task does not add a remote agent provider, change repository hosting, auto-merge a pull request, publish a release, store GitHub credentials, or add industrial modules.

## Acceptance Contract

- Plan mode is an explicit runtime execution mode that rejects mutating tools through the existing tool policy boundary and remains visibly distinct in the UI and durable queue metadata.
- A prompt submitted while another turn is running enters the main-process queue immediately; the renderer does not maintain a second hidden execution queue.
- Steering an active turn records the instruction, interrupts the current turn, and schedules a follow-up through the authoritative queue. Hi Code does not claim unsupported in-stream model mutation.
- Queue, steer, interruption, and follow-up state remain visible and recoverable through Runtime Job Queue and Job Center events.
- Git status, branch creation/switching, staging, commit, pull-request creation, and CI status use bounded argument arrays in the selected repository.
- Branch switching refuses a dirty worktree. Pull-request creation requires an explicit user confirmation and never stores or logs credentials.
- Missing GitHub CLI, missing authentication, detached HEAD, absent upstream, failed CI, and pending CI are visible states rather than false success.
- A real Electron E2E fixture completes plan/queue/steer and local Git commit/branch behavior, then displays deterministic PR/CI fixture states through the same production command path.

## Baseline

- Real entrypoints remain `electron/main.mjs`, `electron/preload.cjs`, `renderer/index.html`, and `renderer/renderer.js` with the typed App Shell mounted through the existing bootstrap.
- Package version is `0.6.0-alpha.8`.
- `node node_modules/npm/bin/npm-cli.js run verify`: passed from the clean HC-UI-312 parent before task-state changes.
- HC-UI-312 local and cross-platform CI evidence remains valid; the historical ten-hour HC-RUN-220 suite is not rerun.

## Security Design Constraints

- Git and GitHub commands use executable plus argument arrays with `shell: false`, bounded output, timeout, minimal child environment, and redacted diagnostics.
- Repository operations resolve from the selected workspace and cannot accept arbitrary `cwd`, absolute file paths, path traversal, command fragments, or unbounded text.
- Read-only status operations do not require approval. Branch/commit/PR mutations use explicit product controls; PR creation additionally requires a fresh confirmation.
- Branch switching fails closed when the worktree is dirty. No operation performs reset, clean, force push, force checkout, merge, rebase, or auto-merge.
- Plan mode cannot authorize mutating Runtime tools. Existing permission and workspace confinement remain authoritative in other modes.
- GitHub authentication remains owned by the external `gh` client or operating-system credential store; Hi Code does not read, persist, or display tokens.

## Planned Verification

- Focused Runtime control and queue service tests.
- Focused Git collaboration service tests with real temporary repositories and a deterministic external-CLI fixture.
- Renderer App Shell tests for plan, queue, steer, branch, PR confirmation, and failed CI visibility.
- Security baseline, centralized IPC contract, build, verify, release check, feature tests, DoD unit, full-tree DoD scan, production audit, and program-control checks.
- Real Electron E2E for the complete local coding loop and responsive layout.

## Rollback

Revert the HC-GIT-320 implementation commits. Existing Runtime input, interrupt, Runtime Job Queue, Git status/diff/stage/commit, editor, terminal, preview, and legacy panels continue to provide the pre-task workflow.
