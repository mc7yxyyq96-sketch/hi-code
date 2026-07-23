export function mountGatewayPanel({
  root,
  startGateway,
  stopGateway,
  statusGateway,
  connectRemote,
  onToast,
}) {
  if (!root) return { refresh() {}, stop() {} };

  root.innerHTML = `
    <div class="gateway-shell">
      <div class="gateway-head">
        <div>
          <h2>Gateway</h2>
          <p>本地控制面：会话路由、通道适配、远程连接与 NewAPI Relay（客户端不持上游主密钥）。</p>
        </div>
        <div class="gateway-head-actions">
          <button type="button" class="primary" data-role="start">启动本地 Gateway</button>
          <button type="button" class="ghost" data-role="stop">停止</button>
          <button type="button" class="ghost" data-role="refresh">刷新</button>
        </div>
      </div>
      <div class="gateway-summary" data-role="summary"></div>
      <form class="gateway-remote" data-role="remote">
        <label>远程 Gateway URL
          <input name="baseUrl" placeholder="http://127.0.0.1:8787" />
        </label>
        <label>Token
          <input name="token" placeholder="Bearer token" />
        </label>
        <button type="submit" class="ghost">连接远程</button>
      </form>
      <div class="gateway-hint" data-role="wsHint">WebSocket：启动后连接 ws://127.0.0.1:&lt;port&gt;/v1/ws?token=…</div>
      <pre class="gateway-log" data-role="log">尚未连接</pre>
    </div>
  `;

  const summary = root.querySelector('[data-role="summary"]');
  const log = root.querySelector('[data-role="log"]');

  function toast(kind, message) {
    onToast?.(kind, message);
  }

  async function refresh() {
    const result = await statusGateway();
    const running = !!result?.running;
    const port = result?.marker?.port;
    const token = result?.marker?.token;
    summary.innerHTML = `
      <div class="cap-stat"><b>${running ? "ON" : "OFF"}</b><span>本地</span></div>
      <div class="cap-stat"><b>${port || "—"}</b><span>端口</span></div>
      <div class="cap-stat"><b>${result?.control?.channels?.length || 0}</b><span>通道</span></div>
      <div class="cap-stat"><b>${result?.control?.ws?.clients ?? 0}</b><span>WS</span></div>
    `;
    const hint = root.querySelector('[data-role="wsHint"]');
    if (hint) {
      hint.textContent = running && port
        ? `WebSocket：ws://127.0.0.1:${port}/v1/ws?token=${token || "…"}`
        : "WebSocket：启动本地 Gateway 后显示连接串";
    }
    log.textContent = JSON.stringify(result, null, 2);
    return result;
  }

  root.querySelector('[data-role="start"]').onclick = async () => {
    const result = await startGateway({});
    if (!result?.ok) return toast("error", result?.error || "启动失败");
    toast("ok", `Gateway :${result.port}`);
    await refresh();
  };
  root.querySelector('[data-role="stop"]').onclick = async () => {
    await stopGateway();
    toast("ok", "Gateway 已停止");
    await refresh();
  };
  root.querySelector('[data-role="refresh"]').onclick = () => refresh();
  root.querySelector('[data-role="remote"]').addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await connectRemote({
      baseUrl: String(data.get("baseUrl") || ""),
      token: String(data.get("token") || ""),
    });
    if (!result?.ok) return toast("error", result?.error || "连接失败");
    toast("ok", "已连接远程 Gateway");
    log.textContent = JSON.stringify(result, null, 2);
  });

  return { refresh, stop() {} };
}
