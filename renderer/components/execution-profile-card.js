const REASONING_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  ultra: "超高",
};

const SPEED_LABELS = {
  low: "快速",
  medium: "标准",
  high: "深度",
  ultra: "深度",
};

function activeProfile(config = {}) {
  const profiles = config.profiles && typeof config.profiles === "object" ? config.profiles : {};
  const key = config.defaultProfile || Object.keys(profiles)[0] || "default";
  return { key, profile: profiles[key] || profiles.default || config || {} };
}

function isLocalProfile(profile = {}) {
  if (profile.privacyLevel === "local" || profile.local === true || profile.protocol === "ollama") return true;
  try {
    const url = new URL(String(profile.baseURL || ""));
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function formatTokenBudget(value) {
  const tokens = Math.max(0, Math.floor(Number(value) || 0));
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 ? 1 : 0)}K`;
  return String(tokens);
}

export function deriveExecutionProfile(config = {}) {
  const { key, profile } = activeProfile(config);
  const reasoning = REASONING_LABELS[config.reasoningLevel] ? config.reasoningLevel : "medium";
  const contextWindow = Math.max(1, Number(profile.contextWindow || config.contextWindow || 65_536));
  const compactThreshold = Math.min(0.95, Math.max(0.1, Number(config.compactThreshold || 0.75)));
  const budgetTokens = Math.floor(contextWindow * compactThreshold);
  const local = isLocalProfile(profile);
  return {
    profileKey: key,
    model: String(profile.model || config.model || "未配置"),
    speed: SPEED_LABELS[reasoning],
    reasoning: REASONING_LABELS[reasoning],
    reasoningKey: reasoning,
    privacy: local ? "本地" : "远程",
    privacyDetail: local ? "数据留在本机端点" : "请求会发送到所选 Provider",
    budget: `${formatTokenBudget(budgetTokens)} tokens`,
    budgetTokens,
    contextWindow,
    compactThreshold,
    remote: !local,
  };
}
