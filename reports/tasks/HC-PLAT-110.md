# HC-PLAT-110 Task Manifest

Status: Completed

Owner: Security And Release

Release: `0.6.0-alpha.8`

Branch: `codex/security-release/hc-plat-110`

Parent commit: `6a27bd31980c240434d3b5e0c2b18da84f686c8d`

Started: `2026-07-10T17:48:41Z`

Completed: `2026-07-10T19:01:57Z`

Evidence: `reports/evidence/HC-PLAT-110/manifest.json` after acceptance

## Problem

Electron 31.7.7 is outside Electron's supported stable window, and the existing real Electron smoke runs on Linux only. Updating the dependency without checking the embedded runtime, security configuration, native modules, packaging toolchain, and all desktop platforms would leave the release claim unverified.

## Outcome

Move Hi Code to the current supported Electron stable line with a reproducible compatibility contract and a real Linux/macOS/Windows startup matrix while preserving the existing application version and user data format.

## Scope

- Electron and electron-builder supported-version upgrade.
- Package-lock and installed-runtime consistency checks.
- Embedded Electron/Chromium/Node version capture in real E2E evidence.
- Native production dependency inventory and rebuild policy.
- Linux, macOS, and Windows CI startup smoke.
- Existing Electron security and responsive behavior regression checks.
- Task documentation, rollback, program state, and hashed evidence.

## Out Of Scope

- Application version promotion, GitHub release, signing, notarization, or automatic update.
- Renderer redesign, Provider work, industrial modules, or new user-facing features.
- Adding a native dependency solely to exercise rebuild tooling.
- Dropping legacy session or runtime data.

## Security

The upgrade cannot disable sandboxing, context isolation, navigation guards, IPC validation, or E2E environment isolation. Runtime diagnostics may record version numbers but not environment values, credentials, tokens, or user project content.

## Compatibility And Migration

There is no persisted-data migration. The compatibility contract covers Electron 43.1.0, Chromium 150, and Node 24. Existing IPC channels and preload APIs remain unchanged. The parent dependency lock remains the rollback source.

## Tests

- Package, lockfile, installed runtime, and embedded runtime version checks.
- BrowserWindow security setting checks.
- Native production dependency inventory.
- Existing real Electron responsive and protocol-native turn E2E.
- CI matrix structure for Ubuntu, macOS, and Windows.
- Full repository build, verify, release, security, DoD, and production audit gates.

## Rollback

Revert the HC-PLAT-110 commits to restore Electron 31.7.7, electron-builder 24.13.3, and the previous Linux-only smoke job. No user data or workspace files require rollback.

## Result

- Electron 31.7.7 was replaced with exact Electron 43.1.0; electron-builder is exact 26.15.3.
- Real E2E records Electron 43.1.0, Chromium 150.0.7871.47, and Node 24.18.0 and passes 13 interaction/security checks.
- BrowserWindow keeps context isolation, renderer sandboxing, and disabled Node integration, and now denies untrusted navigation and renderer-created windows.
- The production lock graph has no native Node add-on. The documented future rebuild gate remains fail-closed.
- A pinned dev-only npm CLI makes electron-builder dependency collection deterministic even when the global `npm` executable is a wrapper. Native rebuild remains enabled.
- The macOS arm64 unsigned alpha DMG was generated successfully. Signing and notarization remain a separate release approval.
- GitHub Actions run `29116173672` passed the test job plus real Electron smoke on Ubuntu, macOS, and Windows; job URLs are captured in `reports/evidence/HC-PLAT-110/ci-matrix.json`.
- The local evidence manifest records 13 passing commands and 22 hashed key artifacts.

## Commit Plan

1. Record the supported-line decision and active task control state.
2. Upgrade dependencies and implement the executable compatibility contract.
3. Add three-platform CI startup coverage, run acceptance, and commit evidence.
