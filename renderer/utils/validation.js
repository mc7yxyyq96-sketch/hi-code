export function parseJsonObject(text) {
  try {
    const value = text ? JSON.parse(text) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function validateQuickProfileFields(profile, { providerLabel = "模型", apiOnly = false, localEndpoint = false } = {}) {
  if (apiOnly && !profile.apiKey) return `请粘贴 ${providerLabel} API Key`;
  if (!profile.baseURL) return "请填写 Base URL";
  if (!profile.model) return "请填写模型名";
  if (!profile.apiKey && !localEndpoint) return "请粘贴云端模型的 API Key";
  return "";
}

export function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
