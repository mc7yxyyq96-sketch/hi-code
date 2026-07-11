import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  collectProductionVersions,
  findBlockingAdvisories,
  normalizeAdvisories,
  resolveRegistry,
} from "../scripts/audit-production.mjs";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    fail++;
  }
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const root = process.cwd();
const requiredFiles = [
  "docs/program/PROGRAM.md",
  "docs/program/ARCHITECTURE.md",
  "docs/adr/README.md",
  "docs/adr/ADR-0001-program-control-and-evidence.md",
  "docs/adr/ADR-0002-runtime-protocol-authority-migration.md",
  "docs/adr/ADR-0003-typed-runtime-stores-and-idempotent-replay.md",
  "docs/adr/ADR-0004-turn-state-and-conservative-recovery.md",
  "docs/adr/ADR-0005-supported-electron-line.md",
  "docs/adr/ADR-0006-model-provider-adapter-v2.md",
  "docs/model-provider-adapters.md",
  "docs/electron-compatibility.md",
  "docs/runtime-stores.md",
  "planning/backlog.json",
  "planning/release-board.json",
  "reports/program/status.md",
  "reports/program/risks.json",
  "reports/tasks/HC-PROG-100.md",
  "reports/tasks/HC-QA-101.md",
  "reports/tasks/HC-RUN-201.md",
  "reports/tasks/HC-RUN-202.md",
  "reports/tasks/HC-RUN-203.md",
  "reports/tasks/HC-PLAT-110.md",
  "reports/tasks/HC-REL-ALPHA-8.md",
  "reports/tasks/HC-PROV-210.md",
  "reports/tasks/HC-PROV-211.md",
  "reports/tasks/HC-REL-ALPHA-7.md",
  "reports/evidence/baseline/manifest.json",
  "reports/evidence/HC-QA-101/manifest.json",
  "reports/evidence/HC-RUN-201/manifest.json",
  "reports/evidence/HC-RUN-202/manifest.json",
  "reports/evidence/HC-RUN-203/manifest.json",
  "reports/evidence/HC-REL-ALPHA-7/manifest.json",
  "reports/evidence/HC-PLAT-110/ci-matrix.json",
  "reports/evidence/HC-PLAT-110/manifest.json",
  "reports/evidence/HC-REL-ALPHA-8/manifest.json",
  "reports/evidence/HC-PROV-210/manifest.json",
  "scripts/electron-compatibility.mjs",
  "scripts/run-electron-builder.mjs",
  "test/electron-compatibility-tests.mjs",
  "reports/releases/0.6.0-alpha.7/capability-matrix.md",
  "reports/releases/0.6.0-alpha.7/migration-report.md",
  "reports/releases/0.6.0-alpha.7/security-report.md",
  "reports/releases/0.6.0-alpha.7/e2e-report.md",
  "reports/releases/0.6.0-alpha.7/known-limitations.md",
  "reports/releases/0.6.0-alpha.7/release-evidence.md",
  "reports/releases/0.6.0-alpha.8/capability-matrix.md",
  "reports/releases/0.6.0-alpha.8/migration-report.md",
  "reports/releases/0.6.0-alpha.8/security-report.md",
  "reports/releases/0.6.0-alpha.8/e2e-report.md",
  "reports/releases/0.6.0-alpha.8/known-limitations.md",
  "reports/releases/0.6.0-alpha.8/release-evidence.md",
];

console.log("\n[program-control] required artifacts");
for (const relative of requiredFiles) {
  check(`${relative} exists and is non-empty`, fs.existsSync(path.join(root, relative)) && fs.statSync(path.join(root, relative)).size > 0);
}

const backlog = readJson(root, "planning/backlog.json");
const board = readJson(root, "planning/release-board.json");
const risks = readJson(root, "reports/program/risks.json");
const manifest = readJson(root, "reports/evidence/baseline/manifest.json");
const qaManifest = readJson(root, "reports/evidence/HC-QA-101/manifest.json");
const runtimeManifest = readJson(root, "reports/evidence/HC-RUN-201/manifest.json");
const runtimeStoreManifest = readJson(root, "reports/evidence/HC-RUN-202/manifest.json");
const turnRecoveryManifest = readJson(root, "reports/evidence/HC-RUN-203/manifest.json");
const platformManifest = readJson(root, "reports/evidence/HC-PLAT-110/manifest.json");
const platformCiEvidence = readJson(root, "reports/evidence/HC-PLAT-110/ci-matrix.json");
const releaseManifest = readJson(root, "reports/evidence/HC-REL-ALPHA-7/manifest.json");
const alpha8ReleaseManifest = readJson(root, "reports/evidence/HC-REL-ALPHA-8/manifest.json");
const modelProviderManifest = readJson(root, "reports/evidence/HC-PROV-210/manifest.json");
const packageJson = readJson(root, "package.json");
const packageLock = readJson(root, "package-lock.json");
const programTask = backlog.tasks.find((task) => task.id === "HC-PROG-100");
const runtimeBacklogTask = backlog.tasks.find((task) => task.id === "HC-RUN-201");
const nextRuntimeTask = backlog.tasks.find((task) => task.id === "HC-RUN-202");
const recoveryRuntimeTask = backlog.tasks.find((task) => task.id === "HC-RUN-203");
const platformTask = backlog.tasks.find((task) => task.id === "HC-PLAT-110");
const alpha8ReleaseTask = backlog.tasks.find((task) => task.id === "HC-REL-ALPHA-8");
const modelProviderTask = backlog.tasks.find((task) => task.id === "HC-PROV-210");
const openAIResponsesTask = backlog.tasks.find((task) => task.id === "HC-PROV-211");
const uiShellTask = backlog.tasks.find((task) => task.id === "HC-UI-301");
const qaTask = board.tasks.find((task) => task.id === "HC-QA-101");
const runtimeTask = board.tasks.find((task) => task.id === "HC-RUN-201");
const runtimeStoreTask = board.tasks.find((task) => task.id === "HC-RUN-202");
const turnRecoveryTask = board.tasks.find((task) => task.id === "HC-RUN-203");
const platformBoardTask = board.tasks.find((task) => task.id === "HC-PLAT-110");
const alpha8ReleaseBoardTask = board.tasks.find((task) => task.id === "HC-REL-ALPHA-8");
const modelProviderBoardTask = board.tasks.find((task) => task.id === "HC-PROV-210");
const openAIResponsesBoardTask = board.tasks.find((task) => task.id === "HC-PROV-211");

console.log("\n[program-control] board and evidence contract");
check("backlog records immutable source commit", /^[0-9a-f]{40}$/.test(backlog.sourceCommit || ""));
check("HC-PROG-100 is completed", programTask?.status === "completed", programTask?.status);
check("release board keeps QA dependency", qaTask?.dependencies?.includes("HC-PROG-100"));
check("HC-QA-101 is completed with evidence", qaTask?.status === "completed" && qaTask?.evidence === "reports/evidence/HC-QA-101/manifest.json");
check("Electron responsive gate passed", board.gates?.find((gate) => gate.id === "electron-responsive-e2e")?.status === "passed");
check("release board keeps runtime dependency", runtimeTask?.dependencies?.includes("HC-PROG-100"));
check(
  "HC-RUN-201 is completed with evidence",
  runtimeTask?.status === "completed" && runtimeTask?.evidence === "reports/evidence/HC-RUN-201/manifest.json",
  JSON.stringify(runtimeTask),
);
check("runtime event sink gate passed", board.gates?.find((gate) => gate.id === "runtime-event-sink")?.status === "passed");
check("HC-RUN-201 completion is reflected in backlog", runtimeBacklogTask?.status === "completed" && runtimeBacklogTask?.evidenceManifest === "reports/evidence/HC-RUN-201/manifest.json");
check(
  "HC-RUN-202 completed only after its dependency and evidence",
  nextRuntimeTask?.status === "completed" &&
    nextRuntimeTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    nextRuntimeTask?.evidenceManifest === "reports/evidence/HC-RUN-202/manifest.json",
  JSON.stringify(nextRuntimeTask),
);
check(
  "release board records HC-RUN-202 completion",
  runtimeStoreTask?.status === "completed" && runtimeStoreTask?.evidence === "reports/evidence/HC-RUN-202/manifest.json",
  JSON.stringify(runtimeStoreTask),
);
check("runtime store replay gate passed", board.gates?.find((gate) => gate.id === "runtime-store-replay")?.status === "passed");
check(
  "HC-RUN-203 completed only after typed replay acceptance",
  recoveryRuntimeTask?.status === "completed" &&
    recoveryRuntimeTask?.branch === "codex/runtime-engine/hc-run-203" &&
    recoveryRuntimeTask?.startedAt &&
    recoveryRuntimeTask?.completedAt &&
    recoveryRuntimeTask?.evidenceManifest === "reports/evidence/HC-RUN-203/manifest.json" &&
    recoveryRuntimeTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed"),
  JSON.stringify(recoveryRuntimeTask),
);
check("release board records HC-RUN-203 completion", turnRecoveryTask?.status === "completed" && turnRecoveryTask?.evidence === "reports/evidence/HC-RUN-203/manifest.json", JSON.stringify(turnRecoveryTask));
check("turn recovery gate passed", board.gates?.find((gate) => gate.id === "runtime-turn-recovery")?.status === "passed");
check("turn recovery test is part of the global verification matrix", packageJson.scripts["test:turn-recovery"] === "node test/turn-recovery-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/turn-recovery-tests.mjs"));
check(
  "HC-PLAT-110 completed only after its dependency",
  platformTask?.status === "completed" &&
    platformTask?.branch === "codex/security-release/hc-plat-110" &&
    platformTask?.startedAt &&
    platformTask?.completedAt &&
    platformTask?.evidenceManifest === "reports/evidence/HC-PLAT-110/manifest.json" &&
    platformTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    platformBoardTask?.status === "completed" &&
    platformBoardTask?.evidence === "reports/evidence/HC-PLAT-110/manifest.json",
  JSON.stringify(platformTask),
);
check("HC-PLAT-110 pins the supported Electron toolchain", packageJson.devDependencies?.electron === "43.1.0" && packageLock.packages?.["node_modules/electron"]?.version === "43.1.0" && packageJson.devDependencies?.["electron-builder"] === "26.15.3");
check("Electron compatibility contract is part of global verification", packageJson.scripts["test:electron-compatibility"] === "node test/electron-compatibility-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/electron-compatibility-tests.mjs"));
check("Electron supported-line gate passed", board.gates?.find((gate) => gate.id === "electron-supported-line")?.status === "passed");
check("HC-PLAT-110 evidence records every command passing", platformManifest.summary?.allPassed === true && platformManifest.summary?.total === 13, JSON.stringify(platformManifest.summary));
check("HC-PLAT-110 evidence is captured from its task branch", platformManifest.source?.branch === "codex/security-release/hc-plat-110" && platformManifest.source?.parentCommit === platformCiEvidence.headSha);
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "electron-compatibility", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "mac-package", "program-control", "git-diff-check"]) {
  check(`HC-PLAT-110 captured ${requiredCommand}`, platformManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of platformManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-PLAT-110 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-PLAT-110 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
for (const platform of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
  check(`HC-PLAT-110 ${platform} Electron smoke passed`, platformCiEvidence.jobs?.some((job) => job.name === `Electron smoke (${platform})` && job.conclusion === "success" && job.artifactUpload === "success"));
}
check(
  "HC-REL-ALPHA-8 completed only after all candidate dependencies",
  alpha8ReleaseTask?.status === "completed" &&
    alpha8ReleaseTask?.branch === "codex/release/0.6.0-alpha.8" &&
    alpha8ReleaseTask?.completedAt &&
    alpha8ReleaseTask?.evidenceManifest === "reports/evidence/HC-REL-ALPHA-8/manifest.json" &&
    alpha8ReleaseTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    alpha8ReleaseBoardTask?.status === "completed" &&
    alpha8ReleaseBoardTask?.evidence === "reports/evidence/HC-REL-ALPHA-8/manifest.json",
  JSON.stringify(alpha8ReleaseTask),
);
check("HC-UI-301 is dependency-ready", uiShellTask?.status === "ready" && uiShellTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed"));
check("alpha.8 version is synchronized", packageJson.version === "0.6.0-alpha.8" && packageLock.version === packageJson.version && packageLock.packages?.[""]?.version === packageJson.version && fs.readFileSync(path.join(root, "VERSION"), "utf8").trim() === packageJson.version);
check("alpha.8 release candidate gate passed", board.currentRelease === packageJson.version && board.candidate?.version === packageJson.version && board.candidate?.branch === "codex/release/0.6.0-alpha.8" && board.candidate?.status === "passed" && board.candidate?.evidence === "reports/evidence/HC-REL-ALPHA-8/manifest.json" && board.gates?.find((gate) => gate.id === "alpha-8-release-candidate")?.status === "passed");
check("historical alpha.7 release candidate gate remains passed", board.gates?.find((gate) => gate.id === "alpha-7-release-candidate")?.status === "passed");
check(
  "HC-PROV-210 completed only after typed runtime store completion and evidence",
  modelProviderTask?.status === "completed" &&
    modelProviderTask?.branch === "codex/runtime-engine/hc-prov-210" &&
    modelProviderTask?.completedAt &&
    modelProviderTask?.evidenceManifest === "reports/evidence/HC-PROV-210/manifest.json" &&
    modelProviderTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    modelProviderBoardTask?.status === "completed" &&
    modelProviderBoardTask?.evidence === "reports/evidence/HC-PROV-210/manifest.json" &&
    board.gates?.find((gate) => gate.id === "model-provider-v2")?.status === "passed",
  JSON.stringify(modelProviderTask),
);
check("Model Provider focused tests are part of global verification", packageJson.scripts["test:model-providers"] === "node test/model-provider-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/model-provider-tests.mjs"));
check(
  "HC-PROV-211 starts only after Model Provider v2 completion",
  openAIResponsesTask?.status === "in_progress" &&
    openAIResponsesTask?.branch === "codex/runtime-engine/hc-prov-211" &&
    Boolean(openAIResponsesTask?.startedAt) &&
    openAIResponsesTask?.taskManifest === "reports/tasks/HC-PROV-211.md" &&
    openAIResponsesTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    openAIResponsesBoardTask?.status === "in_progress" &&
    board.gates?.find((gate) => gate.id === "openai-responses-adapter")?.status === "in_progress",
  JSON.stringify(openAIResponsesTask),
);
check("HC-PROV-210 evidence records every command passing", modelProviderManifest.summary?.allPassed === true && modelProviderManifest.summary?.total === 16, JSON.stringify(modelProviderManifest.summary));
check("HC-PROV-210 evidence is captured from its task branch", modelProviderManifest.source?.branch === "codex/runtime-engine/hc-prov-210" && modelProviderManifest.source?.parentCommit === "a0f4025addf0de92192011632d194878bb7b0d3c");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "model-provider-tests", "runtime-protocol", "runtime-events", "runtime-concurrency", "runtime-clients", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-PROV-210 captured ${requiredCommand}`, modelProviderManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of modelProviderManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-PROV-210 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-PROV-210 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("risk register has active risks", Array.isArray(risks.risks) && risks.risks.length > 0);
check("baseline records source commit", manifest.source?.commit === backlog.sourceCommit);
check("baseline records every gate passing", manifest.summary?.allPassed === true, JSON.stringify(manifest.summary));
check("baseline records no runtime product dirt", manifest.capture?.runtimeProductDirtyPaths?.length === 0, JSON.stringify(manifest.capture?.runtimeProductDirtyPaths));
for (const command of manifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("HC-QA-101 evidence records every command passing", qaManifest.summary?.allPassed === true, JSON.stringify(qaManifest.summary));
for (const command of qaManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-QA-101 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-QA-101 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("HC-RUN-201 evidence records every command passing", runtimeManifest.summary?.allPassed === true, JSON.stringify(runtimeManifest.summary));
check("HC-RUN-201 evidence is captured from its task branch", runtimeManifest.source?.branch === "codex/runtime-engine/hc-run-201");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "runtime-events", "runtime-concurrency", "runtime-clients", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "git-diff-check"]) {
  check(`HC-RUN-201 captured ${requiredCommand}`, runtimeManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of runtimeManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-RUN-201 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-RUN-201 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("HC-RUN-202 evidence records every command passing", runtimeStoreManifest.summary?.allPassed === true && runtimeStoreManifest.summary?.total === 16, JSON.stringify(runtimeStoreManifest.summary));
check("HC-RUN-202 evidence is captured from its task branch", runtimeStoreManifest.source?.branch === "codex/runtime-engine/hc-run-202");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "runtime-protocol", "runtime-stores", "runtime-store-integration", "runtime-events", "runtime-concurrency", "runtime-clients", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "git-diff-check"]) {
  check(`HC-RUN-202 captured ${requiredCommand}`, runtimeStoreManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of runtimeStoreManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-RUN-202 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-RUN-202 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("HC-RUN-203 evidence records every command passing", turnRecoveryManifest.summary?.allPassed === true && turnRecoveryManifest.summary?.total === 18, JSON.stringify(turnRecoveryManifest.summary));
check("HC-RUN-203 evidence is captured from its task branch", turnRecoveryManifest.source?.branch === "codex/runtime-engine/hc-run-203");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "runtime-protocol", "runtime-stores", "runtime-store-integration", "turn-recovery", "runtime-events", "runtime-concurrency", "runtime-clients", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "git-diff-check"]) {
  check(`HC-RUN-203 captured ${requiredCommand}`, turnRecoveryManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of turnRecoveryManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-RUN-203 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-RUN-203 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("alpha.7 evidence records every command passing", releaseManifest.summary?.allPassed === true && releaseManifest.summary?.total === 11, JSON.stringify(releaseManifest.summary));
check("alpha.7 evidence is captured from its release branch", releaseManifest.source?.branch === "codex/release/0.6.0-alpha.7" && releaseManifest.source?.version === "0.6.0-alpha.7");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`alpha.7 captured ${requiredCommand}`, releaseManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of releaseManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`alpha.7 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`alpha.7 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("alpha.7 capability report does not claim event-only resume", fs.readFileSync(path.join(root, "reports/releases/0.6.0-alpha.7/capability-matrix.md"), "utf8").includes("Full event-only context reconstruction | Not delivered"));
check("alpha.8 capability report claims only evidence-backed event reconstruction", fs.readFileSync(path.join(root, "reports/releases/0.6.0-alpha.8/capability-matrix.md"), "utf8").toLowerCase().includes("complete normalized streams only"));
check("alpha.8 limitations keep signing outside the candidate", fs.readFileSync(path.join(root, "reports/releases/0.6.0-alpha.8/known-limitations.md"), "utf8").includes("not signed or notarized"));
check("alpha.8 evidence records every command passing", alpha8ReleaseManifest.summary?.allPassed === true && alpha8ReleaseManifest.summary?.total === 13, JSON.stringify(alpha8ReleaseManifest.summary));
check("alpha.8 evidence is captured from its release branch", alpha8ReleaseManifest.source?.branch === "codex/release/0.6.0-alpha.8" && alpha8ReleaseManifest.source?.version === packageJson.version);
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "electron-compatibility", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "mac-package", "program-control", "git-diff-check"]) {
  check(`alpha.8 captured ${requiredCommand}`, alpha8ReleaseManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of alpha8ReleaseManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`alpha.8 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`alpha.8 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check("historical final acceptance is explicitly named", fs.existsSync(path.join(root, "reports/final-acceptance-historical.md")));
check("unmarked final acceptance path is absent", !fs.existsSync(path.join(root, "reports/final-acceptance.md")));
check("audit archive policy is present", fs.readFileSync(path.join(root, "reports/audit/README.md"), "utf8").includes("not current release status"));
check("production audit is package-manager independent", packageJson.scripts["audit:prod"] === "node scripts/audit-production.mjs --audit-level=high");

console.log("\n[program-control] production audit helpers");
const fixture = {
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { prod: "1.0.0" }, devDependencies: { dev: "2.0.0" } },
    "node_modules/prod": { version: "1.0.0" },
    "node_modules/dev": { version: "2.0.0", dev: true },
    "node_modules/prod/node_modules/@scope/child": { version: "3.0.0" },
  },
};
const versions = collectProductionVersions(fixture);
check("production audit includes production packages", versions.prod?.[0] === "1.0.0");
check("production audit excludes development packages", versions.dev === undefined);
check("production audit preserves scoped transitive packages", versions["@scope/child"]?.[0] === "3.0.0");
const advisories = normalizeAdvisories({
  prod: [
    { severity: "moderate", title: "moderate issue" },
    { severity: "high", title: "high issue" },
  ],
});
check("high audit threshold blocks high advisories", findBlockingAdvisories(advisories, "high").length === 1);
let insecureRegistryRejected = false;
try {
  resolveRegistry("http://registry.example.test");
} catch {
  insecureRegistryRejected = true;
}
check("production audit rejects insecure registry", insecureRegistryRejected);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
