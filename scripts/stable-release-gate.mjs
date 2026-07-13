import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..");
const REQUIRED_PLATFORMS = ["ubuntu-latest", "macos-latest", "windows-latest"];
const ENGINEERING_CONDITION_IDS = new Set([
  "runtime-protocol-authority",
  "complete-turn-replay",
  "runtime-client-isolation",
  "three-platform-electron-smoke",
  "three-platform-package-smoke",
  "code-studio-core-flow",
  "mcp-connection-layer",
  "full-tree-dod",
  "p0-p1-release-work",
  "truthful-documentation",
]);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function optionalJson(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? readJson(root, relativePath) : null;
}

function git(root, args) {
  const allowedKeys = process.platform === "win32"
    ? ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "LANG"]
    : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG"];
  const env = Object.fromEntries(allowedKeys
    .filter((key) => typeof process.env[key] === "string" && process.env[key])
    .map((key) => [key, process.env[key]]));
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim() || "unknown";
}

function commandPassed(manifest, commandId) {
  return Boolean(manifest?.summary?.allPassed)
    && manifest.commands?.some((command) => command.id === commandId && command.status === "passed");
}

function taskCompleted(board, taskId) {
  return board?.tasks?.some((task) => task.id === taskId && task.status === "completed");
}

function condition({ id, title, status, evidence, reason = null, category = "engineering" }) {
  return {
    id,
    title,
    category,
    status,
    evidence: [...new Set(evidence || [])],
    ...(reason ? { reason } : {}),
  };
}

function allPlatformsPassed(ciMatrix, field) {
  return REQUIRED_PLATFORMS.every((platform) => ciMatrix?.jobs?.some((job) => (
    job.platform === platform
      && job.status === "completed"
      && job.conclusion === "success"
      && job[field] === "success"
  )));
}

function explicitSignedPlatformEvidence(ciMatrix) {
  const mac = ciMatrix?.jobs?.find((job) => job.platform === "macos-latest" && job.packageSmoke === "success");
  const windows = ciMatrix?.jobs?.find((job) => job.platform === "windows-latest" && job.packageSmoke === "success");
  const linux = ciMatrix?.jobs?.find((job) => job.platform === "ubuntu-latest" && job.packageSmoke === "success");
  return Boolean(
    mac?.signatureSmoke === "success"
      && mac?.notarizationSmoke === "success"
      && mac?.updateSmoke === "success"
      && windows?.signatureSmoke === "success"
      && windows?.updateSmoke === "success"
      && linux?.integritySmoke === "success"
      && linux?.updateSmoke === "success"
  );
}

function documentClaimsAreTruthful(docs) {
  const releasePolicy = docs.releasePipeline || "";
  const taskReport = docs.releaseTask || "";
  const executionPlan = docs.executionPlan || "";
  return releasePolicy.includes("Unsigned and update-disabled")
    && releasePolicy.includes("cannot claim commercial signing")
    && taskReport.includes("Treating unsigned macOS/Windows packages as stable release artifacts")
    && executionPlan.includes("签名安装包和更新链路通过");
}

function openReleaseRisks(risks) {
  return (risks?.risks || []).filter((risk) => (
    risk.status === "open"
      && ["critical", "high"].includes(risk.severity)
      && risk.owner !== "industrial-platform"
      && risk.owner !== "developer-environment"
  ));
}

export function evaluateStableReleaseGate(input) {
  const {
    version,
    board,
    risks,
    manifests,
    releaseCi,
    docs,
    issues = [],
    source,
    evaluatedAt = new Date().toISOString(),
  } = input;

  const runtimeProtocol = taskCompleted(board, "HC-RUN-201")
    && taskCompleted(board, "HC-RUN-202")
    && commandPassed(manifests["HC-RUN-201"], "runtime-clients")
    && commandPassed(manifests["HC-RUN-202"], "runtime-protocol");
  const turnReplay = commandPassed(manifests["HC-RUN-202"], "runtime-store-integration")
    && commandPassed(manifests["HC-RUN-203"], "turn-recovery");
  const clientIsolation = commandPassed(manifests["HC-RUN-201"], "runtime-concurrency")
    && commandPassed(manifests["HC-RUN-201"], "electron-e2e");
  const electronMatrix = allPlatformsPassed(releaseCi, "electronSmoke");
  const packageMatrix = allPlatformsPassed(releaseCi, "packageSmoke");
  const codeStudio = ["HC-UI-310", "HC-UI-311", "HC-UI-312", "HC-GIT-320"]
    .every((taskId) => taskCompleted(board, taskId) && manifests[taskId]?.summary?.allPassed === true);
  const mcp = taskCompleted(board, "HC-MCP-410")
    && commandPassed(manifests["HC-MCP-410"], "mcp-tests")
    && commandPassed(manifests["HC-MCP-410"], "security-tests");
  const dod = commandPassed(manifests["HC-MCP-410"], "dod-scan");
  const releasePipeline = taskCompleted(board, "HC-REL-420")
    && commandPassed(manifests["HC-REL-420"], "release-pipeline-tests")
    && commandPassed(manifests["HC-REL-420"], "checksum-verification");
  const unsignedAnnotation = releaseCi?.annotations?.some((annotation) => (
    annotation.severity === "warning" && /unsigned|update-disabled/i.test(annotation.message || "")
  ));
  const signingRisk = risks?.risks?.find((risk) => risk.id === "RISK-REL-001");
  const signedReleaseChain = releasePipeline
    && packageMatrix
    && explicitSignedPlatformEvidence(releaseCi)
    && signingRisk?.status !== "open"
    && !unsignedAnnotation;
  const unresolvedReleaseRisks = openReleaseRisks(risks);
  const openReleaseWork = [
    ...(board?.tasks || [])
      .filter((task) => ["P0", "P1"].includes(task.priority) && task.status !== "completed")
      .map((task) => ({ id: task.id, source: "release-board", status: task.status })),
    ...(Array.isArray(issues) ? issues : [])
      .filter((issue) => ["P0", "P1"].includes(issue.severity) && issue.status !== "fixed")
      .map((issue) => ({ id: issue.id, source: "issue-registry", status: issue.status || "open" })),
  ];
  const docsTruthful = documentClaimsAreTruthful(docs);

  const conditions = [
    condition({
      id: "runtime-protocol-authority",
      title: "Runtime Protocol v2 is the durable source of truth",
      status: runtimeProtocol ? "passed" : "failed",
      evidence: ["reports/evidence/HC-RUN-201/manifest.json", "reports/evidence/HC-RUN-202/manifest.json"],
      reason: runtimeProtocol ? null : "Runtime protocol or client-adapter evidence is incomplete.",
    }),
    condition({
      id: "complete-turn-replay",
      title: "Complete turns replay and interrupted turns recover conservatively",
      status: turnReplay ? "passed" : "failed",
      evidence: ["reports/evidence/HC-RUN-202/manifest.json", "reports/evidence/HC-RUN-203/manifest.json"],
      reason: turnReplay ? null : "Replay or recovery evidence is incomplete.",
    }),
    condition({
      id: "runtime-client-isolation",
      title: "Desktop, CLI, and TUI do not depend on a global stdout bridge",
      status: clientIsolation ? "passed" : "failed",
      evidence: ["reports/evidence/HC-RUN-201/manifest.json"],
      reason: clientIsolation ? null : "Runtime concurrency or real Electron client evidence is incomplete.",
    }),
    condition({
      id: "three-platform-electron-smoke",
      title: "Core Electron startup passes on Linux, macOS, and Windows",
      status: electronMatrix ? "passed" : "failed",
      evidence: ["reports/evidence/HC-REL-420/ci-matrix.json"],
      reason: electronMatrix ? null : "At least one target platform lacks successful Electron smoke evidence.",
    }),
    condition({
      id: "three-platform-package-smoke",
      title: "Native package lifecycle smoke passes on Linux, macOS, and Windows",
      status: packageMatrix && releasePipeline ? "passed" : "failed",
      evidence: ["reports/evidence/HC-REL-420/manifest.json", "reports/evidence/HC-REL-420/ci-matrix.json"],
      reason: packageMatrix && releasePipeline ? null : "Package or release-pipeline evidence is incomplete.",
    }),
    condition({
      id: "code-studio-core-flow",
      title: "Code Studio editor, terminal, preview, and Git delivery flow is evidenced",
      status: codeStudio ? "passed" : "failed",
      evidence: [
        "reports/evidence/HC-UI-310/manifest.json",
        "reports/evidence/HC-UI-311/manifest.json",
        "reports/evidence/HC-UI-312/manifest.json",
        "reports/evidence/HC-GIT-320/manifest.json",
      ],
      reason: codeStudio ? null : "One or more Code Studio core-flow gates are incomplete.",
    }),
    condition({
      id: "mcp-connection-layer",
      title: "MCP stdio and Streamable HTTP lifecycle is compatible and secured",
      status: mcp ? "passed" : "failed",
      evidence: ["reports/evidence/HC-MCP-410/manifest.json"],
      reason: mcp ? null : "HC-MCP-410 lifecycle or security evidence is incomplete.",
    }),
    condition({
      id: "full-tree-dod",
      title: "Latest full-tree DoD and Skeleton scan has no blocking findings",
      status: dod ? "passed" : "failed",
      evidence: ["reports/evidence/HC-MCP-410/manifest.json"],
      reason: dod ? null : "The latest committed task does not contain a passing full-tree scan.",
    }),
    condition({
      id: "p0-p1-release-work",
      title: "No open P0 or P1 release work remains",
      status: openReleaseWork.length === 0 ? "passed" : "failed",
      evidence: ["planning/release-board.json", "reports/audit/README.md"],
      reason: openReleaseWork.length === 0
        ? null
        : `Open P0/P1 work remains: ${openReleaseWork.map((item) => item.id).join(", ")}.`,
    }),
    condition({
      id: "truthful-documentation",
      title: "Documentation states the current unsigned and update-disabled boundary",
      status: docsTruthful ? "passed" : "failed",
      evidence: ["docs/program/EXECUTION_PLAN.md", "docs/release-pipeline.md", "reports/tasks/HC-REL-420.md"],
      reason: docsTruthful ? null : "Release documentation does not preserve all required capability boundaries.",
    }),
    condition({
      id: "signed-release-chain",
      title: "macOS and Windows signing, Apple notarization, and stable update chain are verified",
      category: "promotion",
      status: signedReleaseChain ? "passed" : "blocked",
      evidence: ["reports/evidence/HC-REL-420/ci-matrix.json", "reports/program/risks.json", "docs/release-pipeline.md"],
      reason: signedReleaseChain
        ? null
        : "RISK-REL-001 remains open and current CI artifacts are explicitly unsigned and update-disabled.",
    }),
    condition({
      id: "release-risk-disposition",
      title: "No open critical or high non-industrial release risk remains",
      category: "promotion",
      status: unresolvedReleaseRisks.length === 0 ? "passed" : "blocked",
      evidence: ["reports/program/risks.json"],
      reason: unresolvedReleaseRisks.length === 0
        ? null
        : `Open release risks require disposition: ${unresolvedReleaseRisks.map((risk) => risk.id).join(", ")}.`,
    }),
  ];

  const engineeringFailed = conditions.some((item) => ENGINEERING_CONDITION_IDS.has(item.id) && item.status !== "passed");
  const failed = conditions.filter((item) => item.status === "failed");
  const blocked = conditions.filter((item) => item.status === "blocked");
  const decision = failed.length > 0 ? "rejected" : blocked.length > 0 ? "blocked" : "ready";
  const blockers = [
    ...(signedReleaseChain ? [] : [{
      id: "RISK-REL-001",
      type: "external-release-infrastructure",
      severity: signingRisk?.severity || "medium",
      reason: "Apple signing/notarization and Windows code-signing evidence are not available for stable promotion.",
      evidence: ["reports/program/risks.json", "reports/evidence/HC-REL-420/ci-matrix.json"],
    }]),
    ...unresolvedReleaseRisks.map((risk) => ({
      id: risk.id,
      type: "open-program-risk",
      severity: risk.severity,
      reason: risk.title,
      evidence: risk.evidence || ["reports/program/risks.json"],
    })),
    ...failed.map((item) => ({
      id: item.id,
      type: "engineering-gate-failure",
      severity: "critical",
      reason: item.reason || item.title,
      evidence: item.evidence,
    })),
  ];

  return {
    schemaVersion: 1,
    gateId: "HC-REL-STABLE-GATE",
    targetVersion: "0.6.0",
    evaluatedVersion: version,
    evaluatedAt,
    source,
    engineeringStatus: engineeringFailed ? "failed" : "passed",
    decision,
    formalReleaseCreated: false,
    tagCreated: false,
    conditions,
    blockers,
    summary: {
      total: conditions.length,
      passed: conditions.filter((item) => item.status === "passed").length,
      blocked: blocked.length,
      failed: failed.length,
    },
  };
}

export function collectStableReleaseInputs(root = defaultRoot) {
  const taskIds = [
    "HC-RUN-201",
    "HC-RUN-202",
    "HC-RUN-203",
    "HC-UI-310",
    "HC-UI-311",
    "HC-UI-312",
    "HC-GIT-320",
    "HC-REL-420",
    "HC-MCP-410",
  ];
  return {
    version: readJson(root, "package.json").version,
    board: readJson(root, "planning/release-board.json"),
    risks: readJson(root, "reports/program/risks.json"),
    manifests: Object.fromEntries(taskIds.map((taskId) => [
      taskId,
      optionalJson(root, `reports/evidence/${taskId}/manifest.json`),
    ])),
    releaseCi: optionalJson(root, "reports/evidence/HC-REL-420/ci-matrix.json"),
    docs: {
      executionPlan: readText(root, "docs/program/EXECUTION_PLAN.md"),
      releasePipeline: readText(root, "docs/release-pipeline.md"),
      releaseTask: readText(root, "reports/tasks/HC-REL-420.md"),
    },
    issues: optionalJson(root, "reports/audit/issues.json") || [],
    source: {
      commit: git(root, ["rev-parse", "HEAD"]),
      branch: git(root, ["branch", "--show-current"]),
    },
  };
}

function markdown(result) {
  const conditionRows = result.conditions.map((item) => (
    `| ${item.id} | ${item.status.toUpperCase()} | ${item.title} | ${item.reason || "Verified by committed evidence."} |`
  ));
  const blockerRows = result.blockers.length
    ? result.blockers.map((item) => `- **${item.id}** (${item.severity}): ${item.reason}`)
    : ["- None."];
  return `# Hi Code 0.6.0 Stable Release Gate\n\n`
    + `- Decision: **${result.decision.toUpperCase()}**\n`
    + `- Engineering status: **${result.engineeringStatus.toUpperCase()}**\n`
    + `- Evaluated source: \`${result.source.commit}\` on \`${result.source.branch}\`\n`
    + `- Evaluated package version: \`${result.evaluatedVersion}\`\n`
    + `- Formal Release created: **No**\n`
    + `- Tag created: **No**\n\n`
    + `## Conditions\n\n`
    + `| Gate | Status | Requirement | Evidence result |\n`
    + `| --- | --- | --- | --- |\n`
    + `${conditionRows.join("\n")}\n\n`
    + `## Blockers\n\n${blockerRows.join("\n")}\n\n`
    + `## Decision\n\n`
    + (result.decision === "ready"
      ? "All stable-promotion conditions are evidenced. Formal publication still requires an explicit authorized release action.\n"
      : "The engineering baseline is retained, but stable promotion is not authorized while the blockers above remain. The package version, formal Release, tag, signing claims, and risk states are unchanged.\n");
}

function parseArgs(argv) {
  const rootArg = argv.find((arg) => arg.startsWith("--root="));
  return {
    root: rootArg ? path.resolve(rootArg.slice("--root=".length)) : defaultRoot,
    requireReady: argv.includes("--require-ready"),
  };
}

export function writeStableReleaseGateOutputs(root, result) {
  const evidenceDir = path.join(root, "reports", "evidence", "HC-REL-STABLE-GATE");
  const reportDir = path.join(root, "reports", "releases", "0.6.0-stable");
  fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o755 });
  fs.mkdirSync(reportDir, { recursive: true, mode: 0o755 });
  fs.writeFileSync(path.join(evidenceDir, "gate-result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
  fs.writeFileSync(path.join(reportDir, "gate-report.md"), markdown(result), { mode: 0o644 });
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluateStableReleaseGate(collectStableReleaseInputs(args.root));
    writeStableReleaseGateOutputs(args.root, result);
    console.log(`[stable-release-gate] engineering=${result.engineeringStatus} decision=${result.decision} passed=${result.summary.passed} blocked=${result.summary.blocked} failed=${result.summary.failed}`);
    for (const blocker of result.blockers) {
      console.log(`[stable-release-gate] blocker ${blocker.id}: ${blocker.reason}`);
    }
    if (args.requireReady && result.decision !== "ready") process.exitCode = 2;
  } catch (error) {
    console.error(`[stable-release-gate] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
