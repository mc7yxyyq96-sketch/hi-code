import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EXECUTION_POLICY_SCHEMA_VERSION,
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  projectExecutionCapabilities,
  terminateExecutionProcessTree,
} from "../dist/execution-policy.js";
import {
  createExecutionPolicyService,
  registerExecutionPolicyIpc,
} from "../electron/services/execution-policy-service.mjs";
import {
  buildExecutionSupervisorEnv,
  runManagedExecution,
  runManagedExecutionSync,
} from "../dist/execution-runner.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => success(name), (error) => failure(name, error));
    }
    success(name);
  } catch (error) {
    failure(name, error);
  }
}

function success(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function failure(name, error) {
  failed += 1;
  console.error(`  ✗ ${name}: ${error?.message || error}`);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-execution-policy-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-execution-outside-"));

function request(overrides = {}) {
  return {
    id: "policy-test",
    surface: "runtime-bash",
    executable: process.execPath,
    args: ["--version"],
    cwd: workspace,
    allowedRoots: [workspace],
    filesystem: "workspace-write",
    network: "allow",
    environment: {
      source: {
        PATH: process.env.PATH,
        HOME: os.homedir(),
        OPENAI_API_KEY: "must-not-escape",
      },
    },
    limits: { timeoutMs: 5_000, outputBytes: 64 * 1024 },
    approval: { required: true, granted: true },
    processTree: { required: true },
    enforcementMode: "strict",
    ...overrides,
  };
}

console.log("\n[execution-policy] platform capability truth");

const darwin = detectExecutionCapabilities({
  platform: "darwin",
  backendAvailability: { sandboxExec: true },
  processTreeSupport: true,
});
check("macOS reports sandbox-exec without claiming complete isolation", () => {
  assert.equal(darwin.schemaVersion, EXECUTION_POLICY_SCHEMA_VERSION);
  assert.equal(darwin.backend.id, "macos-sandbox-exec");
  assert.equal(darwin.controls.filesystem.enforcement, "write-confined");
  assert.equal(darwin.controls.network.enforcement, "deny-when-requested");
  assert.equal(darwin.strength, "partial");
  assert.ok(darwin.warnings.some((item) => /read/i.test(item)));
});

const linux = detectExecutionCapabilities({
  platform: "linux",
  backendAvailability: { bubblewrap: true },
  processTreeSupport: true,
});
check("Linux reports verified bubblewrap controls", () => {
  assert.equal(linux.backend.id, "linux-bubblewrap");
  assert.equal(linux.controls.filesystem.enforcement, "write-confined");
  assert.equal(linux.controls.network.enforcement, "deny-when-requested");
  assert.equal(linux.controls.processTree.available, true);
  assert.notEqual(linux.strength, "strong");
});

const weakLinux = detectExecutionCapabilities({
  platform: "linux",
  backendAvailability: { bubblewrap: false },
  processTreeSupport: true,
});
check("Linux without bubblewrap is explicitly weak", () => {
  assert.equal(weakLinux.backend.id, "none");
  assert.equal(weakLinux.strength, "weak");
  assert.equal(weakLinux.controls.filesystem.available, false);
  assert.ok(weakLinux.setupHint.includes("bubblewrap"));
});

const windows = detectExecutionCapabilities({
  platform: "win32",
  backendAvailability: { windowsRestrictedToken: false, windowsJobObject: false },
  processTreeSupport: true,
});
check("Windows does not invent restricted-token isolation", () => {
  assert.equal(windows.backend.id, "none");
  assert.equal(windows.strength, "weak");
  assert.equal(windows.controls.filesystem.available, false);
  assert.equal(windows.controls.network.available, false);
  assert.equal(windows.controls.processTree.enforcement, "taskkill-tree");
});

check("renderer projection is bounded and value-free", () => {
  const projection = projectExecutionCapabilities(darwin);
  assert.deepEqual(Object.keys(projection).sort(), ["backend", "controls", "platform", "schemaVersion", "setupHint", "strength", "warnings"]);
  assert.ok(!JSON.stringify(projection).includes(os.homedir()));
  assert.ok(JSON.stringify(projection).length < 16_384);
});

console.log("\n[execution-policy] deterministic policy decisions");

check("strict workspace isolation fails closed without a backend", () => {
  const decision = evaluateExecutionPolicy(request(), weakLinux);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "filesystem_isolation_unavailable");
});

check("report-only mode permits weak execution but records the missing control", () => {
  const decision = evaluateExecutionPolicy(request({ enforcementMode: "report-only" }), weakLinux);
  assert.equal(decision.ok, true);
  assert.equal(decision.strength, "weak");
  assert.equal(decision.enforced.filesystem, false);
  assert.ok(decision.warnings.some((item) => /filesystem/i.test(item)));
});

check("network deny fails closed when unavailable", () => {
  const decision = evaluateExecutionPolicy(request({ filesystem: "unrestricted", network: "deny" }), windows);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "network_isolation_unavailable");
});

check("approval is required before launch", () => {
  const decision = evaluateExecutionPolicy(request({ approval: { required: true, granted: false } }), darwin);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "approval_required");
});

check("working directory escape is rejected", () => {
  const decision = evaluateExecutionPolicy(request({ cwd: outside }), darwin);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "cwd_outside_allowed_roots");
});

check("command deny policy is enforced before spawn", () => {
  const decision = evaluateExecutionPolicy(request({ commandPolicy: { deny: [path.basename(process.execPath)] } }), darwin);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "command_denied");
});

check("environment is minimized and audit metadata contains no values", () => {
  const decision = evaluateExecutionPolicy(request(), darwin);
  assert.equal(decision.ok, true);
  assert.equal(decision.launch.env.OPENAI_API_KEY, undefined);
  assert.ok(decision.launch.env.PATH);
  assert.deepEqual(decision.audit.envKeys.sort(), Object.keys(decision.launch.env).sort());
  assert.ok(!JSON.stringify(decision.audit).includes("must-not-escape"));
  assert.equal(decision.audit.argCount, 1);
});

check("invalid or excessive limits fail closed", () => {
  const badTimeout = evaluateExecutionPolicy(request({ limits: { timeoutMs: -1, outputBytes: 1024 } }), darwin);
  const badOutput = evaluateExecutionPolicy(request({ limits: { timeoutMs: 1000, outputBytes: 1024 * 1024 * 1024 } }), darwin);
  assert.equal(badTimeout.code, "invalid_limits");
  assert.equal(badOutput.code, "invalid_limits");
});

check("malformed policy input fails closed instead of throwing", () => {
  const decision = evaluateExecutionPolicy({}, darwin);
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "invalid_request");
});

check("interactive execution remains weak and does not claim a timeout", () => {
  const decision = evaluateExecutionPolicy(request({
    filesystem: "unrestricted",
    interactive: true,
    limits: { timeoutMs: 0, outputBytes: 1024 * 1024 },
  }), darwin);
  assert.equal(decision.ok, true);
  assert.equal(decision.strength, "weak");
  assert.equal(decision.enforced.timeout, false);
  assert.equal(decision.audit.interactive, true);
  assert.ok(decision.warnings.some((item) => /no automatic timeout/i.test(item)));
});

console.log("\n[execution-policy] backend launch plans");

check("macOS plan confines writes and can deny network", () => {
  const decision = evaluateExecutionPolicy(request({ network: "deny" }), darwin);
  const plan = createExecutionLaunchPlan(decision, darwin);
  assert.equal(plan.command, "/usr/bin/sandbox-exec");
  assert.equal(plan.args[0], "-p");
  assert.ok(plan.args[1].includes("deny file-write"));
  assert.ok(plan.args[1].includes("deny network"));
  assert.ok(plan.args.includes(process.execPath));
});

check("Linux plan uses die-with-parent, workspace bind, and network namespace", () => {
  const decision = evaluateExecutionPolicy(request({ network: "deny" }), linux);
  const plan = createExecutionLaunchPlan(decision, linux);
  assert.equal(plan.command, "bwrap");
  assert.ok(plan.args.includes("--die-with-parent"));
  assert.ok(plan.args.includes("--bind"));
  assert.ok(plan.args.includes("--unshare-net"));
  assert.ok(plan.args.includes("--chdir"));
});

check("weak report-only plan remains unwrapped and visibly weak", () => {
  const decision = evaluateExecutionPolicy(request({ enforcementMode: "report-only" }), weakLinux);
  const plan = createExecutionLaunchPlan(decision, weakLinux);
  assert.equal(plan.command, process.execPath);
  assert.equal(plan.strength, "weak");
  assert.ok(plan.warnings.length > 0);
});

console.log("\n[execution-policy] Electron service boundary");

check("service exposes a value-free capability projection", () => {
  const logs = [];
  const service = createExecutionPolicyService({
    platform: "linux",
    backendAvailability: { bubblewrap: false },
    processTreeSupport: true,
    logger: (event, payload) => logs.push({ event, payload }),
  });
  const result = service.capabilities();
  assert.equal(result.ok, true);
  assert.equal(result.capabilities.strength, "weak");
  const decision = service.evaluate(request({ enforcementMode: "report-only" }));
  assert.equal(decision.ok, true);
  assert.ok(logs.some((entry) => entry.event === "execution-policy:decision"));
  assert.ok(!JSON.stringify(logs).includes("must-not-escape"));
  assert.ok(!JSON.stringify(logs).includes("--version"));
});

check("IPC registers read-only capabilities only", () => {
  const channels = [];
  registerExecutionPolicyIpc({
    register: { handle: (channel) => channels.push(channel) },
    executionPolicy: createExecutionPolicyService({ platform: "win32", backendAvailability: {}, processTreeSupport: true }),
  });
  assert.deepEqual(channels, ["execution-policy:capabilities"]);
});

console.log("\n[execution-policy] process tree termination");

await check("managed async execution bounds output and preserves metadata-only audit", async () => {
  const result = await runManagedExecution(request({
    filesystem: "unrestricted",
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(8192))"],
    limits: { timeoutMs: 5_000, outputBytes: 1_024 },
  }), { capabilities: weakLinux });
  assert.equal(result.ok, true);
  assert.equal(Buffer.byteLength(result.stdout), 1_024);
  assert.equal(result.policy.audit.envKeys.includes("OPENAI_API_KEY"), false);
  assert.ok(!JSON.stringify(result.policy).includes("must-not-escape"));
});

check("managed sync execution uses the supervisor and returns bounded output", () => {
  const result = runManagedExecutionSync(request({
    filesystem: "unrestricted",
    executable: process.execPath,
    args: ["-e", "process.stdout.write('sync-ok')"],
    limits: { timeoutMs: 5_000, outputBytes: 1_024 },
  }), { capabilities: weakLinux });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "sync-ok");
  assert.equal(result.policy.strength, "weak");
});

check("Electron supervisor runs as Node without inheriting parent secrets", () => {
  const env = buildExecutionSupervisorEnv({
    electron: true,
    source: {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      OPENAI_API_KEY: "must-not-escape",
      GITHUB_TOKEN: "must-not-escape",
    },
  });
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.PATH, "/safe/bin");
  assert.equal(env.HOME, "/safe/home");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

check("Windows termination uses a bounded taskkill tree call", () => {
  const calls = [];
  const result = terminateExecutionProcessTree({
    pid: 4242,
    platform: "win32",
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].command.toLowerCase(), "taskkill.exe");
  assert.deepEqual(calls[0].args, ["/PID", "4242", "/T", "/F"]);
  assert.equal(calls[0].options.shell, false);
});

if (process.platform !== "win32") {
  await check("POSIX termination ends the detached parent and descendant", async () => {
    const parent = spawn(process.execPath, ["-e", [
      "const {spawn}=require('node:child_process');",
      "const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      "console.log(c.pid);",
      "setInterval(()=>{},1000);",
    ].join("")], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const childPid = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child pid timeout")), 3000);
      parent.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        resolve(Number(String(chunk).trim()));
      });
    });
    const result = terminateExecutionProcessTree({ pid: parent.pid, platform: process.platform, signal: "SIGTERM" });
    assert.equal(result.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(isAlive(parent.pid), false);
    assert.equal(isAlive(childPid), false);
  });

  check("sync supervisor timeout terminates the target descendant", () => {
    const pidFile = path.join(workspace, "supervisor-child.pid");
    const script = [
      "const fs=require('node:fs'); const {spawn}=require('node:child_process');",
      "const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      `fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));`,
      "setInterval(()=>{},1000);",
    ].join("");
    const result = runManagedExecutionSync(request({
      filesystem: "unrestricted",
      executable: process.execPath,
      args: ["-e", script],
      limits: { timeoutMs: 300, outputBytes: 1_024 },
    }), { capabilities: weakLinux });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    const childPid = Number(fs.readFileSync(pidFile, "utf8"));
    assert.equal(isAlive(childPid), false);
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

fs.rmSync(workspace, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
