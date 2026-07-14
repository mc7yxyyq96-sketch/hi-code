import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ProviderControlRegistry,
  credentialStatus,
  executeWithProviderPolicy,
  normalizeProviderFailure,
} from "../dist/provider-control-plane.js";
import { ProviderUsageStore } from "../dist/provider-usage-store.js";
import {
  buildExternalAgentCommandPlan,
  redactExternalAgentOutput,
  validateExternalAgentConfig,
} from "../dist/external-agent-provider.js";
import { JobStore } from "../dist/job-center.js";
import { WorktreeRunner } from "../dist/worktree-runner.js";
import { createExternalAgentProvider } from "../electron/services/external-agent-provider-service.mjs";
import { createProviderService } from "../electron/services/provider-service.mjs";
import { createElectronSecretStore } from "../electron/services/secret-store-service.mjs";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    pass += 1;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    fail += 1;
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

function descriptor(id, kind, deployment, privacyLevel) {
  return {
    id,
    kind,
    adapterType: `${id}-adapter`,
    name: id,
    version: "1.2.3",
    enabled: true,
    configured: true,
    capability: {
      modelName: kind === "model" ? `${id}-model` : undefined,
      contextLength: kind === "model" ? 128_000 : undefined,
      vision: kind === "model",
      tools: true,
      streaming: true,
      reasoning: true,
      cost: { currency: "USD", source: "configured", inputPerMillionTokens: 1, outputPerMillionTokens: 2 },
      deployment,
      privacyLevel,
      capabilities: kind === "model" ? ["input.text", "input.image", "tool.calling"] : ["external.cli", "workspace.write"],
    },
    credential: { state: kind === "model" ? "stored" : "not_required" },
  };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { return Buffer.from(`encrypted:${value}`, "utf8"); },
    decryptString(value) { return Buffer.from(value).toString("utf8").replace(/^encrypted:/, ""); },
  };
}

console.log("\n[provider-hardening] unified control registry");
const control = new ProviderControlRegistry();
let enabledState = true;
control.register({
  descriptor: descriptor("remote-model", "model", "remote", "remote_warning"),
  healthCheck: () => ({ status: "healthy", checkedAt: Date.now(), version: "2026-07" }),
  setEnabled(value) { enabledState = value; },
});
control.register({
  descriptor: descriptor("external-agent", "agent", "enterprise", "enterprise_policy"),
  healthCheck: () => ({ status: "degraded", checkedAt: Date.now(), message: "manual policy review" }),
});
check("registry distinguishes Model Provider from External Agent Provider", control.discover({ kind: "model" }).length === 1 && control.discover({ kind: "agent" }).length === 1);
check("registry discovers providers by capability", control.discover({ capability: "workspace.write" })[0]?.id === "external-agent");
check("registry exposes bounded capability metadata", control.queryCapabilities("remote-model").contextLength === 128_000 && control.queryCapabilities("remote-model").privacyLevel === "remote_warning");
check("registry reports schema and revision version", control.version().schemaVersion === 1 && control.version().providers === 2 && control.version().revision >= 2);
const healthy = await control.healthCheck("remote-model");
check("registry runs provider health checks", healthy.status === "healthy" && healthy.version === "2026-07");
await control.disable("remote-model");
check("registry disables providers", enabledState === false && control.get("remote-model")?.enabled === false && (await control.healthCheck("remote-model")).status === "disabled");
await control.enable("remote-model");
check("registry enables providers", enabledState === true && control.get("remote-model")?.enabled === true);
await rejects(
  "privacy boundary rejects remote provider marked local-only",
  async () => control.register({ descriptor: descriptor("bad-privacy", "model", "remote", "local_only") }),
  /privacy level/,
);

console.log("\n[provider-hardening] credential and failure policy");
const now = Date.now();
check("expired credentials are explicit", credentialStatus({ state: "stored", secretRef: "provider:model/key", expiresAt: now - 1 }, now).state === "expired");
check("soon-expiring credentials are explicit", credentialStatus({ state: "stored", secretRef: "provider:model/key", expiresAt: now + 60_000 }, now).state === "expiring");
const failures = [
  normalizeProviderFailure(new Error("request timeout api_key=top-secret")),
  normalizeProviderFailure({ status: 429, message: "quota exceeded token=top-secret" }),
  normalizeProviderFailure({ status: 401, message: "invalid API key top-secret" }),
  normalizeProviderFailure(new Error("ECONNREFUSED network failure")),
  normalizeProviderFailure(new Error("provider unavailable")),
];
check("failures normalize timeout/quota/auth/network/unavailable", failures.map((entry) => entry.category).join(",") === "timeout,quota_exceeded,authentication,network,unavailable");
check("failure messages redact credential-shaped data", failures.every((entry) => !entry.message.includes("top-secret")));
let policyRuns = 0;
const policyOutcome = await executeWithProviderPolicy({
  providerId: "primary-agent",
  policy: { retries: 1, retryDelayMs: 0, fallbackProviderIds: ["fallback-agent"] },
  sleep: async () => {},
  async run(providerId) {
    policyRuns += 1;
    if (providerId === "primary-agent") throw new Error("network failure");
    return { ok: true, providerId };
  },
  isSuccessful: (result) => result.ok === true,
});
check("retry and fallback select a healthy provider", policyOutcome.ok && policyOutcome.providerId === "fallback-agent" && policyOutcome.attempts.length === 3 && policyRuns === 3);

console.log("\n[provider-hardening] local usage ledger");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-provider-hardening-"));
const usagePath = path.join(tmp, "provider-data", "usage.json");
const usageStore = new ProviderUsageStore({ storePath: usagePath, now: () => now + 2_000 });
usageStore.record({
  providerId: "remote-model",
  providerKind: "model",
  model: "gpt-production",
  success: true,
  startedAt: now,
  endedAt: now + 1_000,
  inputTokens: 120,
  outputTokens: 30,
  estimatedCostUsd: 0.0012,
});
usageStore.record({
  providerId: "remote-model",
  providerKind: "model",
  model: "gpt-production",
  success: false,
  startedAt: now,
  endedAt: now + 500,
  failureCategory: "quota_exceeded",
});
const usageReloaded = new ProviderUsageStore({ storePath: usagePath }).get("remote-model");
check("usage persists tokens, latency, cost and failure rate", usageReloaded?.runs === 2 && usageReloaded.totalTokens === 150 && usageReloaded.totalLatencyMs === 1_500 && usageReloaded.estimatedCostUsd === 0.0012 && usageReloaded.failureRate === 0.5);
check("usage records provider and model aggregation", usageReloaded?.providerKind === "model" && usageReloaded.models[0]?.model === "gpt-production" && usageReloaded.failures.quota_exceeded === 1);
const usageText = fs.readFileSync(usagePath, "utf8");
check("usage ledger excludes prompts and credentials", !/prompt|api.?key|top-secret/i.test(usageText));
if (process.platform !== "win32") check("usage ledger is private on POSIX", (fs.statSync(usagePath).mode & 0o777) === 0o600);

console.log("\n[provider-hardening] external Agent command boundary");
const workerConfig = {
  commandPath: process.execPath,
  argsJson: JSON.stringify(["-e", "process.stdout.write('worker')", "{prompt}"]),
  timeoutMs: 10_000,
  outputBytes: 128 * 1024,
  network: false,
};
check("custom worker validates absolute executable and bounded args", validateExternalAgentConfig("custom-agent-worker", workerConfig).ok === true);
check("relative executable is rejected", validateExternalAgentConfig("custom-agent-worker", { ...workerConfig, commandPath: "node" }).ok === false);
const commandPlan = buildExternalAgentCommandPlan("custom-agent-worker", workerConfig, "change one file");
check("command plan uses argv without shell text", commandPlan.executable === process.execPath && commandPlan.args.at(-1) === "change one file" && commandPlan.network === "deny");
check("external Agent logs redact secrets", !redactExternalAgentOutput("token=top-secret authorization: Bearer abc123").includes("top-secret") && !redactExternalAgentOutput("token=top-secret authorization: Bearer abc123").includes("abc123"));

console.log("\n[provider-hardening] managed isolated external Agent run");
const workspace = path.join(tmp, "workspace");
fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
fs.writeFileSync(path.join(workspace, "src", "agent.txt"), "before\n");
const safeRoot = path.join(tmp, "worktrees");
const runner = new WorktreeRunner({ safeRoot, idPrefix: "provider-hardening" });
const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "provider-hardening-job",
});
const agentUsage = new ProviderUsageStore({ storePath: path.join(tmp, "agent-usage.json") });
let executionCalls = 0;
let executionBoundaryPassed = false;
const executeManaged = async (request, options = {}) => {
  executionCalls += 1;
  if (request.surface === "provider-health") {
    return {
      ok: true, exitCode: 0, signal: null, timedOut: false, cancelled: false,
      stdout: "worker 1.0.0\n", stderr: "", durationMs: 1, policy: { enforcementMode: request.enforcementMode },
    };
  }
  executionBoundaryPassed = request.surface === "external-agent-provider"
    && request.filesystem === "workspace-write"
    && request.enforcementMode === "strict"
    && request.approval?.required === true
    && request.approval?.granted === true
    && Array.isArray(request.allowedRoots)
    && request.allowedRoots.length === 1
    && request.allowedRoots[0] === request.cwd
    && !("env" in request)
    && !("shell" in request)
    && !JSON.stringify(request).includes("OPENAI_API_KEY");
  fs.writeFileSync(path.join(request.cwd, "src", "agent.txt"), "after\n");
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: options.signal?.aborted === true,
    stdout: "completed token=top-secret",
    stderr: "",
    durationMs: 5,
    policy: { enforcementMode: request.enforcementMode, audit: { decision: "allow" } },
  };
};
const externalAgent = createExternalAgentProvider({
  id: "test-worker",
  name: "Test Worker",
  adapterType: "custom-agent-worker",
  description: "Test-only managed worker",
  jobStore,
  worktreeRunner: runner,
  getCwd: () => workspace,
  runArtifactDir: path.join(tmp, "provider-runs"),
  authorize: async () => "allow",
  usageStore: agentUsage,
  executeManaged,
});
externalAgent.config = workerConfig;
const agentHealth = await externalAgent.healthCheck();
check("external Agent health probe reports real executable version", agentHealth.status === "healthy" && agentHealth.version === "worker 1.0.0");
const agentRun = await externalAgent.run({ providerId: "test-worker", prompt: "change one file", actor: "tester", options: { executionMode: "copy" } });
const agentJob = jobStore.getJob(agentRun.jobId);
const agentArtifactPath = agentRun.artifacts?.[0]?.path;
const agentArtifactText = agentArtifactPath ? fs.readFileSync(agentArtifactPath, "utf8") : "";
check("external Agent run succeeds in isolated workspace", agentRun.ok === true && agentRun.changedFiles.includes("src/agent.txt") && Boolean(agentArtifactPath && fs.existsSync(agentArtifactPath)));
check("managed execution enforces approval, workspace root and no inherited env", executionBoundaryPassed === true);
check("external Agent run writes Job lifecycle evidence", agentJob?.status === "succeeded" && agentJob.events.some((event) => event.type === "provider.execution.authorized") && agentJob.events.some((event) => event.type === "worktree.patch.collected") && agentJob.artifacts.some((artifact) => artifact.type === "provider-run"));
check("external Agent output and artifact redact secrets", !JSON.stringify(agentRun).includes("top-secret") && !agentArtifactText.includes("top-secret") && agentArtifactText.includes("[REDACTED]"));
check("external Agent usage is recorded", agentUsage.get("test-worker")?.succeeded === 1);

let deniedExecutionCalls = 0;
const deniedAgent = createExternalAgentProvider({
  id: "denied-worker",
  name: "Denied Worker",
  adapterType: "custom-agent-worker",
  description: "Denied test worker",
  jobStore,
  worktreeRunner: runner,
  getCwd: () => workspace,
  runArtifactDir: path.join(tmp, "denied-provider-runs"),
  authorize: async () => "deny",
  usageStore: agentUsage,
  executeManaged: async () => { deniedExecutionCalls += 1; throw new Error("must not execute"); },
});
deniedAgent.config = workerConfig;
const deniedRun = await deniedAgent.run({ providerId: "denied-worker", prompt: "do not run", options: { executionMode: "copy" } });
const deniedJob = jobStore.getJob(deniedRun.jobId);
check("denied external Agent never reaches process execution", deniedRun.ok === false && deniedExecutionCalls === 0);
check("denied external Agent writes failed Job and Gate evidence", deniedJob?.status === "failed" && deniedJob.gateResults.some((gate) => gate.status === "failed"));

const dryRun = await externalAgent.run({ providerId: "test-worker", prompt: "plan only", options: { executionMode: "dry-run" } });
const dryArtifact = JSON.parse(fs.readFileSync(dryRun.artifacts[0].path, "utf8"));
check("dry-run is explicitly simulated and does not execute the Agent", dryRun.ok && dryArtifact.simulated === true && dryArtifact.externalExecutionRequired === true && executionCalls === 2);

console.log("\n[provider-hardening] Provider Service discovery and UI contract");
const configPath = path.join(tmp, "providers.json");
const secureConfigPath = path.join(tmp, "model-config.json");
const secretStore = createElectronSecretStore({
  safeStorage: fakeSafeStorage(),
  rootDir: path.join(tmp, "secrets"),
  configPath: secureConfigPath,
  platform: "darwin",
});
const profiles = {
  responses: { name: "OpenAI Responses", protocol: "responses", baseURL: "https://api.openai.com/v1", model: "gpt-responses", apiKey: "runtime-only" },
  anthropic: { name: "Anthropic", protocol: "anthropic_messages", baseURL: "https://api.anthropic.com/v1", model: "claude-production", apiKey: "runtime-only" },
  compatible: { name: "Enterprise Compatible", protocol: "chat_completions", deployment: "enterprise", baseURL: "https://models.example.test/v1", model: "enterprise-model", apiKey: "runtime-only" },
  ollama: { name: "Ollama", protocol: "ollama_chat", baseURL: "http://127.0.0.1:11434", model: "local-model", apiKey: "" },
};
const providerService = createProviderService({
  inputQueue: { enqueue() { throw new Error("not expected"); } },
  jobStore,
  worktreeRunner: runner,
  getCwd: () => workspace,
  configPath,
  runArtifactDir: path.join(tmp, "service-runs"),
  secretStore,
  loadConfig: () => ({ profiles }),
  usagePath: path.join(tmp, "service-usage.json"),
  authorize: async () => "deny",
});
const discovered = providerService.discoverProviders().providers;
const modelAdapters = new Set(discovered.filter((provider) => provider.kind === "model").map((provider) => provider.adapterType));
const agentAdapters = new Set(discovered.filter((provider) => provider.kind === "agent").map((provider) => provider.adapterType));
check("service discovers all production Model Provider adapters", ["openai-responses", "anthropic", "openai-compatible", "ollama-local"].every((adapter) => modelAdapters.has(adapter)));
check("service discovers internal and external Agent Provider adapters", ["internal-runtime", "codex-cli", "claude-code", "custom-agent-worker"].every((adapter) => agentAdapters.has(adapter)));
check("service registry version covers unified providers", providerService.getProviderRegistryVersion().registry.providers === discovered.length);
const responseProvider = discovered.find((provider) => provider.adapterType === "openai-responses");
check("service exposes model capability and privacy metadata", providerService.getProviderCapabilities(responseProvider.id).capability.modelName === "gpt-responses" && responseProvider.capability.privacyLevel === "remote_warning");
const modelRun = await providerService.runProvider(responseProvider.id, { prompt: "must use model runtime" });
check("Model Provider cannot be run as External Agent Provider", modelRun.ok === false && /model runtime/i.test(modelRun.error));
providerService.configureProvider(responseProvider.id, { enabled: false });
check("Provider Settings enable/disable persists", providerService.getProvider(responseProvider.id).provider.enabled === false && JSON.parse(fs.readFileSync(configPath, "utf8")).modelProviders.responses.enabled === false);
check("provider registry state never persists runtime API keys", !fs.readFileSync(configPath, "utf8").includes("runtime-only"));

const html = fs.readFileSync(path.join(process.cwd(), "renderer", "index.html"), "utf8");
const panel = fs.readFileSync(path.join(process.cwd(), "renderer", "components", "provider-settings-panel.js"), "utf8");
const arena = fs.readFileSync(path.join(process.cwd(), "renderer", "components", "patch-arena-panel.js"), "utf8");
check("Provider Settings has a real mounted panel", html.includes("settingsProviderSection") && html.includes("providerSettingsRoot") && panel.includes("healthCheckProvider") && panel.includes("configureProvider"));
check("Provider Settings exposes health, credential, privacy and enable controls", /health|健康/.test(panel) && /credential|凭据/.test(panel) && /privacy|隐私/.test(panel) && panel.includes("configureProvider") && panel.includes("input.checked"));
check("Patch Arena only offers Agent Providers", arena.includes('provider.kind === "agent"'));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
