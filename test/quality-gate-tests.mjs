import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIpcRegistrar } from "../electron/ipc/ipc-utils.mjs";
import { createQualityGateService, registerQualityGateIpc } from "../electron/services/quality-gate-service.mjs";
import { IndustrialProjectStore } from "../dist/industrial-project.js";
import { JobStore } from "../dist/job-center.js";
import { QualityGateRunner, builtInQualityGates } from "../dist/quality-gates.js";

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

function commandGate(id, args) {
  return {
    id,
    name: id,
    type: "command_gate",
    category: "software",
    severity: "high",
    description: "test command gate",
    command: process.execPath,
    args,
    remediation: { summary: "fix command", steps: ["read evidence"] },
  };
}

console.log("\n[quality-gates] core runner");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-quality-gates-"));
const workspace = path.join(tmp, "workspace");
fs.mkdirSync(workspace, { recursive: true });
const artifactFile = path.join(workspace, "artifact.txt");
const schemaFile = path.join(workspace, "schema.json");
fs.writeFileSync(artifactFile, "ok\n");
fs.writeFileSync(schemaFile, JSON.stringify({ schemaVersion: 1, name: "Gate Schema" }));
const realArtifactFile = fs.realpathSync.native(artifactFile);

const runner = new QualityGateRunner({ cwd: workspace, timeoutMs: 5_000 });
const builtIns = builtInQualityGates();
check("built-in gates include required gate types", ["command_gate", "file_exists_gate", "schema_gate", "artifact_integrity_gate", "security_gate", "human_approval_gate", "adapter_gate", "documentation_gate"].every((type) => builtIns.some((gate) => gate.type === type)), builtIns.map((gate) => gate.type).join(", "));

const commandPass = await runner.runGate({ workspacePath: workspace, gate: commandGate("test.command.pass", ["-e", "console.log('pass')"]) });
check("command gate pass records evidence", commandPass.status === "passed" && commandPass.result.evidence.command.includes(process.execPath) && /pass/.test(commandPass.result.evidence.stdoutSummary), JSON.stringify(commandPass));

const commandFail = await runner.runGate({ workspacePath: workspace, gate: commandGate("test.command.fail", ["-e", "console.error('fail')\nprocess.exit(2)"]) });
check("command gate fail records stderr", commandFail.status === "failed" && /fail/.test(commandFail.result.evidence.stderrSummary), JSON.stringify(commandFail));

const fileGate = await runner.runGate({
  workspacePath: workspace,
  gate: {
    id: "test.file.exists",
    name: "file exists",
    type: "file_exists_gate",
    category: "software",
    severity: "medium",
    description: "file exists",
    remediation: { summary: "create file", steps: ["write file"] },
  },
  artifactPaths: ["artifact.txt"],
});
check("file exists gate passes for workspace artifact", fileGate.status === "passed" && fileGate.result.evidence.artifactLinks[0] === realArtifactFile, JSON.stringify(fileGate));

const schemaGate = await runner.runGate({
  workspacePath: workspace,
  gate: {
    id: "test.schema",
    name: "schema gate",
    type: "schema_gate",
    category: "software",
    severity: "medium",
    description: "schema gate",
    requiredFields: ["schemaVersion", "name"],
    remediation: { summary: "fix schema", steps: ["add fields"] },
  },
  schemaValue: { schemaVersion: 1, name: "ok" },
});
check("schema gate validates required fields", schemaGate.status === "passed", JSON.stringify(schemaGate));

const simulatedAdapter = await runner.runGate({
  workspacePath: workspace,
  gate: {
    id: "test.adapter.simulated",
    name: "adapter simulated",
    type: "adapter_gate",
    category: "adapter",
    severity: "high",
    description: "adapter gate",
    adapterId: "freecad",
    remediation: { summary: "run real adapter", steps: ["install tool"] },
  },
  adapterResult: { ok: true, adapterId: "freecad", simulated: true, artifacts: [{ path: artifactFile }] },
});
check("simulated adapter gate is not passed", simulatedAdapter.status === "simulated" && simulatedAdapter.status !== "passed", JSON.stringify(simulatedAdapter));

const approvalPending = await runner.runGate({
  workspacePath: workspace,
  gate: {
    id: "test.human.approval",
    name: "human approval",
    type: "human_approval_gate",
    category: "approval",
    severity: "critical",
    description: "human approval",
    requiresApproval: true,
    remediation: { summary: "approve", steps: ["human review"] },
  },
});
check("human approval gate requires approval", approvalPending.status === "requires_approval" && approvalPending.result.evidence.manualApprovalRequired === true, JSON.stringify(approvalPending));

const approvalPassed = await runner.runGate({
  workspacePath: workspace,
  gate: approvalPending.result,
  approval: { status: "approved", actor: "tester" },
}).catch((error) => ({ error }));
check("invalid custom result cannot be used as gate", approvalPassed.error instanceof Error);

const approvalGate = builtIns.find((gate) => gate.id === "bim.code_check_manual_approval");
const approved = await runner.runGate({ workspacePath: workspace, gate: approvalGate, approval: { status: "approved", actor: "tester" } });
check("approved human gate passes", approved.status === "passed" && approved.result.evidence.manualApprovalRequired === false, JSON.stringify(approved));

console.log("\n[quality-gates] service, persistence, project");
const projectStore = new IndustrialProjectStore({ workspacePath: workspace });
projectStore.createProject({ name: "Quality Gate Project", type: "software_release", domains: ["software", "qa"], actor: "tester" });
const jobStore = new JobStore({ storePath: path.join(tmp, "jobs.json"), allowedArtifactRoots: [workspace], idPrefix: "quality-job" });
const service = createQualityGateService({ getCwd: () => workspace, jobStore });
const serviceRun = await service.runGate({
  gate: {
    id: "test.service.file",
    name: "service file",
    type: "file_exists_gate",
    category: "software",
    severity: "medium",
    description: "service file gate",
    remediation: { summary: "create file", steps: ["write file"] },
  },
  artifactPaths: ["artifact.txt"],
  actor: "tester",
});
check("service run returns gate result", serviceRun.ok === true && serviceRun.run.status === "passed" && serviceRun.gateResult.status === "passed", JSON.stringify(serviceRun));
const serviceJob = jobStore.getJob(serviceRun.jobId);
check("gate result writes to Job Center", serviceJob?.gateResults.some((gate) => gate.gate === "test.service.file") && serviceJob?.artifacts.some((artifact) => artifact.type === "quality_gate_evidence"), JSON.stringify(serviceJob));
const projectAfterGate = projectStore.getProject();
check("gate result writes to Industrial Project", projectAfterGate.qualityGates.some((gate) => gate.id === "quality-test.service.file" && gate.status === "passed" && gate.resultPath), JSON.stringify(projectAfterGate.qualityGates));

const approvalServiceRun = await service.approveGate({ gateId: "bim.code_check_manual_approval", approved: false, actor: "tester", reason: "not reviewed" });
check("service approval reject writes failed result", approvalServiceRun.ok === true && approvalServiceRun.run.status === "failed", JSON.stringify(approvalServiceRun));

console.log("\n[quality-gates] IPC");
const ipc = fakeIpcMain();
const register = createIpcRegistrar(ipc);
registerQualityGateIpc({ register, qualityGate: service });
check("IPC exposes quality-gate:list", ipc.handles.has("quality-gate:list"));
check("IPC exposes quality-gate:run", ipc.handles.has("quality-gate:run"));
check("IPC exposes quality-gate:approve", ipc.handles.has("quality-gate:approve"));
const ipcList = await ipc.handles.get("quality-gate:list")({});
check("IPC list returns built-in gates", ipcList.ok === true && ipcList.gates.length >= 8, JSON.stringify(ipcList));
const ipcRun = await ipc.handles.get("quality-gate:run")({}, { gateId: "software.security_sensitive_file_changed", changedFiles: ["electron/preload.cjs"], actor: "tester" });
check("IPC run calls real service path", ipcRun.ok === true && ipcRun.run.status === "warning", JSON.stringify(ipcRun));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
