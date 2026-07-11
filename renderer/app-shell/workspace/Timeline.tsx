import { useSyncExternalStore } from "react";
import { MAX_TIMELINE_ROWS, type WorkspaceRecoveryTask, type WorkspaceTimelineEvent } from "./contracts.ts";
import type { WorkspaceController } from "./controller.ts";
import type { WorkspaceStore } from "./store.ts";

interface TimelineProps {
  controller: WorkspaceController;
  store: WorkspaceStore;
}

function statusClass(status?: string) {
  return ({ running: "is-running", waiting: "is-waiting", done: "is-done", error: "is-error", denied: "is-denied", interrupted: "is-interrupted" } as Record<string, string>)[status || ""] || "";
}

function statusText(status?: string) {
  return ({ running: "运行中", waiting: "等待确认", done: "完成", error: "失败", denied: "已拒绝", interrupted: "已中断" } as Record<string, string>)[status || ""] || String(status || "");
}

function formatDuration(value?: number) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return "";
  if (duration < 1_000) return `${Math.round(duration)}ms`;
  if (duration < 60_000) return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(duration / 60_000)}m ${Math.round((duration % 60_000) / 1_000)}s`;
}

function timelineMeta(event: WorkspaceTimelineEvent) {
  const bits = [event.type.startsWith("turn:") ? "turn" : event.type === "permission:requested" ? "permission" : event.tool || event.type];
  if (event.status) bits.push(statusText(event.status));
  const duration = formatDuration(event.payload?.durationMs);
  if (duration) bits.push(duration);
  if (event.summary && event.summary !== event.title) bits.push(event.summary.slice(0, 80));
  return bits.filter(Boolean).join(" · ");
}

function recoveryActionLabel(task: WorkspaceRecoveryTask) {
  return ({ retry_turn: "重试", retry_with_approval: "重新确认", review_output: "查看输出", inspect_tool: "检查状态" } as Record<string, string>)[task.recoveryAction || ""] || "检查状态";
}

function recoveryMeta(task: WorkspaceRecoveryTask) {
  const bits: string[] = [];
  const when = task.updatedAt || task.createdAt;
  if (when) bits.push(new Date(when).toLocaleString());
  const duration = formatDuration(task.durationMs);
  if (duration) bits.push(duration);
  const phase = ({ running_model: "模型运行中断", streaming: "流式输出中断", waiting_approval: "等待审批", tool_running: "工具状态未知", failed: "执行失败", denied: "审批已拒绝", interrupted: "任务已中断" } as Record<string, string>)[task.phase || ""];
  if (phase) bits.push(phase);
  if (task.partialAssistantText) bits.push(`保留 ${task.partialAssistantText.length} 字输出${task.partialOutputTruncated ? "（已截断）" : ""}`);
  if (task.reason) bits.push(task.reason);
  return bits.join(" · ");
}

export function Timeline({ controller, store }: TimelineProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const events = [...state.timeline]
    .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0))
    .slice(0, MAX_TIMELINE_ROWS);
  const retryRecovery = state.availableActions.includes("retryRecovery");
  const refreshRecovery = state.availableActions.includes("refreshRecovery");
  const retryTimeline = state.availableActions.includes("retryTimeline");
  const selectDiff = state.availableActions.includes("selectDiff");
  const run = (name: "retryRecovery" | "refreshRecovery" | "retryTimeline" | "selectDiff", value?: string) => {
    void controller.run(name, ...(value ? [value] : [])).catch(() => undefined);
  };

  return (
    <div className="timeline-workspace" data-workspace-owner="react">
      {state.recoveryTasks.length ? (
        <div className="recovery-panel">
          <div className="recovery-head">
            <span>可恢复任务</span>
            <button className="timeline-action" type="button" disabled={!refreshRecovery} title={refreshRecovery ? "重新读取失败任务" : "恢复处理器尚未就绪"} onClick={() => run("refreshRecovery")}>刷新</button>
          </div>
          <div className="recovery-list">
            {state.recoveryTasks.slice(0, 6).map((task) => (
              <div className={`recovery-row ${statusClass(task.status)}`} key={task.id}>
                <span className="recovery-status">{statusText(task.status)}</span>
                <span className="recovery-main">
                  <span className="recovery-title">{task.title || task.summary || "可恢复任务"}</span>
                  <span className="recovery-meta">{recoveryMeta(task)}</span>
                </span>
                <button className="timeline-action recovery-retry" type="button" disabled={!retryRecovery} onClick={() => run("retryRecovery", task.id)}>{recoveryActionLabel(task)}</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="timeline-list" data-total-events={state.timeline.length} data-mounted-events={events.length}>
        {!events.length ? <div className="timeline-empty">工具调用会显示在这里。</div> : events.map((event) => {
          const canRetry = event.type.startsWith("turn:") && ["error", "interrupted", "denied"].includes(event.status || "") && Boolean(event.payload?.retryInput);
          return (
            <div
              className={`timeline-row ${statusClass(event.status)} ${event.type.replace(":", "-")}`}
              key={event.id}
              role={event.diffId ? "button" : undefined}
              tabIndex={event.diffId ? 0 : undefined}
              onClick={() => { if (event.diffId && selectDiff) run("selectDiff", event.diffId); }}
              onKeyDown={(keyEvent) => { if (event.diffId && selectDiff && (keyEvent.key === "Enter" || keyEvent.key === " ")) { keyEvent.preventDefault(); run("selectDiff", event.diffId); } }}
            >
              <span className="timeline-dot" />
              <span className="timeline-main">
                <span className="timeline-title">{event.title || event.tool || event.type}</span>
                <span className="timeline-meta">{timelineMeta(event)}</span>
              </span>
              <span className="timeline-actions">
                {canRetry ? <button className="timeline-action" type="button" disabled={!retryTimeline} title="重新执行这个任务" onClick={(clickEvent) => { clickEvent.stopPropagation(); run("retryTimeline", event.id); }}>重试</button> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
