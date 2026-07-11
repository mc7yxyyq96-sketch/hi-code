import { useEffect, useState, useSyncExternalStore } from "react";
import { buildUnifiedDiffLines, type UnifiedDiffLine } from "./diff.ts";
import type { WorkspaceController } from "./controller.ts";
import type { DiffReviewComment } from "./review.ts";
import type { WorkspaceStore } from "./store.ts";

interface InspectorProps {
  controller: WorkspaceController;
  store: WorkspaceStore;
}

interface ReviewTarget {
  line: number;
  side: "before" | "after";
}

function diffStatusText(status: string) {
  return ({ pending: "已应用 · 可回滚", accepted: "已归档", rejected: "已回滚", undone: "已撤销" } as Record<string, string>)[status] || status;
}

export function Inspector({ controller, store }: InspectorProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = state.diffs.filter((diff) => diff.status === "pending");
  const archived = state.diffs.filter((diff) => diff.status !== "pending");
  const visible = state.showArchivedDiffs ? [...pending, ...archived] : pending;
  const selected = visible.find((diff) => diff.id === state.selectedDiffId) || visible[0];
  const actions = new Set(state.availableActions);
  const run = (name: Parameters<WorkspaceController["run"]>[0], value?: unknown) => {
    void controller.run(name, ...(value === undefined ? [] : [value])).catch(() => undefined);
  };
  const enabled = selected?.status === "pending";
  const lines = selected ? buildUnifiedDiffLines(selected) : [];

  useEffect(() => {
    setReviewTarget(null);
    setCommentBody("");
    setSubmitting(false);
  }, [selected?.id]);

  const submitReview = async () => {
    if (!selected || !reviewTarget || !commentBody.trim() || !actions.has("requestDiffRevision")) return;
    const comment: DiffReviewComment = {
      diffId: selected.id,
      path: selected.path,
      line: reviewTarget.line,
      side: reviewTarget.side,
      body: commentBody,
    };
    setSubmitting(true);
    try {
      await controller.run("requestDiffRevision", comment);
      setCommentBody("");
      setReviewTarget(null);
    } catch {
      // Controller publishes a visible error; preserve the draft for retry.
    } finally {
      setSubmitting(false);
    }
  };

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
      <div className="diff-view" role="listbox" aria-label="文件改动行">
        {selected ? lines.map((line, index) => <DiffLine key={`${selected.id}-${index}`} line={line} selected={Boolean(reviewTarget && line.line === reviewTarget.line && line.side === reviewTarget.side)} reviewable={Boolean(enabled && actions.has("requestDiffRevision"))} onSelect={setReviewTarget} />) : <span className="diff-code-line meta">{state.diffs.length ? "当前没有可归档或回滚的文件改动。" : "还没有文件改动。"}</span>}
      </div>
      {enabled ? (
        <div className="diff-review">
          <div className="diff-review-head">
            <strong>行级审查</strong>
            <span>{reviewTarget ? `${reviewTarget.side === "after" ? "新" : "旧"}文件第 ${reviewTarget.line} 行` : "先选择一行"}</span>
          </div>
          <textarea value={commentBody} maxLength={4_000} disabled={!reviewTarget || submitting} onChange={(event) => setCommentBody(event.target.value)} placeholder="说明需要修改的内容。提交后会作为真实任务进入当前会话。" />
          <button className="primary" type="button" disabled={!reviewTarget || !commentBody.trim() || submitting || !actions.has("requestDiffRevision")} onClick={() => { void submitReview(); }}>{submitting ? "正在提交…" : "请求修改"}</button>
        </div>
      ) : null}
      <div className="diff-actions">
        <button className="primary" type="button" disabled={!enabled || !actions.has("archiveDiff")} onClick={() => run("archiveDiff")}>归档</button>
        <button className="ghost" type="button" disabled={!enabled || !actions.has("rollbackDiff")} onClick={() => run("rollbackDiff")}>回滚</button>
        <button className="ghost" type="button" disabled={!pending.length || !actions.has("archiveAllDiffs")} onClick={() => run("archiveAllDiffs")}>全部归档</button>
        <button className="ghost" type="button" disabled={!pending.length || !actions.has("rollbackAllDiffs")} onClick={() => run("rollbackAllDiffs")}>全部回滚</button>
      </div>
    </div>
  );
}

function DiffLine({ line, selected, reviewable, onSelect }: { line: UnifiedDiffLine; selected: boolean; reviewable: boolean; onSelect(target: ReviewTarget): void }) {
  if (!line.line || !line.side) return <span className={`diff-code-line ${line.kind}`}>{line.text || " "}</span>;
  return (
    <button className={`diff-code-line ${line.kind}${selected ? " selected" : ""}`} type="button" role="option" aria-selected={selected} disabled={!reviewable} onClick={() => onSelect({ line: line.line!, side: line.side! })}>
      <span className="diff-line-number">{line.line}</span>
      <code>{line.text || " "}</code>
    </button>
  );
}
