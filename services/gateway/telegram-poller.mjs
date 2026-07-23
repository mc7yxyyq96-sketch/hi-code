/**
 * Telegram long-polling adapter (clean-room). Requires bot token via channel configure.
 */

export function createTelegramPoller({
  getToken,
  onMessage,
  fetchImpl = fetch,
  intervalMs = 1200,
} = {}) {
  let timer = null;
  let offset = 0;
  let running = false;

  async function tick() {
    const token = typeof getToken === "function" ? getToken() : "";
    if (!token) return;
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=0&offset=${offset}`;
      const res = await fetchImpl(url);
      const data = await res.json();
      if (!data?.ok || !Array.isArray(data.result)) return;
      for (const update of data.result) {
        offset = Math.max(offset, Number(update.update_id || 0) + 1);
        const msg = update.message || update.edited_message;
        if (!msg?.text) continue;
        onMessage?.({
          channel: "telegram",
          externalId: String(msg.chat?.id ?? msg.from?.id ?? "unknown"),
          text: String(msg.text),
          metadata: {
            username: msg.from?.username || "",
            chatType: msg.chat?.type || "",
            updateId: update.update_id,
          },
        });
      }
    } catch {
      // Network blips are expected; next tick retries.
    }
  }

  function start() {
    if (running) return { ok: true, already: true };
    running = true;
    timer = setInterval(tick, intervalMs);
    tick();
    return { ok: true };
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    return { ok: true };
  }

  function status() {
    return { running, offset, hasToken: Boolean(typeof getToken === "function" && getToken()) };
  }

  return { start, stop, status, tick };
}
