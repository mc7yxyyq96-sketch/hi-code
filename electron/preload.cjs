// Preload: expose a small, safe API to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

function safeInvoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((error) => ({
    ok: false,
    error: error && error.message ? error.message : String(error || "IPC failed"),
  }));
}

function requireString(value, field = "value") {
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  return { ok: true, value };
}

function optionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function checkedInvoke(channel, value, field = "value") {
  const checked = requireString(value, field);
  return checked.ok ? safeInvoke(channel, checked.value) : Promise.resolve(checked);
}

contextBridge.exposeInMainWorld("hicode", {
  onOutput: (cb) => typeof cb === "function" && ipcRenderer.on("output", (_e, s) => cb(String(s || ""))),
  onReady: (cb) => typeof cb === "function" && ipcRenderer.on("ready", (_e, d) => cb(optionalObject(d))),
  onAsk: (cb) => typeof cb === "function" && ipcRenderer.on("ask", (_e, d) => cb(optionalObject(d))),
  onTurnDone: (cb) => typeof cb === "function" && ipcRenderer.on("turn-done", () => cb()),
  onToolEvent: (cb) => typeof cb === "function" && ipcRenderer.on("tool-event", (_e, d) => cb(optionalObject(d))),
  onDiffsChanged: (cb) => typeof cb === "function" && ipcRenderer.on("diffs-changed", (_e, d) => cb(Array.isArray(d) ? d : [])),
  onRuntimeQueue: (cb) => typeof cb === "function" && ipcRenderer.on("runtime-queue", (_e, d) => cb(optionalObject(d))),
  send: (text) => {
    if (typeof text === "string") ipcRenderer.send("input", text);
  },
  answer: (id, value) => {
    if ((typeof id === "number" || typeof id === "string") && typeof value === "string") {
      ipcRenderer.send("ask-response", { id, value });
    }
  },
  interrupt: () => ipcRenderer.send("interrupt"),
  clearRuntimeQueue: () => safeInvoke("runtime-queue:clear"),
  authStatus: () => safeInvoke("auth-status"),
  register: (payload) => safeInvoke("register", optionalObject(payload)),
  login: (payload) => safeInvoke("login", optionalObject(payload)),
  logout: () => safeInvoke("logout"),
  listCapabilities: () => safeInvoke("list-capabilities"),
  listStore: (options) => safeInvoke("list-store", optionalObject(options)),
  setStoreSource: (sourceId) => checkedInvoke("set-store-source", sourceId, "sourceId"),
  previewStoreItem: (itemId) => checkedInvoke("preview-store-item", itemId, "itemId"),
  installStoreItem: (itemId, options) => {
    const checked = requireString(itemId, "itemId");
    return checked.ok ? safeInvoke("install-store-item", checked.value, optionalObject(options)) : Promise.resolve(checked);
  },
  getStoreItem: (itemId) => checkedInvoke("store:item", itemId, "itemId"),
  enableStoreItem: (itemId) => checkedInvoke("store:enable", itemId, "itemId"),
  disableStoreItem: (itemId) => checkedInvoke("store:disable", itemId, "itemId"),
  uninstallStoreItem: (itemId) => checkedInvoke("store:uninstall", itemId, "itemId"),
  listToolEvents: () => safeInvoke("tool-events:list"),
  listRecoverableTasks: (limit) => safeInvoke("recoverable-tasks:list", Number.isFinite(Number(limit)) ? Number(limit) : undefined),
  listDiffs: () => safeInvoke("diffs:list"),
  acceptDiff: (id) => checkedInvoke("diffs:accept", id, "diffId"),
  rejectDiff: (id) => checkedInvoke("diffs:reject", id, "diffId"),
  acceptAllDiffs: () => safeInvoke("diffs:accept-all"),
  rejectAllDiffs: () => safeInvoke("diffs:reject-all"),
  clearArchivedDiffs: () => safeInvoke("diffs:clear-archived"),
  gitStatus: () => safeInvoke("git:status"),
  gitDiff: (payload) => safeInvoke("git:diff", optionalObject(payload)),
  gitStage: (paths) => safeInvoke("git:stage", stringArray(paths)),
  gitUnstage: (paths) => safeInvoke("git:unstage", stringArray(paths)),
  gitCommitMessage: () => safeInvoke("git:commit-message"),
  gitCommit: (message) => checkedInvoke("git:commit", message, "message"),
  pickFolder: () => safeInvoke("pick-folder"),
  getCwd: () => safeInvoke("get-cwd"),
  listDir: (dir) => checkedInvoke("list-dir", dir, "dir"),
  readFile: (p) => checkedInvoke("read-file", p, "path"),
  listSessions: () => safeInvoke("list-sessions"),
  resumeSession: (id) => checkedInvoke("resume-session", id, "sessionId"),
  readSession: (id) => checkedInvoke("read-session", id, "sessionId"),
  deleteSession: (id) => checkedInvoke("delete-session", id, "sessionId"),
  getConfig: () => safeInvoke("get-config"),
  saveConfig: (text) => checkedInvoke("save-config", text, "configText"),
  testModel: (profile) => safeInvoke("test-model", optionalObject(profile)),
  getAppInfo: () => safeInvoke("app:info"),
  openDataDir: () => safeInvoke("app:open-data-dir"),
  revealConfigFile: () => safeInvoke("app:reveal-config"),
  openAppPage: (target) => checkedInvoke("app:open-page", target, "target"),
  checkUpdates: () => safeInvoke("app:check-updates"),
  createJob: (payload) => safeInvoke("job:create", optionalObject(payload)),
  listJobs: (options) => safeInvoke("job:list", optionalObject(options)),
  getJob: (jobId) => checkedInvoke("job:get", jobId, "jobId"),
  updateJob: (jobId, payload) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:update", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  appendJobEvent: (jobId, payload) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:event:add", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  addJobArtifact: (jobId, payload) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:artifact:add", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  addJobGateResult: (jobId, payload) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:gate:add", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  cancelJob: (jobId, options) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:cancel", checked.value, optionalObject(options)) : Promise.resolve(checked);
  },
  retryJob: (jobId, options) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:retry", checked.value, optionalObject(options)) : Promise.resolve(checked);
  },
  pauseJob: (jobId, options) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:pause", checked.value, optionalObject(options)) : Promise.resolve(checked);
  },
  resumeJob: (jobId, options) => {
    const checked = requireString(jobId, "jobId");
    return checked.ok ? safeInvoke("job:resume", checked.value, optionalObject(options)) : Promise.resolve(checked);
  },
  listJobEvents: (jobId) => checkedInvoke("job:events", jobId, "jobId"),
  listJobArtifacts: (jobId) => checkedInvoke("job:artifacts", jobId, "jobId"),
  previewJobArtifact: (jobId, artifactId) => {
    const checkedJob = requireString(jobId, "jobId");
    if (!checkedJob.ok) return Promise.resolve(checkedJob);
    const checkedArtifact = requireString(artifactId, "artifactId");
    return checkedArtifact.ok ? safeInvoke("job:artifact:preview", checkedJob.value, checkedArtifact.value) : Promise.resolve(checkedArtifact);
  },
  openJobArtifact: (jobId, artifactId) => {
    const checkedJob = requireString(jobId, "jobId");
    if (!checkedJob.ok) return Promise.resolve(checkedJob);
    const checkedArtifact = requireString(artifactId, "artifactId");
    return checkedArtifact.ok ? safeInvoke("job:artifact:open", checkedJob.value, checkedArtifact.value) : Promise.resolve(checkedArtifact);
  },
  listProviders: () => safeInvoke("provider:list"),
  getProvider: (providerId) => checkedInvoke("provider:get", providerId, "providerId"),
  configureProvider: (providerId, payload) => {
    const checked = requireString(providerId, "providerId");
    return checked.ok ? safeInvoke("provider:configure", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  runProvider: (providerId, payload) => {
    const checked = requireString(providerId, "providerId");
    return checked.ok ? safeInvoke("provider:run", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  cancelProvider: (providerId, payload) => {
    const checked = requireString(providerId, "providerId");
    return checked.ok ? safeInvoke("provider:cancel", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  createWorktree: (payload) => safeInvoke("worktree:create", optionalObject(payload)),
  runWorktree: (payload) => safeInvoke("worktree:run", optionalObject(payload)),
  collectWorktreeChanges: (payload) => safeInvoke("worktree:collectChanges", optionalObject(payload)),
  cleanupWorktree: (payload) => safeInvoke("worktree:cleanup", optionalObject(payload)),
  listArenaRuns: (options) => safeInvoke("arena:list", optionalObject(options)),
  getArenaRun: (runId) => checkedInvoke("arena:get", runId, "runId"),
  createArenaRun: (payload) => safeInvoke("arena:create", optionalObject(payload)),
  acceptArenaCandidate: (runId, candidateId, payload) => {
    const checkedRun = requireString(runId, "runId");
    if (!checkedRun.ok) return Promise.resolve(checkedRun);
    const checkedCandidate = requireString(candidateId, "candidateId");
    return checkedCandidate.ok ? safeInvoke("arena:acceptCandidate", checkedRun.value, checkedCandidate.value, optionalObject(payload)) : Promise.resolve(checkedCandidate);
  },
  rejectArenaCandidate: (runId, candidateId, payload) => {
    const checkedRun = requireString(runId, "runId");
    if (!checkedRun.ok) return Promise.resolve(checkedRun);
    const checkedCandidate = requireString(candidateId, "candidateId");
    return checkedCandidate.ok ? safeInvoke("arena:rejectCandidate", checkedRun.value, checkedCandidate.value, optionalObject(payload)) : Promise.resolve(checkedCandidate);
  },
  mergeArenaCandidate: (runId, candidateId, payload) => {
    const checkedRun = requireString(runId, "runId");
    if (!checkedRun.ok) return Promise.resolve(checkedRun);
    const checkedCandidate = requireString(candidateId, "candidateId");
    return checkedCandidate.ok ? safeInvoke("arena:mergeCandidate", checkedRun.value, checkedCandidate.value, optionalObject(payload)) : Promise.resolve(checkedCandidate);
  },
  previewArenaArtifact: (runId, candidateId, artifactPath) => {
    const checkedRun = requireString(runId, "runId");
    if (!checkedRun.ok) return Promise.resolve(checkedRun);
    const checkedCandidate = requireString(candidateId, "candidateId");
    if (!checkedCandidate.ok) return Promise.resolve(checkedCandidate);
    const checkedPath = requireString(artifactPath, "artifactPath");
    return checkedPath.ok ? safeInvoke("arena:artifact:preview", checkedRun.value, checkedCandidate.value, checkedPath.value) : Promise.resolve(checkedPath);
  },
  openArenaArtifact: (runId, candidateId, artifactPath) => {
    const checkedRun = requireString(runId, "runId");
    if (!checkedRun.ok) return Promise.resolve(checkedRun);
    const checkedCandidate = requireString(candidateId, "candidateId");
    if (!checkedCandidate.ok) return Promise.resolve(checkedCandidate);
    const checkedPath = requireString(artifactPath, "artifactPath");
    return checkedPath.ok ? safeInvoke("arena:artifact:open", checkedRun.value, checkedCandidate.value, checkedPath.value) : Promise.resolve(checkedPath);
  },
  getIndustrialProjectSchema: () => safeInvoke("industrial-project:schema"),
  getIndustrialProject: () => safeInvoke("industrial-project:get"),
  validateIndustrialProject: (payload) => safeInvoke("industrial-project:validate", optionalObject(payload)),
  saveIndustrialProject: (payload) => safeInvoke("industrial-project:save", optionalObject(payload)),
  buildIndustrialRequirementDraft: (payload) => safeInvoke("industrial-requirement:draft", optionalObject(payload)),
  addIndustrialRequirement: (payload) => safeInvoke("industrial-requirement:add", optionalObject(payload)),
  updateIndustrialRequirementCriteria: (payload) => safeInvoke("industrial-requirement:criteria:update", optionalObject(payload)),
  generateIndustrialArtifactPlan: (payload) => safeInvoke("industrial-requirement:artifact-plan", optionalObject(payload)),
  generateIndustrialTestPlan: (payload) => safeInvoke("industrial-requirement:test-plan", optionalObject(payload)),
  generateIndustrialSpecPackage: (payload) => safeInvoke("industrial-requirement:spec-package", optionalObject(payload)),
  approveIndustrialRequirement: (payload) => safeInvoke("industrial-requirement:approve", optionalObject(payload)),
  addIndustrialArtifact: (payload) => safeInvoke("industrial-project:artifact:add", optionalObject(payload)),
  addIndustrialTraceability: (payload) => safeInvoke("industrial-project:traceability:add", optionalObject(payload)),
  addIndustrialGateResult: (payload) => safeInvoke("industrial-project:gate:add", optionalObject(payload)),
  listDomainPacks: () => safeInvoke("domain-pack:list"),
  getDomainPack: (packId) => checkedInvoke("domain-pack:get", packId, "packId"),
  validateDomainPack: (payload) => safeInvoke("domain-pack:validate", optionalObject(payload)),
  installDomainPack: (payload) => safeInvoke("domain-pack:install", optionalObject(payload)),
  updateDomainPack: (payload) => safeInvoke("domain-pack:update", optionalObject(payload)),
  enableDomainPack: (packId, payload) => {
    const checked = requireString(packId, "packId");
    return checked.ok ? safeInvoke("domain-pack:enable", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  disableDomainPack: (packId, payload) => {
    const checked = requireString(packId, "packId");
    return checked.ok ? safeInvoke("domain-pack:disable", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  uninstallDomainPack: (packId, payload) => {
    const checked = requireString(packId, "packId");
    return checked.ok ? safeInvoke("domain-pack:uninstall", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  recommendDomainPacks: () => safeInvoke("domain-pack:recommend"),
  listAgentProfiles: (payload) => safeInvoke("agent-team:profiles", optionalObject(payload)),
  getAgentProfile: (profileId) => checkedInvoke("agent-team:profile:get", profileId, "profileId"),
  createAgentPlan: (payload) => safeInvoke("agent-team:plan:create", optionalObject(payload)),
  listAgentPlans: (payload) => safeInvoke("agent-team:plan:list", optionalObject(payload)),
  getAgentPlan: (planId) => checkedInvoke("agent-team:plan:get", planId, "planId"),
  createMultiAgentJob: (payload) => safeInvoke("agent-team:job:create", optionalObject(payload)),
  listToolchainAdapters: () => safeInvoke("toolchain:list"),
  detectToolchainAdapter: (adapterId, payload) => {
    const checked = requireString(adapterId, "adapterId");
    return checked.ok ? safeInvoke("toolchain:detect", checked.value, optionalObject(payload)) : Promise.resolve(checked);
  },
  getToolchainCapabilities: (adapterId) => checkedInvoke("toolchain:capabilities", adapterId, "adapterId"),
  validateToolchainAdapter: (payload) => safeInvoke("toolchain:validate-adapter", optionalObject(payload)),
  runToolchainAdapter: (payload) => safeInvoke("toolchain:run", optionalObject(payload)),
  listQualityGates: () => safeInvoke("quality-gate:list"),
  runQualityGate: (payload) => safeInvoke("quality-gate:run", optionalObject(payload)),
  approveQualityGate: (payload) => safeInvoke("quality-gate:approve", optionalObject(payload)),
  getReleaseReadiness: (payload) => safeInvoke("release:readiness", optionalObject(payload)),
  buildReleasePackage: (payload) => safeInvoke("release:build", optionalObject(payload)),
  openReleasePackage: (payload) => safeInvoke("release:open", optionalObject(payload)),
  createIndustrialControlBoxSample: (payload) => safeInvoke("sample:industrial-control-box:create", optionalObject(payload)),
});
