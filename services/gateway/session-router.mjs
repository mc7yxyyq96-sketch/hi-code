import crypto from "node:crypto";

/**
 * Session router: map channel external IDs to gateway sessions.
 */
export function createSessionRouter({ now = () => Date.now() } = {}) {
  /** @type {Map<string, any>} */
  const sessions = new Map();
  /** @type {Map<string, string>} */
  const routeIndex = new Map();

  function routeKey(channel, externalId) {
    return `${channel}::${externalId || "default"}`;
  }

  function create(input = {}) {
    const id = `gs-${crypto.randomBytes(6).toString("hex")}`;
    const session = {
      id,
      channel: String(input.channel || "desktop"),
      externalId: String(input.externalId || ""),
      workspace: String(input.workspace || ""),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      createdAt: now(),
      updatedAt: now(),
      messageCount: 0,
      lastMessage: "",
    };
    sessions.set(id, session);
    if (session.externalId) routeIndex.set(routeKey(session.channel, session.externalId), id);
    return session;
  }

  function get(id) {
    return sessions.get(String(id || "")) || null;
  }

  function list() {
    return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function routeInbound(message = {}) {
    const key = routeKey(message.channel, message.externalId);
    let id = routeIndex.get(key);
    let session = id ? sessions.get(id) : null;
    if (!session) {
      session = create({
        channel: message.channel,
        externalId: message.externalId,
        metadata: message.metadata,
      });
    }
    session.updatedAt = now();
    session.messageCount += 1;
    session.lastMessage = String(message.text || "").slice(0, 240);
    sessions.set(session.id, session);
    return session;
  }

  return { create, get, list, routeInbound };
}
