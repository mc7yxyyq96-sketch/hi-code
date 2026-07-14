import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ipcObject, ipcString, redactString } from "../ipc/ipc-utils.mjs";

export const PREVIEW_EVENT_CHANNEL = "preview:event";
export const MAX_PREVIEW_SELECTORS = 12;
export const MAX_PREVIEW_SCREENSHOT_BYTES = 16 * 1024 * 1024;

const PREVIEW_ID_RE = /^preview-[a-f0-9-]{36}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CLOSED_STATES = new Set(["closed", "failed"]);

export function createPreviewService({
  getCwd,
  evidenceRoot,
  windowFactory,
  getParentWindow = () => null,
  logger = null,
  fsImpl = fs,
  idFactory = () => `preview-${crypto.randomUUID()}`,
  now = () => new Date(),
  loadTimeoutMs = 15_000,
} = {}) {
  if (typeof getCwd !== "function") throw new Error("preview-service requires getCwd");
  if (typeof evidenceRoot !== "string" || !evidenceRoot.trim()) throw new Error("preview-service requires evidenceRoot");
  if (typeof windowFactory !== "function") throw new Error("preview-service requires windowFactory");

  const safeEvidenceRoot = prepareEvidenceRoot(evidenceRoot, fsImpl);
  const records = new Map();
  const ownerRecords = new Map();

  const log = (event, payload = {}) => {
    if (typeof logger !== "function") return;
    logger(event, sanitizePreviewLog(payload));
  };

  const capabilities = () => ({
    ok: true,
    available: true,
    isolation: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: false,
      externalNavigation: "deny",
      permissions: "deny",
      downloads: "deny",
    },
    supportedSchemes: ["http"],
    loopbackOnly: true,
    maxSelectors: MAX_PREVIEW_SELECTORS,
  });

  const open = async (event, payload = {}) => {
    const owner = requireOwner(event);
    const workspace = resolveWorkspace(getCwd(), fsImpl);
    const request = normalizePreviewOpenRequest(payload);
    trimOwnerRegistry(owner.id, records, ownerRecords);
    const id = idFactory();
    if (!PREVIEW_ID_RE.test(id) || records.has(id)) throw new Error("preview id generator returned an invalid or duplicate id");

    const record = {
      id,
      owner,
      ownerId: owner.id,
      workspace,
      url: request.url,
      origin: request.origin,
      label: request.label,
      selectors: request.selectors,
      state: "registered",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      currentUrl: request.url,
      title: request.label,
      error: "",
      blockedNavigation: "",
      window: null,
      lastVerification: null,
      ownerDestroyedHandler: null,
      closeReason: "",
    };
    records.set(id, record);
    addOwnerRecord(ownerRecords, owner.id, id);
    bindOwner(record);

    const result = await launch(record);
    return result.ok
      ? { ok: true, preview: publicRecord(record) }
      : { ok: false, code: result.code, error: result.error, preview: publicRecord(record) };
  };

  const list = (event) => {
    const owner = requireOwner(event);
    const workspace = resolveWorkspace(getCwd(), fsImpl);
    const previews = [...(ownerRecords.get(owner.id) || [])]
      .map((id) => records.get(id))
      .filter((record) => record && record.workspace === workspace)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(publicRecord);
    return { ok: true, previews };
  };

  const reopen = async (event, previewId) => {
    const record = requireOwnedRecord(event, previewId, records, getCwd, fsImpl);
    if (record.window && !isWindowDestroyed(record.window)) {
      record.window.show();
      record.window.focus();
      return { ok: true, reused: true, preview: publicRecord(record) };
    }
    const result = await launch(record);
    return result.ok
      ? { ok: true, reused: false, preview: publicRecord(record) }
      : { ok: false, code: result.code, error: result.error, preview: publicRecord(record) };
  };

  const reload = async (event, previewId) => {
    const record = requireOwnedRecord(event, previewId, records, getCwd, fsImpl);
    const previewWindow = requireActiveWindow(record);
    record.state = "loading";
    record.error = "";
    touch(record, now);
    sendRecordEvent(record, "state");
    try {
      const loaded = waitForNextLoad(previewWindow.webContents, loadTimeoutMs, "预览刷新超时");
      previewWindow.webContents.reloadIgnoringCache();
      await loaded;
      record.state = "ready";
      record.currentUrl = boundedText(previewWindow.webContents.getURL?.() || record.url, 2048);
      record.title = boundedText(previewWindow.webContents.getTitle?.() || record.label, 160);
      touch(record, now);
      sendRecordEvent(record, "state");
      return { ok: true, preview: publicRecord(record) };
    } catch (error) {
      return failRecord(record, "preview_reload_failed", `预览刷新失败：${redactString(error?.message || String(error))}`, now, log);
    }
  };

  const verify = async (event, previewId, payload = {}) => {
    const record = requireOwnedRecord(event, previewId, records, getCwd, fsImpl);
    const previewWindow = requireActiveWindow(record);
    const selectors = normalizeSelectors(ipcObject(payload).selectors ?? record.selectors);
    const verificationId = `verification-${now().getTime()}-${crypto.randomUUID().slice(0, 8)}`;
    const verificationDir = safeChildPath(safeEvidenceRoot, record.id, verificationId);
    fsImpl.mkdirSync(verificationDir, { recursive: true, mode: 0o700 });

    let dom = null;
    let diagnostic = "";
    let screenshotPath = "";
    let screenshotBytes = 0;
    try {
      const raw = await previewWindow.webContents.executeJavaScript(buildDomVerificationScript(selectors), true);
      dom = normalizeDomEvidence(raw, selectors);
    } catch (error) {
      diagnostic = `DOM 验证失败：${redactString(error?.message || String(error))}`;
    }

    try {
      const image = await previewWindow.webContents.capturePage();
      const png = image?.toPNG?.();
      if (!Buffer.isBuffer(png) || png.length === 0 || png.length > MAX_PREVIEW_SCREENSHOT_BYTES) {
        throw new Error("screenshot is empty or exceeds 16 MiB");
      }
      screenshotPath = path.join(verificationDir, "preview.png");
      fsImpl.writeFileSync(screenshotPath, png, { mode: 0o600, flag: "wx" });
      screenshotBytes = png.length;
    } catch (error) {
      diagnostic = [diagnostic, `截图失败：${redactString(error?.message || String(error))}`].filter(Boolean).join("；");
    }

    const checks = buildVerificationChecks(record, dom, selectors, screenshotBytes);
    const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
    const evidence = {
      schemaVersion: 1,
      verificationId,
      previewId: record.id,
      status,
      checkedAt: now().toISOString(),
      url: boundedText(dom?.url || record.currentUrl || record.url, 2048),
      origin: record.origin,
      title: boundedText(dom?.title || record.title, 160),
      selectors,
      checks,
      dom,
      screenshot: screenshotPath ? { path: screenshotPath, bytes: screenshotBytes } : null,
      diagnostic: boundedText(diagnostic, 2048),
    };
    const evidencePath = path.join(verificationDir, "evidence.json");
    writeJsonAtomic(evidencePath, evidence, fsImpl);
    record.lastVerification = { ...evidence, evidencePath };
    record.state = "ready";
    record.error = status === "passed" ? "" : (diagnostic || "一个或多个自动验证检查未通过");
    touch(record, now);
    sendRecordEvent(record, "verification");
    log("preview:verified", { previewId: record.id, ownerId: record.ownerId, status, checks: checks.length, screenshotBytes });
    return { ok: true, verification: publicVerification(record.lastVerification), preview: publicRecord(record) };
  };

  const close = async (event, previewId, reason = "user_closed") => {
    const record = requireOwnedRecord(event, previewId, records, getCwd, fsImpl);
    closeRecordWindow(record, normalizeReason(reason));
    return { ok: true, preview: publicRecord(record) };
  };

  const remove = async (event, previewId) => {
    const record = requireOwnedRecord(event, previewId, records, getCwd, fsImpl);
    closeRecordWindow(record, "removed");
    unbindOwner(record);
    records.delete(record.id);
    removeOwnerRecord(ownerRecords, record.ownerId, record.id);
    return { ok: true, previewId: record.id, removed: true };
  };

  const closeAllForOwner = async (ownerId, reason = "owner_closed") => {
    const ids = [...(ownerRecords.get(Number(ownerId)) || [])];
    for (const id of ids) {
      const record = records.get(id);
      if (!record) continue;
      closeRecordWindow(record, normalizeReason(reason));
      unbindOwner(record);
      records.delete(id);
    }
    ownerRecords.delete(Number(ownerId));
    return { ok: true, closed: ids.length };
  };

  const closeAll = async (reason = "service_shutdown") => {
    const active = [...records.values()];
    for (const record of active) {
      closeRecordWindow(record, normalizeReason(reason));
      unbindOwner(record);
    }
    records.clear();
    ownerRecords.clear();
    return { ok: true, closed: active.length };
  };

  const bindOwner = (record) => {
    record.ownerDestroyedHandler = () => { void closeAllForOwner(record.ownerId, "owner_closed"); };
    record.owner.once("destroyed", record.ownerDestroyedHandler);
  };

  const launch = async (record) => {
    if (isOwnerDestroyed(record.owner)) return failRecord(record, "preview_owner_closed", "主窗口已关闭，未打开预览", now, log);
    const activeWorkspace = resolveWorkspace(getCwd(), fsImpl);
    if (activeWorkspace !== record.workspace) return failRecord(record, "preview_workspace_changed", "工作区已切换，请重新注册预览", now, log);
    if (record.window && !isWindowDestroyed(record.window)) closeRecordWindow(record, "replaced");

    const parent = getParentWindow(record.owner);
    let previewWindow;
    try {
      previewWindow = windowFactory({
        width: 1120,
        height: 760,
        minWidth: 640,
        minHeight: 420,
        show: false,
        parent: parent && !isWindowDestroyed(parent) ? parent : undefined,
        title: `Hi Code Preview · ${record.label}`,
        backgroundColor: "#ffffff",
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          webviewTag: false,
          devTools: false,
          safeDialogs: true,
          spellcheck: false,
          autoplayPolicy: "user-gesture-required",
          partition: `hicode-preview-${record.id}`,
        },
      });
      assertIsolatedWindow(previewWindow);
      record.window = previewWindow;
      record.state = "loading";
      record.error = "";
      record.blockedNavigation = "";
      record.closeReason = "";
      touch(record, now);
      configureWindow(record, previewWindow, log, now);
      sendRecordEvent(record, "state");
    } catch (error) {
      if (previewWindow && !isWindowDestroyed(previewWindow)) previewWindow.destroy();
      record.window = null;
      return failRecord(record, "preview_isolation_failed", `无法建立隔离预览：${redactString(error?.message || String(error))}`, now, log);
    }

    try {
      await withTimeout(Promise.resolve(previewWindow.loadURL(record.url)), loadTimeoutMs, "本地预览连接超时");
      if (isOwnerDestroyed(record.owner)) {
        closeRecordWindow(record, "owner_closed");
        return failRecord(record, "preview_owner_closed", "主窗口已关闭，预览已清理", now, log);
      }
      const currentWorkspace = resolveWorkspace(getCwd(), fsImpl);
      if (currentWorkspace !== record.workspace) {
        closeRecordWindow(record, "workspace_changed");
        return failRecord(record, "preview_workspace_changed", "工作区已切换，预览已清理", now, log);
      }
      record.state = "ready";
      record.currentUrl = boundedText(previewWindow.webContents.getURL?.() || record.url, 2048);
      record.title = boundedText(previewWindow.webContents.getTitle?.() || record.label, 160);
      touch(record, now);
      previewWindow.show();
      previewWindow.focus();
      sendRecordEvent(record, "state");
      log("preview:opened", { previewId: record.id, ownerId: record.ownerId, workspace: record.workspace, origin: record.origin });
      return { ok: true };
    } catch (error) {
      if (!isWindowDestroyed(previewWindow)) previewWindow.destroy();
      record.window = null;
      return failRecord(record, "preview_load_failed", `无法打开本地应用：${redactString(error?.message || String(error))}`, now, log);
    }
  };

  return Object.freeze({
    capabilities,
    open,
    list,
    reopen,
    reload,
    verify,
    close,
    remove,
    closeAllForOwner,
    closeAll,
    activeCount: () => [...records.values()].filter((record) => record.window && !isWindowDestroyed(record.window)).length,
  });
}

export function registerPreviewIpc({ register, preview }) {
  if (!register) throw new Error("registerPreviewIpc requires register");
  if (!preview) throw new Error("registerPreviewIpc requires preview service");
  register.handle("preview:capabilities", (event) => preview.capabilities(event));
  register.handle("preview:open", (event, payload) => preview.open(event, payload));
  register.handle("preview:list", (event) => preview.list(event));
  register.handle("preview:reopen", (event, previewId) => preview.reopen(event, previewId));
  register.handle("preview:reload", (event, previewId) => preview.reload(event, previewId));
  register.handle("preview:verify", (event, previewId, payload) => preview.verify(event, previewId, payload));
  register.handle("preview:close", (event, previewId, reason) => preview.close(event, previewId, reason));
  register.handle("preview:remove", (event, previewId) => preview.remove(event, previewId));
}

export function canonicalizePreviewUrl(value) {
  const raw = ipcString(value).trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("预览地址必须是有效的本地 HTTP URL");
  let url;
  try { url = new URL(raw); } catch { throw new Error("预览地址格式无效"); }
  if (url.protocol !== "http:") throw new Error("预览仅支持本机 HTTP 地址");
  if (url.username || url.password) throw new Error("预览地址不能包含凭据");
  if (url.hash) throw new Error("预览地址不能包含片段标识");
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("预览地址必须使用 localhost、127.0.0.1 或 ::1");
  const port = url.port ? Number(url.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("预览端口无效");
  return Object.freeze({ url: url.href, origin: url.origin, port });
}

export function normalizePreviewOpenRequest(value) {
  const data = ipcObject(value);
  const canonical = canonicalizePreviewUrl(data.url);
  const label = boundedText(ipcString(data.label).trim() || new URL(canonical.url).host, 120);
  return Object.freeze({ ...canonical, label, selectors: normalizeSelectors(data.selectors) });
}

export function buildDomVerificationScript(selectors = []) {
  const encoded = JSON.stringify(normalizeSelectors(selectors)).replace(/</g, "\\u003c");
  return `(() => {
    const selectors = ${encoded};
    const selectorResults = selectors.map((selector) => {
      try { return { selector, count: document.querySelectorAll(selector).length, error: "" }; }
      catch (error) { return { selector, count: 0, error: String(error && error.message || error).slice(0, 256) }; }
    });
    const bodyTextLength = Math.min(10000000, (document.body && document.body.innerText || "").length);
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyTextLength,
      selectorResults,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      documentSize: {
        width: Math.max(document.documentElement && document.documentElement.scrollWidth || 0, document.body && document.body.scrollWidth || 0),
        height: Math.max(document.documentElement && document.documentElement.scrollHeight || 0, document.body && document.body.scrollHeight || 0)
      },
      landmarks: {
        headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        main: document.querySelectorAll("main,[role=main]").length,
        buttons: document.querySelectorAll("button,[role=button]").length,
        forms: document.querySelectorAll("form").length
      }
    };
  })()`;
}

function configureWindow(record, previewWindow, log, now) {
  const contents = previewWindow.webContents;
  const previewSession = contents.session;
  contents.setWindowOpenHandler((details) => {
    record.blockedNavigation = boundedText(details?.url || "new-window", 2048);
    touch(record, now);
    sendRecordEvent(record, "navigation-blocked");
    return { action: "deny" };
  });
  const blockNavigation = (event, targetUrl) => {
    if (isAllowedNavigation(record.origin, targetUrl)) return;
    event.preventDefault();
    record.blockedNavigation = boundedText(targetUrl, 2048);
    touch(record, now);
    sendRecordEvent(record, "navigation-blocked");
    log("preview:navigation-blocked", { previewId: record.id, ownerId: record.ownerId, targetUrl });
  };
  contents.on("will-navigate", blockNavigation);
  contents.on("will-redirect", blockNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("render-process-gone", (_event, details) => {
    record.error = `预览渲染进程已退出：${boundedText(details?.reason || "unknown", 128)}`;
    record.state = "failed";
    const failedWindow = record.window;
    record.window = null;
    if (failedWindow && !isWindowDestroyed(failedWindow)) failedWindow.destroy();
    touch(record, now);
    sendRecordEvent(record, "state");
  });
  previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.on("will-download", (event) => event.preventDefault());
  previewSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    callback({ cancel: !isAllowedResource(record.origin, details.url) });
  });
  previewWindow.on("closed", () => {
    record.window = null;
    if (record.state !== "failed") record.state = "closed";
    record.closeReason ||= "window_closed";
    touch(record, now);
    sendRecordEvent(record, "state");
  });
}

function assertIsolatedWindow(previewWindow) {
  const contents = previewWindow?.webContents;
  const previewSession = contents?.session;
  if (!previewWindow || !contents || typeof previewWindow.loadURL !== "function") throw new Error("preview window factory returned an invalid window");
  if (typeof contents.setWindowOpenHandler !== "function" || typeof contents.on !== "function") throw new Error("preview WebContents security hooks are unavailable");
  if (!previewSession || typeof previewSession.setPermissionRequestHandler !== "function" || typeof previewSession.setPermissionCheckHandler !== "function") throw new Error("preview permission isolation is unavailable");
  if (typeof previewSession.on !== "function" || typeof previewSession.webRequest?.onBeforeRequest !== "function") throw new Error("preview download/network isolation is unavailable");
}

function buildVerificationChecks(record, dom, selectors, screenshotBytes) {
  const sameOrigin = dom ? safeOrigin(dom.url) === record.origin : false;
  const checks = [
    { id: "same-origin", status: sameOrigin ? "passed" : "failed", detail: sameOrigin ? record.origin : "页面离开了注册来源" },
    { id: "document-ready", status: dom && ["interactive", "complete"].includes(dom.readyState) ? "passed" : "failed", detail: dom?.readyState || "unavailable" },
    { id: "screenshot", status: screenshotBytes > 0 ? "passed" : "failed", detail: screenshotBytes > 0 ? `${screenshotBytes} bytes` : "未生成截图" },
  ];
  for (const selector of selectors) {
    const result = dom?.selectorResults?.find((item) => item.selector === selector);
    checks.push({
      id: `selector:${selector}`,
      status: result && result.count > 0 && !result.error ? "passed" : "failed",
      detail: result?.error || `${result?.count || 0} matches`,
    });
  }
  return checks;
}

function normalizeDomEvidence(value, selectors) {
  const data = ipcObject(value);
  const selectorResults = Array.isArray(data.selectorResults)
    ? data.selectorResults.slice(0, selectors.length).map((item, index) => {
      const entry = ipcObject(item);
      return {
        selector: selectors[index] || boundedText(entry.selector, 256),
        count: Math.max(0, Math.min(1_000_000, Math.floor(Number(entry.count) || 0))),
        error: boundedText(entry.error, 256),
      };
    })
    : [];
  return {
    url: boundedText(data.url, 2048),
    title: boundedText(data.title, 160),
    readyState: ["loading", "interactive", "complete"].includes(data.readyState) ? data.readyState : "unknown",
    bodyTextLength: Math.max(0, Math.min(10_000_000, Math.floor(Number(data.bodyTextLength) || 0))),
    selectorResults,
    viewport: normalizeDimensions(data.viewport),
    documentSize: normalizeDimensions(data.documentSize),
    landmarks: normalizeLandmarks(data.landmarks),
  };
}

function normalizeDimensions(value) {
  const data = ipcObject(value);
  return {
    width: boundedNumber(data.width, 0, 100_000),
    height: boundedNumber(data.height, 0, 100_000),
    ...(data.devicePixelRatio === undefined ? {} : { devicePixelRatio: boundedNumber(data.devicePixelRatio, 0.1, 10) }),
  };
}

function normalizeLandmarks(value) {
  const data = ipcObject(value);
  const out = {};
  for (const key of ["headings", "main", "buttons", "forms"]) out[key] = boundedNumber(data[key], 0, 1_000_000);
  return out;
}

function publicRecord(record) {
  return Object.freeze({
    id: record.id,
    url: record.url,
    origin: record.origin,
    label: record.label,
    selectors: [...record.selectors],
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    currentUrl: record.currentUrl,
    title: record.title,
    error: record.error,
    blockedNavigation: record.blockedNavigation,
    closeReason: record.closeReason,
    lastVerification: publicVerification(record.lastVerification),
  });
}

function publicVerification(value) {
  if (!value) return null;
  return Object.freeze({
    verificationId: value.verificationId,
    status: value.status,
    checkedAt: value.checkedAt,
    url: value.url,
    title: value.title,
    checks: value.checks.map((check) => ({ ...check })),
    dom: value.dom ? { ...value.dom, selectorResults: value.dom.selectorResults.map((item) => ({ ...item })) } : null,
    screenshot: value.screenshot ? { ...value.screenshot } : null,
    diagnostic: value.diagnostic,
    evidencePath: value.evidencePath,
  });
}

function failRecord(record, code, error, now, log) {
  record.state = "failed";
  record.error = boundedText(error, 2048);
  touch(record, now);
  sendRecordEvent(record, "state");
  log("preview:failed", { previewId: record.id, ownerId: record.ownerId, code, error: record.error });
  return { ok: false, code, error: record.error };
}

function closeRecordWindow(record, reason) {
  record.closeReason = normalizeReason(reason);
  const previewWindow = record.window;
  record.window = null;
  if (previewWindow && !isWindowDestroyed(previewWindow)) previewWindow.destroy();
  if (record.state !== "failed") record.state = "closed";
}

function requireActiveWindow(record) {
  if (!record.window || isWindowDestroyed(record.window) || record.state !== "ready") throw new Error("预览窗口未打开");
  return record.window;
}

function requireOwnedRecord(event, value, records, getCwd, fsImpl) {
  const owner = requireOwner(event);
  const id = ipcString(value).trim();
  if (!PREVIEW_ID_RE.test(id)) throw new Error("preview id is invalid");
  const record = records.get(id);
  if (!record) throw new Error("preview does not exist");
  if (record.ownerId !== owner.id) throw new Error("preview belongs to another window");
  if (record.workspace !== resolveWorkspace(getCwd(), fsImpl)) throw new Error("preview belongs to another workspace");
  return record;
}

function requireOwner(event) {
  const owner = event?.sender;
  if (!owner || !Number.isInteger(owner.id) || owner.id <= 0 || typeof owner.send !== "function" || typeof owner.once !== "function") {
    throw new Error("preview request has no valid renderer owner");
  }
  if (isOwnerDestroyed(owner)) throw new Error("preview renderer owner is closed");
  return owner;
}

function resolveWorkspace(value, fsImpl) {
  const cwd = path.resolve(String(value || ""));
  const real = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(cwd) : fsImpl.realpathSync(cwd);
  if (!fsImpl.statSync(real).isDirectory()) throw new Error("Current workspace is not a directory.");
  return real;
}

function normalizeSelectors(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("selectors must be an array");
  if (value.length > MAX_PREVIEW_SELECTORS) throw new Error(`selectors cannot exceed ${MAX_PREVIEW_SELECTORS}`);
  const selectors = value.map((item) => {
    const selector = ipcString(item).trim();
    if (!selector || selector.length > 256 || /[\u0000-\u001f\u007f]/.test(selector)) throw new Error("selector is invalid");
    return selector;
  });
  if (new Set(selectors).size !== selectors.length) throw new Error("selectors must be unique");
  return selectors;
}

function isAllowedNavigation(origin, targetUrl) {
  try { return new URL(targetUrl).origin === origin; } catch { return false; }
}

function isAllowedResource(origin, targetUrl) {
  try {
    const target = new URL(targetUrl);
    if (["data:", "blob:", "about:"].includes(target.protocol)) return true;
    if (target.protocol === "ws:") return `http://${target.host}` === origin;
    if (target.protocol === "wss:") return `https://${target.host}` === origin;
    return target.origin === origin;
  } catch {
    return false;
  }
}

function prepareEvidenceRoot(value, fsImpl) {
  const target = path.resolve(value);
  fsImpl.mkdirSync(target, { recursive: true, mode: 0o700 });
  return fsImpl.realpathSync.native ? fsImpl.realpathSync.native(target) : fsImpl.realpathSync(target);
}

function safeChildPath(root, ...segments) {
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("preview evidence path escaped its safe root");
  return target;
}

function writeJsonAtomic(file, value, fsImpl) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fsImpl.renameSync(temporary, file);
  try { fsImpl.chmodSync(file, 0o600); } catch {}
}

function sendRecordEvent(record, type) {
  if (isOwnerDestroyed(record.owner)) return false;
  try {
    record.owner.send(PREVIEW_EVENT_CHANNEL, Object.freeze({ type, preview: publicRecord(record) }));
    return true;
  } catch {
    return false;
  }
}

function addOwnerRecord(ownerRecords, ownerId, id) {
  const ids = ownerRecords.get(ownerId) || new Set();
  ids.add(id);
  ownerRecords.set(ownerId, ids);
}

function removeOwnerRecord(ownerRecords, ownerId, id) {
  const ids = ownerRecords.get(ownerId);
  if (!ids) return;
  ids.delete(id);
  if (!ids.size) ownerRecords.delete(ownerId);
}

function trimOwnerRegistry(ownerId, records, ownerRecords) {
  const ids = [...(ownerRecords.get(ownerId) || [])];
  if (ids.length < 8) return;
  const removable = ids.map((id) => records.get(id)).filter((record) => record && CLOSED_STATES.has(record.state)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  while (ids.length >= 8 && removable.length) {
    const record = removable.shift();
    unbindOwner(record);
    records.delete(record.id);
    removeOwnerRecord(ownerRecords, ownerId, record.id);
    ids.splice(ids.indexOf(record.id), 1);
  }
  if (ids.length >= 8) throw new Error("最多保留 8 个应用预览，请先关闭或移除旧预览");
}

function unbindOwner(record) {
  if (!record.ownerDestroyedHandler || typeof record.owner.removeListener !== "function") return;
  try { record.owner.removeListener("destroyed", record.ownerDestroyedHandler); } catch {}
  record.ownerDestroyedHandler = null;
}

function isOwnerDestroyed(owner) {
  try { return typeof owner?.isDestroyed === "function" && owner.isDestroyed(); } catch { return true; }
}

function isWindowDestroyed(previewWindow) {
  try { return typeof previewWindow?.isDestroyed === "function" && previewWindow.isDestroyed(); } catch { return true; }
}

function touch(record, now) {
  record.updatedAt = now().toISOString();
}

function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function normalizeReason(value) {
  return String(value || "closed").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64) || "closed";
}

function boundedText(value, max) {
  return String(value || "").slice(0, max);
}

function boundedNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizePreviewLog(value) {
  const out = {};
  for (const [key, item] of Object.entries(ipcObject(value))) {
    if (/dom|screenshot|evidence|content/i.test(key)) continue;
    if (typeof item === "string") out[key] = redactString(item).slice(0, 2048);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) out[key] = item;
  }
  return out;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function waitForNextLoad(contents, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      contents.removeListener("did-finish-load", onFinish);
      contents.removeListener("did-fail-load", onFail);
    };
    const onFinish = () => { cleanup(); resolve(); };
    const onFail = (_event, errorCode, errorDescription) => {
      cleanup();
      reject(new Error(`${errorDescription || "preview load failed"} (${Number(errorCode) || 0})`));
    };
    contents.once("did-finish-load", onFinish);
    contents.once("did-fail-load", onFail);
  });
}
