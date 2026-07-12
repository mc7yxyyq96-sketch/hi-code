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
  "docs/adr/ADR-0007-explicit-openai-responses-transport.md",
  "docs/adr/ADR-0008-explicit-anthropic-ollama-transports.md",
  "docs/adr/ADR-0009-durable-attachments-and-command-routing.md",
  "docs/adr/ADR-0010-gradual-react-app-shell.md",
  "docs/adr/ADR-0011-typed-session-workbench.md",
  "docs/adr/ADR-0012-conflict-safe-integrated-editor.md",
  "docs/adr/ADR-0013-policy-bound-integrated-terminal.md",
  "docs/app-shell.md",
  "docs/session-workbench.md",
  "docs/code-editor.md",
  "docs/integrated-terminal.md",
  "docs/secure-app-preview.md",
  "docs/adr/ADR-0014-isolated-loopback-app-preview.md",
  "docs/attachments-and-command-registry.md",
  "docs/anthropic-ollama-adapters.md",
  "docs/model-provider-adapters.md",
  "docs/openai-responses-adapter.md",
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
  "reports/tasks/HC-PROV-212.md",
  "reports/tasks/HC-RUN-220.md",
  "reports/tasks/HC-UI-301.md",
  "reports/tasks/HC-UI-302.md",
  "reports/tasks/HC-UI-310.md",
  "reports/tasks/HC-UI-311.md",
  "reports/tasks/HC-UI-312.md",
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
  "reports/evidence/HC-PROV-211/manifest.json",
  "reports/evidence/HC-PROV-212/manifest.json",
  "reports/evidence/HC-RUN-220/manifest.json",
  "reports/evidence/HC-UI-301/manifest.json",
  "reports/evidence/HC-UI-302/manifest.json",
  "reports/evidence/HC-UI-310/manifest.json",
  "reports/evidence/HC-UI-311/manifest.json",
  "reports/evidence/HC-UI-311/ci-matrix.json",
  "reports/evidence/HC-UI-312/manifest.json",
  "reports/evidence/HC-UI-312/ci-matrix.json",
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
const openAIResponsesManifest = readJson(root, "reports/evidence/HC-PROV-211/manifest.json");
const anthropicOllamaManifest = readJson(root, "reports/evidence/HC-PROV-212/manifest.json");
const attachmentCommandManifest = readJson(root, "reports/evidence/HC-RUN-220/manifest.json");
const uiShellManifest = readJson(root, "reports/evidence/HC-UI-301/manifest.json");
const uiWorkbenchManifest = readJson(root, "reports/evidence/HC-UI-302/manifest.json");
const editorWorkbenchManifest = readJson(root, "reports/evidence/HC-UI-310/manifest.json");
const terminalManifest = readJson(root, "reports/evidence/HC-UI-311/manifest.json");
const terminalCiEvidence = readJson(root, "reports/evidence/HC-UI-311/ci-matrix.json");
const previewManifest = readJson(root, "reports/evidence/HC-UI-312/manifest.json");
const previewCiEvidence = readJson(root, "reports/evidence/HC-UI-312/ci-matrix.json");
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
const anthropicOllamaTask = backlog.tasks.find((task) => task.id === "HC-PROV-212");
const attachmentCommandTask = backlog.tasks.find((task) => task.id === "HC-RUN-220");
const uiShellTask = backlog.tasks.find((task) => task.id === "HC-UI-301");
const uiWorkbenchTask = backlog.tasks.find((task) => task.id === "HC-UI-302");
const editorWorkbenchTask = backlog.tasks.find((task) => task.id === "HC-UI-310");
const terminalTask = backlog.tasks.find((task) => task.id === "HC-UI-311");
const previewTask = backlog.tasks.find((task) => task.id === "HC-UI-312");
const qaTask = board.tasks.find((task) => task.id === "HC-QA-101");
const runtimeTask = board.tasks.find((task) => task.id === "HC-RUN-201");
const runtimeStoreTask = board.tasks.find((task) => task.id === "HC-RUN-202");
const turnRecoveryTask = board.tasks.find((task) => task.id === "HC-RUN-203");
const platformBoardTask = board.tasks.find((task) => task.id === "HC-PLAT-110");
const alpha8ReleaseBoardTask = board.tasks.find((task) => task.id === "HC-REL-ALPHA-8");
const modelProviderBoardTask = board.tasks.find((task) => task.id === "HC-PROV-210");
const openAIResponsesBoardTask = board.tasks.find((task) => task.id === "HC-PROV-211");
const anthropicOllamaBoardTask = board.tasks.find((task) => task.id === "HC-PROV-212");
const attachmentCommandBoardTask = board.tasks.find((task) => task.id === "HC-RUN-220");
const uiShellBoardTask = board.tasks.find((task) => task.id === "HC-UI-301");
const uiWorkbenchBoardTask = board.tasks.find((task) => task.id === "HC-UI-302");
const editorWorkbenchBoardTask = board.tasks.find((task) => task.id === "HC-UI-310");
const terminalBoardTask = board.tasks.find((task) => task.id === "HC-UI-311");
const previewBoardTask = board.tasks.find((task) => task.id === "HC-UI-312");

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
check(
  "HC-UI-301 completed only after its dependencies and evidence",
  uiShellTask?.status === "completed" &&
    uiShellTask?.branch === "codex/desktop-ux/hc-ui-301" &&
    Boolean(uiShellTask?.startedAt) &&
    Boolean(uiShellTask?.completedAt) &&
    uiShellTask?.taskManifest === "reports/tasks/HC-UI-301.md" &&
    uiShellTask?.evidenceManifest === "reports/evidence/HC-UI-301/manifest.json" &&
    uiShellTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    uiShellBoardTask?.status === "completed" &&
    uiShellBoardTask?.taskManifest === "reports/tasks/HC-UI-301.md" &&
    uiShellBoardTask?.evidence === "reports/evidence/HC-UI-301/manifest.json",
  JSON.stringify(uiShellTask),
);
check("React App Shell gate passed with committed evidence", board.gates?.find((gate) => gate.id === "react-app-shell")?.status === "passed" && board.gates?.find((gate) => gate.id === "react-app-shell")?.evidence === "reports/evidence/HC-UI-301/manifest.json");
check("HC-UI-301 compatibility risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-UI-002" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-UI-301/manifest.json")));
check("HC-UI-301 evidence records every command passing", uiShellManifest.summary?.allPassed === true && uiShellManifest.summary?.total === 13, JSON.stringify(uiShellManifest.summary));
check("HC-UI-301 evidence is captured from its isolated branch", uiShellManifest.source?.branch === "codex/desktop-ux/hc-ui-301" && uiShellManifest.source?.parentCommit === "f25eab4c72bfff8a2a9e8b7f7ccfd6a2767cf1d6");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "app-shell-tests", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-UI-301 captured ${requiredCommand}`, uiShellManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of uiShellManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-UI-301 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-UI-301 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-UI-302 completed only after its dependencies and evidence",
  uiWorkbenchTask?.status === "completed" &&
    uiWorkbenchTask?.branch === "codex/desktop-ux/hc-ui-302" &&
    Boolean(uiWorkbenchTask?.startedAt) &&
    Boolean(uiWorkbenchTask?.completedAt) &&
    uiWorkbenchTask?.taskManifest === "reports/tasks/HC-UI-302.md" &&
    uiWorkbenchTask?.evidenceManifest === "reports/evidence/HC-UI-302/manifest.json" &&
    uiWorkbenchTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    uiWorkbenchBoardTask?.status === "completed" &&
    uiWorkbenchBoardTask?.taskManifest === "reports/tasks/HC-UI-302.md" &&
    uiWorkbenchBoardTask?.evidence === "reports/evidence/HC-UI-302/manifest.json",
  JSON.stringify(uiWorkbenchTask),
);
check("React Session Workbench gate passed with committed evidence", board.gates?.find((gate) => gate.id === "react-session-workbench")?.status === "passed" && board.gates?.find((gate) => gate.id === "react-session-workbench")?.evidence === "reports/evidence/HC-UI-302/manifest.json");
check("HC-UI-302 migration risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-UI-003" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-UI-302/manifest.json")));
check("HC-UI-302 evidence records every command passing from a clean tree", uiWorkbenchManifest.summary?.allPassed === true && uiWorkbenchManifest.summary?.total === 14 && uiWorkbenchManifest.capture?.workingTreeClean === true, JSON.stringify(uiWorkbenchManifest.summary));
check("HC-UI-302 evidence is captured from its isolated branch", uiWorkbenchManifest.source?.branch === "codex/desktop-ux/hc-ui-302" && uiWorkbenchManifest.source?.parentCommit === "423a05a64acf8f4c916b2b48cc5237a42b38a25b");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "app-shell-tests", "workspace-shell-tests", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-UI-302 captured ${requiredCommand}`, uiWorkbenchManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of uiWorkbenchManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-UI-302 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-UI-302 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-UI-310 completed only after its dependency and evidence",
  editorWorkbenchTask?.status === "completed" &&
    editorWorkbenchTask?.branch === "codex/desktop-ux/hc-ui-310" &&
    Boolean(editorWorkbenchTask?.startedAt) &&
    Boolean(editorWorkbenchTask?.completedAt) &&
    editorWorkbenchTask?.taskManifest === "reports/tasks/HC-UI-310.md" &&
    editorWorkbenchTask?.evidenceManifest === "reports/evidence/HC-UI-310/manifest.json" &&
    editorWorkbenchTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    editorWorkbenchBoardTask?.status === "completed" &&
    editorWorkbenchBoardTask?.taskManifest === "reports/tasks/HC-UI-310.md" &&
    editorWorkbenchBoardTask?.evidence === "reports/evidence/HC-UI-310/manifest.json",
  JSON.stringify(editorWorkbenchTask),
);
check("Integrated editor review gate passed with committed evidence", board.gates?.find((gate) => gate.id === "integrated-editor-review-loop")?.status === "passed" && board.gates?.find((gate) => gate.id === "integrated-editor-review-loop")?.evidence === "reports/evidence/HC-UI-310/manifest.json");
check("HC-UI-310 data-loss and fake-review risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-UI-004" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-UI-310/manifest.json")));
check("HC-UI-310 evidence records every command passing from a clean tree", editorWorkbenchManifest.summary?.allPassed === true && editorWorkbenchManifest.summary?.total === 15 && editorWorkbenchManifest.capture?.workingTreeClean === true, JSON.stringify(editorWorkbenchManifest.summary));
check("HC-UI-310 evidence is captured from its isolated branch", editorWorkbenchManifest.source?.branch === "codex/desktop-ux/hc-ui-310" && editorWorkbenchManifest.source?.parentCommit === "cfd75e100f7d1fc7841c7df3d31534da30368b14");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "editor-workbench-tests", "workspace-shell-tests", "renderer-tests", "service-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-UI-310 captured ${requiredCommand}`, editorWorkbenchManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of editorWorkbenchManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-UI-310 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-UI-310 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-UI-311 completed only after its dependencies and evidence",
  terminalTask?.status === "completed" &&
    terminalTask?.branch === "codex/desktop-ux/hc-ui-311" &&
    Boolean(terminalTask?.startedAt) &&
    Boolean(terminalTask?.completedAt) &&
    terminalTask?.taskManifest === "reports/tasks/HC-UI-311.md" &&
    terminalTask?.evidenceManifest === "reports/evidence/HC-UI-311/manifest.json" &&
    terminalTask?.ciEvidence === "reports/evidence/HC-UI-311/ci-matrix.json" &&
    terminalTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    terminalBoardTask?.status === "completed" &&
    terminalBoardTask?.taskManifest === "reports/tasks/HC-UI-311.md" &&
    terminalBoardTask?.evidence === "reports/evidence/HC-UI-311/manifest.json" &&
    terminalBoardTask?.ciEvidence === "reports/evidence/HC-UI-311/ci-matrix.json",
  JSON.stringify(terminalTask),
);
check("Integrated terminal policy gate passed with committed evidence", board.gates?.find((gate) => gate.id === "integrated-terminal-policy")?.status === "passed" && board.gates?.find((gate) => gate.id === "integrated-terminal-policy")?.evidence === "reports/evidence/HC-UI-311/manifest.json" && board.gates?.find((gate) => gate.id === "integrated-terminal-policy")?.ciEvidence === "reports/evidence/HC-UI-311/ci-matrix.json");
check("HC-UI-311 policy and lifecycle risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-UI-005" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-UI-311/manifest.json") && risk.evidence?.includes("reports/evidence/HC-UI-311/ci-matrix.json")));
check("HC-UI-311 evidence records every command passing from a clean tree", terminalManifest.summary?.allPassed === true && terminalManifest.summary?.total === 18 && terminalManifest.capture?.workingTreeClean === true, JSON.stringify(terminalManifest.summary));
check("HC-UI-311 evidence is captured from its isolated branch", terminalManifest.source?.branch === "codex/desktop-ux/hc-ui-311" && terminalManifest.source?.parentCommit === "d9703672325345e3e92924aaf9abe52ec29fe714");
check(
  "HC-UI-311 CI passed general tests and real Electron smoke on every target platform",
  terminalCiEvidence.event === "pull_request" &&
    terminalCiEvidence.pullRequest === 15 &&
    terminalCiEvidence.status === "completed" &&
    terminalCiEvidence.conclusion === "success" &&
    terminalCiEvidence.headSha === "55d9ede7f5a3cde4ebc8841feb9ba32a0296b673" &&
    ["ubuntu-latest", "macos-latest", "windows-latest"].every((platform) => terminalCiEvidence.jobs?.some((job) => job.platform === platform && job.name === `Electron smoke (${platform})` && job.conclusion === "success" && job.electronSmoke === "success" && job.artifactUpload === "success")) &&
    terminalCiEvidence.jobs?.some((job) => job.name === "test" && job.conclusion === "success" && job.testSuites === "success" && job.dodScan === "success"),
  JSON.stringify(terminalCiEvidence),
);
for (const requiredCommand of ["build", "terminal-tests", "service-tests", "app-shell-tests", "renderer-tests", "electron-compatibility", "security-tests", "verify", "release-check", "feature-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "mac-package", "terminal-package", "program-control", "git-diff-check"]) {
  check(`HC-UI-311 captured ${requiredCommand}`, terminalManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of terminalManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-UI-311 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-UI-311 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-UI-312 completed only after its dependencies and evidence",
  previewTask?.status === "completed" &&
    previewTask?.branch === "codex/desktop-ux/hc-ui-312" &&
    Boolean(previewTask?.startedAt) &&
    Boolean(previewTask?.completedAt) &&
    previewTask?.taskManifest === "reports/tasks/HC-UI-312.md" &&
    previewTask?.evidenceManifest === "reports/evidence/HC-UI-312/manifest.json" &&
    previewTask?.ciEvidence === "reports/evidence/HC-UI-312/ci-matrix.json" &&
    previewTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    previewBoardTask?.status === "completed" &&
    previewBoardTask?.taskManifest === "reports/tasks/HC-UI-312.md" &&
    previewBoardTask?.evidence === "reports/evidence/HC-UI-312/manifest.json" &&
    previewBoardTask?.ciEvidence === "reports/evidence/HC-UI-312/ci-matrix.json",
  JSON.stringify(previewTask),
);
check("Secure App Preview gate passed with committed evidence", board.gates?.find((gate) => gate.id === "secure-app-preview")?.status === "passed" && board.gates?.find((gate) => gate.id === "secure-app-preview")?.evidence === "reports/evidence/HC-UI-312/manifest.json" && board.gates?.find((gate) => gate.id === "secure-app-preview")?.ciEvidence === "reports/evidence/HC-UI-312/ci-matrix.json");
check("HC-UI-312 isolation and false-verification risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-UI-006" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-UI-312/manifest.json") && risk.evidence?.includes("reports/evidence/HC-UI-312/ci-matrix.json")));
check("HC-UI-312 evidence records every command passing from a clean tree", previewManifest.summary?.allPassed === true && previewManifest.summary?.total === 15 && previewManifest.capture?.workingTreeClean === true, JSON.stringify(previewManifest.summary));
check("HC-UI-312 evidence is captured from its isolated branch", previewManifest.source?.branch === "codex/desktop-ux/hc-ui-312" && previewManifest.source?.parentCommit === "d1138ab3583bb22117fb2e097acbd76e986b00e2");
check(
  "HC-UI-312 CI passed general tests and real Electron smoke on every target platform",
  previewCiEvidence.event === "pull_request" &&
    previewCiEvidence.pullRequest === 16 &&
    previewCiEvidence.status === "completed" &&
    previewCiEvidence.conclusion === "success" &&
    previewCiEvidence.headSha === "dd7655eb6a4d304224b884588930047cd66ce06f" &&
    ["ubuntu-latest", "macos-latest", "windows-latest"].every((platform) => previewCiEvidence.jobs?.some((job) => job.platform === platform && job.name === `Electron smoke (${platform})` && job.conclusion === "success" && job.electronSmoke === "success" && job.artifactUpload === "success")) &&
    previewCiEvidence.jobs?.some((job) => job.name === "test" && job.conclusion === "success" && job.testSuites === "success" && job.dodScan === "success"),
  JSON.stringify(previewCiEvidence),
);
for (const requiredCommand of ["build", "preview-tests", "service-tests", "app-shell-tests", "renderer-tests", "security-tests", "verify", "release-check", "feature-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-UI-312 captured ${requiredCommand}`, previewManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of previewManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-UI-312 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-UI-312 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
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
check("OpenAI Responses focused tests are part of global verification", packageJson.scripts["test:openai-responses"] === "node test/openai-responses-provider-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/openai-responses-provider-tests.mjs"));
check("Anthropic and Ollama focused tests are part of global verification", packageJson.scripts["test:anthropic-ollama"] === "node test/anthropic-ollama-provider-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/anthropic-ollama-provider-tests.mjs"));
check("Attachment and command routing tests are part of global verification", packageJson.scripts["test:attachment-command"] === "node test/attachment-command-registry-tests.mjs" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/attachment-command-registry-tests.mjs"));
check("OpenAI Responses evidence capture is reproducible", packageJson.scripts["program:evidence:openai-responses"] === "node scripts/capture-task-evidence.mjs --task=HC-PROV-211" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-PROV-211"'));
check("Anthropic and Ollama evidence capture is reproducible", packageJson.scripts["program:evidence:anthropic-ollama"] === "node scripts/capture-task-evidence.mjs --task=HC-PROV-212" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-PROV-212"'));
check("Attachment and command evidence capture is reproducible", packageJson.scripts["program:evidence:attachment-command"] === "node scripts/capture-task-evidence.mjs --task=HC-RUN-220" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-RUN-220"'));
check("Typed App Shell tests are part of global verification", packageJson.scripts["test:app-shell"]?.includes("test/app-shell-tests.ts") && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/app-shell-tests.ts"));
check("Typed App Shell evidence capture is reproducible", packageJson.scripts["program:evidence:app-shell"] === "node scripts/capture-task-evidence.mjs --task=HC-UI-301" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-UI-301"'));
check("Typed Session Workbench evidence capture is reproducible", packageJson.scripts["program:evidence:session-workbench"] === "node scripts/capture-task-evidence.mjs --task=HC-UI-302" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-UI-302"'));
check("Integrated editor tests are part of global verification", packageJson.scripts["test:editor-workbench"] === "tsx test/editor-workbench-tests.ts" && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/editor-workbench-tests.ts"));
check("Integrated editor evidence capture is reproducible", packageJson.scripts["program:evidence:editor-workbench"] === "node scripts/capture-task-evidence.mjs --task=HC-UI-310" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-UI-310"'));
check("Integrated terminal tests are part of global verification", packageJson.scripts["test:terminal"]?.includes("test/terminal-service-tests.mjs") && packageJson.scripts["test:terminal"]?.includes("test/terminal-workbench-tests.ts") && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/terminal-service-tests.mjs") && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/terminal-workbench-tests.ts"));
check("Integrated terminal evidence capture is reproducible", packageJson.scripts["program:evidence:terminal"] === "node scripts/capture-task-evidence.mjs --task=HC-UI-311" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-UI-311"'));
check("Secure App Preview tests are part of global verification", packageJson.scripts["test:preview"]?.includes("test/preview-service-tests.mjs") && packageJson.scripts["test:preview"]?.includes("test/preview-workbench-tests.ts") && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/preview-service-tests.mjs") && fs.readFileSync(path.join(root, "scripts/verify.mjs"), "utf8").includes("test/preview-workbench-tests.ts"));
check("Secure App Preview evidence capture is reproducible", packageJson.scripts["program:evidence:preview"] === "node scripts/capture-task-evidence.mjs --task=HC-UI-312" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-UI-312"'));
check("Coding and Git delivery evidence capture is reproducible", packageJson.scripts["program:evidence:git-loop"] === "node scripts/capture-task-evidence.mjs --task=HC-GIT-320" && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('"HC-GIT-320"'));
check("Task evidence commands cannot be shadowed by a project-local npm binary", fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes("sanitizeEvidencePath") && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('path.resolve(root, "node_modules", ".bin")'));
check("Task evidence executes the locked npm CLI with the current Node runtime", fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes('path.join(root, "node_modules", "npm", "bin", "npm-cli.js")') && fs.readFileSync(path.join(root, "scripts/capture-task-evidence.mjs"), "utf8").includes("isNpmCommand ? node : spec.command"));
check(
  "HC-PROV-211 completed only after Model Provider v2 completion and evidence",
  openAIResponsesTask?.status === "completed" &&
    openAIResponsesTask?.branch === "codex/runtime-engine/hc-prov-211" &&
    Boolean(openAIResponsesTask?.startedAt) &&
    Boolean(openAIResponsesTask?.completedAt) &&
    openAIResponsesTask?.taskManifest === "reports/tasks/HC-PROV-211.md" &&
    openAIResponsesTask?.evidenceManifest === "reports/evidence/HC-PROV-211/manifest.json" &&
    openAIResponsesTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    openAIResponsesBoardTask?.status === "completed" &&
    openAIResponsesBoardTask?.evidence === "reports/evidence/HC-PROV-211/manifest.json" &&
    board.gates?.find((gate) => gate.id === "openai-responses-adapter")?.status === "passed",
  JSON.stringify(openAIResponsesTask),
);
check("HC-PROV-211 evidence records every command passing", openAIResponsesManifest.summary?.allPassed === true && openAIResponsesManifest.summary?.total === 19, JSON.stringify(openAIResponsesManifest.summary));
check("HC-PROV-211 evidence is captured from its isolated branch", openAIResponsesManifest.source?.branch === "codex/runtime-engine/hc-prov-211" && openAIResponsesManifest.source?.parentCommit === "b6d6ae2a3dc296c9ba80c57226b516e7f54dc291");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "openai-responses-tests", "model-provider-tests", "service-tests", "runtime-protocol", "runtime-events", "runtime-concurrency", "runtime-clients", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-PROV-211 captured ${requiredCommand}`, openAIResponsesManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of openAIResponsesManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-PROV-211 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-PROV-211 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-PROV-212 completed only after both provider transport dependencies and evidence",
  anthropicOllamaTask?.status === "completed" &&
    anthropicOllamaTask?.branch === "codex/runtime-engine/hc-prov-212" &&
    Boolean(anthropicOllamaTask?.startedAt) &&
    Boolean(anthropicOllamaTask?.completedAt) &&
    anthropicOllamaTask?.taskManifest === "reports/tasks/HC-PROV-212.md" &&
    anthropicOllamaTask?.evidenceManifest === "reports/evidence/HC-PROV-212/manifest.json" &&
    anthropicOllamaTask?.dependencies?.includes("HC-PROV-211") &&
    anthropicOllamaTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    anthropicOllamaBoardTask?.status === "completed" &&
    anthropicOllamaBoardTask?.evidence === "reports/evidence/HC-PROV-212/manifest.json" &&
    board.gates?.find((gate) => gate.id === "anthropic-ollama-adapters")?.status === "passed" &&
    board.gates?.find((gate) => gate.id === "anthropic-ollama-adapters")?.evidence === "reports/evidence/HC-PROV-212/manifest.json",
  JSON.stringify(anthropicOllamaTask),
);
check("HC-PROV-212 evidence records every command passing", anthropicOllamaManifest.summary?.allPassed === true && anthropicOllamaManifest.summary?.total === 20, JSON.stringify(anthropicOllamaManifest.summary));
check("HC-PROV-212 evidence is captured from its isolated branch", anthropicOllamaManifest.source?.branch === "codex/runtime-engine/hc-prov-212" && anthropicOllamaManifest.source?.parentCommit === "e40f45d29a1a964fc4b50b1f8ec3e476809e149a");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "anthropic-ollama-tests", "model-provider-tests", "openai-responses-tests", "service-tests", "runtime-protocol", "runtime-events", "runtime-concurrency", "runtime-clients", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-PROV-212 captured ${requiredCommand}`, anthropicOllamaManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of anthropicOllamaManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-PROV-212 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-PROV-212 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
check(
  "HC-RUN-220 completed only after its runtime dependency and evidence",
  attachmentCommandTask?.status === "completed" &&
    attachmentCommandTask?.branch === "codex/runtime-engine/hc-run-220" &&
    Boolean(attachmentCommandTask?.startedAt) &&
    Boolean(attachmentCommandTask?.completedAt) &&
    attachmentCommandTask?.taskManifest === "reports/tasks/HC-RUN-220.md" &&
    attachmentCommandTask?.evidenceManifest === "reports/evidence/HC-RUN-220/manifest.json" &&
    attachmentCommandTask?.dependencies?.every((id) => backlog.tasks.find((task) => task.id === id)?.status === "completed") &&
    attachmentCommandBoardTask?.status === "completed" &&
    attachmentCommandBoardTask?.branch === "codex/runtime-engine/hc-run-220" &&
    attachmentCommandBoardTask?.evidence === "reports/evidence/HC-RUN-220/manifest.json" &&
    board.gates?.find((gate) => gate.id === "attachment-command-registry")?.status === "passed" &&
    board.gates?.find((gate) => gate.id === "attachment-command-registry")?.evidence === "reports/evidence/HC-RUN-220/manifest.json",
  JSON.stringify(attachmentCommandTask),
);
check("HC-RUN-220 risk is evidence-backed and mitigated", risks.risks?.some((risk) => risk.id === "RISK-RUN-004" && risk.status === "mitigated" && risk.evidence?.includes("reports/evidence/HC-RUN-220/manifest.json")));
check("HC-RUN-220 evidence records every command passing", attachmentCommandManifest.summary?.allPassed === true && attachmentCommandManifest.summary?.total === 24, JSON.stringify(attachmentCommandManifest.summary));
check("HC-RUN-220 evidence is captured from its isolated branch", attachmentCommandManifest.source?.branch === "codex/runtime-engine/hc-run-220" && attachmentCommandManifest.source?.parentCommit === "a5008b9edd0802ccbf50d3bd75ad73a9c95107bd");
for (const requiredCommand of ["build", "verify", "release-check", "feature-tests", "attachment-command-tests", "model-provider-tests", "openai-responses-tests", "anthropic-ollama-tests", "service-tests", "runtime-protocol", "runtime-stores", "runtime-store-integration", "turn-recovery", "runtime-events", "runtime-concurrency", "runtime-clients", "renderer-tests", "security-tests", "dod-tests", "dod-scan", "production-audit", "electron-e2e", "program-control", "git-diff-check"]) {
  check(`HC-RUN-220 captured ${requiredCommand}`, attachmentCommandManifest.commands?.some((command) => command.id === requiredCommand && command.status === "passed"));
}
for (const command of attachmentCommandManifest.commands || []) {
  const absolute = path.join(root, command.logPath || "");
  check(`HC-RUN-220 ${command.id} log exists`, Boolean(command.logPath) && fs.existsSync(absolute));
  if (fs.existsSync(absolute)) check(`HC-RUN-220 ${command.id} log hash matches`, digest(absolute) === command.logSha256);
}
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
