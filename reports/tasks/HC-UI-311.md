# HC-UI-311 Integrated PTY Terminal Under Execution Policy

Status: In Progress

Branch: `codex/desktop-ux/hc-ui-311`

Parent commit: `115ea610d4432cf386f7c66d566534e165392454`

Started: `2026-07-11T17:58:50Z`

## Scope

Deliver a real interactive terminal inside the existing typed App Shell. The terminal must use a centralized main-process PTY service, preserve the current renderer/preload boundaries, require explicit execution authorization, remain confined to the active workspace, receive a minimal child environment, redact persisted diagnostics, and terminate its process tree when the session or owning window closes.

This task does not implement app preview, Git/PR/CI orchestration, industrial adapters, signing, or release promotion.

## Acceptance Contract

- An authorized user can start one interactive shell for the active workspace, exchange input/output, resize it, and close it from the desktop UI.
- A denied start does not create a PTY or child process.
- Session identifiers cannot access another window or workspace.
- Closing a terminal or BrowserWindow terminates the complete process tree and stops output delivery.
- Parent API keys, tokens, passwords, and unrelated environment values are absent from the PTY environment and logs.
- Transcript memory and renderer rendering remain bounded during long output streams.
- macOS, Linux, and Windows shell selection is explicit and capability-reported; unavailable native support fails closed with a useful reason.

## Baseline

- Real entrypoints remain `electron/main.mjs`, `electron/preload.cjs`, `renderer/index.html`, and `renderer/renderer.js` with the typed App Shell loaded through the established renderer bootstrap.
- Package version is `0.6.0-alpha.8`.
- `npm run verify`: passed from clean parent commit before task-state changes.
- HC-UI-310 committed evidence remains 15/15; the historical HC-RUN-220 long-duration evidence is reused and is not rerun for this task.

## Security Design Constraints

- Renderer code never receives `child_process`, a raw native PTY object, or a generic IPC invoke surface.
- PTY creation, input, resize, and close use typed validated IPC methods.
- Start authorization is a separate explicit operation; input cannot silently create a terminal.
- The service uses the shared safe child-environment policy and never logs full environment maps or raw secrets.
- Output events are owner-scoped, sequence-numbered, size-bounded, and detached before renderer delivery.
- Cleanup is idempotent and limited to sessions created by the service.

## Planned Evidence

Focused service and renderer tests will cover authorization, workspace confinement, environment minimization, interactive I/O, resize, bounded output, ownership, and cleanup. Real Electron E2E will cover keyboard interaction and terminal close behavior at compact and desktop widths. The task will then capture build, verify, release check, feature, security, DoD, production audit, Electron E2E, program-control, and diff-check evidence from a clean source commit.

## Rollback

Revert the HC-UI-311 implementation commits. The existing command tool, Runtime, editor, conversation, Diff Inspector, and legacy panels remain unchanged and continue to provide the pre-terminal workflow.
