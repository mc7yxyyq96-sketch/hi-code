import { escapeHtml } from "../utils/format.js";

export function mountReleaseCenterPanel({ elements, api, toast }) {
  const state = {
    readiness: null,
    releasePackage: null,
    lastError: "",
  };

  const refresh = async () => {
    const version = elements.version.value.trim();
    elements.status.textContent = "正在检查发布就绪度...";
    const result = await api.getReleaseReadiness({ version });
    if (!result?.ok) {
      state.lastError = result?.error || "发布就绪度检查失败。";
      elements.status.textContent = state.lastError;
      render(state, elements);
      return;
    }
    state.readiness = result.readiness;
    state.lastError = "";
    elements.status.textContent = state.readiness?.ready ? "可发布" : "被阻断";
    render(state, elements);
  };

  elements.refresh.onclick = refresh;
  elements.build.onclick = async () => {
    elements.status.textContent = "正在生成交付包...";
    const result = await api.buildReleasePackage({
      version: elements.version.value.trim(),
      createdBy: elements.createdBy.value.trim() || "user",
      overwrite: elements.overwrite?.checked === true,
    });
    if (!result?.ok) {
      state.lastError = result?.error || "交付包生成失败。";
      elements.status.textContent = state.lastError;
      toast?.show?.(state.lastError);
      render(state, elements);
      return;
    }
    state.releasePackage = result.releasePackage;
    state.readiness = result.readiness || result.releasePackage?.readiness || state.readiness;
    state.lastError = "";
    elements.status.textContent = `已生成 ${state.releasePackage?.version || ""}`;
    toast?.show?.("交付包已生成。");
    render(state, elements);
  };
  elements.open.onclick = async () => {
    const releasePath = state.releasePackage?.releasePath || state.readiness?.releasePath;
    const result = await api.openReleasePackage({ releasePath, version: elements.version.value.trim() });
    if (!result?.ok) {
      toast?.show?.(result?.error || "发布目录打开失败。");
    }
  };
  render(state, elements);
  return { open: refresh, refresh, stop: () => {} };
}

export function summarizeReleaseReadiness(readiness = null) {
  const gateSummary = readiness?.gateSummary || {};
  const artifactSummary = readiness?.artifactSummary || {};
  return {
    ready: readiness?.ready === true,
    blockers: Array.isArray(readiness?.blockers) ? readiness.blockers.length : 0,
    warnings: Array.isArray(readiness?.warnings) ? readiness.warnings.length : 0,
    gates: Number(gateSummary.total || 0),
    failed: Number(gateSummary.failed || 0),
    approvals: Array.isArray(readiness?.approvals) ? readiness.approvals.length : 0,
    artifacts: Number(artifactSummary.included || 0),
    missing: Number(artifactSummary.missing || 0),
    simulated: Number(artifactSummary.simulated || 0) + (Array.isArray(readiness?.simulatedGates) ? readiness.simulatedGates.length : 0),
    dod: readiness?.definitionOfDone?.status || "not_run",
    skeletonRisks: Number(readiness?.definitionOfDone?.skeleton?.summary?.total || 0),
    skeletonBlocking: Number(readiness?.definitionOfDone?.skeleton?.summary?.blocking || 0),
  };
}

export function renderReleaseCenterMarkup(readiness = null, releasePackage = null, lastError = "") {
  if (!readiness) {
    return `<div class="release-empty">${escapeHtml(lastError || "还没有 release readiness 结果。")}</div>`;
  }
  const summary = summarizeReleaseReadiness(readiness);
  const risks = Array.isArray(readiness.risks) ? readiness.risks : [];
  const approvals = Array.isArray(readiness.approvals) ? readiness.approvals : [];
  const gates = Array.isArray(readiness.gateResults) ? readiness.gateResults : [];
  const artifacts = releasePackage?.artifacts || [];
  return `
    <div class="release-readiness ${summary.ready ? "ready" : "blocked"}">
      <div>
        <strong>${summary.ready ? "已满足发布条件" : "发布被阻断"}</strong>
        <span>${escapeHtml(readiness.project?.name || "需要 .hicode/project.json")} · ${escapeHtml(readiness.version || "")}</span>
      </div>
      <em>${escapeHtml(readiness.releasePath || "")}</em>
    </div>
    <div class="release-grid">
      <section class="industrial-panel">
        <div class="industrial-panel-title">门禁汇总</div>
        <div class="industrial-list">
          ${["passed", "failed", "warning", "simulated", "not_run", "requires_approval"].map((status) => `<div class="industrial-row"><strong>${escapeHtml(statusLabel(status))}</strong><span>${Number(readiness.gateSummary?.[status] || 0)}</span></div>`).join("")}
        </div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">交付物汇总</div>
        <div class="industrial-list">
          <div class="industrial-row"><strong>已纳入</strong><span>${summary.artifacts}</span></div>
          <div class="industrial-row"><strong>缺失</strong><span>${summary.missing}</span></div>
          <div class="industrial-row"><strong>模拟/未运行</strong><span>${summary.simulated}</span></div>
        </div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">风险汇总</div>
        <div class="industrial-list">
          ${risks.length ? risks.map((risk) => `<div class="industrial-row release-risk-${escapeAttr(risk.severity)}"><strong>${escapeHtml(risk.title)}</strong><span>${escapeHtml(risk.message)}</span></div>`).join("") : `<div class="release-empty">暂无发布风险。</div>`}
        </div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">审批记录</div>
        <div class="industrial-list">
          ${approvals.length ? approvals.map((approval) => `<div class="industrial-row"><strong>${escapeHtml(approval.scope || approval.id)}</strong><span>${escapeHtml([statusLabel(approval.status), approval.decidedBy].filter(Boolean).join(" · "))}</span></div>`).join("") : `<div class="release-empty">暂无审批记录。</div>`}
        </div>
      </section>
    </div>
    ${renderDefinitionOfDoneChecklist(readiness.definitionOfDone)}
    <section class="industrial-panel">
      <div class="industrial-panel-title">门禁证据</div>
      <div class="release-table">
        ${gates.length ? gates.slice(0, 40).map((gate) => `<div class="release-row">
          <span class="gate-status gate-${escapeAttr(gate.status)}">${escapeHtml(statusLabel(gate.status))}</span>
          <strong>${escapeHtml(gate.name || gate.gateId)}</strong>
          <small>${escapeHtml([gate.source, gate.evidencePath].filter(Boolean).join(" · "))}</small>
        </div>`).join("") : `<div class="release-empty">暂无门禁证据。</div>`}
      </div>
    </section>
    ${releasePackage ? `<section class="industrial-panel">
      <div class="industrial-panel-title">最新交付包</div>
      <div class="industrial-list">
        <div class="industrial-row"><strong>发布清单</strong><span>${escapeHtml(releasePackage.manifestPath || "")}</span></div>
        <div class="industrial-row"><strong>校验和</strong><span>${Object.keys(releasePackage.checksums || {}).length}</span></div>
        <div class="industrial-row"><strong>已打包交付物</strong><span>${artifacts.length}</span></div>
      </div>
    </section>` : ""}
  `;
}

function render(state, elements) {
  const summary = summarizeReleaseReadiness(state.readiness);
  elements.summary.innerHTML = [
    ["发布状态", summary.ready ? "可发布" : "阻断"],
    ["阻断项", summary.blockers],
    ["警告", summary.warnings],
    ["门禁", summary.gates],
    ["交付物", summary.artifacts],
    ["模拟/未运行", summary.simulated],
    ["完成定义", statusLabel(summary.dod)],
  ].map(([label, value]) => `<div class="job-stat"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`).join("");
  elements.detail.innerHTML = renderReleaseCenterMarkup(state.readiness, state.releasePackage, state.lastError);
  elements.build.disabled = state.readiness ? state.readiness.ready !== true : false;
  elements.open.disabled = !(state.releasePackage?.releasePath || state.readiness?.releasePath);
}

export function renderDefinitionOfDoneChecklist(definitionOfDone = null) {
  if (!definitionOfDone) {
    return `<section class="industrial-panel"><div class="industrial-panel-title">完成定义检查</div><div class="release-empty">尚未检查。</div></section>`;
  }
  const checklist = Array.isArray(definitionOfDone.checklist) ? definitionOfDone.checklist : [];
  const findings = Array.isArray(definitionOfDone.skeleton?.findings) ? definitionOfDone.skeleton.findings : [];
  return `<section class="industrial-panel dod-panel dod-${escapeAttr(definitionOfDone.status)}">
    <div class="industrial-panel-title">完成定义检查</div>
    <div class="industrial-list">
      <div class="industrial-row"><strong>状态</strong><span>${escapeHtml(statusLabel(definitionOfDone.status))} · ${Number(definitionOfDone.skeleton?.summary?.total || 0)} 个骨架风险</span></div>
      ${checklist.map((item) => `<div class="industrial-row dod-check-${escapeAttr(item.status)}"><strong>${escapeHtml(item.title || item.id)}</strong><span>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(item.message || "")}</span></div>`).join("")}
    </div>
    <div class="industrial-panel-title">骨架风险</div>
    <div class="industrial-list">
      ${findings.length ? findings.slice(0, 12).map((finding) => `<div class="industrial-row skeleton-${escapeAttr(finding.severity)}"><strong>${escapeHtml(finding.type)}</strong><span>${escapeHtml(finding.message || finding.path || "")}</span></div>`).join("") : `<div class="release-empty">未发现骨架风险。</div>`}
    </div>
  </section>`;
}

function statusLabel(value = "") {
  return {
    passed: "通过",
    failed: "失败",
    warning: "警告",
    skipped: "跳过",
    simulated: "模拟",
    not_run: "未运行",
    requires_approval: "需要审批",
    approved: "已审批",
    rejected: "已拒绝",
    ready: "就绪",
    blocked: "阻断",
    complete: "完成",
  }[value] || value || "-";
}

function escapeAttr(value) {
  return escapeHtml(String(value || "")).replace(/"/g, "&quot;");
}
