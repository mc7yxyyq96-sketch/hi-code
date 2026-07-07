import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHiCodeApi } from "../renderer/api/hicode-api.js";
import { showRoute } from "../renderer/app/router.js";
import { getState, resetState, setState, subscribe } from "../renderer/app/state.js";
import { diffStatusText, renderUnifiedDiff } from "../renderer/components/diff-viewer.js";
import { jobActionState, renderJobDetailMarkup, renderJobListMarkup, summarizeJobs } from "../renderer/components/job-center-panel.js";
import { renderArenaDetailMarkup, renderArenaRunListMarkup, renderSkeletonRisk, summarizeArenaRuns } from "../renderer/components/patch-arena-panel.js";
import { renderIndustrialProjectMarkup, summarizeArtifactCompleteness, summarizeIndustrialProject } from "../renderer/components/industrial-project-panel.js";
import { renderDomainPackDetailMarkup, renderDomainPackListMarkup, summarizeDomainPacks } from "../renderer/components/domain-pack-panel.js";
import { renderAgentPlanListMarkup, renderAgentPlanMarkup, renderAgentProfileListMarkup, summarizeAgentPlan } from "../renderer/components/agent-team-panel.js";
import { renderToolchainDetailMarkup, renderToolchainListMarkup, summarizeToolchainAdapters } from "../renderer/components/toolchain-panel.js";
import { renderQualityGateDetailMarkup, renderQualityGateListMarkup, summarizeQualityGates } from "../renderer/components/quality-gate-panel.js";
import { renderDefinitionOfDoneChecklist, renderReleaseCenterMarkup, summarizeReleaseReadiness } from "../renderer/components/release-center-panel.js";
import { renderSampleProjectResultMarkup, summarizeSampleProjectResult } from "../renderer/components/sample-project-panel.js";
import { capabilityActionLabel, capabilityDescription, CAPABILITY_META } from "../renderer/components/mcp-panel.js";
import { storeChineseSummary, storeInstallActionState, storeQueryOptions } from "../renderer/components/store-panel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

console.log("\n[renderer] entrypoints");
const rendererEntry = fs.readFileSync(path.join(root, "renderer", "renderer.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "app", "bootstrap.js"), "utf8");
const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "style.css"), "utf8");
const toastSource = fs.readFileSync(path.join(root, "renderer", "components", "toast.js"), "utf8");
check("renderer.js is a thin module entry", rendererEntry.includes("bootstrapHiCode") && rendererEntry.split("\n").length <= 6);
check("index.html loads renderer as ES module", html.includes('type="module" src="renderer.js"'));
check("bootstrap uses API wrapper", bootstrap.includes("createHiCodeApi(window.hicode"));
check("bootstrap imports panel modules", [
  "components/diff-viewer.js",
  "components/file-tree.js",
  "components/mcp-panel.js",
  "components/store-panel.js",
  "components/job-center-panel.js",
  "components/patch-arena-panel.js",
  "components/industrial-project-panel.js",
  "components/domain-pack-panel.js",
  "components/agent-team-panel.js",
  "components/toolchain-panel.js",
  "components/quality-gate-panel.js",
  "components/release-center-panel.js",
  "components/sample-project-panel.js",
  "components/ai-team-panel.js",
  "components/settings-panel.js",
].every((needle) => bootstrap.includes(needle)));
check("MCP config button opens MCP settings mode", bootstrap.includes("cfgBtn.onclick = openMcpSettings") && bootstrap.includes("return openSettings(\"mcp\")"));
check("MCP settings validates mcpServers JSON", bootstrap.includes("function validateMcpServersConfig") && bootstrap.includes("MCP JSON 格式错误") && bootstrap.includes("mcpServers 必须是 JSON 对象"));
check("command sidebar opens visible command center", html.includes('section id="commandView"') && bootstrap.includes('route: "commandView"') && bootstrap.includes('"cmdBtn").onclick = showCommandCenter'));
check("command center exposes real actions", bootstrap.includes("function executeCommand") && bootstrap.includes('if (name === "/mcp") return showCapabilities("mcp")') && bootstrap.includes('if (name === "/diff") return showGit()'));
check("Agent sidebar opens installed agent capability list", html.includes('id="agentsBtn"') && bootstrap.includes('$("agentsBtn").onclick = () => showCapabilities("agents")') && bootstrap.includes('activeNav: CAPABILITY_META[kind]?.nav'));
check("sidebar removes standalone conversation nav and keeps new chat", !html.includes('id="chatNav"') && !bootstrap.includes('$("chatNav")') && !bootstrap.includes('activeNav: "chatNav"') && html.includes('id="newChat"') && html.includes('<span class="nav-label">新对话</span>'));
check("sidebar menu collapse keeps only pinned navigation", html.includes('id="sidebarToggle"') && bootstrap.includes("hicode.sidebarCollapsed") && bootstrap.includes("sidebar-nav-collapsed") && html.includes("nav-pinned") && html.includes("nav-optional") && html.includes('id="newChat"') && html.includes('id="storeBtn"') && html.includes('id="industrialBtn"'));
check("sidebar collapsed hides project recent and account chrome", css.includes("body.sidebar-nav-collapsed .section-label") && css.includes("body.sidebar-nav-collapsed .proj-row") && css.includes("body.sidebar-nav-collapsed .side-list") && css.includes("body.sidebar-nav-collapsed .side-foot"));
check("sidebar reserves macOS traffic-light safe area", css.includes("--mac-titlebar-safe-top") && css.includes("padding: var(--mac-titlebar-safe-top) 10px 10px") && css.includes("height: var(--mac-titlebar-safe-top)") && css.includes("position: absolute"));
check("sidebar menu area scrolls vertically", html.includes('class="side-scroll"') && css.includes(".side-scroll") && css.includes("overflow-y: auto") && css.includes("overscroll-behavior: contain") && css.includes(".side-foot { flex: none"));
check("sidebar scroll resets on init and collapse toggle", bootstrap.includes("function resetSidebarScroll") && bootstrap.includes("function scheduleSidebarScrollReset") && bootstrap.includes('document.querySelector(".side-scroll")') && bootstrap.includes("sideScroll.scrollTop = 0") && bootstrap.includes("requestAnimationFrame(resetSidebarScroll)") && bootstrap.includes("window.setTimeout(resetSidebarScroll, 80)"));
check("sidebar project row explains workspace switching", html.includes('class="proj-copy"') && html.includes('class="proj-hint"') && html.includes("当前工作区 · 点击切换") && css.includes(".proj-copy") && css.includes(".proj-hint"));
check("sidebar recent sessions use compact product list", bootstrap.includes("function formatSessionAge") && bootstrap.includes("sessions-empty") && bootstrap.includes("sess-count") && bootstrap.includes("currentSessionId") && css.includes(".sess.active") && css.includes(".sess-count"));
check("Git panel avoids clipped commit column on medium windows", css.includes('grid-template-areas:') && css.includes('"files diff"') && css.includes('"commit commit"') && css.includes(".git-commit-panel { grid-area: commit; }") && css.includes("@media (min-width: 1280px)") && css.includes('grid-template-areas: "files diff commit"'));
check("Git commit controls remain visible in responsive layout", html.includes('class="git-commit-actions"') && css.includes(".git-commit-actions") && css.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)") && css.includes(".git-commit-status:empty") && css.includes("height: 32px") && css.includes("#gitCommitMessage") && css.includes("max-height: 110px"));
check("capability pages expose Store-managed disable and uninstall actions", bootstrap.includes("getCapabilityStoreItems") && bootstrap.includes("renderCapabilityActions") && bootstrap.includes("returnToCapability") && bootstrap.includes("已禁用") && bootstrap.includes("卸载"));
check("capability Store lookup is silent for missing local-only items", bootstrap.includes("api.getStoreItemSilent") && bootstrap.includes("getCapabilityStoreItems"));
check("store detail exposes uninstall and local translation affordance", bootstrap.includes('id="storeDetailUninstall"') && bootstrap.includes("storeChineseSummary({ ...item, translatedSummary: translatedCandidate || \"\" })") && css.includes(".ghost.danger"));
check("store detail re-translates mixed backend summaries", !bootstrap.includes("translatedCandidate && translatedCandidate !== originalSummary") && bootstrap.includes("translatedSummary: translatedCandidate || \"\""));
check("toast controller deduplicates and limits repeated errors", toastSource.includes("maxVisible = 3") && toastSource.includes("active = new Map") && toastSource.includes("（${existing.count} 次）") && toastSource.includes("target.children.length > maxVisible"));
check("demo browser shim uses neutral paths", !bootstrap.includes("/Users/liu") && bootstrap.includes("/demo/hicode-project") && bootstrap.includes("/demo/hicode-data"));

console.log("\n[renderer] state");
resetState();
let observed = null;
const unsubscribe = subscribe((next) => {
  observed = next.cwd;
});
setState({ cwd: "/tmp/hi-code" });
check("state get/set works", getState().cwd === "/tmp/hi-code");
check("state subscribe works", observed === "/tmp/hi-code");
unsubscribe();

console.log("\n[renderer] api wrapper");
const errors = [];
const api = createHiCodeApi({
  testModel: async () => ({ ok: true, value: 1 }),
  saveConfig: async () => ({ ok: false, error: "bad request" }),
  listJobs: async () => ({ ok: true, jobs: [] }),
  getJob: async (id) => ({ ok: true, job: { id } }),
  listProviders: async () => ({ ok: true, providers: [{ id: "hicode-internal" }] }),
  runProvider: async (id, payload) => ({ ok: true, result: { providerId: id, summary: payload.prompt } }),
  createWorktree: async (payload) => ({ ok: true, workspace: { mode: payload.mode || "auto" } }),
  collectWorktreeChanges: async () => ({ ok: true, changes: { changedFiles: ["a.txt"] } }),
  listArenaRuns: async () => ({ ok: true, runs: [] }),
  createArenaRun: async (payload) => ({ ok: true, run: { id: "arena-1", task: payload.task, candidates: [] } }),
  mergeArenaCandidate: async () => ({ ok: true }),
  getIndustrialProject: async () => ({ ok: true, project: null }),
  saveIndustrialProject: async (payload) => ({ ok: true, project: { name: payload.name, domains: payload.domains } }),
  buildIndustrialRequirementDraft: async (payload) => ({ ok: true, draft: { requirementId: "REQ-UI-1", title: payload.text, domain: "software" } }),
  addIndustrialRequirement: async (payload) => ({ ok: true, requirement: { requirementId: payload.requirementId || "REQ-UI-1", title: payload.title } }),
  updateIndustrialRequirementCriteria: async (payload) => ({ ok: true, requirement: { requirementId: payload.requirementId, acceptanceCriteria: payload.acceptanceCriteria } }),
  generateIndustrialArtifactPlan: async (payload) => ({ ok: true, plan: { requirementId: payload.requirementId }, generated: [{ name: "artifact-plan.md" }] }),
  generateIndustrialTestPlan: async (payload) => ({ ok: true, plan: { requirementId: payload.requirementId, tests: [{ id: "test-1" }] } }),
  generateIndustrialSpecPackage: async (payload) => ({ ok: true, spec: { requirementId: payload.requirementId }, generated: [{ name: "release-checklist.md" }] }),
  approveIndustrialRequirement: async (payload) => ({ ok: true, approval: { status: "approved", scope: `requirement:${payload.requirementId}` } }),
  addIndustrialArtifact: async (payload) => ({ ok: true, artifact: { type: payload.type, name: payload.name } }),
  listDomainPacks: async () => ({ ok: true, packs: [] }),
  getDomainPack: async (id) => ({ ok: true, pack: { manifest: { id } } }),
  validateDomainPack: async (payload) => ({ ok: true, manifest: payload.manifest || payload, errors: [] }),
  installDomainPack: async (payload) => ({ ok: true, pack: { manifest: { id: payload.id } } }),
  enableDomainPack: async (id) => ({ ok: true, pack: { manifest: { id }, enabled: true } }),
  disableDomainPack: async (id) => ({ ok: true, pack: { manifest: { id }, enabled: false } }),
  uninstallDomainPack: async (id) => ({ ok: true, id }),
  recommendDomainPacks: async () => ({ ok: true, packs: [] }),
  listAgentProfiles: async () => ({ ok: true, profiles: [{ id: "product-manager", name: "Product Manager" }] }),
  getAgentProfile: async (id) => ({ ok: true, profile: { id } }),
  createAgentPlan: async (payload) => ({ ok: true, plan: { id: "agent-plan-1", task: payload.task, tasks: [], qualityGates: [], expectedArtifacts: [], humanApprovalPoints: [], route: {} } }),
  listAgentPlans: async () => ({ ok: true, plans: [] }),
  getAgentPlan: async (id) => ({ ok: true, plan: { id, tasks: [], qualityGates: [], expectedArtifacts: [], humanApprovalPoints: [], route: {} } }),
  createMultiAgentJob: async (payload) => ({ ok: true, job: { id: "job-1", status: "waiting_approval" }, plan: { id: payload.planId } }),
  listToolchainAdapters: async () => ({ ok: true, adapters: [{ adapter: { id: "kicad", name: "KiCad", vendor: "KiCad", domains: ["pcb"], capabilities: [] }, detection: { installed: false, reason: "missing", diagnostics: [] } }], toolRequirements: [] }),
  detectToolchainAdapter: async (id, payload) => ({ ok: true, detection: { adapterId: id, installed: !!payload?.executablePath } }),
  getToolchainCapabilities: async (id) => ({ ok: true, capabilities: [{ id, name: "dry-run" }] }),
  runToolchainAdapter: async (payload) => ({ ok: true, result: { adapterId: payload.adapterId, simulated: true, artifacts: [] } }),
  listQualityGates: async () => ({ ok: true, gates: [{ id: "software.npm_build", name: "npm build", type: "command_gate", category: "software", severity: "high" }] }),
  runQualityGate: async (payload) => ({ ok: true, run: { gateId: payload.gateId, status: "passed" }, result: { status: "passed" } }),
  approveQualityGate: async (payload) => ({ ok: true, run: { gateId: payload.gateId, status: payload.approved === false ? "failed" : "passed" } }),
  getReleaseReadiness: async () => ({ ok: true, readiness: { ready: true, version: "1.0.0", gateSummary: { total: 1, passed: 1 }, artifactSummary: { included: 2, missing: 0, simulated: 0 }, risks: [], blockers: [], warnings: [], approvals: [], gateResults: [], simulatedGates: [], releasePath: "/tmp/releases/1.0.0", project: { name: "Project" } } }),
  buildReleasePackage: async () => ({ ok: true, releasePackage: { releaseId: "release-1", version: "1.0.0", releasePath: "/tmp/releases/1.0.0", manifestPath: "/tmp/releases/1.0.0/release-manifest.json", artifacts: [], checksums: { "release-manifest.json": "abc" } } }),
  openReleasePackage: async () => ({ ok: true, releasePath: "/tmp/releases/1.0.0" }),
  createIndustrialControlBoxSample: async () => ({ ok: true, jobId: "job-sample", sample: { name: "Industrial Control Box Demo", artifacts: [{ simulated: true }], gates: [{ status: "simulated" }] }, releasePackage: { releasePath: "/tmp/releases/industrial-control-box-demo" } }),
  listStore: async () => ({ ok: true, items: [{ id: "plugin-demo", name: "Demo Plugin", installed: true, enabled: true }], sources: [] }),
  getStoreItem: async (id) => ({ ok: true, item: { id, name: "Demo Plugin", kind: "plugin", summary: "Plugin for reviewing source code", installed: true, enabled: true }, detail: { translatedSummary: "用于 reviewing 源代码" } }),
  enableStoreItem: async (id) => ({ ok: true, item: { id, enabled: true } }),
  disableStoreItem: async (id) => ({ ok: true, item: { id, enabled: false } }),
  uninstallStoreItem: async (id) => ({ ok: true, item: { id, installed: false } }),
  throws: async () => { throw new Error("boom"); },
  list: async () => ["a"],
}, { onError: (message) => errors.push(message) });
const okResult = await api.testModel({});
check("api wrapper preserves successful result", okResult?.ok === true && okResult.value === 1);
check("api wrapper detects missing methods", api.has("missing") === false);
const bad = await api.saveConfig("{}");
check("api wrapper returns failed API result", bad?.ok === false && /bad request/.test(bad.error || ""));
const missing = await api.gitStatus();
check("api wrapper returns standardized missing-method error", missing?.ok === false && /gitStatus/.test(missing.error || ""));
const missingIndustrialApi = createHiCodeApi({}, { onError: (message) => errors.push(message) });
check("industrial project API does not fake success when preload is missing", (await missingIndustrialApi.getIndustrialProject()).ok === false);
check("job center API list is callable", (await api.listJobs()).ok === true);
check("job center API get is callable", (await api.getJob("job-1")).job.id === "job-1");
check("provider API list is callable", (await api.listProviders()).providers[0].id === "hicode-internal");
check("provider API run is callable", (await api.runProvider("hicode-internal", { prompt: "hello" })).result.summary === "hello");
check("worktree API create is callable", (await api.createWorktree({ mode: "copy" })).workspace.mode === "copy");
check("worktree API collect is callable", (await api.collectWorktreeChanges({})).changes.changedFiles[0] === "a.txt");
check("patch arena API list is callable", (await api.listArenaRuns()).ok === true);
check("patch arena API create is callable", (await api.createArenaRun({ task: "fix bug" })).run.task === "fix bug");
check("industrial project API get is callable", (await api.getIndustrialProject()).ok === true);
check("industrial project API save is callable", (await api.saveIndustrialProject({ name: "Plant", domains: ["software"] })).project.name === "Plant");
check("requirement builder API draft is callable", (await api.buildIndustrialRequirementDraft({ text: "Track API" })).draft.requirementId === "REQ-UI-1");
check("requirement builder API add is callable", (await api.addIndustrialRequirement({ title: "Track API" })).requirement.title === "Track API");
check("spec builder API package is callable", (await api.generateIndustrialSpecPackage({ requirementId: "REQ-UI-1" })).generated[0].name === "release-checklist.md");
check("requirement approval API is callable", (await api.approveIndustrialRequirement({ requirementId: "REQ-UI-1" })).approval.status === "approved");
check("domain pack API list is callable", (await api.listDomainPacks()).ok === true);
check("domain pack API install is callable", (await api.installDomainPack({ id: "software-product" })).pack.manifest.id === "software-product");
check("domain pack API enable is callable", (await api.enableDomainPack("software-product", {})).pack.enabled === true);
check("agent team API profiles is callable", (await api.listAgentProfiles({})).profiles[0].id === "product-manager");
check("agent team API plan is callable", (await api.createAgentPlan({ task: "plan software release" })).plan.task === "plan software release");
check("agent team API job is callable", (await api.createMultiAgentJob({ planId: "agent-plan-1" })).job.status === "waiting_approval");
check("toolchain API list is callable", (await api.listToolchainAdapters()).adapters[0].adapter.id === "kicad");
check("toolchain API detect accepts manual executable path", (await api.detectToolchainAdapter("freecad", { executablePath: "/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd" })).detection.installed === true);
check("toolchain API accepts KiCad manual executable path", (await api.detectToolchainAdapter("kicad", { executablePath: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli" })).detection.installed === true);
check("toolchain API accepts OpenPLC manual executable path", (await api.detectToolchainAdapter("openplc", { executablePath: "/usr/local/bin/iec2c" })).detection.installed === true);
check("toolchain API accepts IfcOpenShell manual executable path", (await api.detectToolchainAdapter("ifcopenshell", { executablePath: "/usr/local/bin/python3" })).detection.installed === true);
check("toolchain API accepts SolidWorks manual executable path payload", (await api.detectToolchainAdapter("solidworks", { executablePath: "C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe" })).detection.installed === true);
check("toolchain API accepts AVEVA connector path payload", (await api.detectToolchainAdapter("aveva", { executablePath: "/opt/company/aveva-connector" })).detection.installed === true);
check("toolchain API dry-run is callable", (await api.runToolchainAdapter({ adapterId: "kicad", task: "plan", mode: "dry-run" })).result.simulated === true);
check("quality gate API list is callable", (await api.listQualityGates()).gates[0].id === "software.npm_build");
check("quality gate API run is callable", (await api.runQualityGate({ gateId: "software.npm_build" })).run.status === "passed");
check("quality gate API approval is callable", (await api.approveQualityGate({ gateId: "bim.code_check_manual_approval", approved: true })).run.status === "passed");
check("release readiness API is callable", (await api.getReleaseReadiness({ version: "1.0.0" })).readiness.ready === true);
check("release build API is callable", (await api.buildReleasePackage({ version: "1.0.0" })).releasePackage.releaseId === "release-1");
check("release open API is callable", (await api.openReleasePackage({ version: "1.0.0" })).ok === true);
check("sample project API is callable", (await api.createIndustrialControlBoxSample({ sampleId: "industrial-control-box" })).sample.name === "Industrial Control Box Demo");
check("store API list is callable", (await api.listStore({})).items[0].id === "plugin-demo");
check("store API detail is callable", (await api.getStoreItem("plugin-demo")).detail.translatedSummary.includes("源代码"));
check("store API disable is callable", (await api.disableStoreItem("plugin-demo")).item.enabled === false);
check("store API enable is callable", (await api.enableStoreItem("plugin-demo")).item.enabled === true);
check("store API uninstall is callable", (await api.uninstallStoreItem("plugin-demo")).item.installed === false);
const silentErrorsBefore = errors.length;
const silentStoreApi = createHiCodeApi({ getStoreItem: async () => ({ ok: false, error: "商店条目不存在" }) }, { onError: (message) => errors.push(message) });
const silentStoreResult = await silentStoreApi.getStoreItemSilent("local-only");
check("silent Store lookup returns failure without user toast", silentStoreResult.ok === false && errors.length === silentErrorsBefore);
const listApi = createHiCodeApi({ listToolEvents: async () => { throw new Error("offline"); } }, { onError: (message) => errors.push(message) });
const list = await listApi.listToolEvents();
check("api wrapper preserves array fallback on error", Array.isArray(list) && list.length === 0);
check("api wrapper reports user-facing errors", errors.length >= 2);

console.log("\n[renderer] components");
check("diff renderer escapes HTML", renderUnifiedDiff({ path: "a.js", before: "<x>", after: "<y>", status: "pending" }).includes("&lt;y&gt;"));
check("diff status text reflects already-applied semantics", diffStatusText("pending") === "已应用 · 可回滚" && diffStatusText("accepted") === "已归档" && diffStatusText("rejected") === "已回滚");
check("diff panel uses archive and rollback labels", html.includes("全部归档") && html.includes("全部回滚") && bootstrap.includes("个可回滚") && bootstrap.includes("归档改动失败") && bootstrap.includes("回滚改动失败"));
check("store query options trim search", storeQueryOptions("  mcp  ").query === "mcp");
check("store Chinese summary translates English descriptions", storeChineseSummary({ summary: "Plugin for exporting source code documents" }).includes("源代码"));
check("store Chinese summary translates mixed Chinese-English descriptions", storeChineseSummary({ summary: "A runnable AI organization pack with roster and review gates — themed as 三省六部." }).includes("中文说明"));
const figmaTranslation = storeChineseSummary({ kind: "plugin", category: "design", summary: "Figma workflows for design implementation, Code Connect templates, and design system rule generation." });
check("store Chinese summary truly translates Figma detail", figmaTranslation.includes("设计落地") && figmaTranslation.includes("设计系统规则生成") && !/workflows|implementation|templates|generation/i.test(figmaTranslation));
const fallbackTranslation = storeChineseSummary({ kind: "plugin", category: "design", summary: "Figma workflows for design implementation, Code Connect templates, 和 design system rule generation." });
check("store Chinese summary handles mixed English Chinese connectors", fallbackTranslation.includes("设计落地") && fallbackTranslation.includes("设计系统规则生成") && !/workflows|implementation|templates|generation/i.test(fallbackTranslation));
check("store install action shows disable for enabled item", storeInstallActionState({ installed: true, enabled: true }).primary === "禁用");
check("store install action shows enable for disabled item", storeInstallActionState({ installed: true, enabled: false }).primary === "启用");
check("Agent capability metadata renders real agent entries", CAPABILITY_META.agents?.nav === "agentsBtn" && capabilityDescription("agents", { name: "Reviewer" }) === "本地智能体" && capabilityActionLabel("agents") === "查看");
check("job center empty list renders", renderJobListMarkup([]).includes("还没有任务"));
const failedJob = {
  id: "job-failed",
  title: "Failed build",
  status: "failed",
  source: "test",
  executor: "npm",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  error: "npm test failed",
  tasks: [],
  artifacts: [],
  gateResults: [{ id: "gate-1", gate: "tests", status: "failed", message: "1 failed", createdAt: Date.now(), artifacts: [] }],
  events: [{ id: "evt-1", type: "job.status", message: "running -> failed", createdAt: Date.now() }],
};
check("failed job renders readable error", renderJobDetailMarkup(failedJob).includes("npm test failed"));
check("failed job exposes retry action", jobActionState(failedJob).canRetry === true);
const artifactJob = {
  ...failedJob,
  id: "job-artifact",
  status: "succeeded",
  error: "",
  artifacts: [{ id: "artifact-1", type: "log", name: "build.log", path: "/tmp/build.log", createdAt: Date.now() }],
  gateResults: [{ id: "gate-2", gate: "build", status: "passed", message: "ok", createdAt: Date.now(), artifacts: ["artifact-1"] }],
};
const artifactMarkup = renderJobDetailMarkup(artifactJob);
check("artifact job renders artifact actions", artifactMarkup.includes("data-artifact-preview=\"artifact-1\"") && artifactMarkup.includes("data-artifact-open=\"artifact-1\""));
check("job summary counts artifacts and failures", summarizeJobs([failedJob, artifactJob]).failed === 1 && summarizeJobs([failedJob, artifactJob]).artifacts === 1);
check("patch arena empty list renders", renderArenaRunListMarkup([]).includes("还没有方案轮次"));
const arenaRun = {
  id: "arena-1",
  title: "Fix renderer bug",
  task: "Fix renderer bug",
  status: "ready",
  sourcePath: "/tmp/project",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  candidates: [
    {
      id: "candidate-1",
      providerId: "hicode-internal",
      providerName: "Hi Code Internal",
      status: "ready",
      patch: { path: "/tmp/changes.patch", changedFiles: ["renderer/app.js"], summary: "1 changed file" },
      score: { total: 88 },
      gateResults: [{ id: "gate-1", gate: "syntax check", status: "passed", message: "ok", createdAt: Date.now() }],
      artifacts: [{ type: "patch", name: "changes.patch", path: "/tmp/changes.patch", size: 10 }],
      logs: ["collected patch"],
      riskNotes: ["todo_only_file: File contains only TODO/placeholder content"],
      metadata: {
        definitionOfDone: {
          status: "failed",
          evidencePath: ".hicode/artifacts/definition-of-done/arena.json",
          skeleton: {
            summary: { total: 1, blocking: 1, warning: 0, info: 0 },
            findings: [{ type: "todo_only_file", severity: "blocking", message: "File contains only TODO/placeholder content: src/todo.js" }],
          },
          checklist: [{ id: "no_skeleton", title: "No skeleton delivery", status: "failed", message: "1 skeleton risk found." }],
        },
      },
    },
  ],
};
const arenaMarkup = renderArenaDetailMarkup(arenaRun, "candidate-1", "diff --git a/a b/a");
check("patch arena renders artifact actions", arenaMarkup.includes("data-arena-artifact-preview") && arenaMarkup.includes("data-arena-artifact-open"));
check("patch arena renders skeleton risk", arenaMarkup.includes("骨架风险") && renderSkeletonRisk(arenaRun.candidates[0]).includes("todo_only_file"));
check("patch arena summary counts candidates", summarizeArenaRuns([arenaRun]).candidates === 1 && summarizeArenaRuns([arenaRun]).ready === 1);
check("industrial project empty state renders", renderIndustrialProjectMarkup(null).includes(".hicode/project.json"));
const industrialProject = {
  name: "Industrial Demo",
  type: "mixed",
  domains: ["software", "mechanical"],
  requirements: [{ id: "REQ-1", requirementId: "REQ-1", title: "Traceable requirement", domain: "software", priority: "high", acceptanceCriteria: ["Criterion"], linkedArtifacts: [], linkedTests: [], riskLevel: "high", approvalRequired: true }],
  artifacts: [
    { id: "ART-1", type: "source_code", name: "Source", path: "src/", domain: "software", status: "active" },
    { id: "ART-2", type: "cad_model", name: "CAD Dry Run", path: "cad/metadata.json", domain: "mechanical", status: "draft", metadata: { simulated: true } },
  ],
  traceability: [{ id: "TRACE-1", relation: "requirement_design", fromType: "requirement", fromId: "REQ-1", toType: "design", toId: "DES-1" }],
  qualityGates: [{ id: "GATE-1", type: "test", name: "Tests", status: "passed", message: "ok" }],
};
const industrialMarkup = renderIndustrialProjectMarkup(industrialProject);
check("industrial project renders requirements artifacts and gates", industrialMarkup.includes("Traceable requirement") && industrialMarkup.includes("Source") && industrialMarkup.includes("Tests"));
check("industrial project renders artifact completeness", industrialMarkup.includes("交付物完整度") && summarizeArtifactCompleteness(industrialProject).simulated === 1);
check("industrial project summary counts traceability", summarizeIndustrialProject(industrialProject).traceability === 1);
const domainPack = {
  manifest: {
    id: "pcb-eda",
    name: "PCB EDA",
    version: "1.0.0",
    domains: ["pcb", "electrical"],
    description: "PCB pack",
    standards: [{ id: "std-1", name: "IPC-2221", version: "current", domains: ["pcb"] }],
    templates: [{ id: "tpl-1", name: "PCB Requirement Template", type: "requirement_doc", path: "templates/requirements.md" }],
    checklists: [{ id: "chk-1", name: "PCB Release Checklist", type: "release", path: "checklists/release.md", items: ["ERC", "DRC"] }],
    toolRequirements: [{ id: "tool-1", name: "EDA tool", type: "external_tool", required: false, domains: ["pcb"], dryRunSupported: true }],
    qualityGates: [{ id: "gate-1", name: "pcb drc", type: "pcb_drc", required: true, automated: false }],
    agentProfiles: [{ id: "agent-1", name: "PCB Reviewer", role: "domain_reviewer", domains: ["pcb"] }],
  },
  source: "builtin",
  installed: true,
  enabled: false,
  recommended: true,
};
check("domain pack list renders recommended pack", renderDomainPackListMarkup([domainPack], "pcb-eda").includes("推荐"));
const domainPackMarkup = renderDomainPackDetailMarkup(domainPack);
check("domain pack detail renders templates checklists and tools", domainPackMarkup.includes("PCB Requirement Template") && domainPackMarkup.includes("PCB Release Checklist") && domainPackMarkup.includes("EDA tool"));
check("domain pack summary counts enabled and templates", summarizeDomainPacks([{ ...domainPack, enabled: true }]).enabled === 1 && summarizeDomainPacks([domainPack]).templates === 1);
const agentPlan = {
  id: "agent-plan-1",
  title: "PCB release plan",
  task: "PCB release plan",
  projectType: "pcb_product_development",
  executionMode: "hybrid",
  tasks: [
    { id: "agent-task-pm", agentId: "product-manager", agentName: "Product Manager", role: "product-manager", status: "waiting_approval", executionGroup: 1, expectedArtifacts: ["requirement_doc"], reviewChecklist: [{ title: "PM review" }], reviewResult: "pending" },
    { id: "agent-task-pcb", agentId: "pcb-engineer", agentName: "PCB Engineer", role: "pcb-engineer", status: "waiting_approval", executionGroup: 3, expectedArtifacts: ["gerber", "bom"], reviewChecklist: [{ title: "PCB review" }], reviewResult: "pending" },
  ],
  qualityGates: ["pcb_erc", "pcb_drc"],
  humanApprovalPoints: ["Approve industrial artifact and tool run plan"],
  expectedArtifacts: ["requirement_doc", "gerber", "bom"],
  reviewChain: ["product-manager", "pcb-engineer", "qa-engineer"],
  route: { patchArena: false, industrialPlan: true, toolRunPlan: [{ tool: "EDA tool", domainPackId: "pcb-eda" }] },
};
check("agent profile list renders roles", renderAgentProfileListMarkup([{ id: "pcb-engineer", name: "PCB Engineer", role: "pcb-engineer", domains: ["pcb"] }]).includes("PCB Engineer"));
check("agent plan list renders selected plan", renderAgentPlanListMarkup([agentPlan], "agent-plan-1").includes("active"));
const agentPlanMarkup = renderAgentPlanMarkup(agentPlan, { id: "job-1", status: "waiting_approval" });
check("agent plan detail renders tasks reviews and tool plan", agentPlanMarkup.includes("PCB Engineer") && agentPlanMarkup.includes("评审链") && agentPlanMarkup.includes("EDA tool"));
check("agent plan summary counts approvals", summarizeAgentPlan(agentPlan).approvals === 1 && summarizeAgentPlan(agentPlan).agents === 2);
const toolchainItem = {
  adapter: {
    id: "kicad",
    name: "KiCad",
    vendor: "KiCad",
    domains: ["pcb", "electrical"],
    capabilities: [{ id: "kicad-dry-run", name: "KiCad dry-run", dryRunSupported: true, artifactTypes: ["gerber", "bom"], qualityGates: ["pcb_erc", "pcb_drc"] }],
  },
  detection: {
    installed: false,
    reason: "No command, executable path, or environment marker was found for KiCad.",
    setupHint: "Install KiCad and make kicad-cli available on PATH.",
    diagnostics: [{ id: "diag-1", severity: "warning", message: "tool missing" }],
  },
};
check("toolchain list renders installed state", renderToolchainListMarkup([toolchainItem], "kicad").includes("未安装"));
const toolchainDetail = renderToolchainDetailMarkup(toolchainItem, [{ source: "domain-pack", name: "EDA tool", packId: "pcb-eda", domains: ["pcb"], dryRunSupported: true }], { result: { adapterId: "kicad", simulated: true, artifacts: [{ name: "command-preview.sh", path: "/tmp/command-preview.sh", simulated: true }] } });
check("toolchain detail renders KiCad action, inputs, and artifacts", toolchainDetail.includes("data-tool-action=\"dry-run\"") && toolchainDetail.includes("data-tool-action=\"kicad-flow\"") && toolchainDetail.includes("data-tool-field=\"kicadProjectPath\"") && toolchainDetail.includes("command-preview.sh"));
check("toolchain summary counts missing tools and capabilities", summarizeToolchainAdapters([toolchainItem]).missing === 1 && summarizeToolchainAdapters([toolchainItem]).capabilities === 1);
const qualityGate = {
  id: "bim.code_check_manual_approval",
  name: "code check manual approval",
  type: "human_approval_gate",
  category: "approval",
  severity: "critical",
  description: "Manual approval required.",
  requiresApproval: true,
  remediation: { summary: "Record approval.", steps: ["Attach reviewer", "Confirm scope"] },
};
const qualityRun = {
  run: {
    gateId: qualityGate.id,
    result: {
      gateId: qualityGate.id,
      gateName: qualityGate.name,
      type: qualityGate.type,
      category: qualityGate.category,
      status: "requires_approval",
      severity: "critical",
      message: "Human approval is required.",
      evidence: {
        gateId: qualityGate.id,
        status: "requires_approval",
        startedAt: Date.now(),
        endedAt: Date.now(),
        stdoutSummary: "",
        stderrSummary: "",
        artifactLinks: ["/tmp/evidence.json"],
        remediation: qualityGate.remediation,
        manualApprovalRequired: true,
      },
      remediation: qualityGate.remediation,
    },
  },
};
check("quality gate list renders gates", renderQualityGateListMarkup([qualityGate], qualityGate.id).includes("data-quality-gate=\"bim.code_check_manual_approval\""));
const qualityMarkup = renderQualityGateDetailMarkup(qualityGate, qualityRun);
check("quality gate detail renders evidence and approval actions", qualityMarkup.includes("data-gate-action=\"approve\"") && qualityMarkup.includes("manualApprovalRequired") && qualityMarkup.includes("requires_approval"));
check("quality gate summary counts approvals", summarizeQualityGates([qualityGate]).approvals === 1 && summarizeQualityGates([qualityGate]).human_approval_gate === 1);
const releaseReadiness = {
  ready: false,
  version: "1.2.3",
  releasePath: "/tmp/project/releases/1.2.3",
  project: { name: "Industrial Demo", projectId: "industrial-demo", type: "mixed", domains: ["software"] },
  gateSummary: { total: 3, passed: 1, failed: 1, simulated: 1 },
  artifactSummary: { total: 2, included: 1, missing: 1, simulated: 1 },
  blockers: [{ id: "risk-failed", severity: "blocking", title: "Gate failed", message: "Build gate failed", source: "gate" }],
  warnings: [{ id: "risk-sim", severity: "warning", title: "Gate simulated", message: "CAD gate simulated", source: "gate" }],
  risks: [{ id: "risk-failed", severity: "blocking", title: "Gate failed", message: "Build gate failed", source: "gate" }],
  simulatedGates: [{ id: "gate-sim", gateId: "gate-sim", name: "CAD gate", status: "simulated", source: "industrial_project" }],
  missingArtifacts: [{ id: "artifact-missing", name: "Missing artifact", type: "cad_model", missing: true }],
  approvals: [{ id: "approval-1", status: "approved", scope: "release", decidedBy: "qa" }],
  gateResults: [{ id: "gate-1", gateId: "gate-1", name: "Build gate", status: "failed", source: "industrial_project", evidencePath: "docs/build.json" }],
  definitionOfDone: {
    status: "failed",
    skeleton: {
      summary: { total: 1, blocking: 1, warning: 0, info: 0 },
      findings: [{ type: "mock_only_production_path", severity: "blocking", message: "Production path appears mock-only: src/runtime.js" }],
    },
    checklist: [{ id: "no_skeleton", title: "No skeleton delivery", status: "failed", message: "1 skeleton risk found." }],
  },
};
const releaseMarkup = renderReleaseCenterMarkup(releaseReadiness, { manifestPath: "/tmp/project/releases/1.2.3/release-manifest.json", checksums: { "release-manifest.json": "abc" }, artifacts: [{ id: "source-code" }] });
check("release center renders blocked readiness risks and package", releaseMarkup.includes("发布被阻断") && releaseMarkup.includes("Build gate failed") && releaseMarkup.includes("release-manifest.json"));
check("release center renders Definition of Done checklist", releaseMarkup.includes("完成定义检查") && renderDefinitionOfDoneChecklist(releaseReadiness.definitionOfDone).includes("mock_only_production_path"));
check("release center summary counts gates artifacts approvals and DoD", summarizeReleaseReadiness(releaseReadiness).failed === 1 && summarizeReleaseReadiness(releaseReadiness).missing === 1 && summarizeReleaseReadiness(releaseReadiness).approvals === 1 && summarizeReleaseReadiness(releaseReadiness).dod === "failed");
const sampleMarkup = renderSampleProjectResultMarkup({
  ok: true,
  jobId: "job-sample",
  sample: { name: "Industrial Control Box Demo", artifacts: [{ simulated: true }, { simulated: false }], gates: [{ status: "simulated" }, { status: "passed" }] },
  releasePackage: { releasePath: "/tmp/releases/industrial-control-box-demo" },
});
check("sample project panel renders result summary", sampleMarkup.includes("Industrial Control Box Demo") && summarizeSampleProjectResult({ ok: true, jobId: "job-sample", sample: { artifacts: [{ simulated: true }], gates: [{ status: "not_run" }] } }).simulated === 2);
const freeCadToolchainItem = {
  adapter: {
    id: "freecad",
    name: "FreeCAD",
    vendor: "FreeCAD",
    kind: "open-source",
    domains: ["mechanical", "cad"],
    capabilities: [{ id: "enclosure_generation", name: "Control box enclosure generation", dryRunSupported: true, artifactTypes: ["cad_model"], qualityGates: ["cad_validation"] }],
  },
  detection: {
    installed: false,
    reason: "FreeCADCmd/freecadcmd not detected.",
    setupHint: "Install FreeCAD.",
    diagnostics: [{ id: "diag-freecad", severity: "warning", message: "FreeCAD not installed" }],
  },
};
const freeCadMarkup = renderToolchainDetailMarkup(freeCadToolchainItem, [], { result: { adapterId: "freecad", simulated: true, artifacts: [{ name: "freecad-run-plan.md", path: "/tmp/freecad-run-plan.md", simulated: true }], diagnostics: [{ severity: "info", message: "Dry-run only" }] } });
check("FreeCAD detail renders manual path and demo action", freeCadMarkup.includes("data-tool-field=\"executablePath\"") && freeCadMarkup.includes("data-tool-action=\"freecad-demo\""));
check("FreeCAD detail renders dry-run artifact and diagnostics", freeCadMarkup.includes("freecad-run-plan.md") && freeCadMarkup.includes("Dry-run only"));
const plcToolchainItem = {
  adapter: {
    id: "openplc",
    name: "OpenPLC / IEC 61131-3",
    vendor: "OpenPLC",
    kind: "open-source",
    domains: ["plc", "automation"],
    capabilities: [{ id: "structured_text_generation", name: "Structured Text generation", dryRunSupported: true, artifactTypes: ["plc_program"], qualityGates: ["plc_compile", "human_approval"] }],
  },
  detection: {
    installed: false,
    reason: "OpenPLC/MATIEC not detected.",
    setupHint: "Install OpenPLC or MATIEC iec2c.",
    diagnostics: [{ id: "diag-plc", severity: "warning", message: "OpenPLC not installed" }],
  },
};
const plcMarkup = renderToolchainDetailMarkup(plcToolchainItem, [], { result: { adapterId: "openplc", simulated: true, artifacts: [{ name: "plc-program.st", path: "/tmp/plc-program.st", simulated: false }, { name: "fat-checklist.md", path: "/tmp/fat-checklist.md", simulated: false }, { name: "metadata.json", path: "/tmp/metadata.json", simulated: false }], diagnostics: [{ severity: "warning", message: "PLC compile was not run" }] } });
check("OpenPLC detail renders PLC controls and safety actions", plcMarkup.includes("data-tool-action=\"plc-generate\"") && plcMarkup.includes("data-tool-action=\"plc-syntax-check\"") && plcMarkup.includes("data-tool-field=\"plcIoPoints\"") && plcMarkup.includes("不会下载到任何设备"));
check("OpenPLC detail renders ST FAT/SAT artifacts and diagnostics", plcMarkup.includes("plc-program.st") && plcMarkup.includes("fat-checklist.md") && plcMarkup.includes("PLC compile was not run"));
const bimToolchainItem = {
  adapter: {
    id: "ifcopenshell",
    name: "IfcOpenShell / IFC",
    vendor: "IfcOpenShell",
    kind: "open-source",
    domains: ["bim", "architecture"],
    capabilities: [{ id: "ifc_inspection", name: "IFC inspection", dryRunSupported: true, artifactTypes: ["ifc_model", "inspection_report"], qualityGates: ["bim_check"] }],
  },
  detection: {
    installed: false,
    reason: "IfcOpenShell not detected.",
    setupHint: "Install IfcOpenShell Python module.",
    diagnostics: [{ id: "diag-bim", severity: "warning", message: "IfcOpenShell not installed" }],
  },
};
const bimMarkup = renderToolchainDetailMarkup(bimToolchainItem, [], { result: { adapterId: "ifcopenshell", simulated: true, artifacts: [{ name: "ifc-check-plan.md", path: "/tmp/ifc-check-plan.md", simulated: true }, { name: "bim-delivery-checklist.md", path: "/tmp/bim-delivery-checklist.md", simulated: true }, { name: "metadata.json", path: "/tmp/metadata.json", simulated: true }], diagnostics: [{ severity: "warning", message: "Target standard is not declared" }] } });
check("IfcOpenShell detail renders BIM controls and inspection action", bimMarkup.includes("data-tool-action=\"bim-inspect\"") && bimMarkup.includes("data-tool-field=\"bimIfcPath\"") && bimMarkup.includes("data-tool-field=\"bimTargetStandard\"") && bimMarkup.includes("不会自动给出法规符合结论"));
check("IfcOpenShell detail renders BIM dry-run artifacts and diagnostics", bimMarkup.includes("ifc-check-plan.md") && bimMarkup.includes("bim-delivery-checklist.md") && bimMarkup.includes("Target standard is not declared"));
const solidWorksToolchainItem = {
  adapter: {
    id: "solidworks",
    name: "SolidWorks Bridge",
    vendor: "Dassault Systemes",
    kind: "commercial",
    domains: ["solidworks", "mechanical", "cad"],
    capabilities: [{ id: "macro_generation", name: "Macro generation", dryRunSupported: true, artifactTypes: ["architecture_doc"], qualityGates: ["cad_validation", "human_approval"] }],
  },
  detection: {
    installed: false,
    reason: "unsupported_platform: SolidWorks bridge requires Windows.",
    setupHint: "Use Windows with licensed SolidWorks.",
    diagnostics: [{ id: "diag-solidworks", severity: "warning", code: "solidworks.unsupported_platform", message: "unsupported_platform" }],
  },
};
const solidWorksMarkup = renderToolchainDetailMarkup(solidWorksToolchainItem, [], { result: { adapterId: "solidworks", simulated: true, artifacts: [{ name: "solidworks-run-plan.md", path: "/tmp/solidworks-run-plan.md", simulated: true }, { name: "macro-template.bas", path: "/tmp/macro-template.bas", simulated: true }, { name: "metadata.json", path: "/tmp/metadata.json", simulated: true }], diagnostics: [{ severity: "warning", message: "external_required outputs need manual execution" }] } });
check("SolidWorks detail renders bridge controls and generation action", solidWorksMarkup.includes("data-tool-action=\"solidworks-bridge\"") && solidWorksMarkup.includes("data-tool-field=\"solidworksPartName\"") && solidWorksMarkup.includes("SLDWORKS.exe 路径") && solidWorksMarkup.includes("unsupported_platform"));
check("SolidWorks detail renders bridge artifacts and authorization boundary", solidWorksMarkup.includes("macro-template.bas") && solidWorksMarkup.includes("external_required") && solidWorksMarkup.includes("授权 SolidWorks"));
const avevaToolchainItem = {
  adapter: {
    id: "aveva",
    name: "AVEVA Engineering Bridge",
    vendor: "AVEVA",
    kind: "commercial",
    domains: ["process_chemical", "energy", "manufacturing"],
    capabilities: [{ id: "engineering_data_exchange_plan", name: "Engineering data exchange plan", dryRunSupported: true, artifactTypes: ["inspection_report"], qualityGates: ["process_safety", "documentation_review", "human_approval"] }],
  },
  detection: {
    installed: false,
    reason: "No AVEVA enterprise connector profile is configured.",
    setupHint: "Configure enterprise-approved connector profile.",
    diagnostics: [{ id: "diag-aveva", severity: "warning", code: "aveva.connection.not_configured", message: "not configured" }],
  },
};
const avevaMarkup = renderToolchainDetailMarkup(avevaToolchainItem, [], { result: { adapterId: "aveva", simulated: true, artifacts: [{ name: "aveva-integration-plan.md", path: "/tmp/aveva-integration-plan.md", simulated: true }, { name: "tag-list-template.csv", path: "/tmp/tag-list-template.csv", simulated: true }, { name: "sync-risk-checklist.md", path: "/tmp/sync-risk-checklist.md", simulated: true }, { name: "metadata.json", path: "/tmp/metadata.json", simulated: true }], diagnostics: [{ severity: "warning", message: "manual_approval_required before real sync" }] } });
check("AVEVA detail renders profile controls and dry-run action", avevaMarkup.includes("data-tool-action=\"aveva-plan\"") && avevaMarkup.includes("data-tool-field=\"avevaProfileName\"") && avevaMarkup.includes("data-tool-field=\"avevaAllowedOperations\"") && avevaMarkup.includes("不要输入密码或 token"));
check("AVEVA detail renders templates and risk checklist", avevaMarkup.includes("tag-list-template.csv") && avevaMarkup.includes("sync-risk-checklist.md") && avevaMarkup.includes("manual_approval_required"));

const makeView = () => {
  const classes = new Set();
  return {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
};
const main = { className: "" };
const home = makeView();
const git = makeView();
let activeNav = "";
showRoute({ main, views: { home, git }, route: "git", mainClass: "git", activeNav: "gitBtn", setActiveNav: (id) => { activeNav = id; } });
check("router sets main class", main.className === "git");
check("router hides inactive views", home.classList.contains("hidden") && !git.classList.contains("hidden"));
check("router updates active nav", activeNav === "gitBtn");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) process.exit(1);
