# HC-REL-ALPHA-7 Task Evidence

Status: Completed

Owner: Program Director / Security Release

Release: `0.6.0-alpha.7`

Branch: `codex/release/0.6.0-alpha.7`

Parent commit: `d36923bed32267a5bfb3433e4450307060cbda69`

## Purpose

Close the gap between the completed HC-RUN-201 implementation and the release control plane. The runtime task was already committed and verified, while package metadata and the machine-readable backlog still described alpha.6 or a planned runtime task.

## Changes

- Synchronized `package.json`, `package-lock.json`, and `VERSION` to `0.6.0-alpha.7`.
- Recorded HC-RUN-201 as completed and made only dependency-satisfied work ready.
- Added an explicit release candidate and candidate gate without changing the immutable alpha.6 source baseline.
- Added capability, migration, security, E2E, known-limitations, and release-evidence reports.
- Added a release evidence profile with minimal child-process environment and redacted, hashed logs.
- Added program-control assertions for version consistency, dependency readiness, capability truth, and release evidence.

## Scope Boundary

No runtime, Electron IPC, preload, renderer, provider, industrial adapter, user-data path, or security policy implementation changed. Event-only context reconstruction remains HC-RUN-202. Signing, updater, SBOM, and provenance remain HC-REL-420.

## Verification

`reports/evidence/HC-REL-ALPHA-7/manifest.json` records 11 required commands passing. The candidate includes real Electron streaming with the stdout bridge disabled, 142 security assertions, zero DoD findings, and zero high-or-critical production advisories.

## Rollback

Revert the single release integration commit. HC-RUN-201 remains independently committed and its existing runtime/session data stays intact.
