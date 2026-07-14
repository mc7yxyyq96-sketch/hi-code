import { shortPath } from "../utils/format.js";

const POLL_MS = 6000;
const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  ready: "待确认",
  failed: "失败",
  merged: "已合并",
  rejected: "已拒绝",
  accepted: "已接受",
  passed: "通过",
  warning: "警告",
  blocking: "阻断",
};

const SUMMARY_LABELS = {
  Runs: "轮次",
  Running: "运行中",
  Ready: "待确认",
  Candidates: "候选方案",
  Merged: "已合并",
};

export function mountPatchArenaPanel({ elements, api, toast }) {
  const state = {
    runs: [],
    providers: [],
    selectedRunId: "",
    selectedCandidateId: "",
    selectedRun: null,
    patchPreview: "",
    pollTimer: null,
    visible: false,
  };

  const refresh = async ({ keepSelection = true } = {}) => {
    elements.status.textContent = "正在刷新方案竞技场…";
    const result = await api.listArenaRuns({ limit: 100 });
    if (!result?.ok) {
      elements.status.textContent = result?.error || "方案竞技场读取失败";
      return;
    }
    state.runs = Array.isArray(result.runs) ? result.runs : [];
    if (!keepSelection || !state.runs.some((run) => run.id === state.selectedRunId)) {
      state.selectedRunId = state.runs[0]?.id || "";
      state.selectedCandidateId = state.runs[0]?.candidates?.[0]?.id || "";
    }
    state.selectedRun = state.runs.find((run) => run.id === state.selectedRunId) || null;
    if (!state.selectedRun?.candidates?.some((candidate) => candidate.id === state.selectedCandidateId)) {
      state.selectedCandidateId = state.selectedRun?.candidates?.[0]?.id || "";
    }
    elements.status.textContent = `共 ${state.runs.length} 个方案轮次`;
    render(state, elements, api, toast, refresh);
  };

  const loadProviders = async () => {
    const result = await api.listProviders();
    state.providers = Array.isArray(result?.providers)
      ? result.providers.filter((provider) => provider.kind === "agent" || provider.metadata?.providerKind === "agent")
      : [];
    renderProviders(state, elements);
  };

  const open = async () => {
    state.visible = true;
    startPolling(state, refresh);
    await loadProviders();
    await refresh();
  };

  const stop = () => {
    state.visible = false;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  elements.refresh.onclick = () => refresh();
  elements.create.onclick = async () => {
    const task = elements.task.value.trim();
    if (!task) {
      toast?.show?.("请输入方案任务。");
      return;
    }
    const providerIds = selectedProviders(elements);
    const command = elements.command.value.trim();
    elements.create.disabled = true;
    elements.status.textContent = "正在创建方案轮次...";
    const result = await api.createArenaRun({
      task,
      providerIds,
      command: command || undefined,
      mode: "auto",
      preserveWorkspace: false,
    });
    elements.create.disabled = false;
    if (!result?.ok && !result?.run) return;
    state.selectedRunId = result.run.id;
    state.selectedCandidateId = result.run.candidates?.[0]?.id || "";
    await refresh({ keepSelection: true });
  };

  render(state, elements, api, toast, refresh);
  return { open, stop, refresh };
}

export function summarizeArenaRuns(runs = []) {
  const summary = { total: runs.length, running: 0, ready: 0, failed: 0, candidates: 0, merged: 0 };
  for (const run of runs) {
    if (run.status === "running" || run.status === "queued") summary.running += 1;
    if (run.status === "ready") summary.ready += 1;
    if (run.status === "failed") summary.failed += 1;
    if (run.status === "merged") summary.merged += 1;
    summary.candidates += Array.isArray(run.candidates) ? run.candidates.length : 0;
  }
  return summary;
}

export function renderArenaRunListMarkup(runs = []) {
  if (!runs.length) return `<div class="arena-empty">还没有方案轮次。填写上方任务后点击“创建方案轮次”。</div>`;
  return runs.map((run) => `<button class="arena-run-row arena-${escapeAttr(run.status)}" data-arena-run="${escapeAttr(run.id)}">
    <span>
      <strong>${escapeHtml(run.title || run.task || run.id)}</strong>
      <small>${escapeHtml([statusLabel(run.status), `${run.candidates?.length || 0} 个候选`, formatTime(run.updatedAt || run.createdAt)].filter(Boolean).join(" · "))}</small>
    </span>
    <em>${escapeHtml(statusLabel(run.status))}</em>
  </button>`).join("");
}

export function renderArenaCandidateListMarkup(run, selectedCandidateId = "") {
  const candidates = run?.candidates || [];
  if (!candidates.length) return `<div class="arena-empty">暂无候选方案。Provider 运行完成后会显示 diff、日志和质量门禁。</div>`;
  return candidates.map((candidate) => `<button class="arena-candidate-row ${candidate.id === selectedCandidateId ? "active" : ""}" data-arena-candidate="${escapeAttr(candidate.id)}">
    <span>
      <strong>${escapeHtml(candidate.providerName || candidate.providerId)}</strong>
      <small>${escapeHtml(candidate.patch?.summary || candidate.summary || candidate.error || "等待执行")}${skeletonRiskCount(candidate) ? ` · 骨架风险:${skeletonRiskCount(candidate)}` : ""}</small>
    </span>
    <em class="arena-candidate-status arena-${escapeAttr(candidate.status)}">${escapeHtml(statusLabel(candidate.status))}</em>
  </button>`).join("");
}

export function renderArenaDetailMarkup(run, selectedCandidateId = "", patchPreview = "") {
  if (!run) return `<div class="arena-detail-empty">选择一个方案轮次查看候选方案。</div>`;
  const candidate = (run.candidates || []).find((item) => item.id === selectedCandidateId) || run.candidates?.[0];
  if (!candidate) return `<div class="arena-detail-empty">这个方案轮次还没有候选方案。</div>`;
  return `
    <div class="arena-detail-head">
      <div>
        <div class="arena-title">${escapeHtml(run.title || run.task || run.id)}</div>
        <div class="arena-sub">${escapeHtml(run.id)} · ${escapeHtml(statusLabel(run.status))} · ${escapeHtml(shortPath(run.sourcePath || ""))}</div>
      </div>
      <span class="arena-score">${candidate.score?.total ?? "-"} / 100</span>
    </div>
    ${candidate.error ? `<div class="job-error">${escapeHtml(candidate.error)}</div>` : ""}
    <div class="arena-actions">
      <button data-arena-action="accept" ${candidate.status === "ready" ? "" : "disabled"}>接受</button>
      <button data-arena-action="reject" ${["ready", "failed"].includes(candidate.status) ? "" : "disabled"}>拒绝</button>
      <button data-arena-action="merge" ${candidate.status === "ready" && candidate.patch?.path ? "" : "disabled"}>合并</button>
      <button data-arena-action="refresh">刷新</button>
    </div>
    <div class="arena-detail-grid">
      <section class="arena-panel arena-diff-panel">
        <div class="arena-panel-title">
          <span>Patch 预览</span>
          ${candidate.patch?.path ? `<button data-arena-artifact-preview="${escapeAttr(candidate.patch.path)}">预览</button>` : ""}
        </div>
        <pre class="arena-diff">${escapeHtml(patchPreview || candidate.patch?.summary || "暂无 patch。")}</pre>
      </section>
      <section class="arena-panel">
        <div class="arena-panel-title">质量门禁</div>
        <div class="arena-gates">${renderArenaGates(candidate.gateResults || [])}</div>
      </section>
      <section class="arena-panel">
        <div class="arena-panel-title">骨架风险</div>
        <div class="arena-gates">${renderSkeletonRisk(candidate)}</div>
      </section>
      <section class="arena-panel">
        <div class="arena-panel-title">产物</div>
        <div class="arena-artifacts">${renderArenaArtifacts(candidate.artifacts || [])}</div>
      </section>
      <section class="arena-panel">
        <div class="arena-panel-title">日志</div>
        <pre class="arena-logs">${escapeHtml((candidate.logs || []).slice(-30).join("\n") || "暂无日志。")}</pre>
      </section>
    </div>
  `;
}

function render(state, elements, api, toast, refresh) {
  const summary = summarizeArenaRuns(state.runs);
  elements.summary.innerHTML = [
    ["Runs", summary.total],
    ["Running", summary.running],
    ["Ready", summary.ready],
    ["Candidates", summary.candidates],
    ["Merged", summary.merged],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${SUMMARY_LABELS[label] || label}</span></div>`).join("");

  elements.list.innerHTML = renderArenaRunListMarkup(state.runs);
  elements.list.querySelectorAll("[data-arena-run]").forEach((row) => {
    row.classList.toggle("active", row.dataset.arenaRun === state.selectedRunId);
    row.onclick = async () => {
      state.selectedRunId = row.dataset.arenaRun;
      state.selectedRun = state.runs.find((run) => run.id === state.selectedRunId) || null;
      state.selectedCandidateId = state.selectedRun?.candidates?.[0]?.id || "";
      state.patchPreview = "";
      render(state, elements, api, toast, refresh);
    };
  });

  elements.candidates.innerHTML = renderArenaCandidateListMarkup(state.selectedRun, state.selectedCandidateId);
  elements.candidates.querySelectorAll("[data-arena-candidate]").forEach((row) => {
    row.onclick = () => {
      state.selectedCandidateId = row.dataset.arenaCandidate;
      state.patchPreview = "";
      render(state, elements, api, toast, refresh);
    };
  });

  elements.detail.innerHTML = renderArenaDetailMarkup(state.selectedRun, state.selectedCandidateId, state.patchPreview);
  wireDetailActions(state, elements, api, toast, refresh);
}

function renderProviders(state, elements) {
  const providers = state.providers.length
    ? state.providers
    : [{ id: "hicode-internal", name: "Hi Code Internal", status: "enabled" }];
  elements.providers.innerHTML = providers.map((provider) => {
    const enabled = provider.status === "enabled";
    return `<label class="arena-provider ${enabled ? "" : "disabled"}">
      <input type="checkbox" value="${escapeAttr(provider.id)}" ${enabled ? "checked" : "disabled"} />
      <span>${escapeHtml(provider.name || provider.id)}</span>
      <small>${escapeHtml(providerStatusLabel(provider.status))}</small>
    </label>`;
  }).join("");
}

function wireDetailActions(state, elements, api, toast, refresh) {
  const run = state.selectedRun;
  const candidate = (run?.candidates || []).find((item) => item.id === state.selectedCandidateId);
  if (!run || !candidate) return;

  elements.detail.querySelectorAll("[data-arena-action]").forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.arenaAction;
      if (action === "refresh") return refresh({ keepSelection: true });
      const operations = {
        accept: () => api.acceptArenaCandidate(run.id, candidate.id, { reason: "accepted from Patch Arena UI" }),
        reject: () => api.rejectArenaCandidate(run.id, candidate.id, { reason: "rejected from Patch Arena UI" }),
        merge: () => api.mergeArenaCandidate(run.id, candidate.id, { reason: "merged from Patch Arena UI" }),
      };
      const result = await operations[action]?.();
      if (!result?.ok) return;
      toast?.show?.(action === "merge" ? "Patch 已合并。" : "已更新候选方案。");
      await refresh({ keepSelection: true });
    };
  });

  elements.detail.querySelectorAll("[data-arena-artifact-preview]").forEach((button) => {
    button.onclick = async () => {
      const result = await api.previewArenaArtifact(run.id, candidate.id, button.dataset.arenaArtifactPreview);
      if (!result?.ok) return;
      state.patchPreview = result.content || "";
      render(state, elements, api, toast, refresh);
    };
  });

  elements.detail.querySelectorAll("[data-arena-artifact-open]").forEach((button) => {
    button.onclick = () => api.openArenaArtifact(run.id, candidate.id, button.dataset.arenaArtifactOpen);
  });
}

function renderArenaGates(gates) {
  if (!gates.length) return `<div class="arena-empty">暂无质量门禁结果。</div>`;
  return gates.map((gate) => `<div class="job-gate gate-${escapeAttr(gate.status)}">
    <strong>${escapeHtml(gate.gate)}</strong>
    <span>${escapeHtml(statusLabel(gate.status))}${gate.exitCode !== undefined ? ` · ${escapeHtml(String(gate.exitCode))}` : ""}</span>
    ${gate.message ? `<p>${escapeHtml(gate.message)}</p>` : ""}
  </div>`).join("");
}

function renderArenaArtifacts(artifacts) {
  if (!artifacts.length) return `<div class="arena-empty">暂无产物。</div>`;
  return artifacts.map((artifact) => `<div class="job-artifact">
    <div class="job-artifact-main">
      <strong>${escapeHtml(artifact.name || artifact.type || "artifact")}</strong>
      <span>${escapeHtml(shortPath(artifact.path || ""))}</span>
    </div>
    <div class="job-artifact-actions">
      <button data-arena-artifact-preview="${escapeAttr(artifact.path)}">预览</button>
      <button data-arena-artifact-open="${escapeAttr(artifact.path)}">打开位置</button>
    </div>
  </div>`).join("");
}

function statusLabel(status = "") {
  return STATUS_LABELS[status] || status || "-";
}

function providerStatusLabel(status = "") {
  if (status === "enabled") return "已启用";
  if (status === "disabled") return "已禁用";
  if (status === "not_configured") return "未配置";
  return status || "未知";
}

export function renderSkeletonRisk(candidate) {
  const definitionOfDone = candidate?.metadata?.definitionOfDone;
  const findings = Array.isArray(definitionOfDone?.skeleton?.findings) ? definitionOfDone.skeleton.findings : [];
  const riskTerms = ["skeleton", ["place", "holder"].join(""), ["mo", "ck"].join(""), ["to", "do"].join(""), "empty"];
  const notes = Array.isArray(candidate?.riskNotes) ? candidate.riskNotes.filter((note) => riskTerms.some((term) => String(note).toLowerCase().includes(term))) : [];
  if (!definitionOfDone && !notes.length) return `<div class="arena-empty">未发现骨架风险证据。</div>`;
  return `
    <div class="job-gate gate-${escapeAttr(definitionOfDone?.status || "warning")}">
      <strong>完成定义检查</strong>
      <span>${escapeHtml(statusLabel(definitionOfDone?.status || "warning"))} · ${Number(definitionOfDone?.skeleton?.summary?.total || notes.length)} 个风险</span>
      ${definitionOfDone?.evidencePath ? `<p>${escapeHtml(definitionOfDone.evidencePath)}</p>` : ""}
    </div>
    ${findings.length ? findings.slice(0, 12).map((finding) => `<div class="job-gate gate-${escapeAttr(finding.severity === "blocking" ? "failed" : "warning")}">
      <strong>${escapeHtml(finding.type)}</strong>
      <span>${escapeHtml(statusLabel(finding.severity))}</span>
      <p>${escapeHtml(finding.message || finding.path || "")}</p>
    </div>`).join("") : ""}
    ${!findings.length && notes.length ? notes.slice(0, 8).map((note) => `<div class="job-gate gate-warning"><strong>风险说明</strong><p>${escapeHtml(note)}</p></div>`).join("") : ""}
  `;
}

function skeletonRiskCount(candidate) {
  return Number(candidate?.metadata?.definitionOfDone?.skeleton?.summary?.total || 0);
}

function selectedProviders(elements) {
  const selected = Array.from(elements.providers.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
  return selected.length ? selected : ["hicode-internal"];
}

function startPolling(state, refresh) {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(() => {
    if (state.visible) refresh({ keepSelection: true });
  }, POLL_MS);
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
