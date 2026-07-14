export function parseJsonObject(text) {
  try {
    const value = text ? JSON.parse(text) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function validateQuickProfileFields(profile, { providerLabel = "模型", apiOnly = false, localEndpoint = false } = {}) {
  const hasCredential = Boolean(profile.apiKey || profile.secretRef);
  if (apiOnly && !hasCredential) return `请粘贴 ${providerLabel} API Key`;
  if (!profile.baseURL) return "请填写 Base URL";
  if (!profile.model) return "请填写模型名";
  if (!hasCredential && !localEndpoint) return "请粘贴云端模型的 API Key";
  return "";
}

export function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
