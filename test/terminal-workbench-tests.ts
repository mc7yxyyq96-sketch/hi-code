import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createTerminalApi, type RawTerminalBridge, type TerminalEvent } from "../renderer/app-shell/terminal/api.ts";

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

const session = {
  id: "terminal-00000000-0000-4000-8000-000000000001",
  cwd: "/tmp/Hi Code 中文 workspace",
  shell: { executable: "/bin/zsh", label: "zsh", profileLoading: false },
  cols: 100,
  rows: 28,
  startedAt: 100,
  state: "running",
};

console.log("\n[terminal-workbench] typed renderer API");

await check("renderer normalizes capabilities and clamps terminal dimensions", async () => {
  let createPayload: unknown = null;
  const api = createTerminalApi({
    getTerminalCapabilities: async () => ({
      ok: true,
      available: true,
      platform: "darwin",
      shell: session.shell,
      supportsResize: true,
      profileLoading: false,
      maxSessionsPerWindow: 1,
    }),
    createTerminal: async (payload) => {
      createPayload = payload;
      return { ok: true, session, snapshot: "ready" };
    },
  });
  const capabilities = await api.capabilities();
  assert.equal(capabilities.available, true);
  assert.equal(capabilities.shell?.label, "zsh");
  const created = await api.create({ cols: 900, rows: 1 });
  assert.equal(created.session?.id, session.id);
  assert.deepEqual(createPayload, { cols: 400, rows: 5 });
});

await check("bridge failures return a readable result instead of throwing", async () => {
  const api = createTerminalApi({
    writeTerminal: async () => { throw new Error("write channel unavailable"); },
  });
  const result = await api.write(session.id, "pwd\r");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /write channel unavailable/);
});

await check("terminal events are typed, size-bounded, and unsubscribed", () => {
  let listener: ((value: unknown) => void) | null = null;
  let unsubscribed = false;
  const received: TerminalEvent[] = [];
  const raw: RawTerminalBridge = {
    onTerminalEvent(handler) {
      listener = handler;
      return () => { unsubscribed = true; };
    },
  };
  const unsubscribe = createTerminalApi(raw).onEvent((event) => received.push(event));
  assert.ok(listener);
  listener?.({ type: "output", sessionId: session.id, sequence: 1, data: "hello" });
  listener?.({ type: "output", sessionId: session.id, sequence: 2, data: "x".repeat(70 * 1024) });
  listener?.({ type: "exit", sessionId: session.id, sequence: 3, reason: "closed", exitCode: null, signal: null });
  listener?.({ type: "output", sessionId: "../other", sequence: 4, data: "escape" });
  unsubscribe();
  assert.deepEqual(received.map((event) => event.type), ["output", "exit"]);
  assert.equal(received[1].type === "exit" ? received[1].exitCode : 1, null);
  assert.equal(unsubscribed, true);
});

await check("restored transcript is capped at one MiB", async () => {
  const api = createTerminalApi({
    getTerminalStatus: async () => ({ ok: true, active: true, session, snapshot: `prefix-${"界".repeat(500_000)}` }),
  });
  const status = await api.status();
  assert.equal(status.active, true);
  assert.ok(new TextEncoder().encode(status.snapshot).byteLength <= 1024 * 1024);
  assert.equal(status.snapshot.includes("�"), false);
});

console.log("\n[terminal-workbench] production integration contract");

await check("terminal route is real and browser preview fails closed", () => {
  const html = fs.readFileSync(path.resolve("renderer/index.html"), "utf8");
  const bootstrap = fs.readFileSync(path.resolve("renderer/app/bootstrap.js"), "utf8");
  assert.match(html, /id="terminalView"/);
  assert.match(html, /id="terminalReactMount"/);
  assert.match(bootstrap, /getTerminalCapabilities:[\s\S]*available: false/);
  assert.match(bootstrap, /浏览器预览不提供本机 PTY/);
});

await check("terminal rendering is lazy, bounded, and uses real xterm input", () => {
  const portal = fs.readFileSync(path.resolve("renderer/app-shell/terminal/TerminalPortal.tsx"), "utf8");
  const runtime = fs.readFileSync(path.resolve("renderer/app-shell/terminal/xterm-runtime.ts"), "utf8");
  assert.match(portal, /import\("\.\/xterm-runtime\.ts"\)/);
  assert.match(portal, /inputChainRef/);
  assert.match(runtime, /terminal\.onData\(onInput\)/);
  assert.match(runtime, /scrollback: 5000/);
  assert.doesNotMatch(portal + runtime, /innerHTML|WebLinksAddon|WebglAddon/);
});

await check("production build keeps xterm out of the initial App Shell chunk", () => {
  const chunksDir = path.resolve("renderer/generated/chunks");
  const chunks = fs.readdirSync(chunksDir);
  const xtermChunks = chunks.filter((name) => /^xterm-runtime-.*\.js$/.test(name));
  assert.equal(xtermChunks.length, 1, `Expected one xterm chunk, found ${xtermChunks.join(", ") || "none"}`);
  assert.ok(fs.statSync(path.join(chunksDir, xtermChunks[0])).size > 100_000);
  const shell = fs.readFileSync(path.resolve("renderer/generated/app-shell.js"), "utf8");
  assert.ok(shell.length < 300_000, `Initial App Shell is unexpectedly large: ${shell.length}`);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
