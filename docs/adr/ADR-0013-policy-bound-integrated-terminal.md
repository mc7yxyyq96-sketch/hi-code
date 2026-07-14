# ADR-0013: Policy-Bound Integrated PTY Terminal

Status: Accepted

Date: 2026-07-11

## Context

Hi Code already executes bounded Runtime tools, but users also need an interactive terminal for long-running local workflows, prompts, and programs that require a PTY. A renderer-only console would be fake, while exposing `child_process`, raw IPC, or a native PTY to the renderer would break Electron isolation.

An interactive shell is materially broader than one Runtime tool call. Starting in a workspace does not confine the shell to that directory at the operating-system level, and approving startup means subsequent typed commands execute without per-command permission dialogs. This must be explicit rather than implied away by UI copy.

The first stable `node-pty` package available to this task (`1.1.0`) ships macOS prebuild helpers without executable permission. The official `1.2.0` beta line fixes that packaging defect and a Unix inherited-file-descriptor issue.

## Decision

1. Put PTY ownership in one main-process terminal service. Renderer and preload receive only typed create, status, write, resize, close, and event contracts.
2. Require the existing Runtime permission state before PTY creation. Denial creates no process. One approval covers one terminal session and this scope is stated in UI and native dialog copy.
3. Bind one session to one renderer owner and the workspace active at startup. Close it before workspace changes and when the owner or app closes.
4. Start only trusted platform shells with profile loading disabled. Do not accept a renderer-provided executable, arguments, cwd, or environment.
5. Build a minimal environment with `buildSafeChildEnv`; never inherit the complete parent environment or persist terminal input/output.
6. Bound input and output events to 64 KiB, the in-memory transcript tail to one MiB, and xterm scrollback to 5,000 lines.
7. Terminate the process tree, not just the shell handle. Use `taskkill /T /F` on Windows and descendant plus process-group termination on Unix.
8. Pin official `node-pty@1.2.0-beta.12`, unpack it from ASAR, and allow exactly this native production dependency in the Electron compatibility inventory.
9. Keep terminal rendering lazy. Browser preview fails closed instead of simulating execution.

## Consequences

- Hi Code gains real PTY behavior on macOS, Linux, and Windows without weakening `contextIsolation`, renderer sandboxing, or `nodeIntegration`.
- Terminal startup is auditable metadata, but input, output, transcript, and full environment maps are deliberately absent from persisted logs.
- The shell has the desktop user's OS permissions after approval. Users needing per-action review use Runtime tools; users needing an isolated copy use Worktree Runner.
- A reviewed native dependency enters the production graph and therefore becomes a packaging and cross-platform CI gate.
- The pinned dependency is a beta because the stable package is not functional for packaged macOS helpers. Promotion to a later stable release requires the same compatibility and process-tree tests.

## Rejected Alternatives

- **Render a fake terminal:** rejected because it cannot run interactive programs and would violate the no-placeholder product rule.
- **Use `child_process.spawn` with pipes:** rejected because many shells and CLIs require terminal semantics, resize, and control sequences.
- **Expose node-pty through preload:** rejected because native process authority must remain in the main process.
- **Pass renderer-selected shell/env/cwd:** rejected because it permits path, profile, and credential injection.
- **Approve every keystroke or command line:** rejected because a PTY stream cannot reliably recover shell command boundaries; startup is the explicit authorization unit.
- **Patch `node-pty 1.1.0` permissions locally:** rejected because it hides an upstream packaging defect and complicates signed artifacts.

## Verification And Rollback Gates

- Focused service and renderer terminal tests.
- Security and Electron native-dependency inventory tests.
- Real Electron terminal command/resize/close acceptance at desktop and compact widths.
- Linux, macOS, and Windows Electron CI smoke.
- macOS package inspection proving the native module and helper are outside ASAR and executable.

Rollback removes the terminal route, IPC/service/preload surface, xterm and node-pty dependencies, and native inventory exception. It does not migrate persisted user data because terminal transcripts are not persisted.
