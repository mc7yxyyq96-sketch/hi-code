import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PREVIEW_EVENT_CHANNEL,
  canonicalizePreviewUrl,
  createPreviewService,
} from "../electron/services/preview-service.mjs";

let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.stack || error.message : String(error)}`);
    failed += 1;
  }
}

class FakeOwner extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.destroyed = false;
    this.messages = [];
  }

  send(channel, payload) { this.messages.push({ channel, payload }); }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit("destroyed"); }
}

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.permissionRequest = null;
    this.permissionCheck = null;
    this.requestFilter = null;
    this.requestHandler = null;
    this.webRequest = {
      onBeforeRequest: (filter, handler) => {
        this.requestFilter = filter;
        this.requestHandler = handler;
      },
    };
  }

  setPermissionRequestHandler(handler) { this.permissionRequest = handler; }
  setPermissionCheckHandler(handler) { this.permissionCheck = handler; }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.session = new FakeSession();
    this.url = "";
    this.title = "Fixture Preview";
    this.openHandler = null;
    this.reloads = 0;
    this.dom = {
      url: "http://127.0.0.1:4173/app",
      title: "Fixture Preview",
      readyState: "complete",
      bodyTextLength: 42,
      selectorResults: [{ selector: "#app", count: 1, error: "" }],
      viewport: { width: 1000, height: 700, devicePixelRatio: 2 },
      documentSize: { width: 1000, height: 900 },
      landmarks: { headings: 1, main: 1, buttons: 2, forms: 0 },
    };
  }

  setWindowOpenHandler(handler) { this.openHandler = handler; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  reloadIgnoringCache() {
    this.reloads += 1;
    queueMicrotask(() => this.emit("did-finish-load"));
  }
  executeJavaScript() { return Promise.resolve(this.dom); }
  capturePage() { return Promise.resolve({ toPNG: () => Buffer.from("valid-png-evidence") }); }
}

class FakeWindow extends EventEmitter {
  constructor(options, { failLoad = false } = {}) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.visible = false;
    this.focused = false;
    this.failLoad = failLoad;
  }

  async loadURL(url) {
    if (this.failLoad) throw new Error("connection refused");
    this.webContents.url = url;
  }

  show() { this.visible = true; }
  focus() { this.focused = true; }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-preview-service-"));
const workspace = path.join(root, "Hi Code 中文 workspace");
const evidenceRoot = path.join(root, "app-data", "preview-evidence");
fs.mkdirSync(workspace, { recursive: true });
let cwd = workspace;
let nextId = 1;
let failNextLoad = false;
const windows = [];
const logs = [];
const service = createPreviewService({
  getCwd: () => cwd,
  evidenceRoot,
  windowFactory: (options) => {
    const window = new FakeWindow(options, { failLoad: failNextLoad });
    failNextLoad = false;
    windows.push(window);
    return window;
  },
  getParentWindow: () => null,
  idFactory: () => `preview-00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
  logger: (event, payload) => logs.push({ event, payload }),
  loadTimeoutMs: 200,
});

const owner = new FakeOwner(41);
const event = { sender: owner };

console.log("\n[preview-service] URL and isolation policy");

await check("only canonical loopback HTTP URLs are accepted", () => {
  assert.equal(canonicalizePreviewUrl("http://127.0.0.1:4173/app").origin, "http://127.0.0.1:4173");
  assert.throws(() => canonicalizePreviewUrl("https://127.0.0.1:4173"), /本机 HTTP/);
  assert.throws(() => canonicalizePreviewUrl("http://example.com"), /localhost/);
  assert.throws(() => canonicalizePreviewUrl("http://user:pass@localhost:3000"), /凭据/);
  assert.throws(() => canonicalizePreviewUrl("http://localhost:3000/#token"), /片段/);
});

let opened;
await check("open creates an isolated owner-scoped preview window", async () => {
  opened = await service.open(event, { url: "http://127.0.0.1:4173/app", label: "Fixture", selectors: ["#app"] });
  assert.equal(opened.ok, true);
  assert.equal(opened.preview.state, "ready");
  const previewWindow = windows.at(-1);
  assert.equal(previewWindow.options.webPreferences.contextIsolation, true);
  assert.equal(previewWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(previewWindow.options.webPreferences.sandbox, true);
  assert.equal("preload" in previewWindow.options.webPreferences, false);
  assert.equal(previewWindow.options.webPreferences.devTools, false);
  assert.equal(previewWindow.visible, true);
  assert.equal(previewWindow.focused, true);
  assert.equal(previewWindow.webContents.openHandler({ url: "https://example.com" }).action, "deny");
});

await check("permissions downloads and external resources fail closed", () => {
  const previewWindow = windows.at(-1);
  let permissionAllowed = true;
  previewWindow.webContents.session.permissionRequest(null, "clipboard-read", (allowed) => { permissionAllowed = allowed; });
  assert.equal(permissionAllowed, false);
  assert.equal(previewWindow.webContents.session.permissionCheck(), false);
  let downloadPrevented = false;
  previewWindow.webContents.session.emit("will-download", { preventDefault: () => { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
  let localRequest;
  previewWindow.webContents.session.requestHandler({ url: "http://127.0.0.1:4173/app.js" }, (value) => { localRequest = value; });
  assert.deepEqual(localRequest, { cancel: false });
  let remoteRequest;
  previewWindow.webContents.session.requestHandler({ url: "https://example.com/track" }, (value) => { remoteRequest = value; });
  assert.deepEqual(remoteRequest, { cancel: true });
});

await check("external navigation is blocked and reported to the owner", () => {
  const previewWindow = windows.at(-1);
  let prevented = false;
  previewWindow.webContents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "https://example.com/escape");
  assert.equal(prevented, true);
  assert.ok(owner.messages.some((message) => message.channel === PREVIEW_EVENT_CHANNEL && message.payload.type === "navigation-blocked"));
  const listed = service.list(event);
  assert.equal(listed.previews[0].blockedNavigation, "https://example.com/escape");
});

console.log("\n[preview-service] evidence and lifecycle");

await check("DOM and screenshot verification writes owner-only truthful evidence", async () => {
  const result = await service.verify(event, opened.preview.id, { selectors: ["#app"] });
  assert.equal(result.ok, true);
  assert.equal(result.verification.status, "passed");
  assert.ok(fs.existsSync(result.verification.evidencePath));
  assert.ok(fs.existsSync(result.verification.screenshot.path));
  assert.equal(fs.statSync(result.verification.evidencePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(result.verification.screenshot.path).mode & 0o777, 0o600);
  const evidence = JSON.parse(fs.readFileSync(result.verification.evidencePath, "utf8"));
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.dom.bodyTextLength, 42);
  assert.equal(JSON.stringify(evidence).includes("Fixture secret body"), false);
});

await check("missing selector remains failed rather than fake passed", async () => {
  windows.at(-1).webContents.dom.selectorResults = [{ selector: "#missing", count: 0, error: "" }];
  const result = await service.verify(event, opened.preview.id, { selectors: ["#missing"] });
  assert.equal(result.ok, true);
  assert.equal(result.verification.status, "failed");
  assert.equal(result.verification.checks.find((item) => item.id === "selector:#missing").status, "failed");
});

await check("reload uses the live isolated window and returns to ready", async () => {
  const previewWindow = windows.at(-1);
  const result = await service.reload(event, opened.preview.id);
  assert.equal(result.ok, true);
  assert.equal(result.preview.state, "ready");
  assert.equal(previewWindow.webContents.reloads, 1);
});

await check("closed previews can be reopened without reusing stale windows", async () => {
  const firstWindow = windows.at(-1);
  const closed = await service.close(event, opened.preview.id, "user_closed");
  assert.equal(closed.preview.state, "closed");
  assert.equal(firstWindow.destroyed, true);
  const reopened = await service.reopen(event, opened.preview.id);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.reused, false);
  assert.equal(reopened.preview.state, "ready");
  assert.notEqual(windows.at(-1), firstWindow);
});

await check("renderer crashes destroy the stale native window and remain failed", () => {
  const crashedWindow = windows.at(-1);
  crashedWindow.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  const listed = service.list(event);
  assert.equal(crashedWindow.destroyed, true);
  assert.equal(listed.previews[0].state, "failed");
  assert.match(listed.previews[0].error, /crashed/);
  assert.equal(service.activeCount(), 0);
});

await check("cross-owner and switched-workspace access is rejected", async () => {
  const otherOwner = new FakeOwner(42);
  assert.throws(() => service.list({ sender: { id: 0 } }), /valid renderer owner/);
  await assert.rejects(() => service.close({ sender: otherOwner }, opened.preview.id), /another window/);
  const otherWorkspace = path.join(root, "other-workspace");
  fs.mkdirSync(otherWorkspace);
  cwd = otherWorkspace;
  await assert.rejects(() => service.verify(event, opened.preview.id), /another workspace/);
  cwd = workspace;
});

await check("owner destruction closes windows and removes registry state", async () => {
  owner.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.activeCount(), 0);
  assert.equal(windows.at(-1).destroyed, true);
});

await check("load failures stay visible and do not leave a live window", async () => {
  const failureOwner = new FakeOwner(43);
  failNextLoad = true;
  const result = await service.open({ sender: failureOwner }, { url: "http://localhost:6553" });
  assert.equal(result.ok, false);
  assert.equal(result.preview.state, "failed");
  assert.match(result.error, /connection refused/);
  assert.equal(service.activeCount(), 0);
  assert.ok(logs.some((entry) => entry.event === "preview:failed"));
  await service.closeAllForOwner(failureOwner.id);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
