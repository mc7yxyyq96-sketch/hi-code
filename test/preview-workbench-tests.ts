import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createPreviewApi, type PreviewEvent, type RawPreviewBridge } from "../renderer/app-shell/preview/api.ts";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => unknown | Promise<unknown>) {
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

const preview = {
  id: "preview-00000000-0000-4000-8000-000000000001",
  url: "http://127.0.0.1:4173/",
  origin: "http://127.0.0.1:4173",
  label: "Fixture",
  selectors: ["#app"],
  state: "ready",
  createdAt: "2026-07-12T00:00:00Z",
  updatedAt: "2026-07-12T00:00:01Z",
  currentUrl: "http://127.0.0.1:4173/",
  title: "Fixture",
  error: "",
  blockedNavigation: "",
  closeReason: "",
  lastVerification: null,
};

console.log("\n[preview-workbench] typed renderer API");

await check("browser-only mode fails closed with an actionable reason", async () => {
  const api = createPreviewApi();
  const capabilities = await api.capabilities();
  assert.equal(capabilities.available, false);
  assert.match(capabilities.reason, /桌面版/);
  const result = await api.open({ url: preview.url });
  assert.equal(result.ok, false);
  assert.equal(result.code, "preview_unavailable");
});

await check("open payload and selector list are normalized and bounded", async () => {
  let payload: any = null;
  const api = createPreviewApi({
    openPreview: async (value) => {
      payload = value;
      return { ok: true, preview };
    },
  });
  const result = await api.open({ url: `  ${preview.url}  `, label: " Fixture ", selectors: ["#app", "#app", "main"] });
  assert.equal(result.ok, true);
  assert.deepEqual(payload, { url: preview.url, label: "Fixture", selectors: ["#app", "main"] });
  assert.equal(result.preview?.id, preview.id);
});

await check("bridge exceptions return a visible error result", async () => {
  const api = createPreviewApi({ reloadPreview: async () => { throw new Error("channel unavailable"); } });
  const result = await api.reload(preview.id);
  assert.equal(result.ok, false);
  assert.match(result.error || "", /channel unavailable/);
  const invalid = await api.close("../other");
  assert.equal(invalid.ok, false);
  assert.match(invalid.error || "", /ID/);
});

await check("failed verification remains failed with its evidence checks", async () => {
  const api = createPreviewApi({
    verifyPreview: async () => ({
      ok: true,
      preview: { ...preview, state: "ready" },
      verification: {
        verificationId: "verification-1",
        status: "failed",
        checkedAt: "2026-07-12T00:00:02Z",
        url: preview.url,
        title: "Fixture",
        checks: [{ id: "selector:#missing", status: "failed", detail: "0 matches" }],
        screenshot: { path: "/tmp/preview.png", bytes: 1200 },
        evidencePath: "/tmp/evidence.json",
        diagnostic: "selector missing",
      },
    }),
  });
  const result = await api.verify(preview.id, ["#missing"]);
  assert.equal(result.verification?.status, "failed");
  assert.equal(result.verification?.checks[0].status, "failed");
  assert.equal(result.verification?.diagnostic, "selector missing");
});

await check("preview events are typed and unsubscribed", () => {
  let listener: ((value: unknown) => void) | null = null;
  let unsubscribed = false;
  const events: PreviewEvent[] = [];
  const raw: RawPreviewBridge = {
    onPreviewEvent(handler) {
      listener = handler;
      return () => { unsubscribed = true; };
    },
  };
  const unsubscribe = createPreviewApi(raw).onEvent((event) => events.push(event));
  listener?.({ type: "state", preview });
  listener?.({ type: "unknown", preview });
  listener?.({ type: "verification", preview: { id: "../escape" } });
  unsubscribe();
  assert.deepEqual(events.map((event) => event.type), ["state"]);
  assert.equal(unsubscribed, true);
});

console.log("\n[preview-workbench] production integration contract");

await check("preview route is reachable and mounted by the typed App Shell", () => {
  const html = fs.readFileSync(path.resolve("renderer/index.html"), "utf8");
  const routes = fs.readFileSync(path.resolve("renderer/app-shell/contracts.ts"), "utf8");
  const main = fs.readFileSync(path.resolve("renderer/app-shell/main.tsx"), "utf8");
  const bootstrap = fs.readFileSync(path.resolve("renderer/app/bootstrap.js"), "utf8");
  assert.match(html, /id="previewBtn"/);
  assert.match(html, /id="previewView"/);
  assert.match(html, /id="previewReactMount"/);
  assert.match(routes, /id: "preview"/);
  assert.match(main, /<PreviewPortal api=\{previewApi\}/);
  assert.match(bootstrap, /route: "previewView"/);
});

await check("preview UI exposes only real lifecycle and verification actions", () => {
  const portal = fs.readFileSync(path.resolve("renderer/app-shell/preview/PreviewPortal.tsx"), "utf8");
  for (const action of ["api.open", "api.list", "api.reopen", "api.reload", "api.verify", "api.close", "api.remove"]) {
    assert.ok(portal.includes(action), `${action} is not wired`);
  }
  assert.match(portal, /verification\?\.status === "failed"/);
  assert.doesNotMatch(portal, /innerHTML|dangerouslySetInnerHTML|iframe|webview/i);
});

await check("preview layout has compact single-column behavior", () => {
  const css = fs.readFileSync(path.resolve("renderer/style.css"), "utf8");
  assert.match(css, /\.preview-layout\s*\{[\s\S]*grid-template-columns: minmax\(240px, 330px\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.preview-layout \{ grid-template-columns: 1fr/);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
