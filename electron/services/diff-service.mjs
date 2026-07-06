import { ipcBoundedNumber, ipcString } from "../ipc/ipc-utils.mjs";

export function createDiffIpcService({
  logDir,
  listToolEvents,
  readRecoverableTasksFromLogs,
  listDiffs,
  acceptDiff,
  rejectDiff,
  acceptAllDiffs,
  rejectAllDiffs,
  clearArchivedDiffs,
}) {
  return {
    listToolEvents,
    listRecoverableTasks(limit) {
      return readRecoverableTasksFromLogs(logDir, ipcBoundedNumber(limit, 8, { min: 1, max: 100 }));
    },
    listDiffs,
    acceptDiff(id) {
      return acceptDiff(ipcString(id));
    },
    rejectDiff(id) {
      return rejectDiff(ipcString(id));
    },
    acceptAllDiffs,
    rejectAllDiffs,
    clearArchivedDiffs,
  };
}

export function registerDiffIpc({ register, diff }) {
  if (!register) throw new Error("registerDiffIpc requires register");
  if (!diff) throw new Error("registerDiffIpc requires diff service");

  register.handle("tool-events:list", () => diff.listToolEvents());
  register.handle("recoverable-tasks:list", (_event, limit) => diff.listRecoverableTasks(limit));
  register.handle("diffs:list", () => diff.listDiffs());
  register.handle("diffs:accept", (_event, id) => diff.acceptDiff(id));
  register.handle("diffs:reject", (_event, id) => diff.rejectDiff(id));
  register.handle("diffs:accept-all", () => diff.acceptAllDiffs());
  register.handle("diffs:reject-all", () => diff.rejectAllDiffs());
  register.handle("diffs:clear-archived", () => diff.clearArchivedDiffs());
}
