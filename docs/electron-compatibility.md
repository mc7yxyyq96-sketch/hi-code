# Electron Compatibility Baseline

HC-PLAT-110 moves Hi Code from unsupported Electron 31.7.7 to pinned Electron 43.1.0. The embedded runtime baseline is Chromium 150 and Node 24. Host development and CI require Node 22.12.0 or newer.

## Verify The Contract

```bash
npm run test:electron-compatibility
npm run test:electron-e2e
```

The compatibility test verifies package and lockfile pins, installed package versions, BrowserWindow security settings, navigation/window guards, the native production dependency inventory, and the three-platform CI matrix. The real Electron E2E test reads `process.versions` from the launched main process and records it in `test-results/electron-e2e/<platform>-<arch>/layout-observed.json`.

## Target Platforms

| Platform | CI runner | Launch mode |
| --- | --- | --- |
| Linux x64 | `ubuntu-latest` | Xvfb + production Electron entrypoint |
| macOS | `macos-latest` | Production Electron entrypoint |
| Windows x64 | `windows-latest` | Production Electron entrypoint |

The smoke suite uses an isolated home, user-data directory, local model fixture, and minimal environment. It does not read developer credentials or project sessions.

## Native Dependency Plan

HC-UI-311 introduces one reviewed native production dependency: exact `node-pty@1.2.0-beta.12`. It provides the PTY required by the integrated terminal. No other native production dependency is allowed by `scripts/electron-compatibility.mjs`.

The selected package provides target prebuilds for Linux, macOS, and Windows. The macOS prebuild includes an executable `spawn-helper`; stable `node-pty 1.1.0` is not used because its published helper permission causes `posix_spawnp failed`. `package.json` places the entire package under `asarUnpack` so `.node` files, Windows ConPTY assets, and the macOS helper remain loadable in the packaged app.

The electron-builder 26 development graph includes `electron-winstaller`. Its reviewed install script only selects the package's bundled host-architecture 7-Zip executable and DLL; `pnpm-workspace.yaml` grants that exact package build permission so local policy-enforced installs complete without granting arbitrary scripts.

electron-builder asks the detected package manager for a production dependency tree. Hi Code pins a dev-only npm CLI and invokes electron-builder through `scripts/run-electron-builder.mjs`, which creates an ephemeral PATH shim for that exact CLI. This keeps package collection deterministic when a developer's global `npm` command is a wrapper, while preserving native rebuild and production dependency validation.

When a future production dependency includes another native Node add-on:

1. Record the package, ABI, source, and supported target platforms in a new compatibility task.
2. Add a pinned Electron rebuild step after dependency installation.
3. Build the native module separately on Linux, macOS, and Windows rather than copying host output.
4. Run the real Electron startup and feature path that loads the module on every target platform.
5. Block merge if the module lacks a compatible Electron 43 ABI artifact or a reproducible source build.

## Security Boundary

- `contextIsolation` remains true.
- `nodeIntegration` remains false.
- renderer sandboxing remains enabled.
- renderer-created windows are denied.
- navigation away from the trusted local renderer is blocked.
- preload and IPC contracts are unchanged.
- the terminal preload contract is narrow and validated; native PTY ownership remains in the main process.

## Rollback

Revert the HC-UI-311 terminal dependency, route, service, IPC, tests, and native inventory exception to return to the JavaScript-only HC-PLAT-110 graph. No persisted data format changes in this task, so session, runtime, job, and project stores need no migration or rollback.
