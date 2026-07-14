const HEALTH_LABELS = {
  healthy: "健康",
  degraded: "受限",
  unavailable: "不可用",
  not_configured: "未配置",
  disabled: "已禁用",
  unknown: "待检测",
};

const CREDENTIAL_LABELS = {
  not_required: "无需凭据",
  missing: "缺少凭据",
  stored: "已安全保存",
  expired: "凭据已过期",
  expiring: "凭据即将过期",
};

const PRIVACY_LABELS = {
  local_only: "仅本机",
  remote_warning: "远程数据边界",
  enterprise_policy: "企业策略",
};

export function mountProviderSettingsPanel(root, { api, toast } = {}) {
  const state = {
    providers: [],
    usage: new Map(),
    registry: null,
    loading: false,
    expandedId: "",
  };

  const refresh = async ({ probe = false } = {}) => {
    if (!root || state.loading) return;
    state.loading = true;
    render(root, state);
    const [providersResult, usageResult, registryResult] = await Promise.all([
      api.discoverProviders({}),
      api.getProviderUsage(),
      api.getProviderRegistryVersion(),
    ]);
    state.providers = Array.isArray(providersResult?.providers) ? providersResult.providers : [];
    const usageRows = Array.isArray(usageResult?.usage) ? usageResult.usage : [];
    state.usage = new Map(usageRows.map((item) => [item.providerId, item]));
    state.registry = registryResult?.registry || null;
    state.loading = false;
    render(root, state);
    wire(root, state, { api, toast, refresh });
    if (probe) await probeAll(state, { api, toast, refresh });
  };

  render(root, state);
  return { render: refresh, refresh };
}

async function probeAll(state, { api, toast, refresh }) {
  const enabled = state.providers.filter((provider) => provider.enabled && provider.configured);
  if (!enabled.length) {
    toast?.info?.("没有可检测的已启用 Provider。");
    return;
  }
  await Promise.all(enabled.map((provider) => api.healthCheckProvider(provider.id)));
  toast?.ok?.(`已完成 ${enabled.length} 个 Provider 的健康检查。`);
  await refresh();
}

function render(root, state) {
  const models = state.providers.filter((provider) => provider.kind === "model");
  const agents = state.providers.filter((provider) => provider.kind === "agent");
  const revision = state.registry ? `Registry v${state.registry.schemaVersion} · revision ${state.registry.revision}` : "Registry 正在读取";
  root.innerHTML = `
    <div class="provider-settings-toolbar">
      <div>
        <strong>Provider 控制面</strong>
        <span>${escapeHtml(revision)}</span>
      </div>
      <div class="provider-settings-actions">
        <button type="button" class="ghost" data-provider-action="probe-all" ${state.loading ? "disabled" : ""}>全部检测</button>
        <button type="button" class="ghost" data-provider-action="refresh" ${state.loading ? "disabled" : ""}>刷新</button>
      </div>
    </div>
    <div class="provider-boundary-note">
      <b>模型 Provider 与外部 Agent Provider 是两类执行边界。</b>
      模型通过 Hi Code 推理运行时调用；外部 Agent 仅在明确授权后，以无 shell、最小环境变量和隔离工作区运行。
    </div>
    ${state.loading && !state.providers.length ? '<div class="provider-settings-empty">正在发现 Provider…</div>' : ""}
    ${providerGroupMarkup("模型 Provider", "负责推理、视觉与工具调用；远程模型会把当前请求发送到配置的服务端。", models, state)}
    ${providerGroupMarkup("外部 Agent Provider", "负责运行 Codex CLI、Claude Code CLI 或企业 Agent Worker；默认隔离执行并写入 Job Center。", agents, state)}
  `;
}

function providerGroupMarkup(title, description, providers, state) {
  return `<section class="provider-settings-group">
    <div class="provider-settings-group-head">
      <div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
      <span>${providers.length}</span>
    </div>
    <div class="provider-settings-list">
      ${providers.length ? providers.map((provider) => providerMarkup(provider, state)).join("") : '<div class="provider-settings-empty">没有发现这一类 Provider。</div>'}
    </div>
  </section>`;
}

function providerMarkup(provider, state) {
  const capability = provider.capability || {};
  const health = provider.health || { status: "unknown" };
  const credential = provider.credential || { state: "not_required" };
  const usage = state.usage.get(provider.id);
  const expanded = state.expandedId === provider.id;
  const canConfigure = provider.kind === "agent" && Array.isArray(provider.configSchema) && provider.configSchema.length > 0;
  const capabilityFlags = [
    capability.vision === true ? "视觉" : null,
    capability.tools === true ? "工具" : null,
    capability.streaming === true ? "流式" : null,
    capability.reasoning === true ? "推理" : null,
  ].filter(Boolean);
  return `<article class="provider-settings-item" data-provider-id="${escapeAttr(provider.id)}">
    <div class="provider-settings-main">
      <div class="provider-settings-identity">
        <span class="provider-kind-mark provider-kind-${escapeAttr(provider.kind)}">${provider.kind === "model" ? "M" : "A"}</span>
        <div>
          <div class="provider-settings-name-row">
            <strong>${escapeHtml(provider.name || provider.id)}</strong>
            <span class="provider-health provider-health-${escapeAttr(health.status)}">${escapeHtml(HEALTH_LABELS[health.status] || health.status)}</span>
          </div>
          <p>${escapeHtml(provider.description || provider.adapterType || provider.id)}</p>
          <small>${escapeHtml(provider.adapterType || "unknown")} · v${escapeHtml(provider.version || "-")}${capability.modelName ? ` · ${escapeHtml(capability.modelName)}` : ""}</small>
        </div>
      </div>
      <div class="provider-settings-summary">
        <span title="隐私边界">${escapeHtml(PRIVACY_LABELS[capability.privacyLevel] || capability.privacyLevel || "未声明")}</span>
        <span title="凭据状态">${escapeHtml(CREDENTIAL_LABELS[credential.state] || credential.state || "未知")}</span>
        <span title="能力">${escapeHtml(capabilityFlags.join(" · ") || "基础能力")}</span>
        <span title="用量">${usage ? `${formatNumber(usage.totalTokens)} tokens · ${formatPercent(usage.failureRate)} 失败` : "暂无用量"}</span>
      </div>
      <div class="provider-settings-controls">
        <button type="button" class="ghost" data-provider-action="health" data-provider-id="${escapeAttr(provider.id)}" ${!provider.enabled || !provider.configured ? "disabled" : ""}>检测</button>
        ${canConfigure ? `<button type="button" class="ghost" data-provider-action="expand" data-provider-id="${escapeAttr(provider.id)}">${expanded ? "收起" : "配置"}</button>` : ""}
        <label class="provider-enable-toggle" title="${provider.enabled ? "禁用 Provider" : "启用 Provider"}">
          <input type="checkbox" data-provider-action="toggle" data-provider-id="${escapeAttr(provider.id)}" ${provider.enabled ? "checked" : ""} />
          <span>${provider.enabled ? "启用" : "禁用"}</span>
        </label>
      </div>
    </div>
    ${providerEvidenceMarkup(provider, usage)}
    ${expanded && canConfigure ? providerConfigMarkup(provider) : ""}
  </article>`;
}

function providerEvidenceMarkup(provider, usage) {
  const capability = provider.capability || {};
  const health = provider.health || {};
  const cost = capability.cost || {};
  const values = [
    ["上下文", capability.contextLength ? formatNumber(capability.contextLength) : "未声明"],
    ["部署", deploymentLabel(capability.deployment)],
    ["平均延迟", usage?.averageLatencyMs ? `${formatNumber(usage.averageLatencyMs)} ms` : (health.latencyMs ? `${health.latencyMs} ms` : "暂无")],
    ["估算成本", usage ? `$${Number(usage.estimatedCostUsd || 0).toFixed(4)}` : (cost.source === "unknown" ? "未配置" : "暂无")],
  ];
  return `<div class="provider-evidence-row">
    ${values.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}
    ${health.message ? `<p>${escapeHtml(health.message)}</p>` : ""}
  </div>`;
}

function providerConfigMarkup(provider) {
  const fields = provider.configSchema.filter((field) => field.type !== "secret");
  return `<form class="provider-config-form" data-provider-config-form="${escapeAttr(provider.id)}">
    <div class="provider-config-fields">
      ${fields.map((field) => `<label>
        <span>${escapeHtml(field.label || field.key)}${field.required ? " *" : ""}</span>
        ${field.type === "boolean"
          ? `<input name="${escapeAttr(field.key)}" type="checkbox" />`
          : `<input name="${escapeAttr(field.key)}" type="${field.type === "number" ? "number" : "text"}" ${field.required ? "required" : ""} autocomplete="off" spellcheck="false" placeholder="${escapeAttr(field.description || "")}" />`}
      </label>`).join("")}
    </div>
    <div class="provider-config-foot">
      <p>可执行文件必须使用绝对路径。参数使用 JSON 数组；真实运行仍会单独请求授权。</p>
      <button type="submit" class="primary">保存配置</button>
    </div>
  </form>`;
}

function wire(root, state, { api, toast, refresh }) {
  root.querySelector('[data-provider-action="refresh"]')?.addEventListener("click", () => refresh());
  root.querySelector('[data-provider-action="probe-all"]')?.addEventListener("click", () => refresh({ probe: true }));
  root.querySelectorAll('[data-provider-action="expand"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.expandedId = state.expandedId === button.dataset.providerId ? "" : button.dataset.providerId;
      render(root, state);
      wire(root, state, { api, toast, refresh });
    });
  });
  root.querySelectorAll('[data-provider-action="health"]').forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await api.healthCheckProvider(button.dataset.providerId);
      if (result?.ok) toast?.ok?.(`${providerName(state, button.dataset.providerId)} 健康检查完成。`);
      await refresh();
    });
  });
  root.querySelectorAll('[data-provider-action="toggle"]').forEach((input) => {
    input.addEventListener("change", async () => {
      input.disabled = true;
      const result = await api.configureProvider(input.dataset.providerId, { enabled: input.checked });
      if (!result?.ok) {
        input.checked = !input.checked;
        toast?.error?.(result?.error || "Provider 状态保存失败。");
      } else {
        toast?.ok?.(`${providerName(state, input.dataset.providerId)} 已${input.checked ? "启用" : "禁用"}。`);
      }
      await refresh();
    });
  });
  root.querySelectorAll("[data-provider-config-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const config = {};
      for (const field of form.elements) {
        if (!field.name) continue;
        if (field.type === "checkbox") config[field.name] = field.checked;
        else if (field.value.trim()) config[field.name] = field.type === "number" ? Number(field.value) : field.value.trim();
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const providerId = form.dataset.providerConfigForm;
      const result = await api.configureProvider(providerId, { config, enabled: true });
      if (result?.ok) {
        toast?.ok?.(`${providerName(state, providerId)} 配置已安全保存。`);
        state.expandedId = "";
      } else {
        toast?.error?.(result?.error || "Provider 配置保存失败。");
      }
      await refresh();
    });
  });
}

function providerName(state, providerId) {
  return state.providers.find((provider) => provider.id === providerId)?.name || providerId;
}

function deploymentLabel(value) {
  if (value === "local") return "本机";
  if (value === "enterprise") return "企业连接";
  if (value === "remote") return "远程";
  return "未声明";
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
