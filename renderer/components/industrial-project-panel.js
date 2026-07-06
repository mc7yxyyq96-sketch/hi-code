const DEFAULT_DOMAINS = ["software", "mechanical", "electrical", "documentation", "qa"];

export function mountIndustrialProjectPanel({ elements, api, toast }) {
  const state = {
    schema: { domains: DEFAULT_DOMAINS, artifactTypes: [], gateTypes: [] },
    project: null,
    path: ".hicode/project.json",
    draft: null,
    generated: [],
    visible: false,
  };

  const refresh = async () => {
    elements.status.textContent = "正在读取工业项目…";
    const schema = await api.getIndustrialProjectSchema();
    if (schema?.ok) state.schema = schema;
    const result = await api.getIndustrialProject();
    if (!result?.ok) {
      elements.status.textContent = result?.error || "工业项目读取失败";
      return;
    }
    state.project = result.project || null;
    state.path = result.path || ".hicode/project.json";
    syncForm(state, elements);
    render(state, elements);
  };

  const open = async () => {
    state.visible = true;
    await refresh();
  };

  const stop = () => {
    state.visible = false;
  };

  elements.refresh.onclick = refresh;
  elements.save.onclick = async () => {
    const payload = {
      name: elements.name.value.trim(),
      type: elements.type.value.trim(),
      domains: parseList(elements.domains.value),
    };
    if (!payload.name || !payload.type || !payload.domains.length) {
      toast?.show?.("项目名称、类型和 domains 不能为空。");
      return;
    }
    const result = await api.saveIndustrialProject(payload);
    if (!result?.ok) return;
    state.project = result.project;
    state.path = result.path || state.path;
    render(state, elements);
  };

  elements.addArtifact.onclick = async () => {
    const result = await api.addIndustrialArtifact({
      type: elements.artifactType.value,
      name: elements.artifactName.value.trim(),
      path: elements.artifactPath.value.trim(),
      domain: elements.artifactDomain.value,
    });
    if (!result?.ok) return;
    state.project = result.project;
    clearInputs(elements.artifactName, elements.artifactPath);
    render(state, elements);
  };

  elements.addTrace.onclick = async () => {
    const result = await api.addIndustrialTraceability({
      fromType: elements.traceFromType.value,
      fromId: elements.traceFromId.value.trim(),
      toType: elements.traceToType.value,
      toId: elements.traceToId.value.trim(),
    });
    if (!result?.ok) return;
    state.project = result.project;
    clearInputs(elements.traceFromId, elements.traceToId);
    render(state, elements);
  };

  elements.addGate.onclick = async () => {
    const result = await api.addIndustrialGateResult({
      type: elements.gateType.value,
      name: elements.gateName.value.trim() || elements.gateType.value,
      status: elements.gateStatus.value,
      message: elements.gateMessage.value.trim(),
    });
    if (!result?.ok) return;
    state.project = result.project;
    clearInputs(elements.gateName, elements.gateMessage);
    render(state, elements);
  };

  elements.buildDraft.onclick = async () => {
    const result = await api.buildIndustrialRequirementDraft({
      text: elements.requirementText.value.trim(),
      domain: elements.requirementDomain.value,
      priority: elements.requirementPriority.value,
    });
    if (!result?.ok) return;
    state.draft = result.draft;
    state.generated = [];
    syncDraftForm(state.draft, elements);
    render(state, elements);
  };

  elements.addRequirement.onclick = async () => {
    const payload = requirementPayload(state, elements);
    if (!payload.title || !payload.description) {
      toast?.show?.("需求标题和需求描述不能为空。");
      return;
    }
    const result = await api.addIndustrialRequirement(payload);
    if (!result?.ok) return;
    state.project = result.project;
    state.draft = result.requirement || state.draft;
    state.generated = [];
    render(state, elements);
  };

  elements.saveCriteria.onclick = async () => {
    const requirementId = selectedRequirementId(elements);
    if (!requirementId) {
      toast?.show?.("请选择一个 requirement。");
      return;
    }
    const result = await api.updateIndustrialRequirementCriteria({
      requirementId,
      acceptanceCriteria: parseLines(elements.requirementCriteria.value),
    });
    if (!result?.ok) return;
    state.project = result.project;
    state.draft = result.requirement || state.draft;
    render(state, elements);
  };

  elements.generateArtifactPlan.onclick = async () => {
    await runRequirementAction({ state, elements, toast, apiCall: api.generateIndustrialArtifactPlan, previewLabel: "交付物计划" });
  };

  elements.generateTestPlan.onclick = async () => {
    await runRequirementAction({ state, elements, toast, apiCall: api.generateIndustrialTestPlan, previewLabel: "测试计划" });
  };

  elements.generateSpecPackage.onclick = async () => {
    await runRequirementAction({ state, elements, toast, apiCall: api.generateIndustrialSpecPackage, previewLabel: "规格包" });
  };

  elements.approveRequirement.onclick = async () => {
    const requirementId = selectedRequirementId(elements);
    if (!requirementId) {
      toast?.show?.("请选择一个 requirement。");
      return;
    }
    const result = await api.approveIndustrialRequirement({ requirementId, status: "approved", approver: "user", reason: "confirmed in Industrial Project panel" });
    if (!result?.ok) return;
    state.project = result.project;
    state.generated = [{ name: "approval", relativePath: `requirement:${requirementId}` }];
    render(state, elements);
  };

  render(state, elements);
  return { open, stop, refresh };
}

export function renderIndustrialProjectMarkup(project, { path = ".hicode/project.json" } = {}) {
  if (!project) {
    return `<div class="industrial-empty">当前工作区还没有 <span class="mono">.hicode/project.json</span>。可以先填写上方“项目名称 / 项目类型 / 领域”并保存，或直接创建样板项目。</div>`;
  }
  return `
    <div class="industrial-project-card">
      <div>
        <div class="industrial-title">${escapeHtml(project.name || project.projectId)}</div>
        <div class="industrial-sub">${escapeHtml(project.type || "-")} · ${escapeHtml(path)}</div>
      </div>
      <span>${escapeHtml((project.domains || []).length)} 个领域</span>
    </div>
    <div class="industrial-sections">
      <section class="industrial-panel">
        <div class="industrial-panel-title">领域</div>
        <div class="industrial-chip-list">${renderChips(project.domains || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">需求</div>
        <div class="industrial-list">${renderRequirements(project.requirements || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">交付物</div>
        <div class="industrial-list">${renderArtifacts(project.artifacts || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">交付物完整度</div>
        <div class="industrial-list">${renderArtifactCompleteness(project)}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">可追溯关系</div>
        <div class="industrial-list">${renderTraceability(project.traceability || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">质量门禁</div>
        <div class="industrial-list">${renderGates(project.qualityGates || [])}</div>
      </section>
    </div>
  `;
}

export function summarizeIndustrialProject(project) {
  const completeness = summarizeArtifactCompleteness(project);
  return {
    domains: project?.domains?.length || 0,
    requirements: project?.requirements?.length || 0,
    artifacts: project?.artifacts?.length || 0,
    completeArtifacts: completeness.complete,
    simulatedArtifacts: completeness.simulated,
    traceability: project?.traceability?.length || 0,
    gates: project?.qualityGates?.length || 0,
  };
}

function render(state, elements) {
  fillSelect(elements.artifactType, state.schema.artifactTypes || [], "source_code");
  fillSelect(elements.artifactDomain, state.project?.domains || state.schema.domains || DEFAULT_DOMAINS, "");
  fillSelect(elements.gateType, state.schema.gateTypes || [], "build");
  fillSelect(elements.requirementDomain, state.project?.domains || state.schema.domains || DEFAULT_DOMAINS, state.draft?.domain || "");
  fillRequirementSelect(elements.requirementSelect, state.project?.requirements || []);
  elements.detail.innerHTML = renderIndustrialProjectMarkup(state.project, { path: state.path });
  const summary = summarizeIndustrialProject(state.project);
  elements.summary.innerHTML = [
    ["领域", summary.domains],
    ["需求", summary.requirements],
    ["交付物", summary.artifacts],
    ["已完成", summary.completeArtifacts],
    ["追踪", summary.traceability],
    ["门禁", summary.gates],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");
  elements.draftPreview.innerHTML = renderDraftPreview(state);
  elements.status.textContent = state.project ? `已加载 ${state.path}` : "未创建项目配置";
}

function syncForm(state, elements) {
  if (!state.project) return;
  elements.name.value = state.project.name || "";
  elements.type.value = state.project.type || "";
  elements.domains.value = (state.project.domains || []).join(", ");
}

function renderChips(items) {
  if (!items.length) return `<span class="industrial-muted">暂无</span>`;
  return items.map((item) => `<span class="industrial-chip">${escapeHtml(item)}</span>`).join("");
}

function renderArtifacts(items) {
  if (!items.length) return `<div class="industrial-muted">暂无交付物。</div>`;
  return items.map((item) => `<div class="industrial-row">
    <strong>${escapeHtml(item.name || item.id)}</strong>
    <span>${escapeHtml([item.type, item.domain, item.path].filter(Boolean).join(" · "))}</span>
  </div>`).join("");
}

export function summarizeArtifactCompleteness(project) {
  const artifacts = Array.isArray(project?.artifacts) ? project.artifacts : [];
  const complete = artifacts.filter((artifact) => artifact.path && !["missing", "planned"].includes(String(artifact.status || "")) && artifact.metadata?.simulated !== true).length;
  const simulated = artifacts.filter((artifact) => artifact.metadata?.simulated === true || artifact.metadata?.dryRun === true).length;
  const missingPath = artifacts.filter((artifact) => !artifact.path).length;
  const releaseRequired = artifacts.filter((artifact) => artifact.metadata?.releaseRequired !== false).length;
  const gateLinked = artifacts.filter((artifact) => (project?.qualityGates || []).some((gate) => Array.isArray(gate.artifactIds) && gate.artifactIds.includes(artifact.id))).length;
  return {
    total: artifacts.length,
    complete,
    simulated,
    missingPath,
    releaseRequired,
    gateLinked,
  };
}

function renderArtifactCompleteness(project) {
  const summary = summarizeArtifactCompleteness(project);
  return [
    ["总数", summary.total],
    ["真实完成", summary.complete],
    ["模拟 / dry-run", summary.simulated],
    ["缺少路径", summary.missingPath],
    ["发布要求", summary.releaseRequired],
    ["已绑定门禁", summary.gateLinked],
  ].map(([label, value]) => `<div class="industrial-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
}

function renderRequirements(items) {
  if (!items.length) return `<div class="industrial-muted">暂无需求。</div>`;
  return items.map((item) => `<div class="industrial-row">
    <strong>${escapeHtml(item.requirementId || item.id)} · ${escapeHtml(item.title)}</strong>
    <span>${escapeHtml([item.domain, priorityLabel(item.priority), riskLabel(item.riskLevel), item.approvalRequired ? "需要审批" : ""].filter(Boolean).join(" · "))}</span>
    <span>${escapeHtml((item.acceptanceCriteria || []).join(" | "))}</span>
  </div>`).join("");
}

function renderTraceability(items) {
  if (!items.length) return `<div class="industrial-muted">暂无可追溯关系。</div>`;
  return items.map((item) => `<div class="industrial-row">
    <strong>${escapeHtml(relationLabel(item.relation || "trace"))}</strong>
    <span>${escapeHtml(`${item.fromType}:${item.fromId} -> ${item.toType}:${item.toId}`)}</span>
  </div>`).join("");
}

function renderGates(items) {
  if (!items.length) return `<div class="industrial-muted">暂无质量门禁。</div>`;
  return items.map((item) => `<div class="industrial-row gate-${escapeAttr(item.status)}">
    <strong>${escapeHtml(item.name || item.type)}</strong>
    <span>${escapeHtml([item.type, statusLabel(item.status), item.message].filter(Boolean).join(" · "))}</span>
  </div>`).join("");
}

function fillSelect(select, values, fallback) {
  const selected = select.value || fallback || values[0] || "";
  select.innerHTML = values.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join("");
  if (selected && values.includes(selected)) select.value = selected;
}

function fillRequirementSelect(select, requirements) {
  const selected = select.value;
  select.innerHTML = requirements.map((requirement) => `<option value="${escapeAttr(requirement.requirementId || requirement.id)}">${escapeHtml(requirement.requirementId || requirement.id)} · ${escapeHtml(requirement.title || "")}</option>`).join("");
  if (selected && requirements.some((requirement) => (requirement.requirementId || requirement.id) === selected)) select.value = selected;
}

function parseList(value) {
  return String(value || "").split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

function parseLines(value) {
  return String(value || "").split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
}

function requirementPayload(state, elements) {
  const draft = state.draft || {};
  return {
    requirementId: draft.requirementId,
    title: elements.requirementTitle.value.trim() || draft.title,
    description: elements.requirementText.value.trim() || draft.description,
    domain: elements.requirementDomain.value || draft.domain,
    priority: elements.requirementPriority.value || draft.priority || "medium",
    acceptanceCriteria: parseLines(elements.requirementCriteria.value).length ? parseLines(elements.requirementCriteria.value) : draft.acceptanceCriteria || [],
    linkedArtifacts: draft.linkedArtifacts || [],
    linkedTests: draft.linkedTests || [],
    riskLevel: elements.requirementRisk.value || draft.riskLevel || "medium",
    approvalRequired: elements.requirementApprovalRequired.checked || draft.approvalRequired === true,
  };
}

function syncDraftForm(draft, elements) {
  if (!draft) return;
  elements.requirementTitle.value = draft.title || "";
  elements.requirementText.value = draft.description || elements.requirementText.value;
  elements.requirementDomain.value = draft.domain || elements.requirementDomain.value;
  elements.requirementPriority.value = draft.priority || "";
  elements.requirementRisk.value = draft.riskLevel || "medium";
  elements.requirementApprovalRequired.checked = draft.approvalRequired === true;
  elements.requirementCriteria.value = (draft.acceptanceCriteria || []).join("\n");
}

function selectedRequirementId(elements) {
  return elements.requirementSelect.value || "";
}

async function runRequirementAction({ state, elements, toast, apiCall, previewLabel }) {
  const requirementId = selectedRequirementId(elements);
  if (!requirementId) {
    toast?.show?.("请选择一个需求。");
    return;
  }
  const result = await apiCall({ requirementId });
  if (!result?.ok) return;
  state.project = result.project;
  state.generated = result.generated || [];
  state.draft = result.requirement || state.draft;
  render(state, elements);
  toast?.show?.(`${previewLabel} 已生成。`);
}

function renderDraftPreview(state) {
  const lines = [];
  if (state.draft) {
    lines.push(`<strong>${escapeHtml(state.draft.requirementId || state.draft.id || "草案")}</strong> ${escapeHtml(state.draft.title || "")}`);
    lines.push(`<span>${escapeHtml([state.draft.domain, priorityLabel(state.draft.priority), riskLabel(state.draft.riskLevel)].filter(Boolean).join(" · "))}</span>`);
  }
  if (state.generated?.length) {
    lines.push(`<span>${escapeHtml(state.generated.map((item) => item.relativePath || item.name).join(" · "))}</span>`);
  }
  return lines.length ? `<div class="industrial-row">${lines.join("")}</div>` : `<span class="industrial-muted">暂无草案或生成结果。</span>`;
}

function priorityLabel(value = "") {
  return ({ low: "低优先级", medium: "中优先级", high: "高优先级", critical: "关键优先级" })[value] || value;
}

function riskLabel(value = "") {
  return ({ low: "低风险", medium: "中风险", high: "高风险", critical: "关键风险" })[value] || value;
}

function statusLabel(value = "") {
  return ({ pending: "待运行", passed: "通过", failed: "失败", warning: "警告", skipped: "跳过", simulated: "模拟", not_run: "未运行" })[value] || value;
}

function relationLabel(value = "") {
  return ({
    requirement_design: "需求 -> 设计",
    design_artifact: "设计 -> 交付物",
    artifact_test: "交付物 -> 测试",
    test_release_gate: "测试 -> 发布门禁",
    trace: "追踪关系",
  })[value] || value;
}

function clearInputs(...inputs) {
  for (const input of inputs) input.value = "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
