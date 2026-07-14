# HC-REL-420 Task Manifest

Status: Completed

Started: 2026-07-13T04:48:41Z

Completed: 2026-07-13T09:49:20Z

Branch: `codex/security-release/hc-rel-420`

Parent commit: `14c5380`

## Problem

Hi Code can build an unsigned macOS DMG and Windows NSIS/ZIP, but it does not yet have one truthful release contract for macOS, Windows, and Linux. Linux packages, update channels, SBOM, provenance, installer lifecycle checks, and rollback policy are absent. The current macOS configuration also hard-disables signing even when approved credentials are available.

## Outcome

Deliver a controlled desktop release pipeline that produces inspectable three-platform artifacts and metadata in CI, enables signed release mode only when the required credentials are present, and never presents unsigned development output as a production-signed release. Installed applications receive a bounded, user-confirmed update lifecycle with explicit channel and rollback rules.

## Scope

- macOS DMG and updater ZIP, Windows NSIS and portable ZIP, Linux AppImage and DEB.
- `stable`, `beta`, and `nightly` channel policy with version/channel validation.
- Signing and notarization preflight without exposing credential values.
- Packaged-only updater service with manual check/download/install and user confirmation.
- CycloneDX JSON SBOM from the production lock graph.
- SHA-256 checksums and source/artifact provenance statement.
- Static package integrity plus update, upgrade, and rollback contract tests on all three CI platforms.
- Machine-captured task evidence and a three-platform packaging CI matrix.

## Out Of Scope

- Formal GitHub Release publication, tag creation, signing credential creation, or certificate purchase.
- Silent or forced updates.
- Treating unsigned macOS/Windows packages as stable release artifacts.
- Downgrading an installed release without an explicit recovery package and user approval.
- Changing the Industrial Studio feature surface.

## Interfaces

- Package scripts and `electron-builder` configuration in `package.json`.
- Release policy, SBOM, checksum, provenance, and package inspection scripts under `scripts/`.
- Main-process update service registered through existing IPC utilities.
- Backward-compatible `app:check-updates` IPC plus typed update lifecycle methods.
- Release workflow under `.github/workflows/`.

## Migration And Compatibility

- Existing `app:check-updates` callers remain valid.
- Existing `dist:mac`, `dist:win`, and `dist:all` scripts remain available.
- Existing GitHub releases remain readable; channel-aware metadata is additive.
- No user project or application-data migration is required.

## Security

- Release mode fails closed when required platform signing material is incomplete.
- Formal release mode requires an inspectable clean Git tree, and controlled builder arguments reject caller-supplied publication or config overrides.
- Unsigned CI/development mode is explicit in manifests, UI status, and provenance.
- Updater never auto-downloads or auto-installs and does not run in an unpackaged app.
- Update installation requires a downloaded verified package and a main-process confirmation record.
- Release logs and provenance contain credential presence only, never values.
- Signed-package smoke verifies macOS code signing/notarization or Windows Authenticode instead of trusting credential presence alone.
- Packaging child environments expose only release-tool allowlisted variables.

## Tests

- Release policy channel, credential, and unsigned-mode tests.
- SBOM production dependency graph and deterministic output tests.
- Checksum and provenance integrity/tamper tests.
- Updater check/download/install state machine, confirmation, channel, and rollback tests.
- Package artifact naming, metadata, native module, and version inspection tests.
- Linux/macOS/Windows packaging jobs with uploaded smoke evidence.
- Global build, verify, release check, security, DoD, production audit, and real Electron E2E gates.

## Rollback

- Revert this task commit to restore the old package scripts and GitHub-only update check.
- Existing installers and user data are not modified by development or CI evidence capture.
- Failed packaging leaves versioned artifacts in the task workspace only.
- A failed post-install update keeps the prior package available; automatic downgrade remains disabled.

## Stop Conditions

- Formal publish, notarization, or signing requires explicit user approval and credentials.
- Stable update enablement is blocked until signed package smoke passes on real target machines.
- Any updater path that can install without user confirmation blocks task completion.

## Implemented

- Added one fail-closed release policy for channel, source-tree, signing, notarization, publication, updater, and artifact-label decisions.
- Added native macOS DMG/ZIP, Windows NSIS/ZIP, and Linux AppImage/DEB build contracts with development and approved-release modes.
- Added a packaged-only, user-confirmed updater state machine with bounded channel and rollback behavior; development packages remain update-disabled.
- Added deterministic CycloneDX SBOM, provenance, checksum generation, checksum verification, and credential-safe release child environments.
- Added native package inspection and lifecycle smoke, including deterministic Windows NSIS install/uninstall process-tree completion.
- Added a three-platform GitHub Actions packaging matrix without publishing artifacts as a formal release.

## Focused Verification

- `test/release-pipeline-tests.mjs`: 52 passed.
- `test/security-baseline.mjs`: 229 passed.
- Local macOS development package and lifecycle smoke: passed.
- `npm run release:check`: passed.
- Full-tree DoD scan: zero findings.
- GitHub native package smoke: passed on macOS, Windows, and Linux.
- GitHub real Electron smoke: passed on Ubuntu, macOS, and Windows.

## Evidence

- Local acceptance: `reports/evidence/HC-REL-420/manifest.json`
- Source commit bound by local evidence: `6e42ce3e30028ba9a6e8aee920865a68704b7571`
- Local result: 20 passed, 0 failed, captured from a clean worktree.
- Cross-platform CI: `reports/evidence/HC-REL-420/ci-matrix.json`
- Release Packaging run: `29239107911`
- General CI run: `29239108094`
- Draft PR: `#20`
- CI/development packages remain unsigned and update-disabled. Formal publication, tag creation, signing, and notarization were not performed.
