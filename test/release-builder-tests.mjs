import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createReleaseService, registerReleaseIpc } from "../electron/services/release-service.mjs";
import { createIpcRegistrar } from "../electron/ipc/ipc-utils.mjs";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import { JobStore } from "../dist/job-center.js";
import { ReleaseBuilder } from "../dist/release-builder.js";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

function fakeIpcMain() {
  const handles = new Map();
  return {
    handles,
    handle(channel, fn) {
      handles.set(channel, fn);
    },
  };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeWorkspace(label, { failedGate = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hicode-release-${label}-`));
  write(path.join(root, "package.json"), JSON.stringify({ name: `release-${label}`, version: "1.0.0", scripts: { build: "node -e \"process.exit(0)\"" } }, null, 2));
  write(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  write(path.join(root, "electron", "main.mjs"), "console.log('main');\n");
  write(path.join(root, "renderer", "renderer.js"), "console.log('renderer');\n");
  write(path.join(root, "dist", "index.js"), "console.log('built');\n");
  write(path.join(root, "docs", "requirements.md"), "# Requirement\n");
  write(path.join(root, "docs", "architecture.md"), "# Architecture\n");
  write(path.join(root, "docs", "build-evidence.json"), JSON.stringify({ ok: true }));
  write(path.join(root, ".hicode", "artifacts", "bom.csv"), "part,qty\nshell,1\n");
  write(path.join(root, ".hicode", "artifacts", "cad", "metadata.json"), JSON.stringify({ generated: false, simulated: true }));
  const store = new IndustrialProjectStore({ workspacePath: root });
  store.createProject({
    projectId: `project-${label}`,
    name: `Release Project ${label}`,
    type: "industrial_release",
    domains: ["software", "cad", "documentation", "qa"],
    artifacts: [
      { id: "source", type: "source_code", name: "Source", path: "src/index.ts", domain: "software", status: "active" },
      { id: "req-doc", type: "requirement_doc", name: "Requirements", path: "docs/requirements.md", domain: "documentation", status: "approved" },
      { id: "bom", type: "bom", name: "BOM", path: ".hicode/artifacts/bom.csv", domain: "cad", status: "approved" },
      { id: "sim-cad", type: "cad_model", name: "CAD dry-run metadata", path: ".hicode/artifacts/cad/metadata.json", domain: "cad", status: "draft", metadata: { simulated: true, releaseSeverity: "warning" } },
    ],
    qualityGates: [
      { id: "gate-build", type: "build", name: "Build gate", status: failedGate ? "failed" : "passed", resultPath: "docs/build-evidence.json", message: failedGate ? "build failed" : "build ok" },
      { id: "gate-cad", type: "cad_validation", name: "CAD dry-run gate", status: "simulated", artifactIds: ["sim-cad"], message: "CAD adapter output is dry-run" },
    ],
    actor: "tester",
  });
  return root;
}

console.log("\n[release-builder] core package generation");
const workspace = makeWorkspace("core");
const builder = new ReleaseBuilder({ workspacePath: workspace, jobs: [] });
const readiness = builder.getReadiness({ version: "1.2.3" });
check("readiness allows simulated gate but records warning", readiness.ready === true && readiness.simulatedGates.length === 1 && readiness.warnings.some((item) => /simulated/i.test(item.message)), JSON.stringify(readiness));
const releasePackage = builder.buildRelease({ version: "1.2.3", createdBy: "tester" });
check("manifest is generated", fs.existsSync(releasePackage.manifestPath) && releasePackage.manifest.releaseId === releasePackage.releaseId && releasePackage.manifest.projectId === "project-core", JSON.stringify(releasePackage.manifest));
check("manifest contains required release fields", ["releaseId", "projectId", "version", "createdAt", "createdBy", "sourceCommit", "includedArtifacts", "gateResults", "approvals", "knownRisks", "checksums"].every((field) => field in releasePackage.manifest), JSON.stringify(releasePackage.manifest));
check("checksum manifest is generated", fs.existsSync(releasePackage.checksumPath) && fs.readFileSync(releasePackage.checksumPath, "utf8").includes("release-manifest.json"));
check("artifact copy includes project artifacts", fs.existsSync(path.join(releasePackage.releasePath, "artifacts", "project-artifacts")) && releasePackage.artifacts.some((artifact) => artifact.id === "bom" && artifact.packagePath), JSON.stringify(releasePackage.artifacts));
check("simulated gate is marked in release notes", /SIMULATED \/ DRY-RUN EVIDENCE/.test(fs.readFileSync(releasePackage.notesPath, "utf8")) && /CAD dry-run gate/.test(fs.readFileSync(releasePackage.notesPath, "utf8")));

console.log("\n[release-builder] blocking readiness");
const blockedWorkspace = makeWorkspace("blocked", { failedGate: true });
const blockedBuilder = new ReleaseBuilder({ workspacePath: blockedWorkspace, jobs: [] });
const blockedReadiness = blockedBuilder.getReadiness({ version: "9.9.9" });
check("failed gate blocks release", blockedReadiness.ready === false && blockedReadiness.blockers.some((item) => /Build gate/.test(item.message)), JSON.stringify(blockedReadiness));
const blockedBuild = (() => {
  try {
    blockedBuilder.buildRelease({ version: "9.9.9", createdBy: "tester" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
})();
check("build refuses failed gate", blockedBuild.ok === false && /release is not ready/.test(blockedBuild.error), JSON.stringify(blockedBuild));

console.log("\n[release-builder] service, Job Center, IPC");
const serviceWorkspace = makeWorkspace("service");
const jobStore = new JobStore({ storePath: path.join(serviceWorkspace, ".hicode", "jobs.json"), allowedArtifactRoots: [serviceWorkspace], idPrefix: "release-job" });
const shellCalls = [];
const service = createReleaseService({
  getCwd: () => serviceWorkspace,
  jobStore,
  shell: {
    showItemInFolder(file) {
      shellCalls.push(file);
    },
    openPath(file) {
      shellCalls.push(file);
    },
  },
});
const serviceReady = service.readiness({ version: "2.0.0" });
check("service returns readiness", serviceReady.ok === true && serviceReady.readiness.ready === true, JSON.stringify(serviceReady));
const serviceBuild = service.buildRelease({ version: "2.0.0", createdBy: "tester" });
check("service builds release package", serviceBuild.ok === true && fs.existsSync(serviceBuild.releasePackage.manifestPath), JSON.stringify(serviceBuild));
const serviceJob = jobStore.getJob(serviceBuild.jobId);
check("release package artifact writes to Job Center", serviceJob?.artifacts.some((artifact) => artifact.type === "release_package" && artifact.path.endsWith("release-manifest.json")), JSON.stringify(serviceJob?.artifacts));
check("release build writes Job events and gate result", serviceJob?.events.some((event) => event.type === "release.package.build.completed") && serviceJob?.gateResults.some((gate) => gate.gate === "release.readiness"), JSON.stringify(serviceJob));
const openResult = service.openRelease({ version: "2.0.0" });
check("service opens release folder safely", openResult.ok === true && shellCalls.some((file) => file.includes("release-manifest.json")), JSON.stringify({ openResult, shellCalls }));

const ipc = fakeIpcMain();
const register = createIpcRegistrar(ipc);
registerReleaseIpc({ register, release: service });
check("IPC exposes release:readiness", ipc.handles.has("release:readiness"));
check("IPC exposes release:build", ipc.handles.has("release:build"));
check("IPC exposes release:open", ipc.handles.has("release:open"));
const ipcReady = await ipc.handles.get("release:readiness")({}, { version: "2.0.1" });
check("IPC readiness calls real service path", ipcReady.ok === true && ipcReady.readiness.project.projectId === "project-service", JSON.stringify(ipcReady));

fs.rmSync(workspace, { recursive: true, force: true });
fs.rmSync(blockedWorkspace, { recursive: true, force: true });
fs.rmSync(serviceWorkspace, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
