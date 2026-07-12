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

function runtimeInput(value) {
  if (typeof value === "string") return value.trim() && value.length <= 200000 ? { ok: true, value } : { ok: false, error: "input must be a non-empty bounded string" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "input must be a string or object" };
  const text = typeof value.text === "string" ? value.text : "";
  const attachmentIds = Array.isArray(value.attachmentIds) ? value.attachmentIds : [];
  if (text.length > 200000 || attachmentIds.length > 8 || attachmentIds.some((id) => typeof id !== "string" || !/^att-[a-f0-9-]{36}$/.test(id))) {
    return { ok: false, error: "runtime input is invalid" };
  }
  if (!text.trim() && !attachmentIds.length) return { ok: false, error: "input is empty" };
  if (new Set(attachmentIds).size !== attachmentIds.length) return { ok: false, error: "attachment ids must be unique" };
  return { ok: true, value: { text, attachmentIds: [...attachmentIds] } };
}

function editorOpenRequest(value) {
  const data = optionalObject(value);
  const checkedPath = requireString(data.path, "path");
  if (!checkedPath.ok || !checkedPath.value.trim() || checkedPath.value.length > 4096 || checkedPath.value.includes("\0")) {
    return { ok: false, error: "path must be a non-empty bounded string" };
  }
  return { ok: true, value: { path: checkedPath.value } };
}

function editorSaveRequest(value) {
  const opened = editorOpenRequest(value);
  if (!opened.ok) return opened;
  const data = optionalObject(value);
  const content = requireString(data.content, "content");
  if (!content.ok || content.value.length > 2 * 1024 * 1024 || content.value.includes("\0")) {
    return { ok: false, error: "content must be bounded UTF-8 text" };
  }
  const revision = requireString(data.expectedRevision, "expectedRevision");
  if (!revision.ok || !/^sha256:[a-f0-9]{64}$/.test(revision.value)) {
    return { ok: false, error: "expectedRevision must be a valid SHA-256 revision" };
  }
  return {
    ok: true,
    value: {
      path: opened.value.path,
      content: content.value,
      expectedRevision: revision.value,
      force: data.force === true,
    },
  };
}

function terminalSessionId(value) {
  const checked = requireString(value, "terminalSessionId");
  if (!checked.ok || !/^terminal-[a-f0-9-]{36}$/.test(checked.value)) {
    return { ok: false, error: "terminalSessionId is invalid" };
  }
  return checked;
}

function terminalSize(value) {
  const data = optionalObject(value);
  const cols = Number(data.cols);
  const rows = Number(data.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 20 || cols > 400 || rows < 5 || rows > 200) {
    return { ok: false, error: "terminal size is invalid" };
  }
  return { ok: true, value: { cols: Math.round(cols), rows: Math.round(rows) } };
}

function terminalInput(value) {
  const checked = requireString(value, "terminalInput");
  if (!checked.ok || !checked.value || utf8Length(checked.value) > 64 * 1024) {
    return { ok: false, error: "terminal input is empty or too large" };
  }
  return checked;
}

function terminalEvent(value) {
  const data = optionalObject(value);
  if (!/^terminal-[a-f0-9-]{36}$/.test(String(data.sessionId || ""))) return null;
  if (!Number.isInteger(data.sequence) || data.sequence < 1) return null;
  if (data.type === "output") {
    if (typeof data.data !== "string" || utf8Length(data.data) > 64 * 1024) return null;
    return { type: "output", sessionId: data.sessionId, sequence: data.sequence, data: data.data };
  }
  if (data.type === "exit") {
    return {
      type: "exit",
      sessionId: data.sessionId,
      sequence: data.sequence,
      reason: typeof data.reason === "string" ? data.reason.slice(0, 64) : "closed",
      exitCode: Number.isInteger(data.exitCode) ? data.exitCode : null,
      signal: Number.isInteger(data.signal) ? data.signal : null,
    };
  }
  return null;
}

function previewId(value) {
  const checked = requireString(value, "previewId");
  if (!checked.ok || !/^preview-[a-f0-9-]{36}$/.test(checked.value)) {
    return { ok: false, error: "previewId is invalid" };
  }
  return checked;
}

function previewSelectors(value) {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > 12) return { ok: false, error: "preview selectors are invalid" };
  const selectors = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, error: "preview selector must be a string" };
    const selector = item.trim();
    if (!selector || selector.length > 256 || /[\u0000-\u001f\u007f]/.test(selector)) return { ok: false, error: "preview selector is invalid" };
    selectors.push(selector);
  }
  if (new Set(selectors).size !== selectors.length) return { ok: false, error: "preview selectors must be unique" };
  return { ok: true, value: selectors };
}

function previewOpenRequest(value) {
  const data = optionalObject(value);
  const checkedUrl = requireString(data.url, "url");
  if (!checkedUrl.ok || !checkedUrl.value.trim() || checkedUrl.value.length > 2048 || /[\u0000-\u001f\u007f]/.test(checkedUrl.value)) {
    return { ok: false, error: "preview URL is invalid" };
  }
  const checkedLabel = data.label === undefined ? { ok: true, value: "" } : requireString(data.label, "label");
  if (!checkedLabel.ok || checkedLabel.value.length > 120) return { ok: false, error: "preview label is invalid" };
  const checkedSelectors = previewSelectors(data.selectors);
  if (!checkedSelectors.ok) return checkedSelectors;
  return { ok: true, value: { url: checkedUrl.value.trim(), label: checkedLabel.value.trim(), selectors: checkedSelectors.value } };
}

function previewVerificationRequest(value) {
  const checked = previewSelectors(optionalObject(value).selectors);
  return checked.ok ? { ok: true, value: { selectors: checked.value } } : checked;
}

function previewEvent(value) {
  const data = optionalObject(value);
  const preview = optionalObject(data.preview);
  if (!["state", "navigation-blocked", "verification"].includes(data.type)) return null;
  if (!/^preview-[a-f0-9-]{36}$/.test(String(preview.id || ""))) return null;
  return { type: data.type, preview };
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

contextBridge.exposeInMainWorld("hicode", {
  onOutput: (cb) => typeof cb === "function" && ipcRenderer.on("output", (_e, s) => cb(String(s || ""))),
  onReady: (cb) => typeof cb === "function" && ipcRenderer.on("ready", (_e, d) => cb(optionalObject(d))),
  onAsk: (cb) => typeof cb === "function" && ipcRenderer.on("ask", (_e, d) => cb(optionalObject(d))),
  onTurnDone: (cb) => typeof cb === "function" && ipcRenderer.on("turn-done", () => cb()),
  onToolEvent: (cb) => typeof cb === "function" && ipcRenderer.on("tool-event", (_e, d) => cb(optionalObject(d))),
  onDiffsChanged: (cb) => typeof cb === "function" && ipcRenderer.on("diffs-changed", (_e, d) => cb(Array.isArray(d) ? d : [])),
  onRuntimeQueue: (cb) => typeof cb === "function" && ipcRenderer.on("runtime-queue", (_e, d) => cb(optionalObject(d))),
  onTerminalEvent: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, value) => {
      const normalized = terminalEvent(value);
      if (normalized) cb(normalized);
    };
    ipcRenderer.on("terminal:event", handler);
    return () => ipcRenderer.removeListener("terminal:event", handler);
  },
  onPreviewEvent: (cb) => {
    if (typeof cb !== "function") return () => {};
    const handler = (_event, value) => {
      const normalized = previewEvent(value);
      if (normalized) cb(normalized);
    };
    ipcRenderer.on("preview:event", handler);
    return () => ipcRenderer.removeListener("preview:event", handler);
  },
  send: (input) => {
    const checked = runtimeInput(input);
    if (!checked.ok) return checked;
    ipcRenderer.send("input", checked.value);
    return { ok: true };
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
  attachFile: (payload) => safeInvoke("attach-file", optionalObject(payload)),
  attachImage: (payload) => safeInvoke("attach-image", optionalObject(payload)),
  listAttachments: (sessionId) => sessionId === undefined ? safeInvoke("attachments:list") : checkedInvoke("attachments:list", sessionId, "sessionId"),
  removeAttachment: (id) => checkedInvoke("attachment:remove", id, "attachmentId"),
  getCwd: () => safeInvoke("get-cwd"),
  listDir: (dir) => checkedInvoke("list-dir", dir, "dir"),
  readFile: (p) => checkedInvoke("read-file", p, "path"),
  openEditorFile: (payload) => {
    const checked = editorOpenRequest(payload);
    return checked.ok ? safeInvoke("editor:file:open", checked.value) : Promise.resolve(checked);
  },
  saveEditorFile: (payload) => {
    const checked = editorSaveRequest(payload);
    return checked.ok ? safeInvoke("editor:file:save", checked.value) : Promise.resolve(checked);
  },
  getTerminalCapabilities: () => safeInvoke("terminal:capabilities"),
  createTerminal: (payload) => {
    const checked = terminalSize(payload);
    return checked.ok ? safeInvoke("terminal:create", checked.value) : Promise.resolve(checked);
  },
  getTerminalStatus: () => safeInvoke("terminal:status"),
  writeTerminal: (sessionId, input) => {
    const checkedId = terminalSessionId(sessionId);
    if (!checkedId.ok) return Promise.resolve(checkedId);
    const checkedInput = terminalInput(input);
    return checkedInput.ok ? safeInvoke("terminal:write", checkedId.value, checkedInput.value) : Promise.resolve(checkedInput);
  },
  resizeTerminal: (sessionId, payload) => {
    const checkedId = terminalSessionId(sessionId);
    if (!checkedId.ok) return Promise.resolve(checkedId);
    const checkedSize = terminalSize(payload);
    return checkedSize.ok ? safeInvoke("terminal:resize", checkedId.value, checkedSize.value) : Promise.resolve(checkedSize);
  },
  closeTerminal: (sessionId, reason = "user_closed") => {
    const checkedId = terminalSessionId(sessionId);
    if (!checkedId.ok) return Promise.resolve(checkedId);
    const checkedReason = requireString(reason, "reason");
    if (!checkedReason.ok || !/^[a-z0-9_-]{1,64}$/i.test(checkedReason.value)) return Promise.resolve({ ok: false, error: "terminal close reason is invalid" });
    return safeInvoke("terminal:close", checkedId.value, checkedReason.value);
  },
  getPreviewCapabilities: () => safeInvoke("preview:capabilities"),
  openPreview: (payload) => {
    const checked = previewOpenRequest(payload);
    return checked.ok ? safeInvoke("preview:open", checked.value) : Promise.resolve(checked);
  },
  listPreviews: () => safeInvoke("preview:list"),
  reopenPreview: (id) => {
    const checked = previewId(id);
    return checked.ok ? safeInvoke("preview:reopen", checked.value) : Promise.resolve(checked);
  },
  reloadPreview: (id) => {
    const checked = previewId(id);
    return checked.ok ? safeInvoke("preview:reload", checked.value) : Promise.resolve(checked);
  },
  verifyPreview: (id, payload) => {
    const checkedId = previewId(id);
    if (!checkedId.ok) return Promise.resolve(checkedId);
    const checkedPayload = previewVerificationRequest(payload);
    return checkedPayload.ok ? safeInvoke("preview:verify", checkedId.value, checkedPayload.value) : Promise.resolve(checkedPayload);
  },
  closePreview: (id, reason = "user_closed") => {
    const checkedId = previewId(id);
    if (!checkedId.ok) return Promise.resolve(checkedId);
    const checkedReason = requireString(reason, "reason");
    if (!checkedReason.ok || !/^[a-z0-9_-]{1,64}$/i.test(checkedReason.value)) return Promise.resolve({ ok: false, error: "preview close reason is invalid" });
    return safeInvoke("preview:close", checkedId.value, checkedReason.value);
  },
  removePreview: (id) => {
    const checked = previewId(id);
    return checked.ok ? safeInvoke("preview:remove", checked.value) : Promise.resolve(checked);
  },
  listSessions: () => safeInvoke("list-sessions"),
  resumeSession: (id) => checkedInvoke("resume-session", id, "sessionId"),
  newSession: () => safeInvoke("new-session"),
  readSession: (id) => checkedInvoke("read-session", id, "sessionId"),
  deleteSession: (id) => checkedInvoke("delete-session", id, "sessionId"),
  getConfig: () => safeInvoke("get-config"),
  saveConfig: (text) => checkedInvoke("save-config", text, "configText"),
  testModel: (profile) => safeInvoke("test-model", optionalObject(profile)),
  getAppInfo: () => safeInvoke("app:info"),
  getUsageStats: () => safeInvoke("usage:stats"),
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
