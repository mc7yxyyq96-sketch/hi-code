import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore, JOB_STATUSES } from "../dist/job-center.js";
import { createJobService } from "../electron/services/job-service.mjs";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false, "expected throw");
  } catch (error) {
    check(name, pattern ? pattern.test(error?.message || String(error)) : true, error?.message || String(error));
  }
}

console.log("\n[job-center] model and store");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-job-center-"));
const workspace = path.join(tmp, "workspace");
const storePath = path.join(tmp, "job-center.json");
fs.mkdirSync(workspace, { recursive: true });
const artifactPath = path.join(workspace, "build.log");
fs.writeFileSync(artifactPath, "ok");

const store = new JobStore({ storePath, allowedArtifactRoots: [workspace], idPrefix: "test-job" });
check("job statuses include required states", ["queued", "running", "paused", "waiting_approval", "succeeded", "failed", "cancelled"].every((status) => JOB_STATUSES.includes(status)));

const job = store.createJob({
  title: "Build Hi Code",
  source: "test",
  trigger: "unit-test",
  actor: "tester",
  executor: "job-store",
  cwd: workspace,
  tasks: [
    {
      title: "Compile",
      executor: "tsc",
      steps: [{ title: "Run build", command: "npm run build" }],
    },
  ],
});
check("createJob creates queued job", job.status === "queued" && job.createdAt > 0 && job.events.some((event) => event.type === "job.created"));
check("getJob reads created job", store.getJob(job.id)?.title === "Build Hi Code");
check("listJobs returns created job", store.listJobs({ source: "test" }).some((item) => item.id === job.id));

throws("illegal queued -> succeeded transition rejected", () => store.updateJob(job.id, { status: "succeeded" }), /illegal job status transition/);
const running = store.updateJob(job.id, { status: "running" });
check("updateJob transitions to running", running.status === "running" && typeof running.startedAt === "number");

const event = store.appendJobEvent(job.id, {
  type: "task.step",
  message: "Running TypeScript build",
  actor: "tester",
  taskId: running.tasks[0].id,
  stepId: running.tasks[0].steps[0].id,
});
check("appendJobEvent records event", event.type === "task.step" && store.getJob(job.id)?.events.some((item) => item.id === event.id));

const artifact = store.addArtifact(job.id, {
  type: "log",
  path: artifactPath,
  producedBy: { taskId: running.tasks[0].id, stepId: running.tasks[0].steps[0].id, executor: "tester" },
});
check("addArtifact records artifact", artifact.path === artifactPath && store.getJob(job.id)?.artifacts.some((item) => item.id === artifact.id));
check("addArtifact links task and step", store.getJob(job.id)?.tasks[0].artifacts.includes(artifact.id) && store.getJob(job.id)?.tasks[0].steps[0].artifacts.includes(artifact.id));
throws("artifact outside allowed roots rejected", () => store.addArtifact(job.id, { type: "log", path: path.join(os.tmpdir(), `outside-${Date.now()}.log`) }), /artifact path escapes/);

const gate = store.addGateResult(job.id, {
  gate: "build",
  status: "passed",
  message: "Build passed",
  artifacts: [artifact.id],
  taskId: running.tasks[0].id,
});
check("addGateResult records gate result", gate.status === "passed" && store.getJob(job.id)?.gateResults.some((item) => item.id === gate.id));

const succeeded = store.updateJob(job.id, { status: "succeeded" });
check("running job can succeed", succeeded.status === "succeeded" && typeof succeeded.endedAt === "number");
throws("terminal job cannot be paused", () => store.pauseJob(job.id), /terminal job/);

console.log("\n[job-center] control operations");
const pausable = store.createJob({ title: "Pause me", source: "test" });
const paused = store.pauseJob(pausable.id, "tester");
check("pauseJob moves queued job to paused", paused.status === "paused");
const resumed = store.resumeJob(pausable.id, "tester");
check("resumeJob moves paused job to queued", resumed.status === "queued");

const cancellable = store.createJob({ title: "Cancel me", source: "test" });
const cancelled = store.cancelJob(cancellable.id, "user requested", "tester");
check("cancelJob moves job to cancelled", cancelled.status === "cancelled" && cancelled.error === "user requested");
const retried = store.retryJob(cancellable.id, "tester");
check("retryJob requeues cancelled job", retried.status === "queued" && retried.retryCount === 1 && !retried.error);
throws("retryJob rejects non-terminal active job", () => store.retryJob(retried.id), /cannot retry/);

const failing = store.createJob({ title: "Fail me", source: "test" });
store.updateJob(failing.id, { status: "running" });
const failed = store.updateJob(failing.id, { status: "failed", error: "boom" });
check("failed status records error", failed.status === "failed" && failed.error === "boom");
check("retryJob requeues failed job", store.retryJob(failing.id).status === "queued");

console.log("\n[job-center] persistence and service");
const restored = new JobStore({ storePath, allowedArtifactRoots: [workspace] });
check("persisted job reloads from disk", restored.getJob(job.id)?.artifacts[0]?.id === artifact.id);

let openedArtifact = "";
const service = createJobService({
  jobStore: restored,
  allowedArtifactRoots: [workspace],
  shell: {
    showItemInFolder(filePath) {
      openedArtifact = filePath;
    },
  },
});
const serviceCreated = service.createJob({ title: "Service job", source: "ipc-test" });
check("job service creates job", serviceCreated.ok && serviceCreated.job.source === "ipc-test");
check("job service lists jobs", service.listJobs({ limit: 10 }).jobs.length > 0);
check("job service returns events", service.listEvents(job.id).events.some((item) => item.type === "job.created"));
check("job service returns artifacts", service.listArtifacts(job.id).artifacts.some((item) => item.id === artifact.id));
check("job service previews artifact", service.previewArtifact(job.id, artifact.id).content === "ok");
check("job service opens artifact location", service.openArtifact(job.id, artifact.id).ok && openedArtifact === artifact.path);
check("job service pause/resume works", service.resumeJob(service.pauseJob(serviceCreated.job.id).job.id).job.status === "queued");

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
