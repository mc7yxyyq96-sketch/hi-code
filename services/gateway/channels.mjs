/**
 * Channel adapter registry (Telegram + Discord stubs for Wave3).
 */

export function createChannelRegistry() {
  /** @type {Map<string, { id: string, name: string, enabled: boolean, config: Record<string, unknown>, kind: string }>} */
  const adapters = new Map([
    ["telegram", {
      id: "telegram",
      name: "Telegram",
      kind: "im",
      enabled: false,
      config: { botTokenSet: false },
    }],
    ["discord", {
      id: "discord",
      name: "Discord",
      kind: "im",
      enabled: false,
      config: { botTokenSet: false },
    }],
    ["desktop", {
      id: "desktop",
      name: "Hi Code Desktop",
      kind: "desktop",
      enabled: true,
      config: {},
    }],
  ]);

  function list() {
    return [...adapters.values()].map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      kind: adapter.kind,
      enabled: adapter.enabled,
      config: redact(adapter.config),
    }));
  }

  function configure(id, config = {}) {
    const adapter = adapters.get(String(id || ""));
    if (!adapter) return { ok: false, error: "unknown channel" };
    if (adapter.id === "telegram" || adapter.id === "discord") {
      const token = String(config.botToken || config.token || "");
      adapter.config = {
        ...adapter.config,
        botTokenSet: Boolean(token),
        // Never persist raw token into list responses; keep in memory only for stub.
        _token: token || adapter.config._token || "",
      };
      adapter.enabled = Boolean(adapter.config._token) || config.enabled === true;
    } else {
      adapter.config = { ...adapter.config, ...config };
      if (typeof config.enabled === "boolean") adapter.enabled = config.enabled;
    }
    return { ok: true, channel: list().find((item) => item.id === adapter.id) };
  }

  function acceptInbound(body = {}) {
    const channel = String(body.channel || "");
    const adapter = adapters.get(channel);
    if (!adapter) return { ok: false, error: "unknown channel" };
    if (!adapter.enabled) return { ok: false, error: "channel disabled" };
    const text = String(body.text || body.message || "").trim();
    if (!text) return { ok: false, error: "text required" };
    return {
      ok: true,
      message: {
        channel,
        externalId: String(body.externalId || body.chatId || body.userId || "unknown"),
        text,
        at: Date.now(),
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      },
    };
  }

  function redact(config = {}) {
    const out = { ...config };
    delete out._token;
    return out;
  }

  function getToken(id) {
    const adapter = adapters.get(String(id || ""));
    return adapter?.config?._token ? String(adapter.config._token) : "";
  }

  return { list, configure, acceptInbound, getToken };
}
