import { ipcObject, ipcString, ipcStringArray } from "../ipc/ipc-utils.mjs";

export function createGitService({
  getCwd,
  gitWorkflowStatus,
  gitFileDiff,
  gitStage,
  gitUnstage,
  gitGenerateCommitMessage,
  gitCommit,
}) {
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
  };
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
}
