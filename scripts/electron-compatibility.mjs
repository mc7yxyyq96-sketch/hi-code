#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

export const ELECTRON_COMPATIBILITY_TARGET = Object.freeze({
  electron: "43.1.0",
  electronMajor: 43,
  chromiumMajor: 150,
  embeddedNodeMajor: 24,
  electronBuilder: "26.15.3",
  minimumHostNode: "22.12.0",
  supportedStableMajorsAtDecision: Object.freeze([41, 42, 43]),
});

export const APPROVED_NATIVE_PRODUCTION_DEPENDENCIES = Object.freeze([
  Object.freeze({ name: "node-pty", version: "1.2.0-beta.12", signals: Object.freeze(["install-script"]) }),
]);

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? lockPath : lockPath.slice(index + marker.length);
}

export function collectNativeProductionDependencies(lockfile) {
  const native = [];
  for (const [lockPath, metadata] of Object.entries(lockfile?.packages || {})) {
    if (!lockPath || !metadata || metadata.dev === true) continue;
    const signals = [];
    if (metadata.gypfile === true) signals.push("gypfile");
    if (metadata.hasInstallScript === true) signals.push("install-script");
    if (!signals.length) continue;
    native.push({
      name: packageNameFromLockPath(lockPath),
      version: metadata.version || "unknown",
      lockPath,
      signals,
    });
  }
  return native.sort((a, b) => a.lockPath.localeCompare(b.lockPath));
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

export function inspectElectronCompatibility(root = defaultRoot) {
  const pkg = readJson(root, "package.json");
  const lock = readJson(root, "package-lock.json");
  const installedElectron = readJson(root, "node_modules/electron/package.json");
  const installedBuilder = readJson(root, "node_modules/electron-builder/package.json");
  const installedNpm = readJson(root, "node_modules/npm/package.json");
  const installedPty = readJson(root, "node_modules/node-pty/package.json");
  const mainSource = fs.readFileSync(path.join(root, "electron", "main.mjs"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const ciEvidence = readJson(root, "reports/evidence/HC-PLAT-110/ci-matrix.json");
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  const lockRoot = lock.packages?.[""] || {};
  const nativeProductionDependencies = collectNativeProductionDependencies(lock);

  check("electron-package-pin", pkg.devDependencies?.electron === ELECTRON_COMPATIBILITY_TARGET.electron, pkg.devDependencies?.electron);
  check("electron-lock-pin", lockRoot.devDependencies?.electron === ELECTRON_COMPATIBILITY_TARGET.electron && lock.packages?.["node_modules/electron"]?.version === ELECTRON_COMPATIBILITY_TARGET.electron, lock.packages?.["node_modules/electron"]?.version);
  check("electron-installed-version", installedElectron.version === ELECTRON_COMPATIBILITY_TARGET.electron, installedElectron.version);
  check("builder-package-pin", pkg.devDependencies?.["electron-builder"] === ELECTRON_COMPATIBILITY_TARGET.electronBuilder, pkg.devDependencies?.["electron-builder"]);
  check("builder-lock-pin", lockRoot.devDependencies?.["electron-builder"] === ELECTRON_COMPATIBILITY_TARGET.electronBuilder && lock.packages?.["node_modules/electron-builder"]?.version === ELECTRON_COMPATIBILITY_TARGET.electronBuilder, lock.packages?.["node_modules/electron-builder"]?.version);
  check("builder-installed-version", installedBuilder.version === ELECTRON_COMPATIBILITY_TARGET.electronBuilder, installedBuilder.version);
  check("builder-npm-tool-pin", pkg.devDependencies?.npm === "11.9.0" && lockRoot.devDependencies?.npm === "11.9.0" && installedNpm.version === "11.9.0", installedNpm.version);
  check("builder-wrapper", ["dist:mac", "dist:win", "dist:all"].every((name) => pkg.scripts?.[name]?.includes("scripts/run-electron-builder.mjs")), "distribution scripts must not depend on a global npm executable");
  check("host-node-contract", pkg.engines?.node === `>=${ELECTRON_COMPATIBILITY_TARGET.minimumHostNode}`, pkg.engines?.node);
  check("supported-major-record", ELECTRON_COMPATIBILITY_TARGET.supportedStableMajorsAtDecision.includes(ELECTRON_COMPATIBILITY_TARGET.electronMajor), ELECTRON_COMPATIBILITY_TARGET.supportedStableMajorsAtDecision.join(","));
  check("context-isolation", /contextIsolation:\s*true/.test(mainSource), "contextIsolation must remain true");
  check("node-integration", /nodeIntegration:\s*false/.test(mainSource), "nodeIntegration must remain false");
  check("renderer-sandbox", /sandbox:\s*true/.test(mainSource), "sandbox must remain true");
  check("window-open-guard", mainSource.includes("setWindowOpenHandler") && mainSource.includes('action: "deny"'), "new renderer windows must be denied");
  check("navigation-guard", mainSource.includes('webContents.on("will-navigate"') && mainSource.includes("event.preventDefault()"), "untrusted renderer navigation must be blocked");
  const approvedNative = nativeProductionDependencies.map(({ name, version, signals }) => ({ name, version, signals }));
  check("native-production-inventory", JSON.stringify(approvedNative) === JSON.stringify(APPROVED_NATIVE_PRODUCTION_DEPENDENCIES), approvedNative.map((entry) => `${entry.name}@${entry.version}`).join(", ") || "none");
  check("node-pty-package-pin", pkg.dependencies?.["node-pty"] === "1.2.0-beta.12" && lockRoot.dependencies?.["node-pty"] === "1.2.0-beta.12" && installedPty.version === "1.2.0-beta.12", installedPty.version);
  check("node-pty-asar-unpack", Array.isArray(pkg.build?.asarUnpack) && pkg.build.asarUnpack.includes("node_modules/node-pty/**/*"), JSON.stringify(pkg.build?.asarUnpack || []));
  const hostPrebuildDir = path.join(root, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`);
  const hostPtyBinary = path.join(hostPrebuildDir, "pty.node");
  const hostSpawnHelper = path.join(hostPrebuildDir, "spawn-helper");
  const hostPrebuildReady = fs.existsSync(hostPtyBinary)
    && (process.platform !== "darwin" || (fs.existsSync(hostSpawnHelper) && Boolean(fs.statSync(hostSpawnHelper).mode & 0o111)));
  check("node-pty-host-prebuild", hostPrebuildReady, hostPrebuildDir);
  check("three-platform-ci-matrix", /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/.test(workflow), "Ubuntu, macOS, and Windows are required");
  check("stacked-pr-ci", /pull_request:\s*\{\}/.test(workflow), "CI must validate pull requests targeting task branches as well as main");
  check("linux-xvfb-smoke", workflow.includes("xvfb-run -a npm run test:electron-e2e"), "Linux Electron smoke requires Xvfb");
  check("native-desktop-smoke", workflow.includes("if: runner.os != 'Linux'") && workflow.includes("run: npm run test:electron-e2e"), "macOS and Windows must launch Electron directly");
  const requiredSmokeJobs = ["ubuntu-latest", "macos-latest", "windows-latest"];
  check("ci-evidence-run", ciEvidence.status === "completed" && ciEvidence.conclusion === "success" && /^[0-9a-f]{40}$/.test(ciEvidence.headSha || ""), ciEvidence.url || "missing run URL");
  check("ci-evidence-platforms", requiredSmokeJobs.every((platform) => ciEvidence.jobs?.some((job) => job.platform === platform && job.name === `Electron smoke (${platform})` && job.conclusion === "success" && job.artifactUpload === "success")), requiredSmokeJobs.join(","));

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    target: ELECTRON_COMPATIBILITY_TARGET,
    allPassed: checks.every((entry) => entry.passed),
    checks,
    nativeProductionDependencies,
    ciEvidence: {
      runId: ciEvidence.runId,
      headSha: ciEvidence.headSha,
      url: ciEvidence.url,
    },
  };
}

function printReport(report) {
  console.log("\n[electron-compatibility] supported runtime contract");
  for (const entry of report.checks) {
    console.log(`  ${entry.passed ? "✓" : "✗"} ${entry.id}${entry.detail ? ` — ${entry.detail}` : ""}`);
  }
  console.log(`\n=== ${report.checks.filter((entry) => entry.passed).length} passed, ${report.checks.filter((entry) => !entry.passed).length} failed ===`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const report = inspectElectronCompatibility();
  printReport(report);
  process.exit(report.allPassed ? 0 : 1);
}
