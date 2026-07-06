import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIpcRegistrar } from "../electron/ipc/ipc-utils.mjs";
import { registerIpcHandlers } from "../electron/ipc/register-ipc-handlers.mjs";
import { createRuntimeService } from "../electron/services/runtime-service.mjs";
import { createQueueService } from "../electron/services/queue-service.mjs";
import { createGitService } from "../electron/services/git-service.mjs";
import { createPathGuard, redactSensitive } from "../electron/services/security-service.mjs";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

function fakeIpcMain() {
  const handles = new Map();
  const events = new Map();
  return {
    handles,
    events,
    handle(channel, fn) {
      handles.set(channel, fn);
    },
    on(channel, fn) {
      events.set(channel, fn);
    },
  };
}

console.log("\n[services] ipc utils");
const ipc = fakeIpcMain();
const logs = [];
const registrar = createIpcRegistrar(ipc, { logger: (event, payload) => logs.push({ event, payload }) });
registrar.handle("ok", () => ({ ok: true, value: 42 }));
registrar.handle("fail", () => {
  throw new Error("bad token=sk-secret123456789");
});
check("ipc-utils registers success handler", (await ipc.handles.get("ok")({}, {})).value === 42);
const failed = await ipc.handles.get("fail")({}, {});
check("ipc-utils normalizes failed handler", failed.ok === false && failed.error.includes("[REDACTED]"), JSON.stringify(failed));
check("ipc-utils logs redacted errors", JSON.stringify(logs).includes("[REDACTED]") && !JSON.stringify(logs).includes("sk-secret123456789"), JSON.stringify(logs));

console.log("\n[services] smoke");
let cleared = false;
const queue = createQueueService({
  inputQueue: {
    clearQueued() {
      cleared = true;
      return 2;
    },
    state() {
      return { running: null, queued: [], history: [] };
    },
  },
});
check("queue service clears runtime queue", queue.clearRuntimeQueue().count === 2 && cleared);

let gitCwd = "";
const git = createGitService({
  getCwd: () => "/tmp/project",
  gitWorkflowStatus: (cwd) => ({ ok: true, cwd }),
  gitFileDiff: (cwd, file, staged) => ({ cwd, file, staged }),
  gitStage: (cwd, files) => ({ cwd, files }),
  gitUnstage: (cwd, files) => ({ cwd, files }),
  gitGenerateCommitMessage: (cwd) => {
    gitCwd = cwd;
    return { ok: true, message: "msg" };
  },
  gitCommit: (cwd, message) => ({ cwd, message }),
});
check("git service preserves cwd boundary", git.commitMessage().message === "msg" && gitCwd === "/tmp/project");
check("git service validates path arrays", git.stage(["a.js", 1, "b.js"]).files.join(",") === "a.js,b.js");

let runtimeMetadata = null;
const runtimeService = createRuntimeService({
  getRuntime: () => ({ abort: () => false }),
  askResolvers: new Map(),
  send: () => {},
  getCwd: () => "/tmp/project",
  inputQueue: {
    enqueue(input, metadata) {
      runtimeMetadata = metadata;
      return { id: "runtime-job-1", input, status: "queued", queuedAt: Date.now(), metadata };
    },
    state() {
      return { running: null, queued: [], history: [] };
    },
    clearQueued() {
      return 0;
    },
  },
  jobStore: {
    createJob(input) {
      return { id: "center-job-1", ...input };
    },
  },
});
const runtimeEnqueue = runtimeService.enqueueInput("run tests");
check("runtime service links Runtime Queue to Job Center", runtimeEnqueue.ok && runtimeEnqueue.jobCenterId === "center-job-1" && runtimeMetadata?.jobCenterId === "center-job-1");

const ipc2 = fakeIpcMain();
registerIpcHandlers({
  ipcMain: ipc2,
  services: {
    runtime: {
      enqueueInput: () => ({ ok: true }),
      answerAsk: () => ({ ok: true }),
      interrupt: () => ({ ok: true }),
    },
    queue,
    security: {
      authStatus: () => ({ user: null }),
      register: () => ({ ok: true }),
      login: () => ({ ok: true }),
      logout: () => ({ ok: true }),
    },
    mcp: { listCapabilities: () => ({ plugins: [], skills: [], mcp: [] }) },
    store: {
      listStore: () => ({ items: [] }),
      setStoreSource: () => ({ ok: true }),
      previewStoreItem: () => ({ ok: true }),
      installStoreItem: () => ({ ok: true }),
      getStoreItemDetail: () => ({ ok: true }),
      enableStoreItem: () => ({ ok: true }),
      disableStoreItem: () => ({ ok: true }),
      uninstallStoreItem: () => ({ ok: true }),
    },
    job: {
      createJob: () => ({ ok: true, job: { id: "job-1" } }),
      listJobs: () => ({ ok: true, jobs: [] }),
      getJob: () => ({ ok: true, job: { id: "job-1" } }),
      updateJob: () => ({ ok: true, job: { id: "job-1" } }),
      appendJobEvent: () => ({ ok: true, event: { id: "evt-1" } }),
      addArtifact: () => ({ ok: true, artifact: { id: "artifact-1" } }),
      addGateResult: () => ({ ok: true, gateResult: { id: "gate-1" } }),
      cancelJob: () => ({ ok: true, job: { id: "job-1" } }),
      retryJob: () => ({ ok: true, job: { id: "job-1" } }),
      pauseJob: () => ({ ok: true, job: { id: "job-1" } }),
      resumeJob: () => ({ ok: true, job: { id: "job-1" } }),
      listEvents: () => ({ ok: true, events: [] }),
      listArtifacts: () => ({ ok: true, artifacts: [] }),
      previewArtifact: () => ({ ok: true, content: "artifact" }),
      openArtifact: () => ({ ok: true }),
    },
    provider: {
      listProviders: () => ({ ok: true, providers: [] }),
      getProvider: () => ({ ok: true, provider: { id: "hicode-internal" } }),
      configureProvider: () => ({ ok: true, provider: { id: "hicode-internal" } }),
      runProvider: () => ({ ok: true, result: { providerId: "hicode-internal", runId: "run-1" } }),
      cancelProvider: () => ({ ok: true, result: { providerId: "hicode-internal", runId: "run-1" } }),
    },
    worktree: {
      createWorkspace: () => ({ ok: true, workspace: { id: "workspace-1" } }),
      run: () => ({ ok: true, workspace: { id: "workspace-1" } }),
      collectChanges: () => ({ ok: true, changes: { changedFiles: [] } }),
      cleanupWorkspace: () => ({ ok: true, cleanup: { removed: true } }),
    },
    arena: {
      listRuns: () => ({ ok: true, runs: [] }),
      getRun: () => ({ ok: true, run: { id: "arena-1" } }),
      runArena: () => ({ ok: true, run: { id: "arena-1" } }),
      acceptCandidate: () => ({ ok: true }),
      rejectCandidate: () => ({ ok: true }),
      mergeCandidate: () => ({ ok: true }),
      previewArtifact: () => ({ ok: true, content: "patch" }),
      openArtifact: () => ({ ok: true }),
    },
    industrialProject: {
      schema: () => ({ ok: true, domains: [] }),
      getProject: () => ({ ok: true, project: null }),
      validateProject: () => ({ ok: true, errors: [] }),
      saveProject: () => ({ ok: true, project: { projectId: "industrial-1" } }),
      buildRequirementDraft: () => ({ ok: true, draft: { requirementId: "REQ-1" } }),
      addRequirement: () => ({ ok: true, requirement: { requirementId: "REQ-1" } }),
      updateRequirementCriteria: () => ({ ok: true, requirement: { requirementId: "REQ-1" } }),
      generateArtifactPlan: () => ({ ok: true, plan: { requirementId: "REQ-1" } }),
      generateTestPlan: () => ({ ok: true, plan: { requirementId: "REQ-1" } }),
      generateSpecPackage: () => ({ ok: true, spec: { requirementId: "REQ-1" } }),
      approveRequirement: () => ({ ok: true, approval: { id: "approval-1" } }),
      addArtifact: () => ({ ok: true, artifact: { id: "artifact-1" } }),
      addTraceability: () => ({ ok: true, traceability: { id: "trace-1" } }),
      addGateResult: () => ({ ok: true, gate: { id: "gate-1" } }),
    },
    domainPack: {
      listDomainPacks: () => ({ ok: true, packs: [] }),
      getDomainPack: () => ({ ok: true, pack: { manifest: { id: "software-product" } } }),
      validateDomainPack: () => ({ ok: true, errors: [], manifest: { id: "software-product" } }),
      installDomainPack: () => ({ ok: true, pack: { manifest: { id: "software-product" } } }),
      updateDomainPack: () => ({ ok: true, pack: { manifest: { id: "software-product" } } }),
      enableDomainPack: () => ({ ok: true, pack: { manifest: { id: "software-product" } } }),
      disableDomainPack: () => ({ ok: true, pack: { manifest: { id: "software-product" } } }),
      uninstallDomainPack: () => ({ ok: true, id: "software-product" }),
      recommendDomainPacks: () => ({ ok: true, packs: [] }),
    },
    agentTeam: {
      listAgentProfiles: () => ({ ok: true, profiles: [] }),
      getAgentProfile: () => ({ ok: true, profile: { id: "product-manager" } }),
      createAgentPlan: () => ({ ok: true, plan: { id: "agent-plan-1" } }),
      listAgentPlans: () => ({ ok: true, plans: [] }),
      getAgentPlan: () => ({ ok: true, plan: { id: "agent-plan-1" } }),
      createMultiAgentJob: () => ({ ok: true, job: { id: "job-1" }, plan: { id: "agent-plan-1" } }),
    },
    industrialTool: {
      listAdapters: () => ({ ok: true, adapters: [], toolRequirements: [] }),
      detectAdapter: () => ({ ok: true, detection: { adapterId: "kicad", installed: false } }),
      getAdapterCapabilities: () => ({ ok: true, capabilities: [] }),
      validateAdapterConfig: () => ({ ok: true, errors: [], adapter: { id: "kicad" } }),
      runAdapterTask: () => ({ ok: true, result: { adapterId: "kicad", simulated: true } }),
    },
    qualityGate: {
      listGates: () => ({ ok: true, gates: [] }),
      runGate: () => ({ ok: true, run: { id: "gate-run-1" } }),
      approveGate: () => ({ ok: true, run: { id: "gate-run-1", status: "passed" } }),
    },
    release: {
      readiness: () => ({ ok: true, readiness: { ready: true, version: "1.0.0" } }),
      buildRelease: () => ({ ok: true, releasePackage: { releaseId: "release-1" } }),
      openRelease: () => ({ ok: true, releasePath: "/tmp/project/releases/1.0.0" }),
    },
    sampleProject: {
      createIndustrialControlBox: () => ({ ok: true, sample: { sampleId: "industrial-control-box-demo" } }),
    },
    diff: {
      listToolEvents: () => [],
      listRecoverableTasks: () => [],
      listDiffs: () => [],
      acceptDiff: () => ({ ok: true }),
      rejectDiff: () => ({ ok: true }),
      acceptAllDiffs: () => ({ ok: true }),
      rejectAllDiffs: () => ({ ok: true }),
      clearArchivedDiffs: () => ({ ok: true }),
    },
    git,
    workspace: {
      pickFolder: () => "/tmp/project",
      getCwd: () => "/tmp/project",
      listDir: () => [],
      readFile: () => ({ content: "" }),
      listSessions: () => [],
      resumeSession: () => [],
      deleteSession: () => true,
      getConfig: () => "",
      saveConfig: () => ({ ok: true }),
      testModel: () => ({ ok: true }),
    },
  },
});
for (const channel of ["runtime-queue:clear", "auth-status", "list-store", "store:item", "store:enable", "store:disable", "store:uninstall", "job:create", "job:list", "job:get", "job:cancel", "job:retry", "job:pause", "job:resume", "job:events", "job:artifacts", "job:artifact:preview", "job:artifact:open", "provider:list", "provider:get", "provider:configure", "provider:run", "provider:cancel", "worktree:create", "worktree:run", "worktree:collectChanges", "worktree:cleanup", "arena:list", "arena:get", "arena:create", "arena:acceptCandidate", "arena:rejectCandidate", "arena:mergeCandidate", "arena:artifact:preview", "arena:artifact:open", "industrial-project:schema", "industrial-project:get", "industrial-project:validate", "industrial-project:save", "industrial-requirement:draft", "industrial-requirement:add", "industrial-requirement:criteria:update", "industrial-requirement:artifact-plan", "industrial-requirement:test-plan", "industrial-requirement:spec-package", "industrial-requirement:approve", "industrial-project:artifact:add", "industrial-project:traceability:add", "industrial-project:gate:add", "domain-pack:list", "domain-pack:get", "domain-pack:validate", "domain-pack:install", "domain-pack:update", "domain-pack:enable", "domain-pack:disable", "domain-pack:uninstall", "domain-pack:recommend", "agent-team:profiles", "agent-team:profile:get", "agent-team:plan:create", "agent-team:plan:list", "agent-team:plan:get", "agent-team:job:create", "toolchain:list", "toolchain:detect", "toolchain:capabilities", "toolchain:validate-adapter", "toolchain:run", "quality-gate:list", "quality-gate:run", "quality-gate:approve", "release:readiness", "release:build", "release:open", "sample:industrial-control-box:create", "diffs:list", "git:status", "read-file"]) {
  check(`register-ipc-handlers exposes ${channel}`, ipc2.handles.has(channel));
}
for (const channel of ["input", "ask-response", "interrupt"]) {
  check(`register-ipc-handlers preserves ${channel} event`, ipc2.events.has(channel));
}

console.log("\n[services] security");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-service-test-"));
const inside = path.join(tmp, "inside.txt");
const outside = path.join(os.tmpdir(), `hicode-outside-${Date.now()}.txt`);
fs.writeFileSync(inside, "ok");
fs.writeFileSync(outside, "no");
const guard = createPathGuard({ roots: [tmp] });
check("security-service allows paths inside roots", guard.assertInside(inside).ok === true);
check("security-service rejects paths outside roots", guard.assertInside(outside).ok === false);
const redacted = redactSensitive({ apiKey: "sk-secret123456789", nested: { authorization: "Bearer abcdef" }, ok: "visible" });
check("security-service redacts sensitive fields", redacted.apiKey === "[REDACTED]" && redacted.nested.authorization === "[REDACTED]" && redacted.ok === "visible", JSON.stringify(redacted));
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(outside, { force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
