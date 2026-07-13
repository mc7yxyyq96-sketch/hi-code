# ADR-0018: Controlled Desktop Release Pipeline

Status: Accepted for HC-REL-420

Date: 2026-07-13

## Context

Hi Code previously built an unsigned macOS DMG and Windows NSIS/ZIP. The package configuration hard-disabled the macOS identity, Linux had no supported target, and update checks only opened GitHub release information. There was no machine-readable SBOM, provenance statement, native installer lifecycle check, or common channel/rollback policy.

Signing, notarization, and formal publication use credentials and irreversible public state. CI and developer builds still need to exercise the complete package layout without presenting those artifacts as trusted releases.

## Decision

Use one versioned release policy before every `electron-builder` invocation.

- Modes are `development`, `ci`, and `release`.
- Product channels are `stable`, `beta`, and `nightly`; their updater metadata names are `latest`, `beta`, and `alpha`.
- Package/version channel mismatches fail before packaging.
- Formal release mode requires an inspectable, clean Git source tree so provenance identifies the exact packaged commit.
- `release` mode requires `HICODE_RELEASE_APPROVED=1` and target-platform signing material. macOS also requires notarization material.
- Formal publishing additionally requires an explicit publish flag and GitHub token. Development and CI invocations force `--publish never`; only a fully approved release policy may pass `--publish always`.
- CI/development packages embed `artifactTrust: unsigned` and `updateEnabled: false`.
- The packaging child receives an allowlisted environment. Model keys, cloud credentials, tokens, and unknown variables are not inherited.
- Updater checks are packaged-only, never automatic, and enabled only by a signed macOS/Windows manifest or an explicitly integrity-verified Linux manifest. Download and install are separate user actions; installation receives a main-process confirmation.
- Automatic downgrade is forbidden. Recovery rollback requires a verified package and explicit approval.
- Every native package job generates a CycloneDX production SBOM, in-toto/SLSA-shaped provenance, and a SHA-256 manifest, then performs a native install/extract smoke.

## Consequences

- Linux gains AppImage and DEB packages; macOS gains the ZIP required by the updater; Windows remains NSIS plus ZIP.
- Pull requests can validate all package formats without release credentials or publication rights.
- Unsigned artifacts remain suitable for CI evidence and local evaluation but not stable promotion or in-app update.
- A formal signed release still stops for user approval and credential availability.
- Package jobs are slower and produce larger CI artifacts, but failures now expose installer and metadata defects before publication.

## Rejected Alternatives

- Treat HTTPS plus checksum metadata as equivalent to platform signing. This would overstate trust on macOS and Windows.
- Enable `autoDownload` or install on quit. This removes the explicit user decision required by the product security model.
- Run one cross-compilation job for all platforms. Native install and extraction semantics would remain untested.
- Generate an SBOM from all lockfile entries. That would mix development tooling with the shipped production graph.
