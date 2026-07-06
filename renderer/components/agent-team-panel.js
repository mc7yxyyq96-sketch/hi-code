import { escapeHtml } from "../utils/format.js";

export function mountAgentTeamPanel({ elements, api, toast }) {
  const state = {
    profiles: [],
    plans: [],
    selectedPlan: null,
    job: null,
    visible: false,
  };

  const refresh = async () => {
    elements.status.textContent = "正在读取智能体团队...";
    const [profilesResult, plansResult] = await Promise.all([
      api.listAgentProfiles({}),
      api.listAgentPlans({ limit: 20 }),
    ]);
    if (profilesResult?.ok) state.profiles = Array.isArray(profilesResult.profiles) ? profilesResult.profiles : [];
    if (plansResult?.ok) {
      state.plans = Array.isArray(plansResult.plans) ? plansResult.plans : [];
      if (!state.selectedPlan && state.plans.length) state.selectedPlan = state.plans[0];
    }
    elements.status.textContent = `智能体 ${state.profiles.length} 个 · 计划 ${state.plans.length} 个`;
    render(state, elements, api, toast);
  };

  elements.refresh.onclick = refresh;
  elements.createPlan.onclick = async () => {
    const task = elements.task.value.trim();
    if (!task) {
      toast?.show?.("请输入需要分工的任务。");
      elements.task.focus();
      return;
    }
    elements.createPlan.disabled = true;
    const result = await api.createAgentPlan({ task, actor: "user" });
    elements.createPlan.disabled = false;
    if (!result?.ok) return;
    state.selectedPlan = result.plan;
    state.plans = [result.plan, ...state.plans.filter((plan) => plan.id !== result.plan.id)];
    state.job = null;
    render(state, elements, api, toast);
  };

  elements.createJob.onclick = async () => {
    if (!state.selectedPlan) {
      toast?.show?.("请先生成智能体分工计划。");
      return;
    }
    elements.createJob.disabled = true;
    const result = await api.createMultiAgentJob({ planId: state.selectedPlan.id, actor: "user" });
    elements.createJob.disabled = false;
    if (!result?.ok) return;
    state.job = result.job;
    state.selectedPlan = result.plan || state.selectedPlan;
    toast?.show?.(`已创建多智能体任务：${result.job?.id || ""}`);
    render(state, elements, api, toast);
  };

  elements.planList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-agent-plan]");
    if (!row) return;
    const result = await api.getAgentPlan(row.dataset.agentPlan);
    if (result?.ok) {
      state.selectedPlan = result.plan;
      state.job = null;
      render(state, elements, api, toast);
    }
  });

  render(state, elements, api, toast);
  return {
    open: async () => {
      state.visible = true;
      await refresh();
    },
    stop: () => {
      state.visible = false;
    },
    refresh,
  };
}

export function summarizeAgentPlan(plan) {
  return {
    agents: plan?.tasks?.length || 0,
    gates: plan?.qualityGates?.length || 0,
    approvals: plan?.humanApprovalPoints?.length || 0,
    artifacts: plan?.expectedArtifacts?.length || 0,
    patchArena: plan?.route?.patchArena === true ? 1 : 0,
  };
}

export function renderAgentProfileListMarkup(profiles = []) {
  if (!profiles.length) return `<div class="agent-team-empty">暂无智能体 Profile。</div>`;
  return profiles.slice(0, 12).map((profile) => `<div class="agent-profile-row">
    <strong>${escapeHtml(profile.name || profile.id)}</strong>
    <span>${escapeHtml([profile.role, (profile.domains || []).join(", ")].filter(Boolean).join(" · "))}</span>
  </div>`).join("");
}

export function renderAgentPlanListMarkup(plans = [], selectedId = "") {
  if (!plans.length) return `<div class="agent-team-empty">暂无分工计划。</div>`;
  return plans.map((plan) => `<button class="agent-plan-row ${plan.id === selectedId ? "active" : ""}" data-agent-plan="${escapeAttr(plan.id)}">
    <span>
      <strong>${escapeHtml(plan.title || plan.task)}</strong>
      <small>${escapeHtml(`${plan.tasks?.length || 0} 个智能体 · ${executionModeLabel(plan.executionMode)}`)}</small>
    </span>
    <em>${escapeHtml(plan.route?.patchArena ? "可进竞技场" : "计划")}</em>
  </button>`).join("");
}

export function renderAgentPlanMarkup(plan, job = null) {
  if (!plan) return `<div class="agent-team-empty">输入任务后生成专业智能体分工。软件任务可进入方案竞技场；工业任务会生成交付物、Checklist、工具 dry-run 计划和人工审批点。</div>`;
  const summary = summarizeAgentPlan(plan);
  return `
    <div class="agent-team-detail-head">
      <div>
        <div class="industrial-title">${escapeHtml(plan.title)}</div>
        <div class="industrial-sub">${escapeHtml(plan.id)} · ${escapeHtml(plan.projectType)} · ${escapeHtml(executionModeLabel(plan.executionMode))}</div>
      </div>
      <span>${summary.agents} 个智能体</span>
    </div>
    ${job ? `<div class="agent-job-link">Job ${escapeHtml(job.id)} · ${escapeHtml(job.status)}</div>` : ""}
    <div class="agent-team-stats">
      ${stat("交付物", summary.artifacts)}
      ${stat("门禁", summary.gates)}
      ${stat("审批点", summary.approvals)}
      ${stat("方案竞技场", summary.patchArena ? "可进入" : "不需要")}
    </div>
    <div class="agent-team-route">
      <strong>执行路线</strong>
      <span>${escapeHtml(plan.route?.patchArena ? "软件任务审批后可进入方案竞技场，多候选 patch 先比较再合并。" : "当前任务不需要方案竞技场。")}</span>
      <span>${escapeHtml(plan.route?.industrialPlan ? "已生成工业交付物、Checklist 和工具运行计划；未安装真实工具时只会 dry-run。" : "当前任务不需要工业工具计划。")}</span>
    </div>
    <div class="agent-team-grid">
      <section class="industrial-panel">
        <div class="industrial-panel-title">智能体任务</div>
        <div class="industrial-list">${renderAgentTasks(plan.tasks || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">评审链</div>
        <div class="industrial-list">${renderList(plan.reviewChain || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">预期交付物</div>
        <div class="industrial-list">${renderList(plan.expectedArtifacts || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">人工审批点</div>
        <div class="industrial-list">${renderList(plan.humanApprovalPoints || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">工具运行计划</div>
        <div class="industrial-list">${renderToolPlan(plan.route?.toolRunPlan || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">评审结果</div>
        <div class="industrial-list">${renderReviews(plan.tasks || [])}</div>
      </section>
    </div>
  `;
}

function render(state, elements) {
  const summary = summarizeAgentPlan(state.selectedPlan);
  elements.summary.innerHTML = [
    ["角色", state.profiles.length],
    ["计划", state.plans.length],
    ["智能体", summary.agents],
    ["交付物", summary.artifacts],
    ["审批点", summary.approvals],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");
  elements.profiles.innerHTML = renderAgentProfileListMarkup(state.profiles);
  elements.planList.innerHTML = renderAgentPlanListMarkup(state.plans, state.selectedPlan?.id || "");
  elements.detail.innerHTML = renderAgentPlanMarkup(state.selectedPlan, state.job);
}

function renderAgentTasks(tasks) {
  if (!tasks.length) return `<div class="industrial-muted">暂无智能体任务。</div>`;
  return tasks.map((task) => `<div class="industrial-row">
    <strong>${escapeHtml(task.agentName || task.agentId)}</strong>
    <span>${escapeHtml(`${statusLabel(task.status)} · 第 ${task.executionGroup} 组 · ${task.expectedArtifacts?.join(", ") || "评审备注"}`)}</span>
  </div>`).join("");
}

function renderReviews(tasks) {
  if (!tasks.length) return `<div class="industrial-muted">暂无评审结果。</div>`;
  return tasks.map((task) => `<div class="industrial-row">
    <strong>${escapeHtml(task.agentName || task.agentId)}</strong>
    <span>${escapeHtml(`${statusLabel(task.reviewResult || "pending")} · ${(task.reviewChecklist || []).map((item) => item.title).join(", ")}`)}</span>
  </div>`).join("");
}

function renderToolPlan(items) {
  if (!items.length) return `<div class="industrial-muted">暂无外部工具计划。</div>`;
  return items.map((item) => `<div class="industrial-row">
    <strong>${escapeHtml(item.tool)}</strong>
    <span>${escapeHtml(`仅 dry-run · 需要授权 · ${item.domainPackId || "项目"}`)}</span>
  </div>`).join("");
}

function renderList(items) {
  if (!items.length) return `<div class="industrial-muted">暂无。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item)}</strong></div>`).join("");
}

function stat(label, value) {
  return `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function statusLabel(value = "") {
  return {
    queued: "排队中",
    running: "运行中",
    paused: "已暂停",
    waiting_approval: "等待审批",
    succeeded: "成功",
    failed: "失败",
    cancelled: "已取消",
    pending: "待处理",
    passed: "通过",
    warning: "警告",
  }[value] || value || "-";
}

function executionModeLabel(value = "") {
  return {
    sequential: "顺序执行",
    parallel: "并行模型",
  }[value] || value || "-";
}
