import { formatDuration, shortPath } from "../utils/format.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "paused", "waiting_approval"]);
const EVENT_PAGE_SIZE = 80;

export function mountJobCenterPanel({ elements, api, toast }) {
  const state = {
    jobs: [],
    selectedJobId: "",
    selectedJob: null,
    eventsExpanded: false,
    pollTimer: null,
    visible: false,
  };

  const refresh = async ({ keepSelection = true } = {}) => {
    elements.status.textContent = "正在刷新任务…";
    const result = await api.listJobs({ limit: 200 });
    if (!result?.ok) {
      elements.status.textContent = result?.error || "任务读取失败";
      return;
    }
    state.jobs = Array.isArray(result.jobs) ? result.jobs : [];
    if (!keepSelection || !state.jobs.some((job) => job.id === state.selectedJobId)) {
      state.selectedJobId = state.jobs[0]?.id || "";
    }
    state.selectedJob = state.jobs.find((job) => job.id === state.selectedJobId) || null;
    elements.status.textContent = `共 ${state.jobs.length} 个任务`;
    render(state, elements, api, toast, refresh);
  };

  const open = async (jobId = "") => {
    state.visible = true;
    if (jobId) state.selectedJobId = jobId;
    startPolling(state, refresh);
    await refresh({ keepSelection: Boolean(jobId) });
  };

  const stop = () => {
    state.visible = false;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  elements.refresh.onclick = () => refresh();
  render(state, elements, api, toast, refresh);

  return {
    open,
    stop,
    refresh,
    select(jobId) {
      state.selectedJobId = jobId;
      state.selectedJob = state.jobs.find((job) => job.id === state.selectedJobId) || null;
      render(state, elements, api, toast, refresh);
    },
    runtimeJobIds() {
      return new Set(state.jobs.map((job) => job.id));
    },
  };
}

export function summarizeJobs(jobs = []) {
  const counts = { total: jobs.length, active: 0, failed: 0, artifacts: 0 };
  for (const job of jobs) {
    if (ACTIVE_STATUSES.has(job.status)) counts.active++;
    if (job.status === "failed") counts.failed++;
    counts.artifacts += Array.isArray(job.artifacts) ? job.artifacts.length : 0;
  }
  return counts;
}

export function jobStatusLabel(status) {
  return {
    queued: "排队中",
    running: "运行中",
    paused: "已暂停",
    waiting_approval: "等待审批",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
  }[status] || status || "-";
}

export function jobActionState(job) {
  const status = job?.status;
  return {
    canCancel: ["queued", "running", "paused", "waiting_approval"].includes(status),
    canRetry: ["failed", "cancelled"].includes(status),
    canPause: ["queued", "running", "waiting_approval"].includes(status),
    canResume: status === "paused",
  };
}

export function renderJobListMarkup(jobs = []) {
  if (!jobs.length) return `<div class="job-empty">还没有任务。运行一次对话后，Runtime Queue 会自动创建 Job。</div>`;
  return jobs.map((job) => `<button class="job-row job-${job.status}" data-job-id="${escapeAttr(job.id)}">
    <span class="job-row-main">
      <span class="job-title">${escapeHtml(job.title || job.id)}</span>
      <span class="job-meta">${escapeHtml(jobMeta(job))}</span>
    </span>
    <span class="job-status">${escapeHtml(jobStatusLabel(job.status))}</span>
  </button>`).join("");
}

export function renderJobDetailMarkup(job, { eventsExpanded = false } = {}) {
  if (!job) {
    return `<div class="job-detail-empty">选择一个任务查看详情。</div>`;
  }
  const actions = jobActionState(job);
  const events = Array.isArray(job.events) ? job.events : [];
  const visibleEvents = eventsExpanded ? events : events.slice(-EVENT_PAGE_SIZE);
  return `
    <div class="job-detail-head">
      <div>
        <div class="job-detail-title">${escapeHtml(job.title || job.id)}</div>
        <div class="job-detail-sub">${escapeHtml(job.id)} · ${escapeHtml(job.source || "manual")} · ${escapeHtml(job.executor || "hicode")}</div>
      </div>
      <span class="job-status job-status-${escapeAttr(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span>
    </div>
    ${job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : ""}
    <div class="job-actions">
      <button data-job-action="cancel" ${actions.canCancel ? "" : "disabled"}>取消</button>
      <button data-job-action="retry" ${actions.canRetry ? "" : "disabled"}>重试</button>
      <button data-job-action="pause" ${actions.canPause ? "" : "disabled"}>暂停</button>
      <button data-job-action="resume" ${actions.canResume ? "" : "disabled"}>继续</button>
      <button data-job-action="refresh">刷新</button>
    </div>
    <div class="job-detail-grid">
      <section class="job-panel">
        <div class="job-panel-title">任务与步骤</div>
        <div class="job-timeline">${renderTasks(job.tasks || [])}</div>
      </section>
      <section class="job-panel">
        <div class="job-panel-title">交付物</div>
        <div class="job-artifacts">${renderArtifacts(job.artifacts || [])}</div>
      </section>
      <section class="job-panel">
        <div class="job-panel-title">门禁结果</div>
        <div class="job-gates">${renderGates(job.gateResults || [])}</div>
      </section>
      <section class="job-panel job-events-panel">
        <div class="job-panel-title">
          <span>事件日志</span>
          ${events.length > EVENT_PAGE_SIZE ? `<button data-job-action="toggle-events">${eventsExpanded ? "收起" : `显示全部 ${events.length}`}</button>` : ""}
        </div>
        <div class="job-events">${renderEvents(visibleEvents)}</div>
      </section>
    </div>
    <pre class="job-artifact-preview hidden"></pre>
  `;
}

function render(state, elements, api, toast, refresh) {
  const summary = summarizeJobs(state.jobs);
  elements.summary.innerHTML = [
    ["总数", summary.total],
    ["进行中", summary.active],
    ["失败", summary.failed],
    ["交付物", summary.artifacts],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");

  elements.list.innerHTML = renderJobListMarkup(state.jobs);
  elements.list.querySelectorAll("[data-job-id]").forEach((row) => {
    row.classList.toggle("active", row.dataset.jobId === state.selectedJobId);
    row.onclick = () => {
      state.selectedJobId = row.dataset.jobId;
      state.selectedJob = state.jobs.find((job) => job.id === state.selectedJobId) || null;
      render(state, elements, api, toast, refresh);
    };
  });

  elements.detail.innerHTML = renderJobDetailMarkup(state.selectedJob, { eventsExpanded: state.eventsExpanded });
  wireDetailActions(state, elements, api, toast, refresh);
}

function wireDetailActions(state, elements, api, toast, refresh) {
  const job = state.selectedJob;
  if (!job) return;
  elements.detail.querySelectorAll("[data-job-action]").forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.jobAction;
      if (action === "refresh") return refresh();
      if (action === "toggle-events") {
        state.eventsExpanded = !state.eventsExpanded;
        render(state, elements, api, toast, refresh);
        return;
      }
      const operations = {
        cancel: () => api.cancelJob(job.id, { reason: "cancelled from Job Center UI" }),
        retry: () => api.retryJob(job.id),
        pause: () => api.pauseJob(job.id),
        resume: () => api.resumeJob(job.id),
      };
      const fn = operations[action];
      if (!fn) return;
      const result = await fn();
      if (!result?.ok) return;
      state.selectedJob = result.job;
      state.selectedJobId = result.job.id;
      await refresh({ keepSelection: true });
    };
  });

  elements.detail.querySelectorAll("[data-artifact-preview]").forEach((button) => {
    button.onclick = async () => {
      const result = await api.previewJobArtifact(job.id, button.dataset.artifactPreview);
      if (!result?.ok) return;
      const preview = elements.detail.querySelector(".job-artifact-preview");
      preview.textContent = result.content || "";
      preview.classList.remove("hidden");
    };
  });

  elements.detail.querySelectorAll("[data-artifact-open]").forEach((button) => {
    button.onclick = async () => {
      await api.openJobArtifact(job.id, button.dataset.artifactOpen);
    };
  });
}

function startPolling(state, refresh) {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    if (state.visible) refresh({ keepSelection: true });
  }, 5000);
}

function renderTasks(tasks) {
  if (!tasks.length) return `<div class="job-empty">暂无 task。</div>`;
  return tasks.map((task) => `<div class="job-task job-${escapeAttr(task.status)}">
    <div class="job-task-head">
      <span>${escapeHtml(task.title || task.id)}</span>
      <em>${escapeHtml(jobStatusLabel(task.status))}</em>
    </div>
    <div class="job-task-meta">${escapeHtml(task.assignee || task.executor || "")}${task.error ? ` · ${escapeHtml(task.error)}` : ""}</div>
    <div class="job-steps">${renderSteps(task.steps || [])}</div>
  </div>`).join("");
}

function renderSteps(steps) {
  if (!steps.length) return "";
  return steps.map((step) => `<div class="job-step job-${escapeAttr(step.status)}">
    <span class="job-step-dot"></span>
    <span class="job-step-main">
      <span>${escapeHtml(step.title || step.id)}</span>
      <small>${escapeHtml([jobStatusLabel(step.status), step.executor, step.command].filter(Boolean).join(" · "))}</small>
    </span>
  </div>`).join("");
}

function renderArtifacts(artifacts) {
  if (!artifacts.length) return `<div class="job-empty">暂无 artifact。</div>`;
  return artifacts.map((artifact) => `<div class="job-artifact">
    <div class="job-artifact-main">
      <strong>${escapeHtml(artifact.name || artifact.type || "artifact")}</strong>
      <span>${escapeHtml(shortPath(artifact.path || ""))}</span>
    </div>
    <div class="job-artifact-actions">
      <button data-artifact-preview="${escapeAttr(artifact.id)}">预览</button>
      <button data-artifact-open="${escapeAttr(artifact.id)}">打开位置</button>
    </div>
  </div>`).join("");
}

function renderGates(gates) {
  if (!gates.length) return `<div class="job-empty">暂无 gate result。</div>`;
  return gates.map((gate) => `<div class="job-gate gate-${escapeAttr(gate.status)}">
    <strong>${escapeHtml(gate.gate)}</strong>
    <span>${escapeHtml(gate.status)}${gate.score !== undefined ? ` · ${escapeHtml(String(gate.score))}` : ""}</span>
    ${gate.message ? `<p>${escapeHtml(gate.message)}</p>` : ""}
  </div>`).join("");
}

function renderEvents(events) {
  if (!events.length) return `<div class="job-empty">暂无事件。</div>`;
  return events.slice().reverse().map((event) => `<div class="job-event">
    <span>${escapeHtml(formatTime(event.createdAt))}</span>
    <strong>${escapeHtml(event.type)}</strong>
    <em>${escapeHtml(event.message || "")}</em>
  </div>`).join("");
}

function jobMeta(job) {
  const bits = [job.source, job.executor, formatTime(job.updatedAt || job.createdAt)];
  if (job.startedAt && job.endedAt) bits.push(formatDuration(job.endedAt - job.startedAt));
  if (Array.isArray(job.artifacts) && job.artifacts.length) bits.push(`${job.artifacts.length} 个交付物`);
  return bits.filter(Boolean).join(" · ");
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
