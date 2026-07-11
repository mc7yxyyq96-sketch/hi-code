import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_TERMINAL_OUTPUT_EVENT_BYTES,
  createTerminalService,
  resolveTerminalShell,
} from "../electron/services/terminal-service.mjs";

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
    this.events = [];
  }

  isDestroyed() {
    return this.destroyed;
  }

  send(channel, payload) {
    if (this.destroyed) throw new Error("owner destroyed");
    this.events.push({ channel, payload });
  }

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

function createFakePty() {
  const state = {
    pid: 4242,
    writes: [],
    resizes: [],
    kills: [],
    dataHandlers: new Set(),
    exitHandlers: new Set(),
  };
  const process = {
    pid: state.pid,
    write(value) { state.writes.push(value); },
    resize(cols, rows) { state.resizes.push({ cols, rows }); },
    kill(signal) { state.kills.push(signal || "default"); },
    onData(handler) {
      state.dataHandlers.add(handler);
      return { dispose: () => state.dataHandlers.delete(handler) };
    },
    onExit(handler) {
      state.exitHandlers.add(handler);
      return { dispose: () => state.exitHandlers.delete(handler) };
    },
  };
  return {
    process,
    state,
    emitData(value) { for (const handler of [...state.dataHandlers]) handler(value); },
    emitExit(value = { exitCode: 0, signal: 0 }) { for (const handler of [...state.exitHandlers]) handler(value); },
  };
}

function createDeterministicFs(workspace) {
  const shell = "/bin/zsh";
  const realpathSync = (value) => value;
  realpathSync.native = (value) => value;
  return {
    realpathSync,
    statSync(value) {
      return {
        isDirectory: () => value === workspace,
        isFile: () => value === shell,
      };
    },
    accessSync(value) {
      if (value !== shell) throw new Error("not executable");
    },
  };
}

function makeFixture({ decision = "allow", transcriptLimit = 64 * 1024, getCwd = null, fsImpl = null, loadPty = null } = {}) {
  const workspace = path.resolve("/tmp/Hi Code terminal 中文");
  const owner = new FakeOwner(11);
  const pty = createFakePty();
  const spawnCalls = [];
  const logs = [];
  const terminations = [];
  const envSource = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/tester",
    TEMP: "/tmp",
    LANG: "en_US.UTF-8",
    SHELL: "/bin/zsh",
    OPENAI_API_KEY: "openai-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    GITHUB_TOKEN: "github-secret",
  };
  const ptyModule = {
    spawn(executable, args, options) {
      spawnCalls.push({ executable, args, options });
      return pty.process;
    },
  };
  const service = createTerminalService({
    getCwd: getCwd || (() => workspace),
    authorize: async () => decision,
    platform: "darwin",
    envSource,
    fsImpl: fsImpl || createDeterministicFs(workspace),
    idFactory: () => "terminal-00000000-0000-4000-8000-000000000001",
    transcriptLimit,
    logger: (event, payload) => logs.push({ event, payload }),
    loadPty: loadPty || (async () => ptyModule),
    terminateProcessTree: async (request) => { terminations.push(request); },
  });
  return { service, owner, pty, ptyModule, spawnCalls, logs, terminations, envSource, workspace };
}

console.log("\n[terminal-service] authorization and isolation");

await check("denied start creates no PTY", async () => {
  const fixture = makeFixture({ decision: "deny" });
  const result = await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  assert.equal(result.ok, false);
  assert.equal(result.denied, true);
  assert.equal(fixture.spawnCalls.length, 0);
});

await check("authorized start uses the current real workspace and a trusted profile-free shell", async () => {
  const fixture = makeFixture();
  const result = await fixture.service.create({ sender: fixture.owner }, { cols: 120, rows: 32 });
  assert.equal(result.ok, true);
  assert.equal(result.session.cwd, fixture.workspace);
  assert.equal(fixture.spawnCalls[0].executable, "/bin/zsh");
  assert.deepEqual(fixture.spawnCalls[0].args, ["-f"]);
  assert.equal(fixture.spawnCalls[0].options.cwd, fixture.workspace);
  assert.equal(fixture.spawnCalls[0].options.cols, 120);
  assert.equal(fixture.spawnCalls[0].options.rows, 32);
});

await check("PTY environment is minimal and excludes parent secrets", async () => {
  const fixture = makeFixture();
  await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  const env = fixture.spawnCalls[0].options.env;
  assert.equal(env.PATH, fixture.envSource.PATH);
  assert.equal(env.HOME, fixture.envSource.HOME);
  assert.equal(env.TERM, "xterm-256color");
  assert.equal(env.HICODE_TERMINAL, "1");
  assert.equal(env.HISTFILE, os.devNull);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.ok(!JSON.stringify(fixture.logs).includes("openai-secret"));
});

await check("session operations are owner-scoped", async () => {
  const fixture = makeFixture();
  const created = await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  const otherOwner = new FakeOwner(12);
  assert.throws(() => fixture.service.write({ sender: otherOwner }, created.session.id, "pwd\r"), /another window/i);
  assert.equal(fixture.service.status({ sender: otherOwner }).active, false);
  assert.equal(fixture.service.status({ sender: fixture.owner }).active, true);
});

await check("owner close during native PTY load cancels spawn", async () => {
  const loading = deferred();
  let fixture;
  fixture = makeFixture({
    loadPty: async () => {
      await loading.promise;
      return fixture.ptyModule;
    },
  });
  const creating = fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  await Promise.resolve();
  fixture.owner.destroy();
  loading.resolve();
  const result = await creating;
  assert.equal(result.ok, false);
  assert.equal(result.code, "terminal_owner_closed");
  assert.equal(fixture.spawnCalls.length, 0);
});

await check("workspace switch during native PTY load cancels stale spawn", async () => {
  const firstWorkspace = path.resolve("/tmp/Hi Code terminal 中文");
  const secondWorkspace = path.resolve("/tmp/Hi Code terminal switched");
  let currentWorkspace = firstWorkspace;
  const loading = deferred();
  const deterministic = createDeterministicFs(firstWorkspace);
  const fsImpl = {
    ...deterministic,
    statSync(value) {
      return {
        isDirectory: () => value === firstWorkspace || value === secondWorkspace,
        isFile: () => value === "/bin/zsh",
      };
    },
  };
  let fixture;
  fixture = makeFixture({
    getCwd: () => currentWorkspace,
    fsImpl,
    loadPty: async () => {
      await loading.promise;
      return fixture.ptyModule;
    },
  });
  const creating = fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  await Promise.resolve();
  currentWorkspace = secondWorkspace;
  loading.resolve();
  const result = await creating;
  assert.equal(result.ok, false);
  assert.equal(result.code, "terminal_workspace_changed");
  assert.equal(fixture.spawnCalls.length, 0);
});

console.log("\n[terminal-service] bounded data and lifecycle");

await check("input, resize, output events, and transcript are bounded", async () => {
  const fixture = makeFixture({ transcriptLimit: 64 * 1024 });
  const created = await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  assert.equal(fixture.service.write({ sender: fixture.owner }, created.session.id, "printf ok\r").ok, true);
  assert.deepEqual(fixture.pty.state.writes, ["printf ok\r"]);
  const resized = fixture.service.resize({ sender: fixture.owner }, created.session.id, { cols: 999, rows: -5 });
  assert.deepEqual({ cols: resized.cols, rows: resized.rows }, { cols: 400, rows: 5 });

  fixture.pty.emitData("界".repeat(30_000));
  const outputEvents = fixture.owner.events.filter((entry) => entry.payload.type === "output");
  assert.ok(outputEvents.length >= 2);
  assert.ok(outputEvents.every((entry) => Buffer.byteLength(entry.payload.data, "utf8") <= MAX_TERMINAL_OUTPUT_EVENT_BYTES));
  const snapshot = fixture.service.status({ sender: fixture.owner }).snapshot;
  assert.ok(Buffer.byteLength(snapshot, "utf8") <= 64 * 1024);
  assert.doesNotMatch(JSON.stringify(fixture.logs), /界界界界界/);
});

await check("close terminates once and emits one terminal exit event", async () => {
  const fixture = makeFixture();
  const created = await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  await fixture.service.close({ sender: fixture.owner }, created.session.id, "user_closed");
  fixture.pty.emitExit();
  assert.equal(fixture.terminations.length, 1);
  assert.equal(fixture.service.activeCount(), 0);
  assert.equal(fixture.owner.events.filter((entry) => entry.payload.type === "exit").length, 1);
});

await check("destroying the renderer owner tears down its PTY", async () => {
  const fixture = makeFixture();
  await fixture.service.create({ sender: fixture.owner }, { cols: 100, rows: 28 });
  fixture.owner.destroy();
  await waitFor(() => fixture.terminations.length === 1);
  assert.equal(fixture.service.activeCount(), 0);
});

console.log("\n[terminal-service] platform contracts");

await check("untrusted SHELL paths are ignored", () => {
  const shell = resolveTerminalShell({
    platform: "darwin",
    env: { SHELL: "/tmp/project/zsh" },
    fsImpl: createDeterministicFs("/tmp/project"),
  });
  assert.equal(shell.executable, "/bin/zsh");
  assert.deepEqual(shell.args, ["-f"]);
});

await check("Windows shell selection stays under trusted roots and disables profiles", () => {
  const executable = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
  const shell = resolveTerminalShell({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files" },
    fsImpl: {
      statSync(value) { return { isFile: () => value === executable }; },
    },
  });
  assert.equal(shell.executable, executable);
  assert.deepEqual(shell.args, ["-NoLogo", "-NoProfile"]);
  assert.equal(shell.profileLoading, false);
});

console.log("\n[terminal-service] real PTY integration");

await check("real PTY executes commands without inherited secrets and closes its process tree", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    console.log("    skip detail: Unix process-group assertion is covered on macOS/Linux; Windows uses taskkill /T in Electron CI");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-pty 中文 path "));
  const owner = new FakeOwner(91);
  const realPty = await import("node-pty");
  let spawned = null;
  const service = createTerminalService({
    getCwd: () => root,
    authorize: async () => "allow",
    envSource: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      SHELL: process.env.SHELL,
      OPENAI_API_KEY: "must-not-reach-terminal",
      ANTHROPIC_API_KEY: "must-not-reach-terminal-either",
    },
    loadPty: async () => ({
      spawn(...args) {
        spawned = realPty.spawn(...args);
        return spawned;
      },
    }),
  });
  try {
    const created = await service.create({ sender: owner }, { cols: 100, rows: 28 });
    assert.equal(created.ok, true, created.error);
    service.write({ sender: owner }, created.session.id, "printf 'HICODE_ENV:%s\\n' \"${OPENAI_API_KEY-unset}\"\r");
    await waitFor(() => outputText(owner).includes("HICODE_ENV:unset"), 5000);
    service.write({ sender: owner }, created.session.id, "sleep 30 & printf 'HICODE_CHILD:%s\\n' $!\r");
    await waitFor(() => /HICODE_CHILD:\d+/.test(outputText(owner)), 5000);
    const childPid = Number(/HICODE_CHILD:(\d+)/.exec(outputText(owner))?.[1]);
    const shellPid = Number(spawned?.pid);
    assert.ok(Number.isInteger(childPid) && childPid > 1);
    assert.ok(Number.isInteger(shellPid) && shellPid > 1);
    await service.close({ sender: owner }, created.session.id, "integration_test");
    await waitFor(() => !pidAlive(shellPid) && !pidAlive(childPid), 5000);
    assert.equal(pidAlive(shellPid), false);
    assert.equal(pidAlive(childPid), false);
  } finally {
    await service.closeAll("test_cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);

function outputText(owner) {
  return owner.events.filter((entry) => entry.payload.type === "output").map((entry) => entry.payload.data).join("");
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error(`condition did not pass within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
