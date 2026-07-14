#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inferReleaseChannel, updaterChannelName } from "../electron/services/release-policy.mjs";
import { validateEmbeddedReleaseManifest } from "../electron/services/update-service.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function stripYamlValue(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function sha512Base64(filePath) {
  return crypto.createHash("sha512").update(fs.readFileSync(filePath)).digest("base64");
}

function expectedExtensions(platform) {
  if (platform === "darwin") return [".dmg", ".zip"];
  if (platform === "win32") return [".exe", ".zip"];
  if (platform === "linux") return [".AppImage", ".deb"];
  throw new Error(`Unsupported package platform: ${platform}`);
}

function metadataSuffix(platform) {
  return platform === "darwin" ? "-mac.yml" : platform === "linux" ? "-linux.yml" : ".yml";
}

export function debianPackageVersion(version) {
  const normalized = String(version || "").trim();
  const prerelease = normalized.indexOf("-");
  return prerelease < 0
    ? normalized
    : `${normalized.slice(0, prerelease)}~${normalized.slice(prerelease + 1)}`;
}

export function inspectReleaseArtifactSet({ releaseDir, version, platform }) {
  const files = fs.readdirSync(releaseDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  const packages = [];
  for (const extension of expectedExtensions(platform)) {
    const matches = files.filter((name) => name.includes(version) && name.endsWith(extension));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${platform} ${extension} artifact for ${version}; found ${matches.length}`);
    const filePath = path.join(releaseDir, matches[0]);
    const size = fs.statSync(filePath).size;
    if (size < 1024) throw new Error(`Release artifact is empty or truncated: ${matches[0]}`);
    packages.push({ name: matches[0], path: filePath, size });
  }

  const channel = updaterChannelName(inferReleaseChannel(version));
  const expectedMetadata = `${channel}${metadataSuffix(platform)}`;
  const metadataPath = path.join(releaseDir, expectedMetadata);
  if (!fs.existsSync(metadataPath)) throw new Error(`Update metadata is missing: ${expectedMetadata}`);
  const metadata = fs.readFileSync(metadataPath, "utf8");
  if (!new RegExp(`^version:\\s*${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(metadata)) {
    throw new Error(`Update metadata version mismatch: ${expectedMetadata}`);
  }
  const referenced = [...metadata.matchAll(/^\s*(?:url|path):\s*(.+?)\s*$/gm)].map((match) => stripYamlValue(match[1]));
  const hashes = [...metadata.matchAll(/^\s*sha512:\s*(.+?)\s*$/gm)].map((match) => stripYamlValue(match[1]));
  const localReferences = referenced.filter((name) => fs.existsSync(path.join(releaseDir, name)));
  if (!localReferences.length) throw new Error(`Update metadata does not reference a local package: ${expectedMetadata}`);
  if (!localReferences.some((name) => hashes.includes(sha512Base64(path.join(releaseDir, name))))) {
    throw new Error(`Update metadata SHA-512 does not match a referenced package: ${expectedMetadata}`);
  }
  return { packages, metadata: { name: expectedMetadata, path: metadataPath, references: localReferences } };
}

function minimalSmokeEnv() {
  const env = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP", "SystemRoot", "LANG", "LC_ALL"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.HICODE_PACKAGE_SMOKE = "1";
  return env;
}

function runChecked(command, args, options = {}) {
  const {
    label = command,
    timeout = 180_000,
    ...spawnOptions
  } = options;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    env: minimalSmokeEnv(),
    ...spawnOptions,
  });
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT"
      ? `timed out after ${timeout}ms`
      : result.error.message;
    throw new Error(`${label} failed: ${detail}`, { cause: result.error });
  }
  if (result.status !== 0) throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(-1200)}`);
  return result;
}

function runWindowsProcessTree(command, args, label) {
  const env = {
    ...minimalSmokeEnv(),
    HICODE_NSIS_TARGET: command,
    HICODE_NSIS_ARGUMENT_LINE: args.join(" "),
  };
  const script = [
    "$process = Start-Process -FilePath $env:HICODE_NSIS_TARGET -ArgumentList $env:HICODE_NSIS_ARGUMENT_LINE -PassThru -Wait;",
    "if ($null -eq $process.ExitCode) { exit 1 };",
    "exit $process.ExitCode",
  ].join(" ");
  return runChecked("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], {
    env,
    label,
    timeout: 300_000,
  });
}

const sleepSignal = new Int32Array(new SharedArrayBuffer(4));

function sleep(milliseconds) {
  Atomics.wait(sleepSignal, 0, 0, milliseconds);
}

function waitForPathsMissing(paths, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let remaining = paths.filter((target) => fs.existsSync(target));
  while (remaining.length && Date.now() < deadline) {
    sleep(250);
    remaining = remaining.filter((target) => fs.existsSync(target));
  }
  if (remaining.length) {
    throw new Error(`NSIS uninstall left installed files behind: ${remaining.map((target) => path.basename(target)).join(", ")}`);
  }
}

function removeTemporaryTree(root, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code)) throw error;
      lastError = error;
      sleep(250);
    }
  }
  throw lastError || new Error(`Timed out cleaning temporary package tree: ${root}`);
}

function findNamed(root, name, { directory = false } = {}) {
  const queue = [root];
  let visited = 0;
  while (queue.length && visited < 20_000) {
    const current = queue.shift();
    visited += 1;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.name === name && (directory ? entry.isDirectory() : entry.isFile())) return absolute;
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(absolute);
    }
  }
  return null;
}

function inspectResources(resourcesPath, version) {
  const asarPath = path.join(resourcesPath, "app.asar");
  if (!fs.existsSync(asarPath) || fs.statSync(asarPath).size < 100_000) throw new Error(`Packaged app.asar is missing or empty: ${asarPath}`);
  const manifestPath = path.join(resourcesPath, "release-channel.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Embedded release manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const checked = validateEmbeddedReleaseManifest(manifest, version);
  if (!checked.ok) throw new Error(`Embedded release manifest is invalid: ${checked.reason}`);
  if (manifest.mode !== "ci" && manifest.mode !== "development" && manifest.mode !== "release") throw new Error("Embedded release mode is invalid");
  if (manifest.mode !== "release" && (manifest.updateEnabled || manifest.artifactTrust !== "unsigned")) {
    throw new Error("Unsigned development/CI package incorrectly claims trusted updates");
  }
  const ptyPath = findNamed(path.join(resourcesPath, "app.asar.unpacked"), "pty.node");
  if (!ptyPath || fs.statSync(ptyPath).size < 20_000) throw new Error("Packaged node-pty binary is missing");
  return { asarPath, manifestPath, manifest, ptyPath };
}

function verifyMacTrust(appPath, manifest) {
  if (manifest.signed !== true) return;
  runChecked("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  if (manifest.notarized === true) runChecked("xcrun", ["stapler", "validate", appPath]);
}

function verifyWindowsTrust(filePath, manifest) {
  if (manifest.signed !== true) return;
  const signatureEnv = { ...minimalSmokeEnv(), HICODE_SIGNATURE_TARGET: filePath };
  runChecked("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:HICODE_SIGNATURE_TARGET; if ($signature.Status -ne 'Valid') { Write-Error ('Invalid Authenticode signature: ' + $signature.Status); exit 1 }",
  ], { env: signatureEnv });
}

function smokeMac(dmgPath, version) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-dmg-smoke-"));
  const mountPoint = path.join(temporary, "mount");
  fs.mkdirSync(mountPoint);
  let attached = false;
  try {
    runChecked("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);
    attached = true;
    const appPath = findNamed(mountPoint, "Hi Code.app", { directory: true });
    if (!appPath) throw new Error("DMG does not contain Hi Code.app");
    const resources = path.join(appPath, "Contents", "Resources");
    const inspected = inspectResources(resources, version);
    verifyMacTrust(appPath, inspected.manifest);
    const plist = path.join(appPath, "Contents", "Info.plist");
    const versionResult = runChecked("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]);
    if (versionResult.stdout.trim() !== version) throw new Error(`DMG app version mismatch: ${versionResult.stdout.trim()}`);
    return inspected;
  } finally {
    if (attached) spawnSync("hdiutil", ["detach", mountPoint, "-force"], { encoding: "utf8", env: minimalSmokeEnv() });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function smokeWindows(installerPath, version) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-nsis-smoke-"));
  const installDir = path.join(temporary, "installed");
  let inspected = null;
  let primaryError = null;
  try {
    console.log("[package-smoke] Windows NSIS silent install");
    runWindowsProcessTree(installerPath, ["/S", `/D=${installDir}`], "NSIS silent install process tree");
    const executable = findNamed(installDir, "Hi Code.exe");
    if (!executable) throw new Error("NSIS smoke install did not create Hi Code.exe");
    console.log("[package-smoke] Windows installed artifact inspection");
    inspected = inspectResources(path.join(path.dirname(executable), "resources"), version);
    verifyWindowsTrust(installerPath, inspected.manifest);
    verifyWindowsTrust(executable, inspected.manifest);
    const uninstaller = findNamed(installDir, "Uninstall Hi Code.exe");
    if (!uninstaller) throw new Error("NSIS smoke install did not create an uninstaller");
    console.log("[package-smoke] Windows NSIS silent uninstall");
    runWindowsProcessTree(uninstaller, ["/S"], "NSIS silent uninstall process tree");
    waitForPathsMissing([executable, inspected.asarPath, uninstaller]);
    console.log("[package-smoke] Windows NSIS lifecycle complete");
  } catch (error) {
    primaryError = error;
  }

  try {
    removeTemporaryTree(temporary);
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError;
    throw new Error(`${primaryError.message}; cleanup also failed: ${cleanupError.message}`, {
      cause: primaryError,
    });
  }
  if (primaryError) throw primaryError;
  return inspected;
}

function smokeLinux(appImagePath, debPath, version) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-linux-smoke-"));
  try {
    fs.chmodSync(appImagePath, 0o755);
    runChecked(appImagePath, ["--appimage-extract"], { cwd: temporary });
    const appImageAsar = findNamed(path.join(temporary, "squashfs-root"), "app.asar");
    if (!appImageAsar) throw new Error("AppImage extraction is missing app.asar");
    const appImageResources = path.dirname(appImageAsar);
    const inspected = inspectResources(appImageResources, version);
    const debRoot = path.join(temporary, "deb-root");
    fs.mkdirSync(debRoot);
    runChecked("dpkg-deb", ["--extract", debPath, debRoot]);
    const debAsar = findNamed(debRoot, "app.asar");
    if (!debAsar) throw new Error("DEB extraction is missing app.asar");
    const debResources = path.dirname(debAsar);
    inspectResources(debResources, version);
    const debVersion = runChecked("dpkg-deb", ["--field", debPath, "Version"]).stdout.trim();
    const expectedDebVersion = debianPackageVersion(version);
    if (debVersion !== expectedDebVersion) {
      throw new Error(`DEB version mismatch: expected ${expectedDebVersion}, got ${debVersion}`);
    }
    return inspected;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function runPackageSmoke({ root = defaultRoot, platform = process.platform, lifecycle = true } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releaseDir = path.join(root, "release");
  const inspected = inspectReleaseArtifactSet({ releaseDir, version: pkg.version, platform });
  let lifecycleResult = null;
  if (lifecycle) {
    if (platform === "darwin") lifecycleResult = smokeMac(inspected.packages.find((item) => item.name.endsWith(".dmg")).path, pkg.version);
    else if (platform === "win32") lifecycleResult = smokeWindows(inspected.packages.find((item) => item.name.endsWith(".exe")).path, pkg.version);
    else lifecycleResult = smokeLinux(
      inspected.packages.find((item) => item.name.endsWith(".AppImage")).path,
      inspected.packages.find((item) => item.name.endsWith(".deb")).path,
      pkg.version,
    );
  }
  return { platform, version: pkg.version, ...inspected, lifecycle: lifecycleResult ? "passed" : "not_run" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const platformArg = process.argv.find((value) => value.startsWith("--platform="));
  try {
    const result = runPackageSmoke({
      platform: platformArg?.split("=")[1] || process.platform,
      lifecycle: !process.argv.includes("--metadata-only"),
    });
    console.log(`[package-smoke] ${result.platform} ${result.version}: ${result.packages.map((item) => item.name).join(", ")}; lifecycle=${result.lifecycle}`);
  } catch (error) {
    console.error(`[package-smoke] ${error.message}`);
    process.exitCode = 1;
  }
}
