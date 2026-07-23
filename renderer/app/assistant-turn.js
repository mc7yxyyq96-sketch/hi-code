/**
 * Clean-room AssistantTurn model + Runtime event projection.
 * Maps Hi Code runtime events into an in-message Agent Run narrative
 * (thinking → tools → text → change summary), Yan/OpenCode/Codex style.
 */

export function createAssistantTurn(seed = {}) {
  return {
    id: seed.id || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: seed.status || "working",
    iteration: seed.iteration || 1,
    toolCallCount: seed.toolCallCount || 0,
    startedAt: seed.startedAt || Date.now(),
    finishedAt: seed.finishedAt || null,
    items: Array.isArray(seed.items) ? seed.items.slice() : [],
    todos: Array.isArray(seed.todos) ? seed.todos.slice() : [],
    changeSummary: seed.changeSummary || null,
    interrupted: !!seed.interrupted,
    error: seed.error || null,
  };
}

export function appendTextDelta(turn, chunk) {
  if (!turn || chunk == null) return turn;
  const text = String(chunk);
  if (!text) return turn;
  const last = turn.items[turn.items.length - 1];
  if (last && last.type === "text") {
    last.content += text;
    return turn;
  }
  turn.items.push({ type: "text", content: text, at: Date.now() });
  return turn;
}

export function upsertThinking(turn, content, { streaming = false } = {}) {
  if (!turn) return turn;
  const text = String(content || "");
  let block = [...turn.items].reverse().find((item) => item.type === "thinking" && item.streaming);
  if (!block) {
    block = { type: "thinking", content: "", streaming: true, at: Date.now() };
    turn.items.push(block);
  }
  block.content = text;
  block.streaming = streaming;
  if (!streaming) block.streaming = false;
  return turn;
}

export function beginToolStep(turn, event = {}) {
  if (!turn) return turn;
  const name = event.tool || event.name || event.payload?.name || "tool";
  const args = event.payload?.args || event.args || {};
  const id = event.id || event.eventId || `${name}-${Date.now()}`;
  const existing = turn.items.find((item) => item.type === "tool" && item.id === id && item.phase === "running");
  if (existing) return turn;
  turn.items.push({
    type: "tool",
    id,
    name,
    args,
    preview: event.summary || event.title || "",
    phase: "running",
    ok: null,
    output: "",
    at: Date.now(),
  });
  turn.toolCallCount = (turn.toolCallCount || 0) + 1;
  turn.status = "working";
  return turn;
}

export function finishToolStep(turn, event = {}) {
  if (!turn) return turn;
  const name = event.tool || event.name || event.payload?.name;
  const id = event.id || event.eventId;
  let step = null;
  if (id) step = [...turn.items].reverse().find((item) => item.type === "tool" && item.id === id);
  if (!step && name) {
    step = [...turn.items].reverse().find((item) => item.type === "tool" && item.name === name && item.phase === "running");
  }
  if (!step) {
    beginToolStep(turn, event);
    step = [...turn.items].reverse().find((item) => item.type === "tool" && item.phase === "running");
  }
  if (!step) return turn;
  const status = event.status || event.payload?.status;
  step.phase = "done";
  step.ok = !(status === "error" || status === "denied" || status === "failed" || event.ok === false);
  step.output = event.summary || event.payload?.output || event.payload?.chunk || step.output || "";
  if (event.payload?.args) step.args = event.payload.args;
  return turn;
}

export function applyChangeSummary(turn, diffs = []) {
  if (!turn) return turn;
  const files = (Array.isArray(diffs) ? diffs : [])
    .filter((diff) => diff && !diff.archived)
    .map((diff) => ({
      path: diff.path || diff.file || "unknown",
      status: diff.status || "modified",
      additions: Number(diff.additions || diff.payload?.additions || 0),
      deletions: Number(diff.deletions || diff.payload?.deletions || 0),
    }));
  if (!files.length) return turn;
  turn.changeSummary = {
    count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
  };
  return turn;
}

export function finalizeTurn(turn, status = "done", detail = "") {
  if (!turn) return turn;
  turn.status = status;
  turn.finishedAt = Date.now();
  if (status === "interrupted") turn.interrupted = true;
  if (status === "error" || status === "denied") turn.error = detail || turn.error;
  for (const item of turn.items) {
    if (item.type === "thinking") item.streaming = false;
    if (item.type === "tool" && item.phase === "running") {
      item.phase = "done";
      item.ok = status === "done" ? item.ok : false;
    }
  }
  return turn;
}

/**
 * Project a Hi Code runtime/tool event into the live turn.
 */
export function projectRuntimeEvent(turn, event = {}) {
  if (!turn || !event) return turn;
  const type = String(event.type || "");

  if (type === "turn:update") {
    const phase = event.payload?.phase;
    if (phase === "thinking" || /thinking/i.test(event.title || "")) {
      upsertThinking(turn, event.summary || event.title || "思考中…", { streaming: true });
    }
    if (phase === "compacting") {
      turn.items.push({
        type: "compact",
        phase: "running",
        content: event.summary || "正在压缩上下文…",
        at: Date.now(),
      });
      turn.status = "working";
    }
    if (phase === "compacted") {
      turn.items.push({
        type: "compact",
        phase: "done",
        content: event.summary || "上下文已压缩",
        removed: Number(event.payload?.removed || 0),
        at: Date.now(),
      });
    }
    return turn;
  }

  if (type === "permission:requested") {
    turn.items.push({
      type: "permission",
      id: event.id || event.payload?.id || `perm-${Date.now()}`,
      action: event.summary || event.payload?.action || event.title || "需要权限确认",
      at: Date.now(),
    });
    turn.status = "waiting";
    return turn;
  }

  if (type === "tool:start" || type === "runtime.tool:start") {
    return beginToolStep(turn, event);
  }

  if (type === "tool:output") {
    const name = event.tool || event.name;
    const step = [...turn.items].reverse().find((item) => item.type === "tool" && (!name || item.name === name) && item.phase === "running");
    if (step) step.output = `${step.output || ""}${event.payload?.chunk || event.summary || ""}`;
    return turn;
  }

  if (type === "tool:done" || type === "runtime.tool:done") {
    return finishToolStep(turn, event);
  }

  if (type === "diff:created") {
    const path = event.path || event.summary || event.title;
    if (!turn.changeSummary) {
      turn.changeSummary = { count: 0, additions: 0, deletions: 0, files: [] };
    }
    if (path && !turn.changeSummary.files.some((file) => file.path === path)) {
      turn.changeSummary.files.push({
        path,
        status: "modified",
        additions: Number(event.payload?.additions || 0),
        deletions: Number(event.payload?.deletions || 0),
      });
      turn.changeSummary.count = turn.changeSummary.files.length;
      turn.changeSummary.additions = turn.changeSummary.files.reduce((sum, file) => sum + file.additions, 0);
      turn.changeSummary.deletions = turn.changeSummary.files.reduce((sum, file) => sum + file.deletions, 0);
    }
    return turn;
  }

  if (type === "turn:done") {
    return finalizeTurn(turn, event.status || "done", event.summary || "");
  }

  return turn;
}

export function serializeTurn(turn) {
  if (!turn) return null;
  return JSON.parse(JSON.stringify(turn));
}

export function restoreTurn(data) {
  if (!data || typeof data !== "object") return createAssistantTurn();
  return createAssistantTurn(data);
}
