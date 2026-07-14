import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectStableReleaseInputs,
  evaluateStableReleaseGate,
  writeStableReleaseGateOutputs,
} from "../scripts/stable-release-gate.mjs";

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function manifest(commandIds) {
  return {
    summary: { allPassed: true },
    commands: commandIds.map((id) => ({ id, status: "passed" })),
  };
}

function readyInput() {
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
    "HC-PROV-301",
  ];
  const tasks = taskIds.map((id) => ({ id, status: "completed" }));
  return {
    version: "0.6.0-rc.1",
    board: { tasks },
    risks: {
      risks: [
        { id: "RISK-REL-001", severity: "medium", status: "mitigated", owner: "security-release", title: "Signing verified" },
      ],
    },
    manifests: {
      "HC-RUN-201": manifest(["runtime-clients", "runtime-concurrency", "electron-e2e"]),
      "HC-RUN-202": manifest(["runtime-protocol", "runtime-store-integration"]),
      "HC-RUN-203": manifest(["turn-recovery"]),
      "HC-UI-310": manifest(["editor-workbench-tests"]),
      "HC-UI-311": manifest(["terminal-tests"]),
      "HC-UI-312": manifest(["preview-tests"]),
      "HC-GIT-320": manifest(["git-collaboration"]),
      "HC-REL-420": manifest(["release-pipeline-tests", "checksum-verification"]),
      "HC-MCP-410": manifest(["mcp-tests", "security-tests", "dod-scan"]),
      "HC-PROV-301": manifest(["provider-hardening-tests", "security-tests", "dod-scan"]),
    },
    releaseCi: {
      jobs: [
        { platform: "ubuntu-latest", status: "completed", conclusion: "success", electronSmoke: "success", packageSmoke: "success", integritySmoke: "success", updateSmoke: "success" },
        { platform: "macos-latest", status: "completed", conclusion: "success", electronSmoke: "success", packageSmoke: "success", signatureSmoke: "success", notarizationSmoke: "success", updateSmoke: "success" },
        { platform: "windows-latest", status: "completed", conclusion: "success", electronSmoke: "success", packageSmoke: "success", signatureSmoke: "success", updateSmoke: "success" },
      ],
      annotations: [],
    },
    docs: {
      releasePipeline: "development: Unsigned and update-disabled. Current evidence cannot claim commercial signing.",
      releaseTask: "Treating unsigned macOS/Windows packages as stable release artifacts is forbidden.",
      executionPlan: "签名安装包和更新链路通过",
    },
    issues: [],
    source: { commit: "abc123", branch: "codex/test" },
    evaluatedAt: "2026-07-13T00:00:00.000Z",
  };
}

await test("ready requires signed package and update-chain evidence", () => {
  const result = evaluateStableReleaseGate(readyInput());
  assert.equal(result.engineeringStatus, "passed");
  assert.equal(result.internalStatus, "READY_FOR_FORMAL_RELEASE");
  assert.equal(result.decision, "ready");
  assert.equal(result.summary.blocked, 0);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.formalReleaseCreated, false);
  assert.equal(result.tagCreated, false);
});

await test("missing platform update-chain evidence blocks stable promotion", () => {
  const input = readyInput();
  delete input.releaseCi.jobs.find((job) => job.platform === "windows-latest").updateSmoke;
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "passed");
  assert.equal(result.internalStatus, "PASS_INTERNAL_ONLY");
  assert.equal(result.decision, "blocked");
  assert.equal(result.conditions.find((item) => item.id === "signed-release-chain")?.status, "blocked");
  assert.ok(result.blockers.some((item) => item.id === "RISK-REL-001"));
});

await test("unsigned artifacts block promotion without failing engineering", () => {
  const input = readyInput();
  input.risks.risks[0].status = "open";
  delete input.releaseCi.jobs[1].signatureSmoke;
  delete input.releaseCi.jobs[1].notarizationSmoke;
  delete input.releaseCi.jobs[2].signatureSmoke;
  input.releaseCi.annotations.push({ severity: "warning", message: "Packages remain unsigned and update-disabled." });
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "passed");
  assert.equal(result.internalStatus, "PASS_INTERNAL_ONLY");
  assert.equal(result.decision, "blocked");
  assert.equal(result.conditions.find((item) => item.id === "signed-release-chain")?.status, "blocked");
  assert.ok(result.blockers.some((item) => item.id === "RISK-REL-001"));
});

await test("an open high program risk blocks stable promotion", () => {
  const input = readyInput();
  input.risks.risks.push({
    id: "RISK-PROV-001",
    severity: "high",
    status: "open",
    owner: "runtime-engine",
    title: "Provider risk is unresolved",
  });
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.internalStatus, "BLOCKED");
  assert.equal(result.decision, "blocked");
  assert.equal(result.conditions.find((item) => item.id === "release-risk-disposition")?.status, "blocked");
  assert.ok(result.blockers.some((item) => item.id === "RISK-PROV-001"));
});

await test("missing Provider hardening evidence rejects the engineering gate", () => {
  const input = readyInput();
  input.manifests["HC-PROV-301"].commands = input.manifests["HC-PROV-301"].commands
    .filter((command) => command.id !== "provider-hardening-tests");
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.internalStatus, "FAILED");
  assert.equal(result.decision, "rejected");
  assert.equal(result.conditions.find((item) => item.id === "provider-production-hardening")?.status, "failed");
});

await test("missing replay evidence rejects the engineering gate", () => {
  const input = readyInput();
  input.manifests["HC-RUN-202"].commands = input.manifests["HC-RUN-202"].commands
    .filter((command) => command.id !== "runtime-store-integration");
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.internalStatus, "FAILED");
  assert.equal(result.decision, "rejected");
  assert.equal(result.conditions.find((item) => item.id === "complete-turn-replay")?.status, "failed");
});

await test("failed platform smoke cannot be hidden by successful package jobs", () => {
  const input = readyInput();
  input.releaseCi.jobs.find((job) => job.platform === "windows-latest").electronSmoke = "failed";
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.decision, "rejected");
  assert.equal(result.conditions.find((item) => item.id === "three-platform-electron-smoke")?.status, "failed");
});

await test("open P0 or P1 board work rejects the engineering gate", () => {
  const input = readyInput();
  input.board.tasks.push({ id: "HC-BLOCKED-001", priority: "P1", status: "in_progress" });
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.decision, "rejected");
  assert.equal(result.conditions.find((item) => item.id === "p0-p1-release-work")?.status, "failed");
});

await test("open P0 or P1 audit issues reject the engineering gate", () => {
  const input = readyInput();
  input.issues.push({ id: "P0-001", severity: "P0", status: "open" });
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.decision, "rejected");
  assert.match(
    result.conditions.find((item) => item.id === "p0-p1-release-work")?.reason || "",
    /P0-001/,
  );
});

await test("deferred P0 or P1 audit issues still reject stable engineering", () => {
  const input = readyInput();
  input.issues.push({ id: "P1-001", severity: "P1", status: "deferred" });
  const result = evaluateStableReleaseGate(input);
  assert.equal(result.engineeringStatus, "failed");
  assert.equal(result.decision, "rejected");
  assert.match(
    result.conditions.find((item) => item.id === "p0-p1-release-work")?.reason || "",
    /P1-001/,
  );
});

await test("gate output records decision without creating a release or tag", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-stable-gate-"));
  try {
    const input = readyInput();
    input.risks.risks[0].status = "open";
    const result = evaluateStableReleaseGate(input);
    writeStableReleaseGateOutputs(root, result);
    const json = JSON.parse(fs.readFileSync(path.join(root, "reports/evidence/HC-REL-STABLE-GATE/gate-result.json"), "utf8"));
    const report = fs.readFileSync(path.join(root, "reports/releases/0.6.0-stable/gate-report.md"), "utf8");
    assert.equal(json.decision, "blocked");
    assert.equal(json.internalStatus, "PASS_INTERNAL_ONLY");
    assert.equal(json.formalReleaseCreated, false);
    assert.equal(json.tagCreated, false);
    assert.match(report, /Formal Release created: \*\*No\*\*/);
    assert.match(report, /Internal status: \*\*PASS_INTERNAL_ONLY\*\*/);
    assert.match(report, /stable promotion is not authorized/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test("repository evidence produces a fail-closed stable assessment", () => {
  const result = evaluateStableReleaseGate(collectStableReleaseInputs());
  assert.equal(result.engineeringStatus, "passed");
  assert.equal(result.internalStatus, "PASS_INTERNAL_ONLY");
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some((item) => item.id === "RISK-REL-001"));
  assert.ok(!result.blockers.some((item) => item.id === "RISK-PROV-001"));
  assert.equal(result.conditions.find((item) => item.id === "provider-production-hardening")?.status, "passed");
  assert.deepEqual(result.summary, { total: 13, passed: 12, blocked: 1, failed: 0 });
});

console.log(`\nStable release gate tests: ${passed}/${passed} passed`);
