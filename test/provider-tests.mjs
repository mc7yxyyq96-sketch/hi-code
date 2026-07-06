import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentProviderRegistry, createPlaceholderProvider } from "../dist/agent-provider.js";
import { JobStore } from "../dist/job-center.js";
import { WorktreeRunner } from "../dist/worktree-runner.js";
import { createProviderService } from "../electron/services/provider-service.mjs";

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

async function rejects(name, fn, pattern) {
  try {
    await fn();
    check(name, false, "expected rejection");
  } catch (error) {
    const message = error?.message || String(error);
    check(name, pattern ? pattern.test(message) : true, message);
  }
}

console.log("\n[providers] registry");
const registry = new AgentProviderRegistry();
registry.registerProvider({
  id: "test-provider",
  name: "Test Provider",
  version: "0.1.0",
  capabilities: ["job.center"],
  run: async (request) => ({
    ok: true,
    providerId: request.providerId,
    runId: "run-ok",
    status: "succeeded",
    summary: request.prompt,
  }),
});
check("registry lists registered provider", registry.listProviders().some((provider) => provider.id === "test-provider"));
check("registry gets registered provider", registry.getProvider("test-provider")?.status === "enabled");
check("registry validates provider config", registry.validateProviderConfig("test-provider").ok === true);
registry.disableProvider("test-provider");
await rejects("disabled provider cannot run", () => registry.runProvider("test-provider", { prompt: "hello" }), /disabled/);
registry.enableProvider("test-provider");
const registryRun = await registry.runProvider("test-provider", { prompt: "hello" });
check("enabled provider can run", registryRun.ok && registryRun.summary === "hello");

registry.registerProvider(createPlaceholderProvider({
  id: "needs-config",
  name: "Needs Config",
  requiredConfig: ["commandPath"],
  configSchema: [{ key: "commandPath", type: "path", required: true }],
}));
check("missing config reports not_configured", registry.getProvider("needs-config")?.status === "not_configured");
check("validateProviderConfig reports missing config", registry.validateProviderConfig("needs-config").missing?.includes("commandPath"));
await rejects("missing config provider cannot run", () => registry.runProvider("needs-config", { prompt: "hello" }), /missing provider config/);
registry.configureProvider("needs-config", { commandPath: "/usr/local/bin/future-provider" });
check("configured reserved provider still does not report enabled", registry.getProvider("needs-config")?.status === "not_configured");

console.log("\n[providers] service and internal provider");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-provider-test-"));
const workspace = path.join(tmp, "workspace");
const runArtifactDir = path.join(tmp, "provider-runs");
fs.mkdirSync(workspace, { recursive: true });
const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "provider-job",
});
const worktreeRunner = new WorktreeRunner({ safeRoot: path.join(tmp, "worktrees"), idPrefix: "provider-test" });

let enqueued = null;
const service = createProviderService({
  inputQueue: {
    enqueue(input, metadata) {
      enqueued = { input, metadata };
      return { id: "runtime-job-1", input, status: "queued", queuedAt: Date.now(), metadata };
    },
  },
  jobStore,
  worktreeRunner,
  diffService: {
    list() {
      return [{ id: "diff-1", path: "src/app.ts", status: "pending" }];
    },
  },
  getCwd: () => workspace,
  configPath: path.join(tmp, "providers.json"),
  runArtifactDir,
});

const providers = service.listProviders().providers;
check("service lists internal provider", providers.some((provider) => provider.id === "hicode-internal" && provider.status === "enabled"));
check("service lists reserved codex provider as not_configured", providers.some((provider) => provider.id === "codex-cli" && provider.status === "not_configured"));

const disabled = service.configureProvider("hicode-internal", { enabled: false });
check("service can disable provider", disabled.ok && disabled.provider.status === "disabled");
const disabledRun = await service.runProvider("hicode-internal", { prompt: "should not run" });
check("disabled provider service run fails", disabledRun.ok === false && /disabled/.test(disabledRun.error || ""));
service.configureProvider("hicode-internal", { enabled: true });

const missingConfigRun = await service.runProvider("codex-cli", { prompt: "run codex" });
check("missing config service run fails", missingConfigRun.ok === false && /missing provider config/.test(missingConfigRun.error || ""));

const run = await service.runProvider("hicode-internal", { prompt: "fix the renderer bug", actor: "tester" });
const runJob = jobStore.getJob(run.result?.jobId || "");
check("internal provider run succeeds", run.ok && run.result.status === "queued");
check("internal provider creates Job", !!runJob && runJob.source === "provider" && runJob.executor === "hicode-internal");
check("internal provider enqueues runtime job with Job Center id", enqueued?.metadata?.jobCenterId === run.result.jobId && enqueued?.metadata?.providerRunId === run.result.runId);
check("internal provider defaults to isolated workspace", enqueued?.metadata?.isolatedWorkspace?.mode === "copy" && enqueued?.metadata?.executionCwd !== workspace);
check("internal provider writes JobEvent logs", runJob?.events.some((event) => event.type === "provider.run.queued"));
check("internal provider writes provider artifact", runJob?.artifacts.some((artifact) => artifact.type === "provider-run" && fs.existsSync(artifact.path)));
check("internal provider returns changed files", run.result.changedFiles?.includes("src/app.ts"));

console.log("\n[providers] failure handling");
const failingStore = new JobStore({
  storePath: path.join(tmp, "failing-jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "provider-fail",
});
const failingService = createProviderService({
  inputQueue: {
    enqueue() {
      throw new Error("runtime queue unavailable");
    },
  },
  jobStore: failingStore,
  worktreeRunner: new WorktreeRunner({ safeRoot: path.join(tmp, "failing-worktrees"), idPrefix: "provider-fail" }),
  getCwd: () => workspace,
  configPath: path.join(tmp, "failing-providers.json"),
  runArtifactDir: path.join(tmp, "failing-provider-runs"),
});
const failedRun = await failingService.runProvider("hicode-internal", { prompt: "this should fail", actor: "tester" });
const failedJob = failingStore.getJob(failedRun.result?.jobId || "");
check("provider run failure returns failed result", failedRun.ok === false && failedRun.result?.status === "failed");
check("provider run failure writes JobEvent", failedJob?.events.some((event) => event.type === "provider.run.failed"));
check("provider run failure writes gate result", failedJob?.gateResults.some((gate) => gate.gate === "provider-run" && gate.status === "failed"));
check("provider run failure marks job failed", failedJob?.status === "failed");

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
