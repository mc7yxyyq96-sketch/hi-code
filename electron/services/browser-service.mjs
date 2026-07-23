import { createRequire } from "node:module";

/**
 * Built-in browser surface (clean-room Wave1).
 * Uses Electron BrowserView over a reserved panel region.
 */

const require = createRequire(import.meta.url);

function loadBrowserView() {
  // Electron is CJS; keep import lazy so unit tests can load sanitize helpers.
  const electron = require("electron");
  return electron.BrowserView || electron.default?.BrowserView;
}

export function sanitizeUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^file:\/\//i.test(text)) return text;
  if (/^about:/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d+\.\d+\.\d+\.\d+/.test(text)) {
    return `http://${text}`;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?]|$)/i.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

export function createBrowserService({ getWindow }) {
  /** @type {import('electron').BrowserView | null} */
  let view = null;
  let visible = false;
  let currentUrl = "about:blank";
  let bounds = { x: 0, y: 0, width: 0, height: 0 };

  function ensureView() {
    if (view) return view;
    const BrowserView = loadBrowserView();
    if (!BrowserView) throw new Error("BrowserView unavailable");
    view = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("did-navigate", (_e, url) => { currentUrl = url; });
    view.webContents.on("did-navigate-in-page", (_e, url) => { currentUrl = url; });
    view.webContents.on("page-title-updated", (_e, title) => {
      const win = typeof getWindow === "function" ? getWindow() : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send("browser:meta", { url: currentUrl, title: String(title || "") });
      }
    });
    return view;
  }

  function attach() {
    const win = typeof getWindow === "function" ? getWindow() : null;
    if (!win || win.isDestroyed()) return { ok: false, error: "no window" };
    const bv = ensureView();
    win.setBrowserView(bv);
    bv.setBounds(bounds);
    visible = true;
    return { ok: true, url: currentUrl, visible };
  }

  function detach() {
    const win = typeof getWindow === "function" ? getWindow() : null;
    if (win && !win.isDestroyed()) {
      try { win.setBrowserView(null); } catch { /* ignore */ }
    }
    visible = false;
    return { ok: true, visible };
  }

  function setBounds(next = {}) {
    bounds = {
      x: Math.max(0, Math.floor(Number(next.x) || 0)),
      y: Math.max(0, Math.floor(Number(next.y) || 0)),
      width: Math.max(0, Math.floor(Number(next.width) || 0)),
      height: Math.max(0, Math.floor(Number(next.height) || 0)),
    };
    if (view && visible) view.setBounds(bounds);
    return { ok: true, bounds };
  }

  async function navigate(rawUrl) {
    const url = sanitizeUrl(rawUrl);
    if (!url) return { ok: false, error: "url is required" };
    ensureView();
    if (!visible) attach();
    try {
      await view.webContents.loadURL(url);
      currentUrl = url;
      return { ok: true, url };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function back() {
    if (!view?.webContents.canGoBack()) return { ok: false, error: "cannot go back" };
    view.webContents.goBack();
    return { ok: true };
  }

  function forward() {
    if (!view?.webContents.canGoForward()) return { ok: false, error: "cannot go forward" };
    view.webContents.goForward();
    return { ok: true };
  }

  function reload() {
    if (!view) return { ok: false, error: "browser not open" };
    view.webContents.reload();
    return { ok: true };
  }

  function state() {
    return {
      ok: true,
      visible,
      url: currentUrl,
      bounds,
      canGoBack: !!view?.webContents.canGoBack(),
      canGoForward: !!view?.webContents.canGoForward(),
    };
  }

  function dispose() {
    detach();
    if (view) {
      try { view.webContents.destroy(); } catch { /* ignore */ }
      view = null;
    }
  }

  return { attach, detach, setBounds, navigate, back, forward, reload, state, dispose, sanitizeUrl };
}

export function registerBrowserIpc({ register, browser }) {
  if (!register || !browser) throw new Error("registerBrowserIpc requires register + browser");
  register("browser:open", async (_e, payload = {}) => {
    browser.setBounds(payload.bounds || {});
    const shown = browser.attach();
    if (payload.url) {
      const nav = await browser.navigate(payload.url);
      return { ...shown, ...nav };
    }
    return shown;
  });
  register("browser:close", async () => browser.detach());
  register("browser:bounds", async (_e, payload = {}) => browser.setBounds(payload || {}));
  register("browser:navigate", async (_e, payload = {}) => browser.navigate(payload?.url));
  register("browser:back", async () => browser.back());
  register("browser:forward", async () => browser.forward());
  register("browser:reload", async () => browser.reload());
  register("browser:state", async () => browser.state());
}
