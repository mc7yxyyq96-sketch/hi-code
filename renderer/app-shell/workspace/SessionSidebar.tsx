import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { filterWorkspaceSessions, type WorkspaceSession } from "./contracts.ts";
import type { WorkspaceController } from "./controller.ts";
import type { WorkspaceStore } from "./store.ts";
import { moveSessionFocusIndex, type SessionFocusDirection } from "./windowing.ts";

interface SessionSidebarProps {
  controller: WorkspaceController;
  store: WorkspaceStore;
}

function formatSessionAge(value?: string | number) {
  const timestamp = new Date(value ?? 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "刚刚";
  if (delta < 60 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / (60 * 60_000))} 小时前`;
  if (delta < 7 * 24 * 60 * 60_000) return `${Math.round(delta / (24 * 60 * 60_000))} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function sessionSubtitle(session: WorkspaceSession) {
  if (session.running) return "进行中";
  if (session.transient) return "未保存";
  if (session.replayOnly) return "回放";
  return formatSessionAge(session.updatedAt);
}

export function SessionSidebar({ controller, store }: SessionSidebarProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const sessions = filterWorkspaceSessions(state.sessions, state.sessionFilter);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openEnabled = state.availableActions.includes("openSession");
  const deleteEnabled = state.availableActions.includes("deleteSession");

  const run = (name: "openSession" | "deleteSession", id: string) => {
    void controller.run(name, id).catch(() => undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const directions: Record<string, SessionFocusDirection | undefined> = {
      ArrowDown: "next",
      ArrowUp: "previous",
      Home: "first",
      End: "last",
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const next = moveSessionFocusIndex(index, sessions.length, direction);
    buttonRefs.current[next]?.focus();
  };

  if (!sessions.length) return <div className="sessions-empty">还没有最近会话</div>;

  return (
    <div className="session-workspace-list" role="listbox" aria-label="最近会话" data-workspace-owner="react">
      {sessions.map((session, index) => {
        const running = Boolean(session.running);
        const transient = Boolean(session.transient);
        const selected = session.id === state.activeSessionId;
        return (
          <div
            className={`sess${selected ? " active" : ""}${running ? " sess-running" : ""}${transient ? " sess-transient" : ""}`}
            key={session.id}
            role="option"
            aria-selected={selected}
          >
            <button
              ref={(element) => { buttonRefs.current[index] = element; }}
              className="sess-main"
              title={openEnabled ? "打开会话" : "会话处理器尚未就绪"}
              disabled={!openEnabled}
              onClick={() => run("openSession", session.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <span className="t">{running ? "● " : ""}{session.firstPrompt || "(空会话)"}</span>
              <span className="s">
                <span className="sess-time">{sessionSubtitle(session)}</span>
                <span className="sess-count">{session.replayOnly ? `${session.eventCount || session.messageCount} 事件` : `${session.messageCount} 条`}</span>
              </span>
            </button>
            <button
              className={`sess-del${transient || running ? " hidden" : ""}`}
              type="button"
              title={transient || running ? "运行中的会话结束后可删除" : deleteEnabled ? "删除会话" : "删除处理器尚未就绪"}
              aria-label={`删除会话：${session.firstPrompt || session.id}`}
              disabled={!deleteEnabled || transient || running}
              onClick={() => run("deleteSession", session.id)}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
