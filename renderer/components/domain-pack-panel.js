import { escapeHtml } from "../utils/format.js";

export function mountDomainPackPanel({ elements, api, toast, onProjectChanged = null }) {
  const state = {
    packs: [],
    selectedId: "",
    selectedPack: null,
    visible: false,
  };

  const refresh = async ({ keepSelection = true } = {}) => {
    elements.summary.textContent = "正在读取领域能力包...";
    const result = await api.listDomainPacks();
    if (!result?.ok) {
      elements.summary.textContent = result?.error || "领域能力包读取失败";
      return;
    }
    state.packs = Array.isArray(result.packs) ? result.packs : [];
    if (!keepSelection || !state.packs.some((pack) => pack.manifest?.id === state.selectedId)) {
      state.selectedId = state.packs.find((pack) => pack.recommended)?.manifest?.id || state.packs[0]?.manifest?.id || "";
    }
    state.selectedPack = state.packs.find((pack) => pack.manifest?.id === state.selectedId) || null;
    render(state, elements, api, toast, refresh, onProjectChanged);
  };

  const select = async (packId) => {
    state.selectedId = packId;
    const result = await api.getDomainPack(packId);
    state.selectedPack = result?.ok ? result.pack : state.packs.find((pack) => pack.manifest?.id === packId) || null;
    render(state, elements, api, toast, refresh, onProjectChanged);
  };

  elements.refresh.onclick = () => refresh({ keepSelection: true });
  elements.list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-domain-pack]");
    if (row) select(row.dataset.domainPack);
  });

  render(state, elements, api, toast, refresh, onProjectChanged);
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

export function summarizeDomainPacks(packs = []) {
  return packs.reduce((summary, pack) => {
    summary.total += 1;
    if (pack.installed) summary.installed += 1;
    if (pack.enabled) summary.enabled += 1;
    if (pack.recommended) summary.recommended += 1;
    summary.templates += pack.manifest?.templates?.length || 0;
    summary.checklists += pack.manifest?.checklists?.length || 0;
    return summary;
  }, { total: 0, installed: 0, enabled: 0, recommended: 0, templates: 0, checklists: 0 });
}

export function renderDomainPackListMarkup(packs = [], selectedId = "") {
  if (!packs.length) return `<div class="domain-pack-empty">暂无领域能力包。启用能力包后，项目会获得对应标准、模板、Checklist、工具要求和质量门禁。</div>`;
  return packs.map((pack) => {
    const manifest = pack.manifest || {};
    const badges = [
      pack.enabled ? "已启用" : pack.installed ? "已安装" : "可安装",
      pack.recommended ? "推荐" : "",
    ].filter(Boolean).join(" · ");
    return `<button class="domain-pack-row ${manifest.id === selectedId ? "active" : ""}" data-domain-pack="${escapeAttr(manifest.id)}">
      <span>
        <strong>${escapeHtml(manifest.name || manifest.id)}</strong>
        <small>${escapeHtml((manifest.domains || []).join(", "))}</small>
      </span>
      <em>${escapeHtml(badges)}</em>
    </button>`;
  }).join("");
}

export function renderDomainPackDetailMarkup(pack) {
  if (!pack) return `<div class="domain-pack-empty">选择一个领域能力包查看标准、模板和 checklist。安装后再启用，才会关联到当前工业项目。</div>`;
  const manifest = pack.manifest || {};
  const actionButtons = renderActions(pack);
  return `
    <div class="domain-pack-detail-head">
      <div>
        <div class="industrial-title">${escapeHtml(manifest.name || manifest.id)}</div>
        <div class="industrial-sub">${escapeHtml(manifest.id)} · v${escapeHtml(manifest.version || "-")} · ${escapeHtml(pack.source || "builtin")}</div>
      </div>
      <span>${escapeHtml(pack.enabled ? "已启用" : pack.installed ? "已安装" : "可安装")}</span>
    </div>
    <p class="domain-pack-description">${escapeHtml(manifest.description || "")}</p>
    <div class="domain-pack-actions">${actionButtons}</div>
    <div class="domain-pack-sections">
      <section class="industrial-panel">
        <div class="industrial-panel-title">标准</div>
        <div class="industrial-list">${renderStandards(manifest.standards || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">模板</div>
        <div class="industrial-list">${renderTemplates(manifest.templates || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">Checklist</div>
        <div class="industrial-list">${renderChecklists(manifest.checklists || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">工具要求</div>
        <div class="industrial-list">${renderTools(manifest.toolRequirements || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">质量门禁</div>
        <div class="industrial-list">${renderGates(manifest.qualityGates || [])}</div>
      </section>
      <section class="industrial-panel">
        <div class="industrial-panel-title">Agent 角色</div>
        <div class="industrial-list">${renderAgents(manifest.agentProfiles || [])}</div>
      </section>
    </div>
  `;
}

function render(state, elements, api, toast, refresh, onProjectChanged) {
  const summary = summarizeDomainPacks(state.packs);
  elements.summary.innerHTML = [
    ["能力包", summary.total],
    ["已安装", summary.installed],
    ["已启用", summary.enabled],
    ["推荐", summary.recommended],
    ["模板", summary.templates],
    ["Checklist", summary.checklists],
  ].map(([label, value]) => `<div class="job-stat"><b>${value}</b><span>${label}</span></div>`).join("");
  elements.list.innerHTML = renderDomainPackListMarkup(state.packs, state.selectedId);
  elements.detail.innerHTML = renderDomainPackDetailMarkup(state.selectedPack);
  elements.detail.querySelectorAll("[data-domain-pack-action]").forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.domainPackAction;
      const packId = state.selectedPack?.manifest?.id;
      if (!packId) return;
      button.disabled = true;
      const result = await runAction({ api, action, packId });
      button.disabled = false;
      if (!result?.ok) {
        toast?.show?.(result?.error || "Domain Pack 操作失败。");
        return;
      }
      if (typeof onProjectChanged === "function" && (action === "enable" || action === "disable")) await onProjectChanged();
      toast?.show?.(domainPackActionMessage(action, packId));
      await refresh({ keepSelection: true });
    };
  });
}

async function runAction({ api, action, packId }) {
  if (action === "install") return api.installDomainPack({ id: packId, source: "builtin", actor: "user" });
  if (action === "enable") return api.enableDomainPack(packId, { actor: "user" });
  if (action === "disable") return api.disableDomainPack(packId, { actor: "user" });
  if (action === "uninstall") return api.uninstallDomainPack(packId, { actor: "user" });
  return { ok: false, error: `unsupported domain pack action: ${action}` };
}

function renderActions(pack) {
  const install = `<button data-domain-pack-action="install" ${pack.installed ? "disabled" : ""}>安装</button>`;
  const enable = `<button data-domain-pack-action="enable" ${pack.installed && !pack.enabled ? "" : "disabled"}>启用</button>`;
  const disable = `<button data-domain-pack-action="disable" ${pack.enabled ? "" : "disabled"}>禁用</button>`;
  const uninstall = `<button data-domain-pack-action="uninstall" ${pack.installed ? "" : "disabled"}>卸载</button>`;
  return [install, enable, disable, uninstall].join("");
}

function renderStandards(items) {
  if (!items.length) return `<div class="industrial-muted">暂无标准。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.version, (item.domains || []).join(", ")].filter(Boolean).join(" · "))}</span></div>`).join("");
}

function renderTemplates(items) {
  if (!items.length) return `<div class="industrial-muted">暂无模板。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(`${item.type} · ${item.path}`)}</span></div>`).join("");
}

function renderChecklists(items) {
  if (!items.length) return `<div class="industrial-muted">暂无 Checklist。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(`${item.items?.length || 0} 项 · ${item.path}`)}</span></div>`).join("");
}

function renderTools(items) {
  if (!items.length) return `<div class="industrial-muted">暂无工具要求。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.required ? "必需" : "可选", item.dryRunSupported ? "支持 dry-run" : "仅人工执行"].join(" · "))}</span></div>`).join("");
}

function renderGates(items) {
  if (!items.length) return `<div class="industrial-muted">暂无质量门禁。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.type, item.required ? "必需" : "可选", item.automated ? "自动" : "人工"].join(" · "))}</span></div>`).join("");
}

function renderAgents(items) {
  if (!items.length) return `<div class="industrial-muted">暂无 Agent 角色。</div>`;
  return items.map((item) => `<div class="industrial-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml([item.role, (item.domains || []).join(", ")].filter(Boolean).join(" · "))}</span></div>`).join("");
}

function domainPackActionMessage(action, packId) {
  return {
    install: `已安装 Domain Pack: ${packId}`,
    enable: `已启用 Domain Pack: ${packId}`,
    disable: `已停用 Domain Pack: ${packId}`,
    uninstall: `已卸载 Domain Pack: ${packId}`,
  }[action] || `Domain Pack 已更新: ${packId}`;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
