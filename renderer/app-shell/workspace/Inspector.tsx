import { useSyncExternalStore } from "react";
import { buildUnifiedDiffLines } from "./diff.ts";
import type { WorkspaceController } from "./controller.ts";
import type { WorkspaceStore } from "./store.ts";

interface InspectorProps {
  controller: WorkspaceController;
  store: WorkspaceStore;
}

function diffStatusText(status: string) {
  return ({ pending: "已应用 · 可回滚", accepted: "已归档", rejected: "已回滚", undone: "已撤销" } as Record<string, string>)[status] || status;
}

export function Inspector({ controller, store }: InspectorProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const pending = state.diffs.filter((diff) => diff.status === "pending");
  const archived = state.diffs.filter((diff) => diff.status !== "pending");
  const visible = state.showArchivedDiffs ? [...pending, ...archived] : pending;
  const selected = visible.find((diff) => diff.id === state.selectedDiffId) || visible[0];
  const actions = new Set(state.availableActions);
  const run = (name: Parameters<WorkspaceController["run"]>[0], value?: string) => {
    void controller.run(name, ...(value ? [value] : [])).catch(() => undefined);
  };
  const enabled = selected?.status === "pending";
  const lines = selected ? buildUnifiedDiffLines(selected) : [];

  return (
    <div className="inspector-workspace" data-workspace-owner="react">
      <div className="panel-head">
        <div>
          <div className="panel-title">改动</div>
          <div className="panel-sub" id="diffSummary">{pending.length} 个可回滚{archived.length ? ` · ${archived.length} 个已归档` : ""}</div>
        </div>
        <div className="panel-actions diff-head-actions">
          <button className={state.showArchivedDiffs ? "mini-btn active" : "mini-btn"} type="button" disabled={!archived.length || !actions.has("toggleDiffHistory")} onClick={() => run("toggleDiffHistory")}>{state.showArchivedDiffs ? "隐藏历史" : "历史"}</button>
          <button className="mini-btn" type="button" disabled={!archived.length || !actions.has("clearDiffHistory")} onClick={() => run("clearDiffHistory")}>清空</button>
        </div>
      </div>
      <div className="diff-list">
        {!state.diffs.length ? <div className="diff-empty">Agent 修改文件后会出现在这里。</div> : !visible.length ? <div className="diff-empty">没有可回滚改动。{archived.length ? `${archived.length} 个历史改动已归档。` : ""}</div> : visible.map((diff) => (
          <button className={`diff-row ${diff.id === selected?.id ? "active" : ""} diff-${diff.status}`} type="button" key={diff.id} disabled={!actions.has("selectDiff")} onClick={() => run("selectDiff", diff.id)}>
            <span className="diff-file">{diff.path}</span>
            <span className="diff-status">{diffStatusText(diff.status)}</span>
          </button>
        ))}
      </div>
      <pre className="diff-view">
        {selected ? lines.map((line, index) => <span className={`diff-code-line ${line.kind}`} key={`${selected.id}-${index}`}>{line.text || " "}</span>) : state.diffs.length ? "当前没有可归档或回滚的文件改动。" : "还没有文件改动。"}
      </pre>
      <div className="diff-actions">
        <button className="primary" type="button" disabled={!enabled || !actions.has("archiveDiff")} onClick={() => run("archiveDiff")}>归档</button>
        <button className="ghost" type="button" disabled={!enabled || !actions.has("rollbackDiff")} onClick={() => run("rollbackDiff")}>回滚</button>
        <button className="ghost" type="button" disabled={!pending.length || !actions.has("archiveAllDiffs")} onClick={() => run("archiveAllDiffs")}>全部归档</button>
        <button className="ghost" type="button" disabled={!pending.length || !actions.has("rollbackAllDiffs")} onClick={() => run("rollbackAllDiffs")}>全部回滚</button>
      </div>
    </div>
  );
}
