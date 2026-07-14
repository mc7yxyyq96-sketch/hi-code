# Integrated Terminal

HC-UI-311 adds a real PTY terminal to the desktop App Shell. It is a local execution surface, not a simulated console and not a replacement for Runtime tool events.

## User Flow

1. Open **Terminal** from the sidebar or compact workspace drawer.
2. Select **Start terminal**.
3. Review the native execution-permission dialog. One approval covers the interactive terminal session; commands entered after startup are not approved one by one.
4. Enter commands in the xterm surface. Resize events follow the visible panel.
5. Select **Stop**, switch workspace, close the owning window, or quit Hi Code to terminate the PTY process tree.

The terminal starts in the active workspace. Its session is bound to that workspace and renderer owner and is closed before a workspace change. It is not an operating-system filesystem sandbox: an approved local shell runs with the desktop user's OS permissions. Users should use Runtime tools or an isolated Worktree Runner when they need per-action review or stronger workspace isolation.

## Architecture

- `electron/services/terminal-service.mjs` owns PTY creation, authorization, shell selection, output delivery, resize, and cleanup.
- `electron/ipc/register-ipc-handlers.mjs` is the only registration path for `terminal:*` handlers.
- `electron/preload.cjs` exposes bounded terminal methods and a sanitized event subscription. It does not expose `ipcRenderer`, `child_process`, or a native PTY object.
- `renderer/app-shell/terminal/api.ts` validates the renderer-side contract.
- `renderer/app-shell/terminal/TerminalPortal.tsx` owns terminal UI state and bounded input sequencing.
- `renderer/app-shell/terminal/xterm-runtime.ts` lazily loads xterm only when the surface is needed.

One PTY may run per renderer window. IDs are opaque and owner-scoped. The transcript retained for route restoration is a one MiB UTF-8 tail; individual input and output events are capped at 64 KiB.

## Execution Policy

PTY creation calls the same `requestPermission` state used by Runtime tools. Default mode displays a native dialog, a session allow decision is honored, and yolo mode permits startup without another prompt. A denied request creates no PTY.

Approval applies to shell startup, not every command typed into the shell. This distinction is visible in the native dialog and empty-terminal guidance. Terminal input is never copied into Runtime logs or Job events.

Before PTY spawn, the main process also evaluates the shared cross-platform execution policy. The terminal is intentionally `weak`: it is interactive, has no automatic timeout, permits network access, and does not claim filesystem confinement. It does retain a minimal environment, one visible startup approval, owner/workspace lifecycle binding, bounded transcript/output, and full process-tree cleanup. Settings displays these controls separately so this boundary cannot be confused with Runtime Bash or an isolated worktree.

## Environment And Shells

The PTY receives `buildSafeChildEnv()` output plus terminal-only values such as `TERM`, `COLORTERM`, `PWD`, and `HICODE_TERMINAL`. API keys, tokens, passwords, unknown variables, `SSH_AUTH_SOCK`, and the complete parent environment are not inherited.

Shell selection fails closed:

| Platform | Selection | Profile behavior |
| --- | --- | --- |
| macOS | trusted `zsh`, `bash`, or `sh` under system/package-manager roots | rc/profile loading disabled |
| Linux | trusted `bash`, `sh`, or `zsh` under system roots | rc/profile loading disabled |
| Windows | PowerShell 7, Windows PowerShell, then Command Prompt under `ProgramFiles`/`SystemRoot` | PowerShell uses `-NoProfile` |

Browser preview returns `available: false`; it never renders fake shell output.

## Native Module Packaging

`node-pty` is pinned to `1.2.0-beta.12`. This version contains official prebuilds for the supported target platforms and includes the upstream executable-bit fix for the macOS `spawn-helper`. `package.json` unpacks `node_modules/node-pty/**/*` from ASAR so native binaries and the helper remain loadable.

The Electron compatibility contract allows exactly this reviewed native production dependency. Any other native package fails the inventory check.

## Cleanup

- Windows uses `taskkill /T /F` for the PTY PID.
- macOS and Linux snapshot descendants before termination, signal descendants and the PTY process group with `SIGTERM`, then use `SIGKILL` for survivors.
- Cleanup is idempotent and applies only to service-created session PIDs.
- Output delivery stops as soon as closing begins.

## Verification

```bash
npm run build
npm run test:terminal
npm run test:services
npm run test:security
npm run test:electron-compatibility
npm run test:electron-e2e
npm run verify
```

The service test launches a real PTY in a path containing spaces and Chinese characters, proves secrets are absent, and proves a background child ends with the terminal. Electron E2E enters a command through xterm and verifies output, responsive layout, resize, and close through the production preload/IPC path.
