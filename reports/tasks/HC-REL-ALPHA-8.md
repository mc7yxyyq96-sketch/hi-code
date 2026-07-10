# HC-REL-ALPHA-8 Task Manifest

Status: Completed

Owner: Release Owner

Release: `0.6.0-alpha.8`

Branch: `codex/release/0.6.0-alpha.8`

Parent commit: `265a69f`

Started: `2026-07-10T19:25:33Z`

Completed: `2026-07-10T19:55:25Z`

Evidence: `reports/evidence/HC-REL-ALPHA-8/manifest.json` after acceptance

## Problem

HC-RUN-202, HC-RUN-203, and HC-PLAT-110 are complete on a common ancestry, but the application still identifies as alpha.7 and has no single alpha.8 capability, migration, security, compatibility, limitation, or release-evidence boundary.

## Outcome

Create a reproducible alpha.8 release candidate from the completed runtime replay/recovery and Electron compatibility work. The candidate may be built and pushed for review, but no tag, GitHub Release, signing, notarization, or public promotion occurs without explicit approval.

## Scope

- Synchronize package, lockfile, VERSION, Electron app info, and renderer version labels to `0.6.0-alpha.8`.
- Publish source-backed capability, migration, security, E2E, known-limitations, and release-evidence reports.
- Re-run all repository gates, Electron compatibility, real Electron E2E, production audit, and macOS alpha packaging.
- Preserve the passing Linux/macOS/Windows startup evidence from HC-PLAT-110.
- Record immutable task evidence and rollback instructions.

## Out Of Scope

- HC-PROV-210, HC-UI-301, or any new product capability.
- Stable release claims, automatic update, signing, notarization, or installer publication.
- Modifying user stores, Runtime Protocol schemas, IPC channels, or workspace data.

## Security

The candidate cannot weaken Electron sandboxing, context isolation, navigation guards, child-process environment filtering, workspace confinement, approval policy, or simulated/not_run semantics. Packaging remains explicitly unsigned.

## Rollback

Revert the alpha.8 candidate commits and continue using the verified alpha.7 metadata. Runtime and project stores do not require rollback because this task performs no data migration.

## Result

- Package metadata, lock metadata, `VERSION`, Electron app info, and renderer version labels resolve to `0.6.0-alpha.8`.
- Six source-backed release reports distinguish implemented, unavailable, external-required, unsigned, and future capabilities.
- The release profile ran 13 commands with 13 passes, including real Electron E2E, Electron compatibility, security, DoD, production audit, and unsigned macOS packaging.
- The full-tree DoD scan reported zero findings.
- HC-PLAT-110 three-platform CI startup evidence is linked without extending that claim to signing or physical installer smoke.
- No tag, GitHub Release, signing, notarization, or public promotion was performed.

## Commit Plan

1. Record the release-candidate task and dependency boundary: completed.
2. Synchronize version metadata and add source-backed release reports: completed.
3. Capture all acceptance evidence and complete the candidate state: completed.
