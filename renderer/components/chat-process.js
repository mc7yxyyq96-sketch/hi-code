/**
 * Clean-room in-message Agent Run rendering (original Hi Code UI).
 * Structure inspired by modern coding-agent narrative UX; no copied assets.
 */

import { escapeHtml } from "../utils/format.js";

const TOOL_LABELS = {
  read_file: "读取文件",
  read: "读取文件",
  write_file: "写入文件",
  write: "写入文件",
  edit_file: "编辑文件",
  edit: "编辑文件",
  apply_patch: "应用补丁",
  list_directory: "列出目录",
  ls: "列出目录",
  search_files: "搜索代码",
  grep: "搜索代码",
  glob: "匹配文件",
  execute_shell: "执行命令",
  bash: "执行命令",
  todo_write: "更新计划",
  spawn_subagent: "委派子 Agent",
  spawn_subagents: "并行子 Agent",
  git_status: "Git 状态",
  git_diff: "Git Diff",
  git_commit: "Git 提交",
};

function toolLabel(name) {
  return TOOL_LABELS[name] || String(name || "工具");
}

function previewArgs(name, args = {}) {
  if (!args || typeof args !== "object") return "";
  if (args.path) return String(args.path);
  if (args.file_path) return String(args.file_path);
  if (args.command) return String(args.command).slice(0, 120);
  if (args.pattern) return String(args.pattern);
  if (args.query) return String(args.query);
  if (args.message) return String(args.message).slice(0, 80);
  try {
    return JSON.stringify(args).slice(0, 120);
  } catch {
    return "";
  }
}

export function buildThinkingElement(content, { open = false, streaming = false } = {}) {
  const el = document.createElement("details");
  el.className = "hc-thinking";
  el.open = open || streaming;
  el.innerHTML = `
    <summary><span class="hc-thinking-icon" aria-hidden="true"></span><span class="hc-thinking-label">${streaming ? "思考中…" : "思考过程"}</span></summary>
    <div class="hc-thinking-text"></div>
  `;
  el.querySelector(".hc-thinking-text").textContent = content || "";
  return el;
}

export function buildToolStepElement(step = {}) {
  const el = document.createElement("details");
  el.className = "hc-tool-step";
  if (step.phase === "running") el.classList.add("is-running");
  if (step.ok === false) el.open = true;
  el.dataset.tool = step.name || "";
  const badge =
    step.phase === "running"
      ? '<span class="hc-tool-badge running" aria-label="运行中"></span>'
      : step.ok === false
        ? '<span class="hc-tool-badge fail">✕</span>'
        : '<span class="hc-tool-badge ok">✓</span>';
  const preview = step.preview || previewArgs(step.name, step.args);
  el.innerHTML = `
    <summary class="hc-tool-summary">
      ${badge}
      <span class="hc-tool-name">${escapeHtml(toolLabel(step.name))}</span>
      <span class="hc-tool-preview">${escapeHtml(preview)}</span>
    </summary>
    <div class="hc-tool-body">
      <pre class="hc-tool-args"></pre>
      <pre class="hc-tool-output"></pre>
    </div>
  `;
  el.querySelector(".hc-tool-args").textContent = JSON.stringify(step.args || {}, null, 2);
  el.querySelector(".hc-tool-output").textContent = step.output || "";
  return el;
}

export function buildTextRoundElement(content) {
  const el = document.createElement("div");
  el.className = "hc-text-round";
  el.textContent = content || "";
  return el;
}

export function buildCompactElement(item = {}) {
  const el = document.createElement("div");
  el.className = `hc-compact-round${item.phase === "running" ? " is-running" : ""}`;
  const label = item.phase === "running" ? "正在压缩上下文" : "上下文已压缩";
  const detail = item.content || (item.removed ? `移除 ${item.removed} 条历史` : "");
  el.innerHTML = `<span class="hc-compact-label">${label}</span><span class="hc-compact-detail"></span>`;
  el.querySelector(".hc-compact-detail").textContent = detail;
  return el;
}

export function buildSystemNoteElement(content) {
  const el = document.createElement("div");
  el.className = "hc-system-round";
  el.textContent = content || "";
  return el;
}

export function buildPermissionElement(item = {}) {
  const el = document.createElement("div");
  el.className = "hc-permission-inline";
  el.dataset.permId = item.id || "";
  el.innerHTML = `
    <div class="hc-permission-title">需要权限确认</div>
    <div class="hc-permission-action"></div>
    <div class="hc-permission-hint">请在下方权限条选择：允许 / 总是允许 / 拒绝</div>
  `;
  el.querySelector(".hc-permission-action").textContent = item.action || "";
  return el;
}

export function buildChangeSummaryElement(summary = {}) {
  const files = Array.isArray(summary.files) ? summary.files : [];
  if (!files.length) return null;
  const el = document.createElement("details");
  el.className = "hc-change-summary";
  el.open = true;
  const additions = Number(summary.additions || 0);
  const deletions = Number(summary.deletions || 0);
  el.innerHTML = `
    <summary class="hc-change-header">
      <span>已编辑 <strong>${files.length}</strong> 个文件</span>
      <span class="hc-change-stats"><span class="add">+${additions}</span> <span class="del">-${deletions}</span></span>
    </summary>
    <div class="hc-change-list"></div>
  `;
  const list = el.querySelector(".hc-change-list");
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "hc-change-file";
    row.innerHTML = `
      <span class="hc-change-path"></span>
      <span class="hc-change-add">+${Number(file.additions || 0)}</span>
      <span class="hc-change-del">-${Number(file.deletions || 0)}</span>
    `;
    row.querySelector(".hc-change-path").textContent = file.path || "";
    list.appendChild(row);
  }
  return el;
}

export function buildRunHeaderElement(turn = {}) {
  const el = document.createElement("div");
  el.className = `hc-run-header status-${turn.status || "working"}`;
  el.innerHTML = `
    <div class="hc-run-summary">
      <span class="hc-run-status"></span>
      <span class="hc-run-meta"></span>
    </div>
    <div class="hc-run-activity"></div>
  `;
  const statusMap = {
    working: "正在执行",
    waiting: "等待确认",
    done: "已完成",
    error: "失败",
    denied: "已拒绝",
    interrupted: "已中断",
  };
  el.querySelector(".hc-run-status").textContent = statusMap[turn.status] || turn.status || "";
  el.querySelector(".hc-run-meta").textContent = `工具 ${turn.toolCallCount || 0} · 轮次 ${turn.iteration || 1}`;
  return el;
}

/**
 * Render a full AssistantTurn into an agent message body element.
 */
export function renderAssistantTurn(bodyEl, turn, { preserveScroll = true } = {}) {
  if (!bodyEl || !turn) return;
  const stick = preserveScroll ? nearBottom(bodyEl) : false;
  bodyEl.classList.add("hc-agent-output");
  bodyEl.classList.remove("agent-pending", "agent-empty");
  bodyEl.innerHTML = "";

  const header = buildRunHeaderElement(turn);
  const activity = header.querySelector(".hc-run-activity");
  bodyEl.appendChild(header);

  for (const item of turn.items || []) {
    if (item.type === "thinking") {
      activity.appendChild(buildThinkingElement(item.content, { streaming: !!item.streaming, open: !!item.streaming }));
    } else if (item.type === "tool") {
      activity.appendChild(buildToolStepElement(item));
    } else if (item.type === "text") {
      activity.appendChild(buildTextRoundElement(item.content));
    } else if (item.type === "compact") {
      activity.appendChild(buildCompactElement(item));
    } else if (item.type === "system") {
      activity.appendChild(buildSystemNoteElement(item.content));
    } else if (item.type === "permission") {
      activity.appendChild(buildPermissionElement(item));
    }
  }

  if (turn.todos?.length) {
    const todoEl = document.createElement("div");
    todoEl.className = "hc-todos";
    todoEl.innerHTML = turn.todos
      .map((todo) => `<div class="hc-todo ${todo.done ? "done" : ""}">${escapeHtml(todo.text || "")}</div>`)
      .join("");
    activity.appendChild(todoEl);
  }

  const summary = buildChangeSummaryElement(turn.changeSummary || {});
  if (summary) activity.appendChild(summary);

  if (turn.interrupted) {
    const foot = document.createElement("div");
    foot.className = "hc-interrupt-footer";
    foot.textContent = "用户已中断本次运行。";
    activity.appendChild(foot);
  }

  if (turn.error) {
    const err = document.createElement("div");
    err.className = "hc-turn-error";
    err.textContent = turn.error;
    activity.appendChild(err);
  }

  if (stick) bodyEl.scrollIntoView({ block: "end" });
}

function nearBottom(el) {
  const root = el.closest("#chat") || el.parentElement;
  if (!root) return true;
  return root.scrollHeight - root.scrollTop - root.clientHeight < 120;
}
