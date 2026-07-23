/**
 * Built-in terminal drawer (clean-room).
 */

export function mountTerminalPanel({
  root,
  createSession,
  writeSession,
  killSession,
  onReady,
  onData,
  onExit,
}) {
  if (!root) return { open() {}, close() {}, toggle() {} };

  root.innerHTML = `
    <div class="hc-term-head">
      <div>
        <div class="hc-term-title">终端</div>
        <div class="hc-term-sub" data-role="meta">未启动</div>
      </div>
      <div class="hc-term-actions">
        <button type="button" data-role="new" class="parity-chip">新建</button>
        <button type="button" data-role="kill" class="parity-chip">关闭会话</button>
        <button type="button" data-role="hide" class="parity-chip">收起</button>
      </div>
    </div>
    <pre class="hc-term-output" data-role="output"></pre>
    <form class="hc-term-form" data-role="form">
      <input data-role="input" spellcheck="false" autocomplete="off" placeholder="输入命令，Enter 发送" />
      <button type="submit" class="parity-chip">运行</button>
    </form>
  `;

  const output = root.querySelector('[data-role="output"]');
  const meta = root.querySelector('[data-role="meta"]');
  const input = root.querySelector('[data-role="input"]');
  let sessionId = null;

  function append(text) {
    output.textContent += text;
    output.scrollTop = output.scrollHeight;
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    const result = await createSession({});
    if (!result?.ok) {
      append(`\n[error] ${result?.error || "无法创建终端"}\n`);
      return null;
    }
    sessionId = result.id;
    meta.textContent = `${result.shell || "shell"} · ${result.cwd || ""}`;
    return sessionId;
  }

  root.querySelector('[data-role="new"]').onclick = async () => {
    if (sessionId) await killSession({ id: sessionId });
    sessionId = null;
    output.textContent = "";
    await ensureSession();
  };
  root.querySelector('[data-role="kill"]').onclick = async () => {
    if (!sessionId) return;
    await killSession({ id: sessionId });
    sessionId = null;
    meta.textContent = "已关闭";
    append("\n[session closed]\n");
  };
  root.querySelector('[data-role="hide"]').onclick = () => {
    document.body.classList.remove("terminal-open");
  };
  root.querySelector('[data-role="form"]').onsubmit = async (event) => {
    event.preventDefault();
    const line = input.value;
    input.value = "";
    const id = await ensureSession();
    if (!id) return;
    append(`\n$ ${line}\n`);
    await writeSession({ id, data: line });
  };

  onReady?.((payload) => {
    if (!sessionId) sessionId = payload.id;
    if (payload.id === sessionId) meta.textContent = `${payload.shell || "shell"} · ${payload.cwd || ""}`;
  });
  onData?.((payload) => {
    if (payload.id !== sessionId) return;
    append(payload.data || "");
  });
  onExit?.((payload) => {
    if (payload.id !== sessionId) return;
    append(`\n[exit ${payload.code ?? "?"}]\n`);
    sessionId = null;
    meta.textContent = "已退出";
  });

  return {
    async open() {
      document.body.classList.add("terminal-open");
      await ensureSession();
      input.focus();
    },
    close() {
      document.body.classList.remove("terminal-open");
    },
    toggle() {
      if (document.body.classList.contains("terminal-open")) this.close();
      else this.open();
    },
  };
}
