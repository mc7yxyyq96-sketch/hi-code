import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildReleaseChildEnv,
  channelAcceptsVersion,
  compareReleaseVersions,
  createReleasePolicy,
  inferReleaseChannel,
  planVersionTransition,
  prepareBuilderArguments,
  releaseEnvironmentSummary,
  resolveBuilderPlatform,
  updaterChannelName,
  writeEmbeddedReleaseManifest,
} from "../electron/services/release-policy.mjs";
import { createUpdateService, validateEmbeddedReleaseManifest } from "../electron/services/update-service.mjs";
import { createCycloneDxBom } from "../scripts/generate-sbom.mjs";
import { createProvenanceStatement } from "../scripts/generate-provenance.mjs";
import { debianPackageVersion, inspectReleaseArtifactSet } from "../scripts/package-smoke.mjs";
import { verifyChecksums, writeChecksums } from "../scripts/checksum-release.mjs";
import { buildReleaseGitEnv, inspectReleaseSource } from "../scripts/release-source.mjs";

let passed = 0;
function check(name, condition, detail = "") {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ""}`);
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log("\n[release-pipeline] version and channel policy");
check("semver comparison orders prerelease and stable", compareReleaseVersions("0.6.0-alpha.8", "0.6.0-beta.1") < 0 && compareReleaseVersions("0.6.0-rc.1", "0.6.0") < 0);
check("release channel inference is explicit", inferReleaseChannel("1.0.0") === "stable" && inferReleaseChannel("1.0.0-beta.2") === "beta" && inferReleaseChannel("1.0.0-alpha.2") === "nightly");
check("updater channel names map to electron metadata", updaterChannelName("stable") === "latest" && updaterChannelName("beta") === "beta" && updaterChannelName("nightly") === "alpha");
check("stable cannot consume prerelease versions", !channelAcceptsVersion("stable", "1.1.0-beta.1") && channelAcceptsVersion("beta", "1.1.0-beta.1") && channelAcceptsVersion("nightly", "1.1.0-alpha.1"));
check("verified forward update is accepted", planVersionTransition({ currentVersion: "1.0.0", targetVersion: "1.1.0", channel: "stable", verified: true }).ok === true);
check("unverified update is rejected", planVersionTransition({ currentVersion: "1.0.0", targetVersion: "1.1.0", channel: "stable", verified: false }).reason === "package_not_verified");
check("automatic rollback is rejected", planVersionTransition({ currentVersion: "1.1.0", targetVersion: "1.0.0", channel: "stable", verified: true }).reason === "automatic_downgrade_forbidden");
check("recovery rollback requires explicit approval", !planVersionTransition({ currentVersion: "1.1.0", targetVersion: "1.0.0", channel: "stable", verified: true, recoveryMode: true }).ok
  && planVersionTransition({ currentVersion: "1.1.0", targetVersion: "1.0.0", channel: "stable", verified: true, recoveryMode: true, userApproved: true }).ok);

console.log("\n[release-pipeline] signing and child environment");
const secretEnv = {
  PATH: "/usr/bin",
  HOME: "/tmp/home",
  OPENAI_API_KEY: "sk-model-secret",
  ANTHROPIC_API_KEY: "anthropic-secret",
  GITHUB_TOKEN: "github-secret",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  HICODE_RELEASE_MODE: "development",
};
const developmentPolicy = createReleasePolicy({ version: "0.6.0-alpha.8", platform: "darwin", env: secretEnv });
check("development artifacts are truthfully unsigned", developmentPolicy.ok && developmentPolicy.artifactTrust === "unsigned" && developmentPolicy.updateEnabled === false && developmentPolicy.channel === "nightly");
const developmentChildEnv = buildReleaseChildEnv({ env: secretEnv, policy: developmentPolicy, shimPath: "/tmp/shim" });
check("development builder excludes model and cloud secrets", !developmentChildEnv.OPENAI_API_KEY && !developmentChildEnv.ANTHROPIC_API_KEY && !developmentChildEnv.GITHUB_TOKEN && !developmentChildEnv.AWS_SECRET_ACCESS_KEY);
check("development builder disables signing discovery", developmentChildEnv.CSC_IDENTITY_AUTO_DISCOVERY === "false");
const windowsBuildEnv = buildReleaseChildEnv({
  env: { PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows", ComSpec: "C:\\attacker\\cmd.exe" },
  policy: { ...developmentPolicy, platform: "win32" },
});
check("Windows builder derives command resolution from trusted constants", windowsBuildEnv.ComSpec === "C:\\Windows\\System32\\cmd.exe" && windowsBuildEnv.PATHEXT === ".COM;.EXE;.BAT;.CMD");
const cleanSource = { ok: true, clean: true, commit: "a".repeat(40), changedPaths: 0 };
const missingReleaseCredentials = createReleasePolicy({ version: "1.0.0", platform: "darwin", mode: "release", env: {}, sourceState: cleanSource });
check("release mode fails closed without approval and signing", !missingReleaseCredentials.ok && missingReleaseCredentials.errors.length >= 3);
const signedReleaseEnv = {
  PATH: "/usr/bin",
  HICODE_RELEASE_MODE: "release",
  HICODE_RELEASE_APPROVED: "1",
  CSC_LINK: "base64-certificate",
  CSC_KEY_PASSWORD: "certificate-password",
  APPLE_ID: "release@example.com",
  APPLE_APP_SPECIFIC_PASSWORD: "app-password",
  APPLE_TEAM_ID: "TEAM123",
  HICODE_RELEASE_PUBLISH: "1",
  GH_TOKEN: "github-token",
};
const signedPolicy = createReleasePolicy({ version: "1.0.0", platform: "darwin", env: signedReleaseEnv, sourceState: cleanSource });
check("approved signed macOS policy enables updates", signedPolicy.ok && signedPolicy.publishAllowed && signedPolicy.updateEnabled && signedPolicy.artifactTrust === "signed");
const linuxReleasePolicy = createReleasePolicy({ version: "1.0.0", platform: "linux", mode: "release", env: { HICODE_RELEASE_APPROVED: "1" }, sourceState: cleanSource });
check("approved Linux release is integrity-verified without claiming signed", linuxReleasePolicy.ok && linuxReleasePolicy.updateEnabled && linuxReleasePolicy.artifactTrust === "integrity_verified" && linuxReleasePolicy.signing.status === "not_configured");
const releaseChildEnv = buildReleaseChildEnv({ env: signedReleaseEnv, policy: signedPolicy });
const envSummary = JSON.stringify(releaseEnvironmentSummary(releaseChildEnv));
check("release environment summary never contains credential values", !envSummary.includes("base64-certificate") && !envSummary.includes("certificate-password") && !envSummary.includes("github-token") && envSummary.includes("[PRESENT]"));
const dirtyReleasePolicy = createReleasePolicy({ version: "1.0.0", platform: "linux", mode: "release", env: { HICODE_RELEASE_APPROVED: "1" }, sourceState: { ...cleanSource, clean: false, changedPaths: 2 } });
check("release mode rejects a dirty source tree", !dirtyReleasePolicy.ok && dirtyReleasePolicy.errors.some((item) => item.includes("clean Git source tree")));
const gitEnv = buildReleaseGitEnv({ PATH: "/usr/bin", HOME: "/tmp/home", GITHUB_TOKEN: "secret", OPENAI_API_KEY: "secret" });
check("release source inspection excludes ambient secrets", gitEnv.PATH === "/usr/bin" && gitEnv.HOME === "/tmp/home" && !gitEnv.GITHUB_TOKEN && !gitEnv.OPENAI_API_KEY);
check("release source inspection uses a portable isolated Git config", gitEnv.GIT_CONFIG_GLOBAL !== os.devNull && fs.statSync(gitEnv.GIT_CONFIG_GLOBAL).isFile());
const sourceTmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-release-source-"));
for (const args of [["init"], ["config", "user.email", "release-test@example.com"], ["config", "user.name", "Release Test"]]) {
  const result = spawnSync("git", args, { cwd: sourceTmp, env: buildReleaseGitEnv(process.env), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
fs.writeFileSync(path.join(sourceTmp, "source.txt"), "committed\n");
for (const args of [["add", "source.txt"], ["commit", "-m", "fixture"]]) {
  const result = spawnSync("git", args, { cwd: sourceTmp, env: buildReleaseGitEnv(process.env), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
fs.appendFileSync(path.join(sourceTmp, "source.txt"), "dirty\n");
const dirtySourceState = inspectReleaseSource(sourceTmp);
check("release source inspection detects a dirty tree", dirtySourceState.ok && !dirtySourceState.clean && dirtySourceState.changedPaths === 1);
fs.rmSync(sourceTmp, { recursive: true, force: true });
const controlledBuilderArgs = prepareBuilderArguments(["--mac", "dmg", "zip"], developmentPolicy);
check("builder policy owns channel and publish arguments", controlledBuilderArgs.includes("--config.publish.channel=alpha") && controlledBuilderArgs.at(-1) === "never");
assert.throws(() => prepareBuilderArguments(["--mac", "dmg", "--publish", "always"], developmentPolicy), /publish mode is controlled/);
passed += 1;
console.log("✓ builder rejects caller-controlled publishing");
assert.throws(() => prepareBuilderArguments(["--mac", "dmg", "--config.mac.identity=null"], signedPolicy), /configuration overrides are not allowed/);
passed += 1;
console.log("✓ builder rejects trust-sensitive config overrides");
assert.throws(() => resolveBuilderPlatform(["--mac", "--win"]), /one platform/);
passed += 1;
console.log("✓ builder isolates platform trust manifests");

console.log("\n[release-pipeline] embedded manifest");
const manifestTmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-release-manifest-"));
const embedded = writeEmbeddedReleaseManifest({ root: manifestTmp, policy: developmentPolicy, env: { SOURCE_DATE_EPOCH: "1700000000" } });
check("embedded manifest records unsigned update-disabled mode", embedded.payload.artifactTrust === "unsigned" && embedded.payload.updateEnabled === false && embedded.payload.generatedAt === "2023-11-14T22:13:20.000Z");
check("embedded manifest validates exact app version", validateEmbeddedReleaseManifest(embedded.payload, "0.6.0-alpha.8").ok && !validateEmbeddedReleaseManifest(embedded.payload, "0.6.0-alpha.9").ok);
fs.rmSync(manifestTmp, { recursive: true, force: true });

console.log("\n[release-pipeline] managed updater lifecycle");
class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checks = 0;
    this.downloads = 0;
    this.installs = 0;
  }
  async checkForUpdates() {
    this.checks += 1;
    const updateInfo = { version: "1.1.0", releaseName: "Hi Code 1.1.0", releaseDate: "2026-07-13T00:00:00Z" };
    this.emit("update-available", updateInfo);
    return { updateInfo };
  }
  async downloadUpdate() {
    this.downloads += 1;
    this.emit("download-progress", { percent: 50, transferred: 5, total: 10 });
    this.emit("update-downloaded", { version: "1.1.0" });
    return ["/tmp/verified-update.pkg"];
  }
  quitAndInstall() { this.installs += 1; }
}
const updateTmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-update-service-"));
const updater = new FakeUpdater();
let beforeInstall = 0;
const updateService = createUpdateService({
  updater,
  getVersion: () => "1.0.0",
  isPackaged: () => true,
  settingsPath: path.join(updateTmp, "settings.json"),
  embeddedManifest: { schemaVersion: 1, version: "1.0.0", channel: "stable", artifactTrust: "signed", updateEnabled: true },
  platform: "darwin",
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  beforeInstall: async () => { beforeInstall += 1; },
});
check("signed packaged updater reports available", updateService.capabilities().available === true);
const updateCheck = await updateService.checkUpdates();
check("manual update check records available version", updateCheck.ok && updateCheck.hasUpdate && updateService.getStatus().state.status === "available" && updater.autoDownload === false && updater.allowDowngrade === false);
const updateDownload = await updateService.downloadUpdate();
check("manual download reaches downloaded state", updateDownload.ok && updater.downloads === 1 && updateService.getStatus().state.status === "downloaded");
const updateInstall = await updateService.installUpdate();
await new Promise((resolve) => setImmediate(resolve));
check("installation requires main-process confirmation and cleanup", updateInstall.ok && beforeInstall === 1 && updater.installs === 1 && updateService.getStatus().state.status === "installing");
const channelChanged = updateService.setChannel("beta");
check("selected channel persists without custom URL input", channelChanged.ok && JSON.parse(fs.readFileSync(path.join(updateTmp, "settings.json"), "utf8")).channel === "beta" && updater.channel === "beta");
assert.throws(() => updateService.setChannel("https://attacker.invalid"), /Unsupported release channel/);
passed += 1;
console.log("✓ arbitrary update channel input is rejected");
updateService.dispose();

const unsignedUpdater = new FakeUpdater();
const unsignedService = createUpdateService({
  updater: unsignedUpdater,
  getVersion: () => "1.0.0",
  isPackaged: () => true,
  embeddedManifest: { schemaVersion: 1, version: "1.0.0", channel: "stable", artifactTrust: "unsigned", updateEnabled: false },
});
const disabledCheck = await unsignedService.checkUpdates();
check("unsigned package cannot invoke updater transport", disabledCheck.disabled && unsignedUpdater.checks === 0 && unsignedService.getStatus().state.status === "disabled");
const nightlyDefaultService = createUpdateService({
  updater: new FakeUpdater(),
  getVersion: () => "1.0.0-alpha.1",
  isPackaged: () => true,
  embeddedManifest: { schemaVersion: 1, version: "1.0.0-alpha.1", channel: "nightly", artifactTrust: "signed", updateEnabled: true },
  platform: "darwin",
});
check("packaged prerelease defaults to its embedded channel", nightlyDefaultService.getStatus().state.channel === "nightly");
const debUpdater = new FakeUpdater();
const debService = createUpdateService({
  updater: debUpdater,
  getVersion: () => "1.0.0",
  isPackaged: () => true,
  embeddedManifest: { schemaVersion: 1, version: "1.0.0", channel: "stable", artifactTrust: "integrity_verified", updateEnabled: true },
  platform: "linux",
  appImagePath: "",
});
const debCheck = await debService.checkUpdates();
check("Linux DEB remains manual-update only", debCheck.disabled && debCheck.reason === "linux_package_manual_update" && debUpdater.checks === 0);
const appImageService = createUpdateService({
  updater: new FakeUpdater(),
  getVersion: () => "1.0.0",
  isPackaged: () => true,
  embeddedManifest: { schemaVersion: 1, version: "1.0.0", channel: "stable", artifactTrust: "integrity_verified", updateEnabled: true },
  platform: "linux",
  appImagePath: "/tmp/Hi-Code.AppImage",
});
check("verified Linux AppImage can use managed updates", appImageService.capabilities().available === true);
fs.rmSync(updateTmp, { recursive: true, force: true });

console.log("\n[release-pipeline] CycloneDX production SBOM");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lockText = fs.readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(lockText);
const bom = createCycloneDxBom({ pkg, lock, lockText, env: { SOURCE_DATE_EPOCH: "1700000000" } });
check("SBOM is CycloneDX 1.7 and complete", bom.bomFormat === "CycloneDX" && bom.specVersion === "1.7" && bom.compositions[0].aggregate === "complete");
check("SBOM contains runtime dependencies", bom.components.some((item) => item.name === "electron-updater") && bom.components.some((item) => item.name === "node-pty"));
check("SBOM excludes development-only dependencies", !bom.components.some((item) => item.name === "typescript") && !bom.components.some((item) => item.name === "electron-builder"));
check("SBOM has dependency graph and integrity hashes", bom.dependencies.length === bom.components.length + 1 && bom.components.some((item) => item.hashes?.[0]?.alg === "SHA-512"));

console.log("\n[release-pipeline] artifact metadata, checksums, and provenance");
check("Debian prerelease version preserves ordering semantics", debianPackageVersion("0.6.0-alpha.8") === "0.6.0~alpha.8" && debianPackageVersion("1.0.0") === "1.0.0");
const releaseTmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-release-artifacts-"));
const fakeVersion = "1.2.3-alpha.1";
const fakeDmg = `Hi Code-${fakeVersion}-mac-arm64.dmg`;
const fakeZip = `Hi Code-${fakeVersion}-mac-arm64.zip`;
fs.writeFileSync(path.join(releaseTmp, fakeDmg), Buffer.alloc(2048, 1));
fs.writeFileSync(path.join(releaseTmp, fakeZip), Buffer.alloc(2048, 2));
const fakeDigest = crypto.createHash("sha512").update(fs.readFileSync(path.join(releaseTmp, fakeZip))).digest("base64");
fs.writeFileSync(path.join(releaseTmp, "alpha-mac.yml"), `version: ${fakeVersion}\nfiles:\n  - url: ${fakeZip}\n    sha512: ${fakeDigest}\npath: ${fakeZip}\nsha512: ${fakeDigest}\n`);
const artifactSet = inspectReleaseArtifactSet({ releaseDir: releaseTmp, version: fakeVersion, platform: "darwin" });
check("package metadata references a matching SHA-512 artifact", artifactSet.packages.length === 2 && artifactSet.metadata.references.includes(fakeZip));
fs.writeFileSync(path.join(releaseTmp, `sbom-v${fakeVersion}.cdx.json`), "{}\n");
fs.writeFileSync(path.join(releaseTmp, `provenance-v${fakeVersion}.json`), "{}\n");
const checksums = writeChecksums({ releaseDir: releaseTmp, version: fakeVersion });
check("checksum manifest covers packages, metadata, SBOM, and provenance", checksums.artifacts.length === 5 && verifyChecksums({ releaseDir: releaseTmp, version: fakeVersion }).entries.length === 5);
fs.appendFileSync(path.join(releaseTmp, fakeDmg), "tampered");
assert.throws(() => verifyChecksums({ releaseDir: releaseTmp, version: fakeVersion }), /checksum mismatch/);
passed += 1;
console.log("✓ checksum verification rejects tampering");
const statement = createProvenanceStatement({
  version: fakeVersion,
  subjects: [{ name: fakeZip, digest: { sha256: "a".repeat(64) } }],
  sourceSha: "b".repeat(40),
  sourceTreeClean: false,
  lockDigest: "c".repeat(64),
  releaseManifest: { channel: "nightly", mode: "ci", signed: false, updateEnabled: false },
  env: { SOURCE_DATE_EPOCH: "1700000000" },
});
check("unsigned provenance is truthful and credential-free", statement.predicate.buildDefinition.externalParameters.artifactTrust === "unsigned"
  && statement.predicate.buildDefinition.internalParameters.credentialValuesRecorded === false
  && statement.predicate.buildDefinition.internalParameters.sourceTreeClean === false
  && statement.predicate.runDetails.metadata.invocationId === "local-unattested");
fs.rmSync(releaseTmp, { recursive: true, force: true });

console.log("\n[release-pipeline] repository integration");
const packageSource = fs.readFileSync("package.json", "utf8");
const preloadSource = fs.readFileSync("electron/preload.cjs", "utf8");
const rendererSource = fs.readFileSync("renderer/app/bootstrap.js", "utf8");
const packagingWorkflow = fs.readFileSync(".github/workflows/release-packaging.yml", "utf8");
const packageSmokeSource = fs.readFileSync("scripts/package-smoke.mjs", "utf8");
check("package config has all native platform targets", packageSource.includes('"dist:mac"') && packageSource.includes('"dist:win"') && packageSource.includes('"dist:linux"') && packageSource.includes('"AppImage"') && packageSource.includes('"deb"'));
check("NSIS lifecycle never auto-launches the installed app", pkg.build?.nsis?.runAfterFinish === false);
check("preload exposes bounded update lifecycle", preloadSource.includes('safeInvoke("app:update-status")') && preloadSource.includes('checkedInvoke("app:update-channel", channel, "channel")') && preloadSource.includes('safeInvoke("app:update-download")') && preloadSource.includes('safeInvoke("app:update-install")'));
check("renderer has real update actions", rendererSource.includes("downloadUpdateBtn.onclick") && rendererSource.includes("installUpdateBtn.onclick") && rendererSource.includes("updateChannelSelect.onchange"));
check("CI packages and smokes all three native platforms", ["ubuntu-latest", "macos-latest", "windows-latest"].every((value) => packagingWorkflow.includes(value))
  && ["dist:${{ matrix.target }}", "package-smoke.mjs", "release:sbom", "release:provenance", "release:verify-checksums"].every((value) => packagingWorkflow.includes(value)));
check("signed package smoke verifies platform signatures", packageSmokeSource.includes('runChecked("codesign"')
  && packageSmokeSource.includes('runChecked("xcrun", ["stapler", "validate"')
  && packageSmokeSource.includes("Get-AuthenticodeSignature"));
check("Windows package smoke waits for the complete NSIS process tree", packageSmokeSource.includes("Start-Process")
  && packageSmokeSource.includes("-PassThru -Wait")
  && packageSmokeSource.includes("HICODE_NSIS_ARGUMENT_LINE"));

console.log(`\n=== ${passed} passed, 0 failed ===`);
