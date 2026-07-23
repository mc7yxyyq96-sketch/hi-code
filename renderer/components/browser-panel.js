/**
 * Built-in browser chrome (clean-room). BrowserView fills the content host.
 */

export function mountBrowserPanel({
  root,
  openBrowser,
  closeBrowser,
  setBounds,
  navigate,
  back,
  forward,
  reload,
  onMeta,
}) {
  if (!root) return { open() {}, close() {}, toggle() {}, isOpen: () => false };

  root.innerHTML = `
    <div class="hc-browser-chrome">
      <button type="button" data-role="back" class="parity-chip" title="后退">←</button>
      <button type="button" data-role="forward" class="parity-chip" title="前进">→</button>
      <button type="button" data-role="reload" class="parity-chip" title="刷新">↻</button>
      <form data-role="form" class="hc-browser-form">
        <input data-role="url" spellcheck="false" autocomplete="off" placeholder="输入 URL 或搜索词" />
      </form>
      <button type="button" data-role="hide" class="parity-chip">收起</button>
    </div>
    <div class="hc-browser-host" data-role="host" aria-label="浏览器内容区"></div>
    <div class="hc-browser-status" data-role="status">未打开</div>
  `;

  const urlInput = root.querySelector('[data-role="url"]');
  const host = root.querySelector('[data-role="host"]');
  const status = root.querySelector('[data-role="status"]');
  let open = false;

  function reportBounds() {
    if (!open || !host) return null;
    const rect = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Electron BrowserView bounds are in DIP (CSS pixels), not device pixels.
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
      dpr,
    };
  }

  async function syncBounds() {
    const bounds = reportBounds();
    if (!bounds || bounds.width < 40 || bounds.height < 40) return;
    await setBounds(bounds);
  }

  async function show(url = "https://example.com") {
    document.body.classList.add("browser-open");
    open = true;
    status.textContent = "加载中…";
    await syncBounds();
    const result = await openBrowser({ url, bounds: reportBounds() });
    if (!result?.ok) {
      status.textContent = result?.error || "无法打开浏览器";
      return;
    }
    urlInput.value = result.url || url;
    status.textContent = result.url || url;
    await syncBounds();
  }

  async function hide() {
    open = false;
    document.body.classList.remove("browser-open");
    await closeBrowser();
    status.textContent = "已收起";
  }

  root.querySelector('[data-role="form"]').addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    if (!open) await show(url);
    else {
      const result = await navigate(url);
      status.textContent = result?.ok ? (result.url || url) : (result?.error || "导航失败");
      if (result?.url) urlInput.value = result.url;
    }
  });

  root.querySelector('[data-role="back"]').onclick = () => back();
  root.querySelector('[data-role="forward"]').onclick = () => forward();
  root.querySelector('[data-role="reload"]').onclick = () => reload();
  root.querySelector('[data-role="hide"]').onclick = () => hide();

  window.addEventListener("resize", () => { if (open) syncBounds(); });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { if (open) syncBounds(); }).observe(host);
  }
  if (typeof onMeta === "function") {
    onMeta((meta) => {
      if (!meta) return;
      if (meta.url) {
        urlInput.value = meta.url;
        status.textContent = meta.title ? `${meta.title} · ${meta.url}` : meta.url;
      }
    });
  }

  return {
    open: show,
    close: hide,
    toggle: async () => (open ? hide() : show()),
    isOpen: () => open,
  };
}
