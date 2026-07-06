import { escapeHtml } from "../utils/format.js";

export function mountQualityGatePanel({ elements, api, toast }) {
  const state = {
    gates: [],
    selectedId: "",
    selected: null,
    lastRun: null,
  };

  const refresh = async () => {
    elements.status.textContent = "正在读取质量门禁...";
    const result = await api.listQualityGates();
    if (!result?.ok) {
      elements.status.textContent = result?.error || "质量门禁读取失败";
      return;
    }
    state.gates = Array.isArray(result.gates) ? result.gates : [];
    if (!state.gates.some((gate) => gate.id === state.selectedId)) state.selectedId = state.gates[0]?.id || "";
    state.selected = state.gates.find((gate) => gate.id === state.selectedId) || null;
    elements.status.textContent = `共 ${state.gates.length} 个门禁`;
    render(state, elements);
  };

  elements.refresh.onclick = refresh;
  elements.list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-quality-gate]");
    if (!row) return;
    state.selectedId = row.dataset.qualityGate;
    state.selected = state.gates.find((gate) => gate.id === state.selectedId) || null;
    render(state, elements);
  });
  elements.detail.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-gate-action]")?.dataset.gateAction;
    if (!action || !state.selected) return;
    const payload = readGatePayload(elements, state.selected.id);
    const result = action === "approve"
        ? await api.approveQualityGate({ ...payload, approved: true })
        : action === "reject"
        ? await api.approveQualityGate({ ...payload, approved: false, reason: "从质量门禁面板拒绝" })
        : await api.runQualityGate(payload);
    if (!result?.ok) return;
    state.lastRun = result;
    toast?.show?.(`质量门禁${statusLabel(result.run?.status || "completed")}。`);
    render(state, elements);
  });
  render(state, elements);
  return { open: refresh, refresh, stop: () => {} };
}

export function summarizeQualityGates(gates = []) {
  return gates.reduce((summary, gate) => {
    summary.total += 1;
    summary[gate.type] = (summary[gate.type] || 0) + 1;
    if (gate.requiresApproval) summary.approvals += 1;
    return summary;
  }, { total: 0, command_gate: 0, file_exists_gate: 0, schema_gate: 0, artifact_integrity_gate: 0, security_gate: 0, human_approval_gate: 0, adapter_gate: 0, documentation_gate: 0, approvals: 0 });
}

export function renderQualityGateListMarkup(gates = [], selectedId = "") {
  if (!gates.length) return `<div class="quality-gate-empty">暂无质量门禁。创建工业项目或启用 Domain Pack 后会出现可运行门禁。</div>`;
  return gates.map((gate) => `<button class="quality-gate-row ${gate.id === selectedId ? "active" : ""}" data-quality-gate="${escapeAttr(gate.id)}">
    <span>
      <strong>${escapeHtml(gate.name || gate.id)}</strong>
      <small>${escapeHtml([gate.category, gate.type].filter(Boolean).join(" · "))}</small>
    </span>
    <em>${escapeHtml(gate.severity || "info")}</em>
  </button>`).join("");
}

export function renderQualityGateDetailMarkup(gate, lastRun = null) {
  if (!gate) return `<div class="quality-gate-empty">选择一个门禁查看规则、证据和操作。命令门禁会真实执行检查；人工审批门禁需要你明确通过或拒绝。</div>`;
  const result = lastRun?.run?.gateId === gate.id ? lastRun.run.result : null;
  const status = result?.status || "not_run";
  return `
    <div class="quality-gate-detail-head">
      <div>
        <div class="industrial-title">${escapeHtml(gate.name || gate.id)}</div>
        <div class="industrial-sub">${escapeHtml(gate.id)} · ${escapeHtml(gate.type)} · ${escapeHtml(gate.category || "-")}</div>
      </div>
      <span class="gate-status gate-${escapeAttr(status)}">${escapeHtml(statusLabel(status))}</span>
    </div>
    <p class="industrial-muted">${escapeHtml(gate.description || "")}</p>
    <div class="quality-gate-actions">
      <button data-gate-action="run">重新运行门禁</button>
      ${gate.type === "human_approval_gate" ? `<button data-gate-action="approve" class="primary">审批通过</button><button data-gate-action="reject" class="ghost">拒绝</button>` : ""}
    </div>
    <div class="quality-gate-inputs">
      <label><span>交付物路径</span><textarea data-gate-field="artifactPaths" rows="3" spellcheck="false" placeholder=".hicode/artifacts/... 每行一个">${escapeHtml((gate.artifactPaths || []).join("\n"))}</textarea></label>
      <label><span>变更文件</span><textarea data-gate-field="changedFiles" rows="3" spellcheck="false" placeholder="electron/main.mjs&#10;renderer/index.html"></textarea></label>
      <label><span>Schema JSON</span><textarea data-gate-field="schemaJson" rows="3" spellcheck="false" placeholder="{&quot;schemaVersion&quot;:1}"></textarea></label>
    </div>
    <div class="quality-gate-grid">
      <section class="industrial-panel">
        <div class="industrial-panel-title">修复建议</div>
        <div class="industrial-list">
          <div class="industrial-row"><strong>${escapeHtml(gate.remediation?.summary || "查看门禁结果并按证据修复。")}</strong><span>${escapeHtml((gate.remediation?.steps || []).join(" · "))}</span></div>
        </div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">证据</div>
        ${result ? renderEvidence(result) : `<div class="quality-gate-empty">尚未运行。</div>`}
      </section>
    </div>
  `;
}

function render(state, elements) {
  const summary = summarizeQualityGates(state.gates);
  elements.summary.innerHTML = [
    ["门禁", summary.total],
    ["命令检查", summary.command_gate],
    ["交付物检查", summary.file_exists_gate + summary.artifact_integrity_gate],
    ["人工审批", summary.approvals],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");
  elements.list.innerHTML = renderQualityGateListMarkup(state.gates, state.selectedId);
  elements.detail.innerHTML = renderQualityGateDetailMarkup(state.selected, state.lastRun);
}

function readGatePayload(elements, gateId) {
  const field = (name) => elements.detail.querySelector(`[data-gate-field='${name}']`)?.value || "";
  const schemaText = field("schemaJson").trim();
  let schemaValue;
  if (schemaText) {
    try {
      schemaValue = JSON.parse(schemaText);
    } catch {
      schemaValue = { invalidJson: schemaText };
    }
  }
  return {
    gateId,
    actor: "user",
    artifactPaths: splitLines(field("artifactPaths")),
    changedFiles: splitLines(field("changedFiles")),
    schemaValue,
  };
}

function renderEvidence(result) {
  const evidence = result.evidence || {};
  return `<div class="quality-gate-evidence">
    <div class="industrial-row"><strong>${escapeHtml(result.message || "")}</strong><span>${escapeHtml([evidence.command, evidence.adapter].filter(Boolean).join(" · "))}</span></div>
    <pre>${escapeHtml(JSON.stringify({
      gateId: evidence.gateId,
      status: evidence.status,
      startedAt: evidence.startedAt,
      endedAt: evidence.endedAt,
      stdoutSummary: evidence.stdoutSummary,
      stderrSummary: evidence.stderrSummary,
      artifactLinks: evidence.artifactLinks,
      remediation: evidence.remediation,
      manualApprovalRequired: evidence.manualApprovalRequired,
    }, null, 2))}</pre>
  </div>`;
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
    completed: "已完成",
    running: "运行中",
  }[value] || value || "-";
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
