export const CAPABILITY_META = {
  plugins: {
    title: "插件",
    subtitle: "本机可用的 Codex/Hi Code 扩展入口。",
    icon: "i-plug",
    empty: "还没有发现本地插件缓存。",
    nav: "pluginsBtn",
  },
  skills: {
    title: "技能",
    subtitle: "可复用的工作流说明，会影响智能体做事方式。",
    icon: "i-spark",
    empty: "还没有发现本地技能。",
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
    title: "MCP",
    subtitle: "从 ~/.hicode/config.json 读取的 Model Context Protocol 服务。",
    icon: "i-network",
    empty: "还没有配置 MCP server。",
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

function statusLabel(value = "") {
  return {
    configured: "已配置",
    installed: "已安装",
    enabled: "已启用",
    disabled: "已禁用",
  }[value] || value || "-";
}
