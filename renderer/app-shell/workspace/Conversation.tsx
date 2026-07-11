import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseAnsiSegments } from "./ansi.ts";
import { MAX_TRANSCRIPT_ROWS, type ConversationMessage } from "./contracts.ts";
import type { WorkspaceStore } from "./store.ts";
import { computeTranscriptWindow } from "./windowing.ts";

interface ConversationProps {
  store: WorkspaceStore;
}

function attachmentLabel(attachment: ConversationMessage["attachments"][number]) {
  const kind = { image: "图片", pdf: "PDF", text: "文本" }[attachment.kind || ""] || "文件";
  return `${kind}：${attachment.name || "attachment"}`;
}

function MessageRow({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return (
      <div className="msg user" data-message-id={message.id}>
        <div className="bubble">
          <span>{message.text}</span>
          {message.attachments.length ? (
            <div className="attachment-tray">
              {message.attachments.map((attachment, index) => (
                <span className="attachment-chip" key={attachment.id || `${message.id}-${index}`}>
                  <span>{attachmentLabel(attachment)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const pending = message.status === "pending" && !message.text;
  const empty = message.status === "empty";
  const error = message.status === "error";
  const text = message.text || (pending ? "Hi Code 正在思考…" : empty ? "这次模型没有返回可显示内容。可以重试，或在“接入 API”里测试/切换模型。" : "");
  return (
    <div className="msg agent" data-message-id={message.id} data-message-status={message.status}>
      <div className="avatar"><span className="logo" /></div>
      <div className={`agent-body${message.role === "system" ? " c-gray" : ""}${pending ? " agent-pending" : ""}${empty ? " agent-empty" : ""}${error ? " agent-error" : ""}`}>
        {parseAnsiSegments(text).map((segment, index) => (
          <span className={segment.className || undefined} key={`${message.id}-${index}`}>{segment.text}</span>
        ))}
      </div>
    </div>
  );
}

export function Conversation({ store }: ConversationProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [anchorEnd, setAnchorEnd] = useState(state.messages.length);
  const previousCount = useRef(state.messages.length);
  const target = document.getElementById("chat");

  useEffect(() => {
    setAnchorEnd(state.messages.length);
    previousCount.current = state.messages.length;
  }, [state.conversationSessionId, state.conversationEpoch]);

  useEffect(() => {
    const wasAtLatest = anchorEnd >= previousCount.current;
    previousCount.current = state.messages.length;
    if (wasAtLatest) setAnchorEnd(state.messages.length);
    else setAnchorEnd((current) => Math.min(current, state.messages.length));
  }, [state.messages.length]);

  const window = computeTranscriptWindow(state.messages.length, anchorEnd);
  const visible = state.messages.slice(window.start, window.end);

  useLayoutEffect(() => {
    if (!target || window.hasNewer) return;
    target.scrollTop = target.scrollHeight;
  }, [target, state.messages.length, state.messages.at(-1)?.text, window.hasNewer]);

  useEffect(() => {
    if (!target) return;
    target.dataset.totalMessages = String(state.messages.length);
    target.dataset.mountedMessages = String(visible.length);
    target.dataset.workspaceOwner = "react";
    target.dataset.windowStart = String(window.start);
    target.dataset.windowEnd = String(window.end);
  }, [target, state.messages.length, visible.length, window.start, window.end]);

  return (
    <>
      {state.messages.length > MAX_TRANSCRIPT_ROWS ? (
        <div className="conversation-window-controls" aria-label="长会话浏览">
          <button type="button" disabled={!window.hasOlder} onClick={() => setAnchorEnd(window.start)}>较早消息</button>
          <span>显示 {window.start + 1}-{window.end} / {state.messages.length}</span>
          <button type="button" disabled={!window.hasNewer} onClick={() => setAnchorEnd(Math.min(state.messages.length, window.end + MAX_TRANSCRIPT_ROWS))}>较新消息</button>
          <button type="button" disabled={!window.hasNewer} onClick={() => setAnchorEnd(state.messages.length)}>回到最新</button>
        </div>
      ) : null}
      <div className="conversation-window" aria-live="polite" data-testid="virtual-transcript">
        {visible.map((message) => <MessageRow key={message.id} message={message} />)}
      </div>
    </>
  );
}
