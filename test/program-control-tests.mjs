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
  "planning/backlog.json",
  "planning/release-board.json",
  "reports/program/status.md",
  "reports/program/risks.json",
  "reports/tasks/HC-PROG-100.md",
  "reports/tasks/HC-QA-101.md",
  "reports/tasks/HC-RUN-201.md",
  "reports/evidence/baseline/manifest.json",
  "reports/evidence/HC-QA-101/manifest.json",
  "reports/evidence/HC-RUN-201/manifest.json",
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
const packageJson = readJson(root, "package.json");
const programTask = backlog.tasks.find((task) => task.id === "HC-PROG-100");
const qaTask = board.tasks.find((task) => task.id === "HC-QA-101");
const runtimeTask = board.tasks.find((task) => task.id === "HC-RUN-201");

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
