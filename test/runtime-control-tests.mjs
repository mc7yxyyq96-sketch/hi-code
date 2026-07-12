import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RuntimeJobQueue } from "../dist/job-queue.js";
import { executeTool } from "../dist/tools/index.js";
import { createRuntimeService, registerRuntimeIpcEvents } from "../electron/services/runtime-service.mjs";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    failed++;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log("\n[runtime-control] authoritative queue ordering");
const order = [];
const queue = new RuntimeJobQueue(async (job) => {
  order.push(job.input);
  if (job.input === "active") await wait(30);
});
queue.enqueue("active");
queue.enqueue("normal-follow-up");
queue.enqueueNext("steer-follow-up", { source: "steer" });
await queue.idle();
check(
  "steer follow-up runs immediately after the active turn",
  order.join(",") === "active,steer-follow-up,normal-follow-up",
  JSON.stringify(order),
);

console.log("\n[runtime-control] plan mode tool boundary");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-plan-mode-"));
const target = path.join(workspace, "blocked.txt");
const events = [];
const env = {
  cfg: { sandbox: false },
  ctx: { cwd: workspace, sandbox: false },
  perms: { mode: "yolo", allowlist: new Set() },
  ask: async () => "y",
  depth: 0,
  executionMode: "plan",
  emitEvent: (event) => events.push(event),
};
const writeResult = await executeTool(env, "write_file", JSON.stringify({ path: "blocked.txt", content: "must not exist" }));
const bashResult = await executeTool(env, "bash", JSON.stringify({ command: "touch blocked-by-bash.txt" }));
check("plan mode blocks write_file even in yolo", writeResult.summary === "denied" && !fs.existsSync(target), JSON.stringify(writeResult));
check("plan mode blocks bash before process execution", bashResult.summary === "denied" && !fs.existsSync(path.join(workspace, "blocked-by-bash.txt")), JSON.stringify(bashResult));
check("plan denial is emitted as a truthful tool event", events.some((event) => event.type === "tool:done" && event.status === "denied"));

console.log("\n[runtime-control] main-process queue and steer service");
const createdJobs = [];
const appendedEvents = [];
const enqueued = [];
let aborted = 0;
const fakeQueue = {
  state() {
    return {
      running: { id: "runtime-active", metadata: { jobCenterId: "job-active", executionMode: "default" } },
      queued: [],
      history: [],
    };
  },
  enqueue(input, metadata) {
    enqueued.push({ position: "tail", input, metadata });
    return { id: `runtime-${enqueued.length}`, input, status: "queued", queuedAt: Date.now(), metadata };
  },
  enqueueNext(input, metadata) {
    enqueued.push({ position: "next", input, metadata });
    return { id: `runtime-${enqueued.length}`, input, status: "queued", queuedAt: Date.now(), metadata };
  },
  clearQueued() {
    return 0;
  },
};
const runtimeService = createRuntimeService({
  getRuntime: () => ({
    abort() {
      aborted++;
      return true;
    },
    isBusy: () => true,
  }),
  inputQueue: fakeQueue,
  askResolvers: new Map(),
  send: () => {},
  getCwd: () => workspace,
  jobStore: {
    createJob(input) {
      const job = { id: `job-${createdJobs.length + 1}`, ...input };
      createdJobs.push(job);
      return job;
    },
    appendJobEvent(jobId, event) {
      appendedEvents.push({ jobId, event });
      return event;
    },
  },
});
const planQueued = runtimeService.enqueueInput({ text: "inspect and propose a plan", executionMode: "plan" });
check("plan prompt is queued with durable execution metadata", planQueued.ok && enqueued[0]?.metadata?.executionMode === "plan" && createdJobs[0]?.metadata?.executionMode === "plan", JSON.stringify({ planQueued, enqueued, createdJobs }));
const steered = runtimeService.steerInput({ text: "focus on the failing test", executionMode: "default" });
check("steer aborts the active runtime and queues next", steered.ok && aborted === 1 && enqueued[1]?.position === "next" && enqueued[1]?.metadata?.source === "steer", JSON.stringify({ steered, aborted, enqueued }));
check("steer records an event on the interrupted Job", appendedEvents.some((entry) => entry.jobId === "job-active" && entry.event.type === "runtime.steer.requested"), JSON.stringify(appendedEvents));

console.log("\n[runtime-control] IPC contract");
const ipc = {
  handles: new Map(),
  events: new Map(),
  handle(channel, handler) {
    this.handles.set(channel, handler);
  },
  on(channel, handler) {
    this.events.set(channel, handler);
  },
};
const register = { handle: (channel, handler) => ipc.handle(channel, handler) };
registerRuntimeIpcEvents({ ipcMain: ipc, register, runtime: runtimeService });
check("runtime enqueue is available through invoke IPC", ipc.handles.has("runtime:enqueue"));
check("runtime steer is available through invoke IPC", ipc.handles.has("runtime:steer"));
check("legacy input event remains registered", ipc.events.has("input"));

fs.rmSync(workspace, { recursive: true, force: true });

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
