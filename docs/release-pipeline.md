# Desktop Release Pipeline

HC-REL-420 defines the package, update, integrity, and provenance contract for Hi Code desktop builds.

## Artifact Matrix

| Platform | Packages | Updater metadata | Native smoke |
| --- | --- | --- | --- |
| macOS | DMG and ZIP | `latest-mac.yml`, `beta-mac.yml`, or `alpha-mac.yml` | read-only DMG mount, bundle/version/resources inspection |
| Windows x64 | NSIS installer and portable ZIP | `latest.yml`, `beta.yml`, or `alpha.yml` | silent temporary install, resources inspection, silent uninstall |
| Linux x64 | AppImage and DEB | `latest-linux.yml`, `beta-linux.yml`, or `alpha-linux.yml` | AppImage extraction and DEB extraction/version inspection |

The package smoke verifies non-empty native artifacts, update metadata SHA-512 references, `app.asar`, the native `node-pty` binary, and the embedded release trust manifest.

## Modes And Trust

`HICODE_RELEASE_MODE` accepts:

- `development`: local package evaluation. Unsigned and update-disabled.
- `ci`: native package and installer validation. Unsigned and update-disabled.
- `release`: approved release output. macOS/Windows fail closed if required signing or notarization material is incomplete; Linux is explicitly `integrity_verified`, not platform-signed.

Every package embeds `resources/release-channel.json`. The manifest records mode, product channel, signed/notarized state, update eligibility, and a policy digest. It never records credential values.

Formal publication is separate from packaging. It requires all of:

- `HICODE_RELEASE_MODE=release`
- `HICODE_RELEASE_APPROVED=1`
- `HICODE_RELEASE_PUBLISH=1`
- a GitHub publication token
- target signing credentials; macOS also requires notarization credentials

The controlled builder rejects caller-provided `--publish` and `--config` overrides. Platform builds run as separate invocations so one platform's signing decision cannot be embedded in another platform's package. Signed-package smoke verifies macOS code signing and stapled notarization, or Windows Authenticode, before the artifact can be treated as signed evidence.

Formal release mode also requires an inspectable, clean Git worktree. Development provenance may be generated from a dirty tree, but it records `sourceTreeClean: false` and remains `local-unattested`; it cannot be promoted as commit-exact release evidence.

Do not set these values merely to make a CI package pass. Missing release credentials are a real stable-promotion blocker.

## Channels

| Product channel | Version shape | electron-updater channel |
| --- | --- | --- |
| `stable` | `1.2.3` | `latest` |
| `beta` | `1.2.3-beta.1` or `1.2.3-rc.1` | `beta` |
| `nightly` | `1.2.3-alpha.1`, `-dev`, or `-nightly` | `alpha` |

The preflight rejects a version published under a different product channel. Stable clients do not consume prereleases; beta clients can consume beta/RC or stable releases; nightly clients can consume all channels.

## Managed Updater

The main process owns the updater. Renderer code can only call typed actions:

- read capability/status
- select one predefined channel
- check manually
- download manually
- install after a native main-process confirmation

`autoDownload`, install-on-quit, and automatic downgrade are disabled. Unpackaged apps, invalid manifests, unsigned packages, and unapproved builds return an explicit disabled reason without contacting the update provider. An approved Linux release may use `integrity_verified` because electron-updater verifies HTTPS-hosted SHA-512 metadata even though no macOS/Windows-style platform signature exists. The Renderer cannot supply a custom feed URL or authorization header.

Linux application updates are enabled only when the packaged process is running from an AppImage. DEB installations remain manual and report that boundary in Settings rather than attempting an unsupported in-app replacement. Unless the user has already chosen a channel, a packaged prerelease starts on the channel embedded by its release policy.

Rollback is a recovery operation, not an update channel. The policy rejects downgrade by default. A recovery package must be verified and separately approved; the regular updater never silently rolls back.

## SBOM, Provenance, And Checksums

`npm run release:sbom` walks reachable production dependencies from `package-lock.json` and writes CycloneDX 1.7 JSON to `release/sbom-v<version>.cdx.json`. Development-only packages are excluded.

`npm run release:provenance` writes an in-toto Statement using the SLSA provenance predicate. It binds package/SBOM digests to the source commit and package-lock digest. Local output is explicitly `local-unattested`; CI output identifies the workflow. An unsigned build remains `artifactTrust: unsigned`.

`npm run release:checksums` covers native packages, updater metadata, blockmaps, SBOM, and provenance. `npm run release:verify-checksums` rejects missing, extra, malformed, or modified artifacts.

## Commands

Use the repository-pinned npm CLI in automation-sensitive local work:

```bash
node node_modules/npm/bin/npm-cli.js run release:preflight -- --platform=darwin
node node_modules/npm/bin/npm-cli.js run dist:mac
node node_modules/npm/bin/npm-cli.js run release:package-smoke -- --platform=darwin
node node_modules/npm/bin/npm-cli.js run release:sbom
node node_modules/npm/bin/npm-cli.js run release:provenance
node node_modules/npm/bin/npm-cli.js run release:checksums
node node_modules/npm/bin/npm-cli.js run release:verify-checksums
```

Use `dist:win` on Windows and `dist:linux` on Linux. `.github/workflows/release-packaging.yml` runs the native three-platform matrix and uploads evidence without publishing a release.

## Current Boundary

The pipeline can prove unsigned package structure, updater fail-closed behavior, integrity metadata, and native installer extraction in CI. It cannot claim commercial signing, Apple notarization, Windows publisher reputation, or a formally published update until approved credentials are present and target-machine smoke passes.
