# HC-UI-311 Integrated PTY Terminal Under Execution Policy

Status: Completed

Branch: `codex/desktop-ux/hc-ui-311`

Parent commit: `115ea610d4432cf386f7c66d566534e165392454`

Started: `2026-07-11T17:58:50Z`

Completed: `2026-07-11T20:35:56Z`

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

## Implementation

- `electron/services/terminal-service.mjs` owns the real `node-pty` lifecycle, trusted profile-free shell selection, one-session-per-window ownership, bounded sequencing, transcript tail, resize, and process-tree termination.
- `electron/main.mjs` reuses the Runtime permission state and a native confirmation dialog before spawn. Workspace changes and window/app shutdown close the owning PTY first.
- `electron/preload.cjs` and centralized IPC expose only typed, bounded terminal operations and an unsubscribable event listener; renderer code never receives a native PTY or generic invoke channel.
- `renderer/app-shell/terminal/` lazy-loads xterm and the fit add-on, restores only a bounded snapshot, serializes input writes, deduplicates output sequence numbers, and reports unavailable native support instead of rendering a fake terminal.
- The packaged Electron app unpacks the reviewed native `node-pty@1.2.0-beta.12` module. Compatibility checks verify the exact package, target prebuild, executable macOS helper, and CI platform matrix.

## Verification So Far

- Production build: passed; xterm remains outside the initial App Shell chunk.
- App Shell: 13/13 passed.
- Terminal service: 12/12 passed, including a real PTY in a workspace containing spaces and Chinese characters, stale owner/workspace start cancellation, and verified descendant cleanup.
- Terminal renderer: 7/7 passed.
- Electron compatibility: 29/29 passed.
- Security baseline: 188/188 passed.
- Real Electron acceptance: passed at 1024 px and 720 px with keyboard input, output, close, and inactive-status verification.
- macOS package inspection: passed; the native module and executable spawn helper are present under `app.asar.unpacked`.

## Final Evidence

`reports/evidence/HC-UI-311/manifest.json` records 18/18 passing gates from clean source commit `d9703672325345e3e92924aaf9abe52ec29fe714`. It includes focused terminal, service, App Shell, renderer, compatibility, security, build, verify, release, feature, DoD, production-audit, real Electron, macOS package, packaged-terminal, program-control, and diff-check evidence with hashed logs. The full-tree DoD scan reports zero findings. Cross-platform native behavior is enforced by the macOS/Linux/Windows CI matrix on every pull request target; local native acceptance is macOS arm64.

`reports/evidence/HC-UI-311/ci-matrix.json` records GitHub Actions run `29167924876` for Draft PR #15 at commit `55d9ede7f5a3cde4ebc8841feb9ba32a0296b673`. The general test job and real Electron smoke jobs on `ubuntu-latest`, `macos-latest`, and `windows-latest` all completed successfully and uploaded their smoke artifacts.

## Rollback

Revert the HC-UI-311 implementation commits. The existing command tool, Runtime, editor, conversation, Diff Inspector, and legacy panels remain unchanged and continue to provide the pre-terminal workflow.
