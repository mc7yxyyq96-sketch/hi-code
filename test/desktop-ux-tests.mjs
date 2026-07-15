import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { newPermissionState, permissionFingerprint, requestPermission } from "../dist/permissions.js";
import { createNativeMenuTemplate, normalizeNativeMenuCommand } from "../electron/services/native-menu-service.mjs";
import { createStoreCatalogCache } from "../electron/services/store-catalog-cache.mjs";
import { deriveExecutionProfile } from "../renderer/components/execution-profile-card.js";
import { storeVirtualRange } from "../renderer/components/store-panel.js";

let passed = 0;
let failed = 0;

async function check(name, test) {
  try {
    await test();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}  ${error?.message || error}`);
    failed += 1;
  }
}

console.log("\n[desktop-ux] permission fingerprints");
await check("an exact approval is remembered only for the current permission state", async () => {
  const state = newPermissionState("default");
  let prompts = 0;
  const request = { tool: "bash", action: "npm run build", mutating: true };
  assert.equal(await requestPermission(state, request, async () => { prompts += 1; return "y"; }), "allow");
  assert.equal(await requestPermission(state, request, async () => { prompts += 1; return "n"; }), "allow");
  assert.equal(prompts, 1);
  const nextSession = newPermissionState("default");
  assert.equal(await requestPermission(nextSession, request, async () => { prompts += 1; return "n"; }), "deny");
  assert.equal(prompts, 2);
});

await check("different actions never share an exact approval", async () => {
  const state = newPermissionState("default");
  let prompts = 0;
  await requestPermission(state, { tool: "bash", action: "npm run build", mutating: true }, async () => { prompts += 1; return "y"; });
  await requestPermission(state, { tool: "bash", action: "npm publish", mutating: true }, async () => { prompts += 1; return "n"; });
  assert.equal(prompts, 2);
});

await check("concurrent identical requests share one decision", async () => {
  const state = newPermissionState("default");
  let prompts = 0;
  let answer;
  const ask = () => {
    prompts += 1;
    return new Promise((resolve) => { answer = resolve; });
  };
  const request = { tool: "write_file", action: "write docs/report.md", mutating: true };
  const first = requestPermission(state, request, ask);
  const second = requestPermission(state, request, ask);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prompts, 1);
  answer("y");
  assert.deepEqual(await Promise.all([first, second]), ["allow", "allow"]);
});

await check("denials are not remembered and fingerprints do not expose action text", async () => {
  const state = newPermissionState("default");
  let prompts = 0;
  const request = { tool: "bash", action: "deploy customer-secret-project", mutating: true };
  await requestPermission(state, request, async () => { prompts += 1; return "n"; });
  await requestPermission(state, request, async () => { prompts += 1; return "n"; });
  assert.equal(prompts, 2);
  const fingerprint = permissionFingerprint(request);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes("customer-secret-project"), false);
});

console.log("\n[desktop-ux] native menu and execution profile");
await check("native Edit/View menus use Electron roles and bounded renderer commands", () => {
  const dispatched = [];
  const template = createNativeMenuTemplate({ platform: "linux", sendCommand: (command) => dispatched.push(command) });
  const edit = template.find((item) => item.label === "编辑");
  const view = template.find((item) => item.label === "显示");
  assert.ok(edit.submenu.some((item) => item.role === "undo"));
  assert.ok(edit.submenu.some((item) => item.role === "paste"));
  view.submenu.find((item) => item.id === "hicode.search").click();
  assert.deepEqual(dispatched, ["search"]);
  assert.equal(normalizeNativeMenuCommand("open-settings"), "open-settings");
  assert.equal(normalizeNativeMenuCommand("open-devtools"), "");
});

await check("execution profile derives model speed privacy and budget from real config", () => {
  const local = deriveExecutionProfile({
    defaultProfile: "factory",
    reasoningLevel: "high",
    compactThreshold: 0.5,
    profiles: { factory: { model: "qwen-local", baseURL: "http://127.0.0.1:11434/v1", contextWindow: 128_000 } },
  });
  assert.deepEqual(
    [local.model, local.speed, local.reasoning, local.privacy, local.budgetTokens],
    ["qwen-local", "深度", "高", "本地", 64_000],
  );
  const remote = deriveExecutionProfile({ profiles: { default: { model: "remote", baseURL: "https://models.example/v1" } } });
  assert.equal(remote.remote, true);
  assert.equal(remote.privacy, "远程");
});

console.log("\n[desktop-ux] Store cache and virtual list");
await check("Store cache persists privately, expires truthfully, and replaces safely", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-store-cache-"));
  const filePath = path.join(directory, "private", "catalog-cache.json");
  let clock = 1_000_000;
  let failNextReplace = true;
  const fsImpl = {
    readFileSync: fs.readFileSync,
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    chmodSync: fs.chmodSync,
    rmSync: fs.rmSync,
    renameSync(from, to) {
      if (failNextReplace && fs.existsSync(to)) {
        failNextReplace = false;
        const error = new Error("destination exists");
        error.code = "EEXIST";
        throw error;
      }
      fs.renameSync(from, to);
    },
  };
  try {
    const cache = createStoreCatalogCache({ filePath, ttlMs: 1_000, maxEntries: 2, now: () => clock, fsImpl });
    assert.equal(cache.get("catalog"), null);
    cache.set("catalog", { items: [{ id: "first" }] });
    cache.set("catalog", { items: [{ id: "second" }] });
    assert.equal(cache.get("catalog").value.items[0].id, "second");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
    }
    clock += 1_001;
    assert.equal(cache.get("catalog").fresh, false);
    cache.set("two", { items: [] });
    cache.set("three", { items: [] });
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(Object.keys(persisted.entries).length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

await check("virtual Store range stays bounded for large catalogs", () => {
  const range = storeVirtualRange({ total: 10_000, scrollTop: 400_000, viewportHeight: 560 });
  assert.ok(range.start > 0);
  assert.ok(range.end < 10_000);
  assert.ok(range.end - range.start <= 14);
  assert.equal(range.totalHeight, 940_000);
  assert.equal(range.offsetTop, range.start * 94);
});

await check("production AppShell declares the industrial design system and five supported widths", () => {
  const appShell = fs.readFileSync(path.resolve("renderer/app-shell/AppShell.tsx"), "utf8");
  const main = fs.readFileSync(path.resolve("renderer/app-shell/main.tsx"), "utf8");
  const designSystem = fs.readFileSync(path.resolve("renderer/app-shell/design-system.ts"), "utf8");
  assert.match(appShell, /data-design-system=\{HICODE_DESIGN_SYSTEM\.id\}/);
  assert.match(main, /dataset\.supportedWidths/);
  assert.match(designSystem, /720, 800, 1100, 1440, 1920/);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
