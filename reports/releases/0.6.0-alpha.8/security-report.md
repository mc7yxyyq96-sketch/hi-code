# Hi Code 0.6.0-alpha.8 Security Report

Status: Candidate gate passed

## Preserved Boundaries

- Electron uses `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing.
- Renderer-created windows are denied and navigation is confined to the trusted local document.
- Preload and IPC validation, normalized errors, workspace confinement, permission requests, and child-process environment minimization remain required.
- Typed runtime paths remain below Hi Code app data; directories use `0700` and files use `0600` where supported.
- Evidence commands receive a minimal environment and redact credential-like values before logs are hashed.

## Recovery Safety

- Approval resolution is durable and cannot be silently reused on retry.
- Unknown or completed mutating tool effects block automatic replay.
- Partial assistant output is bounded and marked as interrupted rather than completed.
- Hidden exact model messages do not enter the legacy timeline or Job logs.

## Dependency And Platform Review

Electron and electron-builder are exact-pinned. The production dependency graph contains no native Node add-on. GitHub Actions startup smoke passed on Linux, macOS, and Windows for the HC-PLAT-110 commit. The alpha.8 candidate repeated local security, DoD, production audit, E2E, and packaging gates with 13 of 13 commands passing.

## Residual Security Risks

The macOS package is not signed or notarized. Windows signing and installer trust are not part of this candidate. Local model content and tool results remain sensitive project data stored on the user's machine.
