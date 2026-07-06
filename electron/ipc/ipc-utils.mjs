const SENSITIVE_KEY_RE = /api[_-]?key|secret|token|password|authorization|cookie/i;
const SECRET_TEXT_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9][A-Za-z0-9._-]{8,}\b/gi;

export function redactSensitive(value, depth = 0) {
  if (depth > 6) return "[MaxDepth]";
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactSensitive(item, depth + 1);
  }
  return out;
}

export function redactString(text) {
  return String(text)
    .replace(SECRET_TEXT_RE, (match, bearerPrefix) => bearerPrefix ? `${bearerPrefix}[REDACTED]` : "sk-[REDACTED]")
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[^\s,'"]+/gi, "$1=[REDACTED]");
}

export function normalizeIpcError(error) {
  const message = error instanceof Error ? error.message : String(error || "IPC handler failed");
  return { ok: false, error: redactString(message) };
}

export function createIpcRegistrar(ipcMain, { logger = null } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new Error("createIpcRegistrar requires ipcMain.handle");
  return {
    handle(channel, handler) {
      if (typeof channel !== "string" || !channel) throw new Error("IPC channel must be a non-empty string");
      if (typeof handler !== "function") throw new Error(`IPC handler for ${channel} must be a function`);
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          return await handler(event, ...args);
        } catch (error) {
          const result = normalizeIpcError(error);
          if (typeof logger === "function") {
            logger("ipc:error", redactSensitive({ channel, error: result.error }));
          }
          return result;
        }
      });
    },
  };
}

export function ipcString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function ipcObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function ipcStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function ipcBoundedNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
