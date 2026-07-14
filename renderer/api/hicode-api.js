const DEFAULT_ERROR = "操作失败，请稍后重试。";

export function createHiCodeApi(rawApi = window.hicode, { onError = null } = {}) {
  const api = rawApi || {};

  const notifyError = (error, fallback = DEFAULT_ERROR, { silent = false } = {}) => {
    const message = userMessage(error, fallback);
    if (!silent && typeof onError === "function") onError(message);
    return message;
  };

  const fallbackWithError = (fallback, message) => {
    if (typeof fallback === "function") return fallback(message);
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) return { ...fallback, error: message };
    return fallback;
  };

  const call = async (name, args = [], fallback = { ok: false, error: DEFAULT_ERROR }, options = {}) => {
    const fn = api[name];
    if (typeof fn !== "function") {
      const message = notifyError(`当前版本不支持 ${name}`, DEFAULT_ERROR, options);
      return fallbackWithError(fallback, message);
    }
    try {
      const result = await fn(...args);
      if (result && typeof result === "object" && result.ok === false) {
        notifyError(result.error || DEFAULT_ERROR, DEFAULT_ERROR, options);
      }
      return result;
    } catch (error) {
      const message = notifyError(error, DEFAULT_ERROR, options);
      return fallbackWithError(fallback, message);
    }
  };

  const listen = (name, handler) => {
    const fn = api[name];
    if (typeof fn !== "function" || typeof handler !== "function") return () => {};
    const unsubscribe = fn((payload) => {
      try {
        handler(payload);
      } catch (error) {
        notifyError(error, `${name} 事件处理失败`);
      }
    });
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  };

  return {
    has: (name) => typeof api[name] === "function",
    send: (text) => call("send", [text], { ok: false }),
    steer: (text) => call("steer", [text], { ok: false }),
    answer: (id, value) => call("answer", [id, value], { ok: false }),
    interrupt: () => call("interrupt", [], { ok: false }),
    clearRuntimeQueue: () => call("clearRuntimeQueue", [], { ok: false, count: 0 }),
    listToolEvents: () => call("listToolEvents", [], []),
    listRecoverableTasks: (limit) => call("listRecoverableTasks", [limit], []),
    listDiffs: () => call("listDiffs", [], []),
    acceptDiff: (id) => call("acceptDiff", [id]),
    rejectDiff: (id) => call("rejectDiff", [id]),
    acceptAllDiffs: () => call("acceptAllDiffs", []),
    rejectAllDiffs: () => call("rejectAllDiffs", []),
    clearArchivedDiffs: () => call("clearArchivedDiffs", []),
    gitStatus: () => call("gitStatus", [], { ok: false, error: "Git 状态读取失败" }),
    gitDiff: (payload) => call("gitDiff", [payload], { ok: false, error: "Git diff 读取失败" }),
    gitStage: (paths) => call("gitStage", [paths]),
    gitUnstage: (paths) => call("gitUnstage", [paths]),
    gitCommitMessage: () => call("gitCommitMessage", []),
    gitCommit: (message) => call("gitCommit", [message]),
    gitBranches: () => call("gitBranches", [], { ok: false, branches: [], error: "分支读取失败" }),
    gitCreateBranch: (payload) => call("gitCreateBranch", [payload]),
    gitSwitchBranch: (payload) => call("gitSwitchBranch", [payload]),
    gitCollaboration: () => call("gitCollaboration", [], { ok: false, checks: [], error: "PR/CI 状态读取失败" }),
    gitCreatePullRequest: (payload) => call("gitCreatePullRequest", [payload]),
    pickFolder: () => call("pickFolder", [], ""),
    attachFile: (payload) => call("attachFile", [payload], { ok: false, error: "附件添加失败" }),
    attachImage: (payload) => call("attachImage", [payload], { ok: false, error: "图片附件失败" }),
    listAttachments: (sessionId) => call("listAttachments", [sessionId], []),
    removeAttachment: (id) => call("removeAttachment", [id], { ok: false, error: "附件移除失败" }),
    getCwd: () => call("getCwd", [], ""),
    listDir: (dir) => call("listDir", [dir], []),
    readFile: (filePath) => call("readFile", [filePath], { error: "读取文件失败", content: "" }),
    openEditorFile: (payload) => call("openEditorFile", [payload], { ok: false, error: "文件打开失败" }),
    saveEditorFile: (payload) => call("saveEditorFile", [payload], { ok: false, error: "文件保存失败" }),
    getTerminalCapabilities: () => call("getTerminalCapabilities", [], { ok: true, available: false, reason: "当前环境不支持集成终端" }, { silent: true }),
    createTerminal: (payload) => call("createTerminal", [payload], { ok: false, error: "终端启动失败" }, { silent: true }),
    getTerminalStatus: () => call("getTerminalStatus", [], { ok: true, active: false, session: null, snapshot: "" }, { silent: true }),
    writeTerminal: (sessionId, input) => call("writeTerminal", [sessionId, input], { ok: false, error: "终端输入失败" }, { silent: true }),
    resizeTerminal: (sessionId, payload) => call("resizeTerminal", [sessionId, payload], { ok: false, error: "终端尺寸更新失败" }, { silent: true }),
    closeTerminal: (sessionId, reason) => call("closeTerminal", [sessionId, reason], { ok: false, error: "终端关闭失败" }, { silent: true }),
    listSessions: () => call("listSessions", [], []),
    resumeSession: (id) => call("resumeSession", [id], []),
    newSession: () => call("newSession", [], { ok: false, error: "新对话创建失败" }),
    readSession: (id) => call("readSession", [id], []),
    deleteSession: (id) => call("deleteSession", [id], false),
    getConfig: () => call("getConfig", [], ""),
    getCredentialStatus: () => call("getCredentialStatus", [], { ok: false, references: [], error: "凭据状态不可用" }, { silent: true }),
    getExecutionPolicyCapabilities: () => call("getExecutionPolicyCapabilities", [], { ok: false, capabilities: null, error: "执行策略状态不可用" }, { silent: true }),
    saveConfig: (text) => call("saveConfig", [text]),
    testModel: (profile) => call("testModel", [profile]),
    getAppInfo: () => call("getAppInfo", [], { ok: false, error: "应用信息不可用" }),
    getUsageStats: () => call("getUsageStats", [], { ok: false, error: "用量数据不可用" }),
    openDataDir: () => call("openDataDir", []),
    revealConfigFile: () => call("revealConfigFile", []),
    openAppPage: (target) => call("openAppPage", [target]),
    checkUpdates: () => call("checkUpdates", [], { ok: false, error: "检查更新不可用" }, { silent: true }),
    getUpdateStatus: () => call("getUpdateStatus", [], { ok: false, error: "更新状态不可用" }, { silent: true }),
    setUpdateChannel: (channel) => call("setUpdateChannel", [channel], { ok: false, error: "更新通道设置不可用" }),
    downloadUpdate: () => call("downloadUpdate", [], { ok: false, error: "更新下载不可用" }),
    installUpdate: () => call("installUpdate", [], { ok: false, error: "更新安装不可用" }),
    createJob: (payload) => call("createJob", [payload]),
    listJobs: (options) => call("listJobs", [options], { ok: true, jobs: [] }),
    getJob: (jobId) => call("getJob", [jobId]),
    updateJob: (jobId, payload) => call("updateJob", [jobId, payload]),
    appendJobEvent: (jobId, payload) => call("appendJobEvent", [jobId, payload]),
    addJobArtifact: (jobId, payload) => call("addJobArtifact", [jobId, payload]),
    addJobGateResult: (jobId, payload) => call("addJobGateResult", [jobId, payload]),
    cancelJob: (jobId, options) => call("cancelJob", [jobId, options]),
    retryJob: (jobId, options) => call("retryJob", [jobId, options]),
    pauseJob: (jobId, options) => call("pauseJob", [jobId, options]),
    resumeJob: (jobId, options) => call("resumeJob", [jobId, options]),
    listJobEvents: (jobId) => call("listJobEvents", [jobId], { ok: true, events: [] }),
    listJobArtifacts: (jobId) => call("listJobArtifacts", [jobId], { ok: true, artifacts: [] }),
    previewJobArtifact: (jobId, artifactId) => call("previewJobArtifact", [jobId, artifactId]),
    openJobArtifact: (jobId, artifactId) => call("openJobArtifact", [jobId, artifactId]),
    listProviders: () => call("listProviders", [], { ok: true, providers: [] }),
    discoverProviders: (payload) => call("discoverProviders", [payload], { ok: true, providers: [] }),
    getProvider: (providerId) => call("getProvider", [providerId]),
    getProviderCapabilities: (providerId) => call("getProviderCapabilities", [providerId]),
    healthCheckProvider: (providerId) => call("healthCheckProvider", [providerId]),
    getProviderRegistryVersion: () => call("getProviderRegistryVersion", []),
    getProviderUsage: (providerId) => call("getProviderUsage", [providerId], { ok: true, usage: [] }),
    rotateProviderCredential: (providerId, payload) => call("rotateProviderCredential", [providerId, payload]),
    configureProvider: (providerId, payload) => call("configureProvider", [providerId, payload]),
    runProvider: (providerId, payload) => call("runProvider", [providerId, payload]),
    cancelProvider: (providerId, payload) => call("cancelProvider", [providerId, payload]),
    createWorktree: (payload) => call("createWorktree", [payload]),
    runWorktree: (payload) => call("runWorktree", [payload]),
    collectWorktreeChanges: (payload) => call("collectWorktreeChanges", [payload]),
    cleanupWorktree: (payload) => call("cleanupWorktree", [payload]),
    listArenaRuns: (options) => call("listArenaRuns", [options], { ok: true, runs: [] }),
    getArenaRun: (runId) => call("getArenaRun", [runId]),
    createArenaRun: (payload) => call("createArenaRun", [payload]),
    acceptArenaCandidate: (runId, candidateId, payload) => call("acceptArenaCandidate", [runId, candidateId, payload]),
    rejectArenaCandidate: (runId, candidateId, payload) => call("rejectArenaCandidate", [runId, candidateId, payload]),
    mergeArenaCandidate: (runId, candidateId, payload) => call("mergeArenaCandidate", [runId, candidateId, payload]),
    previewArenaArtifact: (runId, candidateId, artifactPath) => call("previewArenaArtifact", [runId, candidateId, artifactPath]),
    openArenaArtifact: (runId, candidateId, artifactPath) => call("openArenaArtifact", [runId, candidateId, artifactPath]),
    getIndustrialProjectSchema: () => call("getIndustrialProjectSchema", [], { ok: false, error: "Industrial Project API unavailable", domains: [], artifactTypes: [], gateTypes: [] }),
    getIndustrialProject: () => call("getIndustrialProject", [], { ok: false, error: "Industrial Project API unavailable", project: null, path: ".hicode/project.json" }),
    validateIndustrialProject: (payload) => call("validateIndustrialProject", [payload], { ok: false, errors: ["validation unavailable"] }),
    saveIndustrialProject: (payload) => call("saveIndustrialProject", [payload]),
    buildIndustrialRequirementDraft: (payload) => call("buildIndustrialRequirementDraft", [payload]),
    addIndustrialRequirement: (payload) => call("addIndustrialRequirement", [payload]),
    updateIndustrialRequirementCriteria: (payload) => call("updateIndustrialRequirementCriteria", [payload]),
    generateIndustrialArtifactPlan: (payload) => call("generateIndustrialArtifactPlan", [payload]),
    generateIndustrialTestPlan: (payload) => call("generateIndustrialTestPlan", [payload]),
    generateIndustrialSpecPackage: (payload) => call("generateIndustrialSpecPackage", [payload]),
    approveIndustrialRequirement: (payload) => call("approveIndustrialRequirement", [payload]),
    addIndustrialArtifact: (payload) => call("addIndustrialArtifact", [payload]),
    addIndustrialTraceability: (payload) => call("addIndustrialTraceability", [payload]),
    addIndustrialGateResult: (payload) => call("addIndustrialGateResult", [payload]),
    listDomainPacks: () => call("listDomainPacks", [], { ok: true, packs: [] }),
    getDomainPack: (packId) => call("getDomainPack", [packId]),
    validateDomainPack: (payload) => call("validateDomainPack", [payload], { ok: false, errors: ["validation unavailable"] }),
    installDomainPack: (payload) => call("installDomainPack", [payload]),
    updateDomainPack: (payload) => call("updateDomainPack", [payload]),
    enableDomainPack: (packId, payload) => call("enableDomainPack", [packId, payload]),
    disableDomainPack: (packId, payload) => call("disableDomainPack", [packId, payload]),
    uninstallDomainPack: (packId, payload) => call("uninstallDomainPack", [packId, payload]),
    recommendDomainPacks: () => call("recommendDomainPacks", [], { ok: true, packs: [] }),
    listAgentProfiles: (payload) => call("listAgentProfiles", [payload], { ok: true, profiles: [] }),
    getAgentProfile: (profileId) => call("getAgentProfile", [profileId]),
    createAgentPlan: (payload) => call("createAgentPlan", [payload]),
    listAgentPlans: (payload) => call("listAgentPlans", [payload], { ok: true, plans: [] }),
    getAgentPlan: (planId) => call("getAgentPlan", [planId]),
    createMultiAgentJob: (payload) => call("createMultiAgentJob", [payload]),
    listToolchainAdapters: () => call("listToolchainAdapters", [], { ok: true, adapters: [], toolRequirements: [] }),
    detectToolchainAdapter: (adapterId, payload) => call("detectToolchainAdapter", [adapterId, payload]),
    getToolchainCapabilities: (adapterId) => call("getToolchainCapabilities", [adapterId], { ok: true, capabilities: [] }),
    validateToolchainAdapter: (payload) => call("validateToolchainAdapter", [payload], { ok: false, errors: ["validation unavailable"] }),
    runToolchainAdapter: (payload) => call("runToolchainAdapter", [payload]),
    listQualityGates: () => call("listQualityGates", [], { ok: true, gates: [] }),
    runQualityGate: (payload) => call("runQualityGate", [payload]),
    approveQualityGate: (payload) => call("approveQualityGate", [payload]),
    getReleaseReadiness: (payload) => call("getReleaseReadiness", [payload], { ok: false, readiness: null, error: "Release Builder API unavailable" }),
    buildReleasePackage: (payload) => call("buildReleasePackage", [payload]),
    openReleasePackage: (payload) => call("openReleasePackage", [payload]),
    createIndustrialControlBoxSample: (payload) => call("createIndustrialControlBoxSample", [payload], { ok: false, error: "Sample Project API unavailable" }),
    authStatus: () => call("authStatus", [], { user: null }),
    register: (payload) => call("register", [payload]),
    login: (payload) => call("login", [payload]),
    logout: () => call("logout", []),
    listCapabilities: () => call("listCapabilities", [], { plugins: [], skills: [], mcp: [], agents: [] }),
    listMcpLifecycle: () => call("listMcpLifecycle", [], { ok: false, servers: [], error: "MCP 生命周期不可用" }),
    reloadMcpServers: () => call("reloadMcpServers", [], { ok: false, results: [], servers: [], error: "MCP 重载失败" }),
    connectMcpServer: (name) => call("connectMcpServer", [name]),
    reconnectMcpServer: (name) => call("reconnectMcpServer", [name]),
    disconnectMcpServer: (name) => call("disconnectMcpServer", [name]),
    cancelMcpRequest: (payload) => call("cancelMcpRequest", [payload]),
    listStore: (options) => call("listStore", [options], { items: [], sources: [] }),
    setStoreSource: (sourceId) => call("setStoreSource", [sourceId]),
    previewStoreItem: (id) => call("previewStoreItem", [id]),
    installStoreItem: (id, options) => call("installStoreItem", [id, options]),
    getStoreItem: (id) => call("getStoreItem", [id]),
    getStoreItemSilent: (id) => call("getStoreItem", [id], { ok: false, error: "商店条目不存在" }, { silent: true }),
    enableStoreItem: (id) => call("enableStoreItem", [id]),
    disableStoreItem: (id) => call("disableStoreItem", [id]),
    uninstallStoreItem: (id) => call("uninstallStoreItem", [id]),
    onReady: (handler) => listen("onReady", handler),
    onOutput: (handler) => listen("onOutput", handler),
    onAsk: (handler) => listen("onAsk", handler),
    onTurnDone: (handler) => listen("onTurnDone", handler),
    onToolEvent: (handler) => listen("onToolEvent", handler),
    onDiffsChanged: (handler) => listen("onDiffsChanged", handler),
    onRuntimeQueue: (handler) => listen("onRuntimeQueue", handler),
    onTerminalEvent: (handler) => listen("onTerminalEvent", handler),
  };
}

export function userMessage(error, fallback = DEFAULT_ERROR) {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}
