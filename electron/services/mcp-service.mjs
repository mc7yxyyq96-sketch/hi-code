import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export function createMcpService({
  initMcp,
  mcpLifecycleStatus,
  connectMcpServer,
  reconnectMcpServer,
  disconnectMcpServer,
  cancelMcpRequest,
  loadConfig,
  listLocalPlugins,
  listLocalSkills,
  listConfiguredMcpServers,
  listLocalAgents = () => [],
  secretStore,
  logger = null,
}) {
  if (typeof initMcp !== "function" || typeof mcpLifecycleStatus !== "function") throw new Error("mcp-service requires MCP lifecycle functions");
  if (!secretStore?.persistSecretWrites || !secretStore?.persistConfig || !secretStore?.readConfigForRenderer) {
    throw new Error("mcp-service requires transactional secretStore configuration persistence");
  }

  const persistSecretWrites = async (writes) => {
    const transaction = secretStore.persistSecretWrites(writes);
    transaction.commit();
  };

  const persistOAuthUpdate = async (serverName, rawUpdate) => {
    const server = validatedServerName(serverName);
    const update = validatedOAuthUpdate(rawUpdate);
    const text = secretStore.readConfigForRenderer();
    if (!text) throw new Error("MCP OAuth configuration is not persisted");
    const config = JSON.parse(text);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("persisted configuration is invalid");
    const current = config.mcpServers?.[server];
    if (!current || typeof current !== "object" || Array.isArray(current) || current.transport !== "streamable-http" || current.auth?.type !== "oauth") {
      throw new Error(`MCP OAuth server '${server}' is not present in persisted configuration`);
    }
    const auth = {
      ...current.auth,
      accessToken: update.accessToken,
    };
    if (update.refreshToken) auth.refreshToken = update.refreshToken;
    if (update.expiresAt) auth.expiresAt = update.expiresAt;
    else delete auth.expiresAt;
    config.mcpServers = {
      ...config.mcpServers,
      [server]: { ...current, auth },
    };
    secretStore.persistConfig(config);
    log("mcp.oauth.credentials_persisted", {
      server,
      expiryPersisted: Boolean(update.expiresAt),
      refreshCredentialRotated: Boolean(update.refreshToken),
    });
  };

  const reload = async () => {
    const cfg = loadConfig();
    const results = await initMcp(cfg.mcpServers || {}, { persistOAuthUpdate, persistSecretWrites });
    log("mcp.lifecycle.reload", { serverCount: results.length, readyCount: results.filter((item) => item.ok).length });
    return results;
  };

  return {
    async initializeConfiguredServers() {
      try {
        return await reload();
      } catch (error) {
        log("mcp.lifecycle.initialize_failed", { error: error?.message || String(error) });
        return [];
      }
    },

    listCapabilities() {
      const lifecycle = new Map(mcpLifecycleStatus().map((item) => [item.server, item]));
      return {
        plugins: listLocalPlugins(),
        skills: listLocalSkills(),
        mcp: listConfiguredMcpServers().map((item) => ({ ...item, lifecycle: lifecycle.get(item.name) || null })),
        agents: listLocalAgents(),
      };
    },

    listLifecycle() {
      return { ok: true, servers: mcpLifecycleStatus() };
    },

    async reload() {
      const results = await reload();
      return { ok: results.every((item) => item.ok), results, servers: mcpLifecycleStatus() };
    },

    async connect(name) {
      const server = validatedServerName(name);
      let result = await connectMcpServer(server);
      if (result.normalizedError?.code === "MCP_NOT_CONFIGURED") {
        await reload();
        result = await connectMcpServer(server);
      }
      log("mcp.lifecycle.connect", { server, ok: result.ok, errorCode: result.normalizedError?.code });
      return result;
    },

    async reconnect(name) {
      const server = validatedServerName(name);
      const result = await reconnectMcpServer(server);
      log("mcp.lifecycle.reconnect", { server, ok: result.ok, errorCode: result.normalizedError?.code });
      return result;
    },

    async disconnect(name) {
      const server = validatedServerName(name);
      const result = await disconnectMcpServer(server);
      log("mcp.lifecycle.disconnect", { server, ok: result.ok });
      return result;
    },

    cancel(payload) {
      const value = ipcObject(payload);
      const server = validatedServerName(value.server);
      const callId = ipcString(value.callId).trim();
      if (callId && !/^[A-Za-z0-9._:-]{1,256}$/.test(callId)) throw new Error("MCP call id is invalid");
      const result = cancelMcpRequest(server, callId || undefined);
      log("mcp.lifecycle.cancel", { server, cancelled: result.cancelled });
      return result;
    },
  };

  function log(event, payload) {
    if (typeof logger === "function") logger(event, sanitizeMcpAuditPayload(payload));
  }
}

const SENSITIVE_AUDIT_KEY = /(?:^|[_-])(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passcode|private[_-]?key|client[_-]?secret)(?:$|[_-])/i;
const SENSITIVE_AUDIT_TEXT = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+|\b(?:sk-[A-Za-z0-9._-]{8,}|gh[opsu]_[A-Za-z0-9._-]{8,}|github_pat_[A-Za-z0-9._-]{8,}|xox[baprs]-[A-Za-z0-9._-]{8,})\b/gi;
const INLINE_AUDIT_SECRET = /\b([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passcode|secret|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)\s*[:=]\s*['"]?[^\s,'"}]+/gi;

export function sanitizeMcpAuditPayload(value, depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") {
    return value
      .replace(SENSITIVE_AUDIT_TEXT, (match, prefix) => prefix ? `${prefix}[REDACTED]` : "[REDACTED]")
      .replace(INLINE_AUDIT_SECRET, (_match, key) => `${key}=[REDACTED]`)
      .slice(0, 8192);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeMcpAuditPayload(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_AUDIT_KEY.test(key) ? "[REDACTED]" : sanitizeMcpAuditPayload(entry, depth + 1);
  }
  return result;
}

export function registerMcpIpc({ register, mcp }) {
  if (!register) throw new Error("registerMcpIpc requires register");
  if (!mcp) throw new Error("registerMcpIpc requires mcp service");
  register.handle("list-capabilities", () => mcp.listCapabilities());
  register.handle("mcp:lifecycle", () => mcp.listLifecycle());
  register.handle("mcp:reload", () => mcp.reload());
  register.handle("mcp:connect", (_event, name) => mcp.connect(name));
  register.handle("mcp:reconnect", (_event, name) => mcp.reconnect(name));
  register.handle("mcp:disconnect", (_event, name) => mcp.disconnect(name));
  register.handle("mcp:cancel", (_event, payload) => mcp.cancel(payload));
}

function validatedServerName(value) {
  const name = ipcString(value).trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(name)) throw new Error("MCP server name is invalid");
  return name;
}

function validatedOAuthUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP OAuth update is invalid");
  const accessToken = validatedCredential(value.accessToken, "MCP OAuth access token");
  const refreshToken = value.refreshToken === undefined ? undefined : validatedCredential(value.refreshToken, "MCP OAuth refresh token");
  let expiresAt;
  if (value.expiresAt !== undefined) {
    if (typeof value.expiresAt !== "string" || value.expiresAt.length > 128 || !Number.isFinite(Date.parse(value.expiresAt))) {
      throw new Error("MCP OAuth expiry is invalid");
    }
    expiresAt = new Date(value.expiresAt).toISOString();
  }
  return { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(expiresAt ? { expiresAt } : {}) };
}

function validatedCredential(value, label) {
  if (typeof value !== "string" || !value || value.length > 128 * 1024 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
