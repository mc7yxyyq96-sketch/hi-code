export const CAPABILITY_META = {
  plugins: {
    title: "插件",
    subtitle: "本机可用的 Codex/Hi Code 扩展入口。",
    icon: "i-plug",
    empty: "还没有发现本地插件缓存。",
    nav: "pluginsBtn",
  },
  skills: {
    title: "技能市场",
    subtitle: "浏览本机与商店中的 Agent Skills，安装后可在对话里用 $技能名 调用。",
    icon: "i-spark",
    empty: "还没有发现本地技能。可从商店安装，或把 SKILL.md 放到 ~/.codex/skills。",
    nav: "skillsBtn",
  },
  agents: {
    title: "智能体",
    subtitle: "已安装或可用的专业智能体能力入口。",
    icon: "i-users",
    empty: "还没有发现本地智能体。",
    nav: "agentsBtn",
  },
  mcp: {
    title: "MCP 管理",
    subtitle: "管理 stdio MCP：启停、配置 JSON、查看工具来源（~/.hicode/config.json）。",
    icon: "i-network",
    empty: "还没有配置 MCP server。点击「配置 MCP」或从商店安装。",
    nav: "mcpBtn",
  },
};

export function capabilityDescription(kind, item) {
  if (kind === "mcp") return `${item.command || ""} ${(item.args || []).join(" ")}`.trim() || "MCP 服务";
  if (kind === "skills") return item.description || "本地技能";
  if (kind === "agents") return item.description || "本地智能体";
  return item.description || "本地插件";
}

export function capabilityMeta(kind, item) {
  if (kind === "mcp") return `${statusLabel(item.status || "configured")} · 环境变量 ${item.envCount || 0}`;
  if (kind === "skills") return item.path || item.status || "";
  if (kind === "agents") return `${statusLabel(item.status || "installed")} · ${item.source || item.role || "智能体"}`;
  return `${statusLabel(item.status || "installed")} · ${item.source || ""}`;
}

export function capabilityActionLabel(kind) {
  if (kind === "skills") return "使用";
  if (kind === "agents") return "查看";
  if (kind === "mcp") return "/mcp";
  return "已安装";
}

export function capabilityLifecycleState(kind, item = {}, storeItem = null) {
  const canUse = kind === "skills" || kind === "agents" || kind === "mcp";
  if (storeItem) {
    const enabled = storeItem.enabled !== false;
    return {
      managed: true,
      readonly: false,
      enabled,
      statusLabel: enabled ? "已启用" : "已禁用",
      useLabel: canUse && enabled ? capabilityActionLabel(kind, item) : "",
      toggleAction: enabled ? "disable" : "enable",
      toggleLabel: enabled ? "禁用" : "启用",
      destructiveAction: "uninstall",
      destructiveLabel: "卸载",
    };
  }
  return {
    managed: false,
    readonly: true,
    enabled: true,
    statusLabel: "只读",
    useLabel: canUse ? capabilityActionLabel(kind, item) : "",
    readonlyReason: "该项不是由 Hi Code Store 管理，不能从这里安全卸载。",
  };
}

function statusLabel(value = "") {
  return {
    configured: "已配置",
    installed: "已安装",
    enabled: "已启用",
    disabled: "已禁用",
  }[value] || value || "-";
}
