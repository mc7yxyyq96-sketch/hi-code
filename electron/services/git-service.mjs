import { ipcObject, ipcString, ipcStringArray, redactSensitive } from "../ipc/ipc-utils.mjs";

export function createGitService({
  getCwd,
  gitWorkflowStatus,
  gitFileDiff,
  gitStage,
  gitUnstage,
  gitGenerateCommitMessage,
  gitCommit,
  collaboration = null,
  authorizePullRequest = null,
  logger = null,
}) {
  const log = (event, payload = {}) => {
    if (typeof logger === "function") logger(event, redactSensitive(payload));
  };
  return {
    status() {
      return gitWorkflowStatus(getCwd());
    },

    diff(payload) {
      const data = ipcObject(payload);
      return gitFileDiff(getCwd(), ipcString(data.path), data.staged === true);
    },

    stage(paths) {
      return gitStage(getCwd(), ipcStringArray(paths));
    },

    unstage(paths) {
      return gitUnstage(getCwd(), ipcStringArray(paths));
    },

    commitMessage() {
      return gitGenerateCommitMessage(getCwd());
    },

    commit(message) {
      return gitCommit(getCwd(), ipcString(message));
    },

    branches() {
      return collaboration ? collaboration.listBranches(getCwd()) : { ok: false, error: "Git collaboration service unavailable" };
    },

    createBranch(payload) {
      if (!collaboration) return { ok: false, error: "Git collaboration service unavailable" };
      const name = boundedText(ipcObject(payload).name, 160);
      const result = collaboration.createBranch(getCwd(), name);
      log("git:branch-create", { name, ok: result.ok, code: result.code });
      return result;
    },

    switchBranch(payload) {
      if (!collaboration) return { ok: false, error: "Git collaboration service unavailable" };
      const name = boundedText(ipcObject(payload).name, 160);
      const result = collaboration.switchBranch(getCwd(), name);
      log("git:branch-switch", { name, ok: result.ok, code: result.code });
      return result;
    },

    collaborationStatus() {
      return collaboration ? collaboration.getCollaborationStatus(getCwd()) : { ok: false, error: "Git collaboration service unavailable" };
    },

    async createPullRequest(payload) {
      if (!collaboration) return { ok: false, error: "Git collaboration service unavailable" };
      if (typeof authorizePullRequest !== "function") return { ok: false, error: "Pull Request confirmation unavailable" };
      const input = ipcObject(payload);
      const request = {
        title: boundedText(input.title, 200),
        body: boundedText(input.body, 20_000),
        base: boundedText(input.base || "main", 160),
        draft: input.draft !== false,
      };
      if (!request.title) return { ok: false, error: "PR 标题不能为空" };
      const decision = await authorizePullRequest({ title: request.title, base: request.base, draft: request.draft });
      if (decision !== "allow") {
        log("git:pull-request-denied", { title: request.title, base: request.base });
        return { ok: false, denied: true, code: "pull_request_denied", error: "创建 Pull Request 已取消" };
      }
      const result = collaboration.createPullRequest(getCwd(), request);
      log("git:pull-request-create", { title: request.title, base: request.base, draft: request.draft, ok: result.ok, code: result.code, url: result.url });
      return result;
    },
  };
}

function boundedText(value, limit) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > limit ? text.slice(0, limit) : text;
}

export function registerGitIpc({ register, git }) {
  if (!register) throw new Error("registerGitIpc requires register");
  if (!git) throw new Error("registerGitIpc requires git service");

  register.handle("git:status", () => git.status());
  register.handle("git:diff", (_event, payload) => git.diff(payload));
  register.handle("git:stage", (_event, paths) => git.stage(paths));
  register.handle("git:unstage", (_event, paths) => git.unstage(paths));
  register.handle("git:commit-message", () => git.commitMessage());
  register.handle("git:commit", (_event, message) => git.commit(message));
  register.handle("git:branches", () => git.branches());
  register.handle("git:branch:create", (_event, payload) => git.createBranch(payload));
  register.handle("git:branch:switch", (_event, payload) => git.switchBranch(payload));
  register.handle("git:collaboration", () => git.collaborationStatus());
  register.handle("git:pr:create", (_event, payload) => git.createPullRequest(payload));
}
