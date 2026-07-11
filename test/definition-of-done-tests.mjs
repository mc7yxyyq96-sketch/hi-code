import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPatchArenaService } from "../electron/services/patch-arena-service.mjs";
import { detectSkeleton, runDefinitionOfDone } from "../dist/definition-of-done.js";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import { JobStore } from "../dist/job-center.js";
import { PatchArenaStore } from "../dist/patch-arena.js";
import { ReleaseBuilder } from "../dist/release-builder.js";
import { WorktreeRunner } from "../dist/worktree-runner.js";

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

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function findingTypes(result) {
  return new Set((result.findings || []).map((finding) => finding.type));
}

console.log("\n[definition-of-done] skeleton detector rules");
const fullTreeScanner = fs.readFileSync(path.join(process.cwd(), "scripts", "scan-dod.mjs"), "utf8");
check(
  "full-tree scan excludes only the ignored derived renderer bundle while retaining first-party renderer source",
  fullTreeScanner.includes('const derivedRoots = new Set(["renderer/generated"])')
    && fullTreeScanner.includes('const includeRoots = ["package.json", "electron", "renderer", "src", "docs", "reports", "scripts", "test"]')
    && !fullTreeScanner.includes('derivedRoots = new Set(["renderer"]'),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-dod-"));
const detectorWorkspace = path.join(tmp, "detector");
fs.mkdirSync(detectorWorkspace, { recursive: true });
write(path.join(detectorWorkspace, "src", "empty.js"), "");
write(path.join(detectorWorkspace, "src", "todo.js"), "// TODO\n");
write(path.join(detectorWorkspace, "src", "placeholder.js"), "export function planned() { return null; } // placeholder\n");
write(path.join(detectorWorkspace, "src", "mock-only.js"), "export function run() { return 'mock-only production path'; }\n");
write(path.join(detectorWorkspace, "src", "types.ts"), "interface OnlyTypes { value: string }\n");
write(path.join(detectorWorkspace, "renderer", "index.html"), "<button id=\"shipFakeButton\">Ship</button>\n");

const detectorResult = detectSkeleton({
  workspacePath: detectorWorkspace,
  changedFiles: [
    "src/empty.js",
    "src/todo.js",
    "src/placeholder.js",
    "src/mock-only.js",
    "src/types.ts",
    "renderer/index.html",
  ],
});
const types = findingTypes(detectorResult);
check("detects empty files", types.has("empty_file"), JSON.stringify(detectorResult.findings));
check("detects TODO-only files", types.has("todo_only_file"), JSON.stringify(detectorResult.findings));
check("detects placeholder production content", types.has("placeholder_content"), JSON.stringify(detectorResult.findings));
check("detects mock-only production path", types.has("mock_only_production_path"), JSON.stringify(detectorResult.findings));
check("detects interface-only files", types.has("interface_only_file"), JSON.stringify(detectorResult.findings));
check("detects UI button without behavior", types.has("ui_button_without_behavior"), JSON.stringify(detectorResult.findings));
check("blocking skeleton findings fail detector", detectorResult.ok === false && detectorResult.summary.blocking >= 4, JSON.stringify(detectorResult.summary));

console.log("\n[definition-of-done] project artifact and gate integrity");
const projectWorkspace = path.join(tmp, "project");
fs.mkdirSync(projectWorkspace, { recursive: true });
write(path.join(projectWorkspace, "package.json"), JSON.stringify({ name: "dod-project", scripts: { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" } }, null, 2));
write(path.join(projectWorkspace, "src", "index.ts"), "export function main() { try { return 'ok'; } catch (error) { throw new Error(String(error)); } }\n");
write(path.join(projectWorkspace, "docs", "requirements.md"), "# Requirements\n");
write(path.join(projectWorkspace, "docs", "evidence.json"), JSON.stringify({ ok: true }));
write(path.join(projectWorkspace, ".hicode", "artifacts", "simulated.json"), JSON.stringify({ simulated: true }));
const projectStore = new IndustrialProjectStore({ workspacePath: projectWorkspace });
const project = projectStore.createProject({
  projectId: "dod-project",
  name: "DoD Project",
  type: "industrial_release",
  domains: ["software", "cad", "documentation", "qa"],
  artifacts: [
    { id: "source", type: "source_code", name: "Source", path: "src/index.ts", domain: "software", status: "active" },
    { id: "req", type: "requirement_doc", name: "Requirements", path: "docs/requirements.md", domain: "documentation", status: "approved" },
    { id: "sim", type: "cad_model", name: "Simulated CAD", path: ".hicode/artifacts/simulated.json", domain: "cad", status: "released", metadata: { simulated: true, real: true } },
  ],
  qualityGates: [
    { id: "gate-build", type: "build", name: "Build gate", status: "passed", resultPath: "docs/evidence.json", message: "build ok" },
    { id: "gate-fake", type: "cad_validation", name: "Fake CAD pass", status: "passed", resultPath: "docs/evidence.json", message: "dry-run simulated output" },
  ],
  actor: "tester",
});
const projectDetection = detectSkeleton({ workspacePath: projectWorkspace, project });
const projectTypes = findingTypes(projectDetection);
check("detects simulated artifact marked real", projectTypes.has("simulated_artifact_marked_real"), JSON.stringify(projectDetection.findings));
check("detects fake pass gates", projectTypes.has("fake_pass_gate"), JSON.stringify(projectDetection.findings));

const dod = runDefinitionOfDone({
  workspacePath: projectWorkspace,
  project,
  source: "test",
  evidenceName: "dod-evidence.json",
  persistEvidence: true,
});
check("DoD writes durable evidence", fs.existsSync(path.join(projectWorkspace, dod.evidencePath || "")) && dod.checklist.some((item) => item.id === "no_skeleton"), JSON.stringify(dod));
check("DoD fails simulated-as-real project", dod.ok === false && dod.skeleton.summary.blocking >= 2, JSON.stringify(dod.summary));

console.log("\n[definition-of-done] release blocking");
const releaseWorkspace = path.join(tmp, "release-block");
fs.mkdirSync(releaseWorkspace, { recursive: true });
write(path.join(releaseWorkspace, "package.json"), JSON.stringify({ name: "release-block", version: "1.0.0", scripts: { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" } }, null, 2));
write(path.join(releaseWorkspace, "src", "empty.js"), "");
write(path.join(releaseWorkspace, "docs", "evidence.json"), JSON.stringify({ ok: true }));
const releaseStore = new IndustrialProjectStore({ workspacePath: releaseWorkspace });
releaseStore.createProject({
  projectId: "release-block",
  name: "Release Block",
  type: "industrial_release",
  domains: ["software", "qa"],
  artifacts: [{ id: "source", type: "source_code", name: "Empty source", path: "src/empty.js", domain: "software", status: "active" }],
  qualityGates: [{ id: "gate-build", type: "build", name: "Build gate", status: "passed", resultPath: "docs/evidence.json", message: "build ok" }],
  actor: "tester",
});
const releaseBuilder = new ReleaseBuilder({ workspacePath: releaseWorkspace, jobs: [] });
const releaseReadiness = releaseBuilder.getReadiness({ version: "1.0.0" });
check("failed detector blocks release readiness", releaseReadiness.ready === false && releaseReadiness.blockers.some((item) => /Definition of Done|Skeleton/.test(item.title)), JSON.stringify(releaseReadiness.blockers));
const blockedBuild = (() => {
  try {
    releaseBuilder.buildRelease({ version: "1.0.0", createdBy: "tester" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
})();
check("failed detector blocks release build", blockedBuild.ok === false && /release is not ready/.test(blockedBuild.error), JSON.stringify(blockedBuild));

console.log("\n[definition-of-done] Patch Arena candidate skeleton risk");
const repo = path.join(tmp, "arena-repo");
fs.mkdirSync(repo, { recursive: true });
git(repo, ["init"]);
git(repo, ["config", "user.email", "test@example.com"]);
git(repo, ["config", "user.name", "Hi Code Test"]);
write(path.join(repo, "index.js"), "export const value = 1;\n");
git(repo, ["add", "."]);
git(repo, ["commit", "-m", "initial"]);
const jobStore = new JobStore({ storePath: path.join(tmp, "jobs.json"), allowedArtifactRoots: [tmp], idPrefix: "dod-job" });
const arenaStore = new PatchArenaStore({ storePath: path.join(tmp, "arena-runs.json"), idPrefix: "dod-arena" });
const arena = createPatchArenaService({
  arenaStore,
  jobStore,
  worktreeRunner: new WorktreeRunner({ safeRoot: path.join(tmp, "worktrees"), idPrefix: "dod" }),
  getCwd: () => repo,
  artifactRoot: path.join(tmp, "arena-artifacts"),
  providerService: {
    listProviders: () => ({ ok: true, providers: [{ id: "hicode-internal", name: "Hi Code Internal", status: "enabled" }] }),
    getProvider: () => ({ ok: true, provider: { id: "hicode-internal", name: "Hi Code Internal" } }),
  },
});
const arenaResult = arena.runArena({
  task: "create a skeleton-only implementation",
  providerIds: ["hicode-internal"],
  command: "mkdir -p src && printf '// TODO\\n' > src/todo.js",
});
const arenaRun = arenaStore.getRun(arenaResult.run?.id || "");
const arenaCandidate = arenaRun?.candidates?.[0];
check("Patch Arena skeleton candidate is failed", arenaResult.ok === false && arenaCandidate?.status === "failed", JSON.stringify(arenaResult));
check("Patch Arena candidate records skeleton risk", arenaCandidate?.metadata?.definitionOfDone?.skeleton?.summary?.blocking > 0 && arenaCandidate?.riskNotes?.some((note) => /todo_only_file|skeleton/i.test(note)), JSON.stringify(arenaCandidate?.metadata));
check("Patch Arena writes skeleton evidence artifact", arenaCandidate?.artifacts?.some((artifact) => artifact.name === "definition-of-done.json"), JSON.stringify(arenaCandidate?.artifacts));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
