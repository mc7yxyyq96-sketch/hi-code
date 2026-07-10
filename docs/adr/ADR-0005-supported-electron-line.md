# ADR-0005: Supported Electron Line And Cross-Platform Startup Contract

Status: Accepted

Date: 2026-07-10

## Context

Hi Code `0.6.0-alpha.7` uses Electron `31.7.7`. Electron supports only the latest three stable major releases; on 2026-07-10 those lines are 43, 42, and 41. Electron 31 is therefore outside the supported security and compatibility window.

The existing responsive acceptance test launches the real application but CI runs it only on Linux. A dependency-only bump would not prove that the packaged runtime, preload bridge, renderer, and security flags still work on macOS and Windows.

Official references:

- <https://releases.electronjs.org/>
- <https://www.electronjs.org/docs/latest/tutorial/electron-timelines>
- <https://www.electronjs.org/docs/latest/breaking-changes/>

## Decision

1. Pin Electron to stable `43.1.0` for reproducible development and CI. This runtime contains Chromium 150 and Node 24.
2. Keep the application version at `0.6.0-alpha.7` during the compatibility task. Release promotion remains a separate integration decision.
3. Upgrade `electron-builder` to a Node 24/Electron 43 compatible stable release and keep `package-lock.json` authoritative.
4. Add an executable compatibility contract that verifies the selected runtime, package lock, security settings, CI platform matrix, and native dependency inventory.
5. Run the production Electron entrypoint on Linux, macOS, and Windows in CI. Linux uses Xvfb; macOS and Windows launch directly.
6. Continue to require `contextIsolation: true`, `nodeIntegration: false`, sandboxing, local-file navigation guards, preload validation, and isolated E2E user data.
7. Treat native dependencies as an explicit release concern. The current production dependency graph contains no native Node add-on. Any future `.node`/node-gyp production dependency must add an Electron rebuild step and a target-platform smoke before merge.

## Consequences

- Developers need Node 22.12 or newer to install Electron 43's npm package.
- Runtime behavior now reflects Chromium 150 and Node 24; browser and Node deprecations can surface during this task instead of after stable release.
- Three-platform startup becomes a merge gate, but installer signing and notarization remain separate release-owner approvals.
- Exact version pins reduce accidental runtime drift. A future supported-line update receives a new task and evidence rather than an unreviewed lockfile change.

## Rejected Alternatives

- **Remain on Electron 31:** rejected because it is outside the supported release window.
- **Use Electron 44 prerelease:** rejected because prerelease runtime changes are not appropriate for the alpha.8 compatibility baseline.
- **Upgrade only `package.json`:** rejected because it does not validate the real embedded runtime or three target platforms.
- **Introduce native dependencies to test rebuilds:** rejected because adding unused native code increases attack and packaging surface. The contract instead fails when a native production dependency appears without an explicit plan.

## Verification And Rollout Gates

- `npm run test:electron-compatibility`
- `npm run test:electron-e2e`
- Linux, macOS, and Windows Electron smoke CI jobs
- Full `build`, `verify`, `release:check`, security, DoD, and production audit gates
- A task evidence manifest with immutable command and artifact hashes

Rollback is a dependency and CI revert to the parent commit. No user data, runtime protocol, session, or project migration is performed by this decision.
