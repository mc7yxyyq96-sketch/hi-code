export function mountSampleProjectPanel({ elements, api, toast, refreshTargets = [] }) {
  const state = {
    running: false,
    lastResult: null,
  };

  const refreshAfterCreate = async () => {
    for (const target of refreshTargets) {
      if (target && typeof target.refresh === "function") {
        try {
          await target.refresh();
        } catch {
          /* each panel owns its visible error state */
        }
      }
    }
  };

  const render = () => {
    elements.detail.innerHTML = renderSampleProjectResultMarkup(state.lastResult);
    elements.status.textContent = state.running
      ? "正在生成 Industrial Control Box Demo..."
      : state.lastResult?.ok
        ? "样板项目已生成"
        : "准备就绪";
    elements.create.disabled = state.running;
  };

  elements.create.onclick = async () => {
    if (state.running) return;
    state.running = true;
    render();
    const result = await api.createIndustrialControlBoxSample({
      sampleId: "industrial-control-box",
      overwrite: elements.overwrite.checked,
      runInstalledTools: elements.runInstalledTools.checked,
      releaseVersion: "industrial-control-box-demo",
      actor: "user",
    });
    state.running = false;
    state.lastResult = result;
    if (result?.ok) {
      toast?.show?.("Industrial Control Box Demo 已生成。");
      await refreshAfterCreate();
    } else {
      toast?.error?.(result?.error || "样板项目生成失败");
    }
    render();
  };

  render();
  return {
    refresh: render,
    stop() {},
  };
}

export function renderSampleProjectResultMarkup(result) {
  if (!result) {
    return `<div class="industrial-muted">生成后会在当前工作区写入项目交付物、门禁证据和发布包。外部工具未安装时会明确标记为 dry-run / simulated。</div>`;
  }
  if (!result.ok) {
    return `<div class="industrial-row"><strong>生成失败</strong><span>${escapeHtml(result.error || "unknown error")}</span></div>`;
  }
  const summary = summarizeSampleProjectResult(result);
  return `
    <div class="industrial-project-card">
      <div>
        <div class="industrial-title">${escapeHtml(summary.name)}</div>
        <div class="industrial-sub">${escapeHtml(summary.releasePath || "发布包待生成")}</div>
      </div>
      <span>${summary.artifacts} 个交付物</span>
    </div>
    <div class="industrial-chip-list">
      <span class="industrial-chip">${summary.gates} 个门禁</span>
      <span class="industrial-chip">${summary.simulated} 个模拟/未运行</span>
      <span class="industrial-chip">${summary.jobs ? "已关联 Job" : "Job 待创建"}</span>
    </div>
  `;
}

export function summarizeSampleProjectResult(result) {
  const sample = result?.sample || {};
  const releasePackage = result?.releasePackage || sample.releasePackage || {};
  const artifacts = sample.artifacts || [];
  const gates = sample.gates || [];
  return {
    name: sample.name || "Industrial Control Box Demo",
    releasePath: releasePackage.releasePath || "",
    artifacts: artifacts.length,
    gates: gates.length,
    simulated: artifacts.filter((artifact) => artifact.simulated).length + gates.filter((gate) => gate.status === "simulated" || gate.status === "not_run").length,
    jobs: !!result?.jobId,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
