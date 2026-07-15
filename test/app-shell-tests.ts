import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SHELL_ROUTES,
  createRouteRegistry,
  type ShellRouteDefinition,
} from "../renderer/app-shell/contracts.ts";
import { createShellStore } from "../renderer/app-shell/store.ts";
import { LegacyPanelAdapter, ShellCompatibilityError } from "../renderer/app-shell/legacy-panel-adapter.ts";

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

class FakeClassList {
  readonly values = new Set<string>();

  add(...tokens: string[]) {
    for (const token of tokens) this.values.add(token);
  }

  remove(...tokens: string[]) {
    for (const token of tokens) this.values.delete(token);
  }

  toggle(token: string, force?: boolean) {
    const next = force === undefined ? !this.values.has(token) : force;
    if (next) this.values.add(token);
    else this.values.delete(token);
    return next;
  }

  contains(token: string) {
    return this.values.has(token);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  className = "";
  clickCount = 0;

  constructor(readonly id: string) {}

  click() {
    this.clickCount += 1;
  }
}

class FakeDocument {
  readonly elements = new Map<string, FakeElement>();

  add(id: string) {
    const element = new FakeElement(id);
    this.elements.set(id, element);
    return element;
  }

  getElementById(id: string) {
    return this.elements.get(id) ?? null;
  }

  querySelectorAll(selector: string) {
    if (selector !== ".nav-row") return [];
    return [...this.elements.values()].filter((element) => element.id.endsWith("Btn") || element.id === "newChat");
  }
}

function createLegacyFixture() {
  const document = new FakeDocument();
  document.add("app");
  document.add("main");
  document.add("appShellMount");
  for (const route of DEFAULT_SHELL_ROUTES) {
    if (!document.getElementById(route.panelId)) document.add(route.panelId);
    if (!document.getElementById(route.navId)) document.add(route.navId);
    if (route.triggerId && !document.getElementById(route.triggerId)) document.add(route.triggerId);
  }
  return document;
}

console.log("\n[app-shell] typed route registry");

await check("registry preserves every production shell destination", () => {
  const registry = createRouteRegistry(DEFAULT_SHELL_ROUTES);
  assert.deepEqual(
    registry.list().map((route) => route.id),
    ["home", "chat", "store", "plugins", "skills", "agents", "mcp", "terminal", "preview", "commands", "git", "jobs", "arena", "industrial"],
  );
  assert.equal(registry.resolveLegacy("capabilityView", "skillsBtn")?.id, "skills");
  assert.equal(registry.resolveLegacy("capabilityView", "storeBtn")?.id, "store");
});

await check("duplicate route IDs fail closed", () => {
  const duplicate = [...DEFAULT_SHELL_ROUTES, { ...DEFAULT_SHELL_ROUTES[0] }] as ShellRouteDefinition[];
  assert.throws(() => createRouteRegistry(duplicate), /duplicate route id/i);
});

await check("duplicate legacy panel/navigation mappings fail closed", () => {
  const duplicate = [
    ...DEFAULT_SHELL_ROUTES,
    { ...DEFAULT_SHELL_ROUTES[0], id: "duplicate-home", label: "重复首页" },
  ] as ShellRouteDefinition[];
  assert.throws(() => createRouteRegistry(duplicate), /duplicate legacy mapping/i);
});

console.log("\n[app-shell] external store");

await check("store publishes immutable route and drawer transitions", () => {
  const store = createShellStore({ activeRouteId: "home" });
  const snapshots: string[] = [];
  const unsubscribe = store.subscribe(() => snapshots.push(`${store.getSnapshot().activeRouteId}:${store.getSnapshot().drawerOpen}`));
  const first = store.getSnapshot();
  store.setDrawerOpen(true);
  store.setActiveRoute("git", "gitBtn");
  unsubscribe();
  store.setDrawerOpen(false);
  assert.equal(first.activeRouteId, "home");
  assert.deepEqual(snapshots, ["home:true", "git:false"]);
  assert.notEqual(first, store.getSnapshot());
});

await check("store records a visible compatibility error", () => {
  const store = createShellStore({ activeRouteId: "home" });
  store.setCompatibilityError("缺少面板 #gitView");
  assert.equal(store.getSnapshot().compatibilityError, "缺少面板 #gitView");
  store.setCompatibilityError("");
  assert.equal(store.getSnapshot().compatibilityError, "");
});

console.log("\n[app-shell] legacy panel adapter");

await check("adapter validates and applies one legacy route atomically", () => {
  const document = createLegacyFixture();
  const store = createShellStore({ activeRouteId: "home" });
  const adapter = new LegacyPanelAdapter({ document, store });
  adapter.validate();
  const result = adapter.applyLegacyRoute({ route: "gitView", mainClass: "git", activeNav: "gitBtn" });
  assert.equal(result.routeId, "git");
  assert.equal(document.getElementById("main")?.className, "git");
  assert.equal(document.getElementById("gitView")?.classList.contains("hidden"), false);
  assert.equal(document.getElementById("home")?.classList.contains("hidden"), true);
  assert.equal(document.getElementById("gitBtn")?.classList.contains("active"), true);
  assert.equal(document.getElementById("newChat")?.classList.contains("active"), false);
  assert.equal(store.getSnapshot().activeRouteId, "git");
});

await check("adapter rejects missing production panels with an actionable error", () => {
  const document = createLegacyFixture();
  document.elements.delete("arenaView");
  const adapter = new LegacyPanelAdapter({ document, store: createShellStore({ activeRouteId: "home" }) });
  assert.throws(() => adapter.validate(), (error: unknown) => {
    assert.ok(error instanceof ShellCompatibilityError);
    assert.match(error.message, /#arenaView/);
    return true;
  });
});

await check("adapter routes user intent through the existing real trigger", () => {
  const document = createLegacyFixture();
  const store = createShellStore({ activeRouteId: "home" });
  const adapter = new LegacyPanelAdapter({ document, store });
  adapter.validate();
  adapter.requestRoute("industrial");
  assert.equal(document.getElementById("industrialBtn")?.clickCount, 1);
  assert.equal(store.getSnapshot().drawerOpen, false);
});

await check("non-navigable transcript state is not exposed as a fake button", () => {
  const document = createLegacyFixture();
  const store = createShellStore({ activeRouteId: "home" });
  const adapter = new LegacyPanelAdapter({ document, store });
  adapter.validate();
  assert.throws(() => adapter.requestRoute("chat"), /not directly navigable/i);
  assert.match(store.getSnapshot().compatibilityError, /chat/);
});

console.log("\n[app-shell] production integration contract");

await check("stable renderer entry mounts the generated App Shell before legacy bootstrap", () => {
  const source = fs.readFileSync(path.resolve("renderer/renderer.js"), "utf8");
  assert.match(source, /generated\/app-shell\.js/);
  assert.ok(source.indexOf("mountHiCodeAppShell") < source.indexOf("bootstrapHiCode"));
});

await check("production HTML provides a dedicated App Shell mount", () => {
  const source = fs.readFileSync(path.resolve("renderer/index.html"), "utf8");
  assert.match(source, /id="appShellMount"/);
});

await check("the generated bundle exists after a production build", () => {
  const output = path.resolve("renderer/generated/app-shell.js");
  assert.ok(fs.existsSync(output), `${output} was not generated`);
  const size = fs.statSync(output).size;
  assert.ok(size > 1_000, "App Shell bundle is unexpectedly empty");
  assert.ok(size < 300_000, `App Shell production bundle includes unexpected development weight: ${size} bytes`);
  const chunksDir = path.resolve("renderer/generated/chunks");
  const editorChunks = fs.existsSync(chunksDir)
    ? fs.readdirSync(chunksDir).filter((name) => /^code-editor-.*\.js$/.test(name))
    : [];
  assert.equal(editorChunks.length, 1, `Expected one lazy CodeMirror chunk, found ${editorChunks.join(", ") || "none"}`);
  assert.ok(fs.statSync(path.join(chunksDir, editorChunks[0])).size > 100_000, "Lazy CodeMirror chunk is unexpectedly empty");
  const terminalChunks = fs.existsSync(chunksDir)
    ? fs.readdirSync(chunksDir).filter((name) => /^xterm-runtime-.*\.js$/.test(name))
    : [];
  assert.equal(terminalChunks.length, 1, `Expected one lazy xterm chunk, found ${terminalChunks.join(", ") || "none"}`);
  assert.ok(fs.statSync(path.join(chunksDir, terminalChunks[0])).size > 100_000, "Lazy xterm chunk is unexpectedly empty");
});

await check("real Electron acceptance includes the full 720-1920 range", () => {
  const baseline = JSON.parse(fs.readFileSync(path.resolve("tests/electron-e2e/fixtures/layout-baseline.json"), "utf8"));
  assert.deepEqual(baseline.widths, [720, 800, 1100, 1440, 1920]);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
