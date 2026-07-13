# HC-SEC-402 Cross-Platform Execution Policy And Capability Reporting

Status: Completed

Branch: `codex/security-release/hc-sec-402`

Parent commit: `3a2328cde78f55eeaf18f823f52d23643be93b6b`

Started: `2026-07-12T15:15:48Z`

Completed: `2026-07-13T03:32:56Z`

## Problem

Hi Code has several real security controls, but they are expressed independently. Bash can use macOS `sandbox-exec`; the integrated terminal has explicit startup approval, a minimal environment, and process-tree cleanup; workspace file tools perform canonical path checks; Git and MCP use bounded arguments and reduced environments. Linux and Windows do not currently have an equivalent filesystem sandbox in the Runtime Bash path, and the Settings UI reduces the whole boundary to a macOS-only boolean. This can overstate the protection actually delivered by a specific process launch.

## Outcome

Create one versioned execution-policy contract that evaluates command, working directory, filesystem roots, environment, network, resource/output limits, approval, audit, and process-tree cleanup before launch. Platform capability detection must describe what is enforced, partially enforced, weak, or unavailable. Production execution paths must consume that contract, and the desktop must show the resulting boundary without exposing sensitive data.

## Scope

- Typed execution policy, request, decision, capability, diagnostic, and audit models.
- Deterministic capability detection for macOS, Linux, and Windows.
- macOS `sandbox-exec` backend compatibility with truthful limitations.
- Linux bubblewrap/user-namespace backend when available, with explicit fail-closed behavior for unsupported requested controls.
- Windows process-tree/job capability reporting without claiming restricted-token filesystem or network isolation when it is unavailable.
- Shared environment, command, path, timeout, output, approval, and process-tree policy evaluation.
- Production integration for Runtime Bash and desktop terminal, followed by bounded command runners that currently launch Quality Gate, Worktree, MCP, and industrial tool processes.
- Read-only, validated IPC/preload API and a Settings diagnostics view.
- Unit, platform contract, process-tree, service, Renderer, security, DoD, and real Electron acceptance tests.

## Out Of Scope

- Installing or silently downloading bubblewrap, containers, WSL, or commercial security products.
- Claiming Windows restricted-token or Job Object enforcement without a reviewed native implementation.
- Per-packet firewall management, VPN configuration, or host-wide network changes.
- Replacing the interactive terminal with a container.
- MCP Streamable HTTP/OAuth, package signing, notarization, release publication, or new industrial modules.

## Interfaces

- Core policy API: evaluate a bounded request and return a serializable decision plus launch plan.
- Capability API: read-only platform/backend diagnostics with no environment values or host secrets.
- Bash/terminal integration: launch only after policy and existing permission approval both succeed.
- Renderer API: status only; the Renderer cannot select executables, inject environment values, or bypass policy.

## Security Contract

- Unknown or malformed policy values fail closed.
- Requested controls that cannot be enforced are either denied or explicitly reported as weak according to a declared policy mode; they are never marked strong.
- Environment values remain minimized and redacted.
- Canonical working directories and filesystem roots must remain inside their allowed workspace/app-data boundary.
- Network capability is never inferred from a filesystem sandbox.
- Timeouts, output bounds, and process-tree cleanup are mandatory for non-interactive task runners.
- Interactive terminal startup remains a visible human approval point and keeps its explicit warning when OS filesystem/network isolation is unavailable.

## Test Plan

- Platform capability fixtures for darwin/linux/win32 and unavailable backends.
- Command/path/environment/network policy allow and deny cases.
- Strong/partial/weak labels cannot exceed the underlying enforced controls.
- macOS and Linux launch-plan construction tests without fake execution claims.
- Windows diagnostics truthfully report missing restricted-token/filesystem/network controls.
- Abort/timeout terminates descendants, not only the direct child.
- IPC/preload/Renderer diagnostics are bounded and contain no secret values.
- Full build, verify, release check, security, DoD, production audit, and Electron E2E.

## Baseline

- Source branch was clean at `3a2328cde78f55eeaf18f823f52d23643be93b6b`.
- `node node_modules/npm/bin/npm-cli.js run verify`: passed before task files or production implementation were changed.
- Existing tests truthfully confirm macOS-only Bash write confinement and cross-platform terminal process-tree cleanup; they do not constitute HC-SEC-402 acceptance.

## Implemented

- Added a typed, versioned policy kernel with deterministic macOS, Linux, and Windows capability reporting.
- Added async and synchronous managed runners with minimal child environments, output limits, timeouts, and descendant termination.
- Integrated Runtime Bash, desktop terminal, Worktree Runner, Patch Arena gates, Quality Gate command execution, MCP stdio servers, and real industrial adapter processes.
- Added fresh main-process authorization for Renderer-initiated Worktree, Quality Gate, and industrial-tool execution; Renderer `userApproved` fields are intent only.
- Added a read-only preload/IPC capability projection and Settings diagnostics for all eight policy controls.
- Kept SolidWorks and AVEVA bridge-only with no external process or false real-execution claim.
- Fixed Electron-hosted synchronous supervision by using Node mode only for the internal supervisor, preventing two IfcOpenShell probes from blocking the desktop for ten seconds.
- Bounded automatic IfcOpenShell detection to one highest-priority Python interpreter while retaining all candidates as evidence and preserving explicit manual-path probing.

## Focused Verification

- `test/execution-policy-tests.mjs`: 26 passed.
- `test/terminal-service-tests.mjs`: 12 passed.
- `test/worktree-runner-tests.mjs`: 21 passed.
- `test/patch-arena-tests.mjs`: 20 passed.
- `test/industrial-tool-tests.mjs`: 100 passed.
- `test/quality-gate-tests.mjs`: 19 passed.
- `test/security-baseline.mjs`: 216 passed.
- Real Electron E2E: passed, including capability diagnostics and responsive Industrial Project navigation.

## Evidence

- Local acceptance: `reports/evidence/HC-SEC-402/manifest.json`
- Source commit bound by local evidence: `f45415f9a6eda59f1533da1e2a8a275f265abe90`
- Result: 19 passed, 0 failed, captured from a clean worktree.
- Cross-platform CI: `reports/evidence/HC-SEC-402/ci-matrix.json`
- GitHub Actions run: `29221844706`
- PR: `#19`
- General tests and real Electron smoke passed on Ubuntu, macOS, and Windows.

## Rollback

The policy kernel and platform backends will be introduced behind existing Runtime and service interfaces. Rollback removes their calls and the read-only diagnostic API while preserving the previous permission, safe-environment, workspace, and process-cleanup behavior. No user data migration is planned.
