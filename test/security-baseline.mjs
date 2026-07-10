import fs from "node:fs";
import path from "node:path";

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

const root = process.cwd();
const main = fs.readFileSync(path.join(root, "electron", "main.mjs"), "utf8");
const nativeOpenService = fs.readFileSync(path.join(root, "electron", "services", "native-open-service.mjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
const bash = fs.readFileSync(path.join(root, "src", "tools", "bash.ts"), "utf8");
const mcp = fs.readFileSync(path.join(root, "src", "mcp.ts"), "utf8");
const processEnvService = fs.readFileSync(path.join(root, "src", "process-env.ts"), "utf8");
const ipcUtils = fs.readFileSync(path.join(root, "electron", "ipc", "ipc-utils.mjs"), "utf8");
const ipcRegister = fs.readFileSync(path.join(root, "electron", "ipc", "register-ipc-handlers.mjs"), "utf8");
const storeSchema = fs.readFileSync(path.join(root, "docs", "store-catalog.schema.json"), "utf8");
const domainPacks = fs.readFileSync(path.join(root, "src", "domain-packs.ts"), "utf8");
const agentTeam = fs.readFileSync(path.join(root, "src", "agent-team.ts"), "utf8");
const industrialTools = fs.readFileSync(path.join(root, "src", "industrial-tool-adapters.ts"), "utf8");
const qualityGates = fs.readFileSync(path.join(root, "src", "quality-gates.ts"), "utf8");
const releaseBuilder = fs.readFileSync(path.join(root, "src", "release-builder.ts"), "utf8");
const definitionOfDone = fs.readFileSync(path.join(root, "src", "definition-of-done.ts"), "utf8");
const patchArenaService = fs.readFileSync(path.join(root, "electron", "services", "patch-arena-service.mjs"), "utf8");
const releaseCenterPanel = fs.readFileSync(path.join(root, "renderer", "components", "release-center-panel.js"), "utf8");
const patchArenaPanel = fs.readFileSync(path.join(root, "renderer", "components", "patch-arena-panel.js"), "utf8");
const industrialProjectPanel = fs.readFileSync(path.join(root, "renderer", "components", "industrial-project-panel.js"), "utf8");
const sampleProject = fs.readFileSync(path.join(root, "src", "industrial-control-box-sample.ts"), "utf8");
const sampleProjectService = fs.readFileSync(path.join(root, "electron", "services", "sample-project-service.mjs"), "utf8");
const freeCadAdapter = fs.readFileSync(path.join(root, "src", "freecad-adapter.ts"), "utf8");
const kiCadAdapter = fs.readFileSync(path.join(root, "src", "kicad-adapter.ts"), "utf8");
const plcAdapter = fs.readFileSync(path.join(root, "src", "plc-openplc-adapter.ts"), "utf8");
const bimAdapter = fs.readFileSync(path.join(root, "src", "bim-ifc-adapter.ts"), "utf8");
const solidWorksAdapter = fs.readFileSync(path.join(root, "src", "solidworks-bridge-adapter.ts"), "utf8");
const avevaAdapter = fs.readFileSync(path.join(root, "src", "aveva-bridge-adapter.ts"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const verifyScript = fs.readFileSync(path.join(root, "scripts", "verify.mjs"), "utf8");
const productionAuditScript = fs.readFileSync(path.join(root, "scripts", "audit-production.mjs"), "utf8");
const syncVersionScript = fs.readFileSync(path.join(root, "scripts", "sync-version.mjs"), "utf8");
const commands = fs.readFileSync(path.join(root, "src", "commands.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "src", "runtime.ts"), "utf8");
const runtimeProtocol = fs.readFileSync(path.join(root, "src", "runtime-protocol.ts"), "utf8");
const runtimeEventStore = fs.readFileSync(path.join(root, "src", "runtime-event-store.ts"), "utf8");
const turnStateMachine = fs.readFileSync(path.join(root, "src", "turn-state-machine.ts"), "utf8");
const recovery = fs.readFileSync(path.join(root, "src", "recovery.ts"), "utf8");
const llm = fs.readFileSync(path.join(root, "src", "llm.ts"), "utf8");
const workspaceService = fs.readFileSync(path.join(root, "electron", "services", "workspace-service.mjs"), "utf8");
const electronE2e = fs.readFileSync(path.join(root, "tests", "electron-e2e", "run.mjs"), "utf8");

console.log("\n[security] runtime baseline");
check("contextIsolation remains enabled", /contextIsolation:\s*true/.test(main));
check("nodeIntegration remains disabled", /nodeIntegration:\s*false/.test(main));
check("renderer sandbox enabled", /sandbox:\s*true/.test(main));
check("renderer-created windows are denied", main.includes("setWindowOpenHandler") && main.includes('action: "deny"'));
check("untrusted renderer navigation is blocked", main.includes('webContents.on("will-navigate"') && main.includes("event.preventDefault()"));
check("renderer CSP exists", html.includes("Content-Security-Policy"));
check("CSP blocks remote script by default", /script-src 'self'/.test(html));
check("desktop runtime disables slash-command process exit", main.includes("allowProcessExit: false") && runtime.includes("allowProcessExit: opts.allowProcessExit !== false") && commands.includes("env.allowProcessExit === false"));
check("native app launcher only intercepts known app aliases", nativeOpenService.includes("if (!alias) return null") && !nativeOpenService.includes("alias || rawName"));
check("desktop bridge filters terminal tool chrome from chat output", main.includes("filterRuntimeOutput") && main.includes("shouldForwardRuntimeOutput") && main.includes("/^⏺\\s/") && main.includes("/^[┌│└]/") && main.includes("/^members:/i"));
check("complete model context stays out of legacy timeline logs", main.includes('normalized.type !== "message:appended"') && main.includes("complete model context"));
check("runtime emits versioned protocol envelopes", runtime.includes("createRuntimeProtocolEvent") && runtime.includes("runtimeProtocol") && runtimeProtocol.includes("RUNTIME_PROTOCOL_VERSION = 1") && runtimeProtocol.includes("validateRuntimeProtocolEvent"));
check("runtime protocol events are append-only persisted", runtime.includes("appendRuntimeProtocolEvent") && runtimeEventStore.includes("RUNTIME_EVENT_STORE_DIR") && runtimeEventStore.includes("replayRuntimeProtocolEvents"));
check("approval decisions are durably correlated", runtimeProtocol.includes('"approval.resolved"') && runtimeProtocol.includes("approval.resolved requires requestId") && runtime.includes("requestId: approvalId"));
check("turn recovery blocks unknown side effects", turnStateMachine.includes('recoveryAction: "inspect_tool"') && turnStateMachine.includes("unknown completion or side effects") && recovery.includes("legacy task has no durable tool-side-effect evidence"));
check("turn recovery never reuses prior approval", turnStateMachine.includes('recoveryAction: "retry_with_approval"') && turnStateMachine.includes("retry must request a new human decision"));
check("app version is synced from package metadata", main.includes("version: app.getVersion()") && main.includes("getVersion: () => app.getVersion()") && syncVersionScript.includes("app.getVersion()") && syncVersionScript.includes("appVersionEl.textContent"));
check("preload does not expose ipcRenderer", !/ipcRenderer[,}]/.test(preload) && !/ipcRenderer:\s*ipcRenderer/.test(preload));
check("preload does not expose generic invoke", !/invoke:\s*\(/.test(preload));
check("preload validates string parameters", preload.includes("requireString(") && preload.includes("checkedInvoke("));
check("preload normalizes object parameters", preload.includes("optionalObject(") && preload.includes("stringArray("));
check("preload exposes bounded image attachment API", preload.includes('attachImage: (payload) => safeInvoke("attach-image", optionalObject(payload))'));
check("preload exposes Industrial Project API", [
  "getIndustrialProjectSchema",
  "getIndustrialProject",
  "validateIndustrialProject",
  "saveIndustrialProject",
  "buildIndustrialRequirementDraft",
  "addIndustrialRequirement",
  "updateIndustrialRequirementCriteria",
  "generateIndustrialArtifactPlan",
  "generateIndustrialTestPlan",
  "generateIndustrialSpecPackage",
  "approveIndustrialRequirement",
  "addIndustrialArtifact",
  "addIndustrialTraceability",
  "addIndustrialGateResult",
].every((name) => preload.includes(`${name}:`)));
check("preload normalizes Industrial Project payloads", [
  'validateIndustrialProject: (payload) => safeInvoke("industrial-project:validate", optionalObject(payload))',
  'saveIndustrialProject: (payload) => safeInvoke("industrial-project:save", optionalObject(payload))',
  'buildIndustrialRequirementDraft: (payload) => safeInvoke("industrial-requirement:draft", optionalObject(payload))',
  'addIndustrialRequirement: (payload) => safeInvoke("industrial-requirement:add", optionalObject(payload))',
  'updateIndustrialRequirementCriteria: (payload) => safeInvoke("industrial-requirement:criteria:update", optionalObject(payload))',
  'generateIndustrialArtifactPlan: (payload) => safeInvoke("industrial-requirement:artifact-plan", optionalObject(payload))',
  'generateIndustrialTestPlan: (payload) => safeInvoke("industrial-requirement:test-plan", optionalObject(payload))',
  'generateIndustrialSpecPackage: (payload) => safeInvoke("industrial-requirement:spec-package", optionalObject(payload))',
  'approveIndustrialRequirement: (payload) => safeInvoke("industrial-requirement:approve", optionalObject(payload))',
  'addIndustrialArtifact: (payload) => safeInvoke("industrial-project:artifact:add", optionalObject(payload))',
  'addIndustrialTraceability: (payload) => safeInvoke("industrial-project:traceability:add", optionalObject(payload))',
  'addIndustrialGateResult: (payload) => safeInvoke("industrial-project:gate:add", optionalObject(payload))',
].every((needle) => preload.includes(needle)));
check("preload exposes Domain Pack API", [
  "listDomainPacks",
  "getDomainPack",
  "validateDomainPack",
  "installDomainPack",
  "updateDomainPack",
  "enableDomainPack",
  "disableDomainPack",
  "uninstallDomainPack",
  "recommendDomainPacks",
].every((name) => preload.includes(`${name}:`)));
check("preload validates Domain Pack packId arguments", preload.includes('checkedInvoke("domain-pack:get", packId, "packId")') && preload.includes('safeInvoke("domain-pack:enable", checked.value, optionalObject(payload))'));
check("preload exposes Agent Team API", [
  "listAgentProfiles",
  "getAgentProfile",
  "createAgentPlan",
  "listAgentPlans",
  "getAgentPlan",
  "createMultiAgentJob",
].every((name) => preload.includes(`${name}:`)));
check("preload validates Agent Team id arguments", preload.includes('checkedInvoke("agent-team:profile:get", profileId, "profileId")') && preload.includes('checkedInvoke("agent-team:plan:get", planId, "planId")'));
check("preload exposes Industrial Toolchain API", [
  "listToolchainAdapters",
  "detectToolchainAdapter",
  "getToolchainCapabilities",
  "validateToolchainAdapter",
  "runToolchainAdapter",
].every((name) => preload.includes(`${name}:`)));
check("preload validates Industrial Toolchain adapter ids", preload.includes('requireString(adapterId, "adapterId")') && preload.includes('safeInvoke("toolchain:detect", checked.value, optionalObject(payload))') && preload.includes('checkedInvoke("toolchain:capabilities", adapterId, "adapterId")'));
check("preload exposes Quality Gate API", [
  "listQualityGates",
  "runQualityGate",
  "approveQualityGate",
].every((name) => preload.includes(`${name}:`)));
check("preload normalizes Quality Gate payloads", preload.includes('runQualityGate: (payload) => safeInvoke("quality-gate:run", optionalObject(payload))') && preload.includes('approveQualityGate: (payload) => safeInvoke("quality-gate:approve", optionalObject(payload))'));
check("preload exposes Release Builder API", [
  "getReleaseReadiness",
  "buildReleasePackage",
  "openReleasePackage",
].every((name) => preload.includes(`${name}:`)));
check("preload normalizes Release Builder payloads", preload.includes('getReleaseReadiness: (payload) => safeInvoke("release:readiness", optionalObject(payload))') && preload.includes('buildReleasePackage: (payload) => safeInvoke("release:build", optionalObject(payload))') && preload.includes('openReleasePackage: (payload) => safeInvoke("release:open", optionalObject(payload))'));
check("preload exposes Sample Project API", preload.includes('createIndustrialControlBoxSample: (payload) => safeInvoke("sample:industrial-control-box:create", optionalObject(payload))'));
check("IPC handlers use normalized wrapper", ipcUtils.includes("createIpcRegistrar") && /ipcMain\.handle\(channel/.test(ipcUtils));
check("main process delegates IPC registration", main.includes("registerIpcHandlers({") && ipcRegister.includes("registerSecurityIpc"));
check("workspace image attachments are confined to workspace", workspaceService.includes("attachImage(payload") && workspaceService.includes(".hicode") && workspaceService.includes("attachments") && workspaceService.includes("safeNewWorkspacePath") && workspaceService.includes("safeExistingWorkspacePath"));
check("workspace image attachments restrict formats and size", workspaceService.includes("MAX_ATTACHMENT_BYTES") && workspaceService.includes("image/png") && workspaceService.includes("image/webp") && workspaceService.includes("只支持 PNG、JPG、GIF、WebP"));
check("model image rejection returns actionable guidance", llm.includes("当前模型或服务商接口拒绝了图片输入") && llm.includes("hasImageContent(messages)"));
check("main process wires Release Builder service", main.includes("createReleaseService") && ipcRegister.includes("registerReleaseIpc"));
check("main process wires Sample Project service", main.includes("createSampleProjectService") && ipcRegister.includes("registerSampleProjectIpc") && ipcRegister.includes("sampleProject"));
check("no direct IPC handle registrations in main", (main.match(/ipcMain\.handle\(/g) || []).length === 0);
check("bash tool filters inherited env", bash.includes("filterEnv(") && !/env:\s*process\.env/.test(bash));
check("safe child env service denies inherited secrets by default", processEnvService.includes("SAFE_CHILD_ENV_KEYS") && processEnvService.includes("SENSITIVE_ENV_KEY_RE") && processEnvService.includes("redactEnvForLogs"));
check("MCP server process uses safe child env", mcp.includes("buildSafeChildEnv") && !mcp.includes("...process.env"));
check("FreeCAD execution uses safe child env", freeCadAdapter.includes("buildSafeChildEnv") && !freeCadAdapter.includes("...process.env, HICODE_FREECAD_OUTPUT_DIR"));
check("Electron E2E isolates HOME and USERPROFILE", electronE2e.includes("safeElectronEnv(isolatedHome)") && electronE2e.includes("env.HOME = isolatedHome") && electronE2e.includes("env.USERPROFILE = isolatedHome") && !electronE2e.includes('"PATH", "HOME"'));
check("Electron E2E rejects inherited secret variables", electronE2e.includes("sensitiveKeys") && electronE2e.includes("TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY") && electronE2e.includes("assert.deepEqual(environment.sensitiveKeys, [])"));
check("Electron E2E enters chat through a local command", electronE2e.includes('await input.fill("/help")') && !electronE2e.includes('await input.fill("Electron responsive smoke")'));
check("Store rejects remote local paths", main.includes("validateLocalInstallPath") && main.includes("远程 catalog 不得引用本机路径"));
check("Store rejects remote sourceRoot paths", main.includes("plugin manifest.sourceRoot") && main.includes("validateLocalInstallPath(item.install?.manifest?.sourceRoot"));
check("Store rejects remote sourcePath paths", main.includes("skill.sourcePath") && main.includes("validateLocalInstallPath(item.install?.skill?.sourcePath"));
check("remote downloads require HTTPS", main.includes("远程下载必须使用 HTTPS") && /startsWith\("http:"\).*isTrustedLocalStoreSource/s.test(main));
check("Store download filename is sanitized", main.includes("safeDownloadFilename") && main.includes("path.basename"));
check("Store download retries fallback mirrors", main.includes("downloadCandidateUrls") && main.includes("已尝试") && main.includes("github-search"));
check("Store uninstall is restricted to store dir", main.includes("safeRemoveStorePath") && main.includes("不在 Hi Code 商店安全目录内"));
check("disabled Store capabilities remain manageable", main.includes("status: record.enabled === false ? \"disabled\"") && main.includes("enabled: record.enabled !== false") && !main.includes("record?.kind === kind && record.enabled !== false"));
check("Store schema reserves sha256", storeSchema.includes('"sha256"') && storeSchema.includes("^[a-fA-F0-9]{64}$"));
check("Store schema reserves signature", storeSchema.includes('"signature"') && storeSchema.includes('"signatureAlgorithm"'));
check("unverified download requires confirmation", main.includes("needUserConfirmation") && main.includes("allowUnverifiedDownload"));
check("preload exposes managed Store actions", [
  "getStoreItem",
  "enableStoreItem",
  "disableStoreItem",
  "uninstallStoreItem",
].every((name) => preload.includes(`${name}:`)));
check("Domain Packs reject automatic scripts", domainPacks.includes("postinstall") && domainPacks.includes("scripts") && domainPacks.includes("is not allowed"));
check("Domain Packs require HTTPS for remote installs", domainPacks.includes("remote domain pack sourceUrl must use HTTPS"));
check("Domain Packs reserve hash or signature", domainPacks.includes("remote domain pack requires sha256 or signature"));
check("Domain Packs reject remote local paths", domainPacks.includes("sourcePath") && domainPacks.includes("sourceRoot") && domainPacks.includes("is not allowed for remote packs"));
check("Domain Packs restrict install paths to safe root", domainPacks.includes("assertInside(this.safeRoot") && domainPacks.includes("domain pack path escapes safe root"));
check("Agent Team store restricts paths to safe root", agentTeam.includes("AgentTeamStore requires safeRoot") && agentTeam.includes("agent team path escapes safe root"));
check("Agent Team marks industrial tools as dry-run only", agentTeam.includes("dryRunOnly: true") && agentTeam.includes("No real industrial tool execution"));
check("Industrial Tool adapters restrict artifact paths", industrialTools.includes("industrial tool path escapes workspace") && industrialTools.includes("assertInside(workspace"));
check("Industrial Tool adapters require approval for execution", industrialTools.includes("external industrial tool execution requires explicit user approval"));
check("Industrial Tool adapters mark dry-run artifacts simulated", industrialTools.includes("simulated: true") && industrialTools.includes("industrial-tool-dry-run"));
check("Industrial Tool adapters keep generic real execution blocked", industrialTools.includes("real industrial tool execution is unavailable for this adapter in Sprint 6G"));
check("Industrial Tool adapters include FreeCAD execution path", industrialTools.includes("runFreeCadAdapterTask") && industrialTools.includes("freeCadAdapterManifest"));
check("FreeCAD adapter writes dry-run plan artifacts", freeCadAdapter.includes("freecad-run-plan.md") && freeCadAdapter.includes("expected-artifacts.json"));
check("Industrial Tool adapters include KiCad execution path", industrialTools.includes("runKiCadAdapterTask") && industrialTools.includes("kiCadAdapterManifest"));
check("KiCad adapter writes dry-run plan artifacts", kiCadAdapter.includes("kicad-run-plan.md") && kiCadAdapter.includes("expected-input.json") && kiCadAdapter.includes("expected-artifacts.json") && kiCadAdapter.includes("command-preview.sh"));
check("KiCad adapter confines outputs to project artifacts", kiCadAdapter.includes("KiCad output path escapes workspace") && kiCadAdapter.includes("KiCad output path must stay under .hicode/artifacts"));
check("KiCad adapter records simulated dry-run gates", kiCadAdapter.includes('projectDiagnostics(resolved, "simulated")') && kiCadAdapter.includes("kicad.dry_run") && kiCadAdapter.includes('"simulated"'));
check("Industrial Tool adapters include OpenPLC execution path", industrialTools.includes("runOpenPlcAdapterTask") && industrialTools.includes("openPlcAdapterManifest"));
check("OpenPLC adapter writes required engineering artifacts", ["plc-program.st", "io-map.csv", "safety-interlocks.md", "fat-checklist.md", "sat-checklist.md", "metadata.json"].every((needle) => plcAdapter.includes(needle)));
check("OpenPLC adapter writes compile dry-run artifacts", ["plc-compile-plan.md", "command-preview.sh", "expected-artifacts.json"].every((needle) => plcAdapter.includes(needle)));
check("OpenPLC adapter confines outputs to project artifacts", plcAdapter.includes("PLC output path escapes workspace") && plcAdapter.includes("PLC output path must stay under .hicode/artifacts"));
check("OpenPLC adapter requires approval and forbids device/network access", plcAdapter.includes("requires explicit user approval") && plcAdapter.includes("forbids network/device access") && plcAdapter.includes("deviceDownloadPerformed: false"));
check("OpenPLC adapter keeps missing compiler gate not_run", plcAdapter.includes("plc.compile.not_run") && plcAdapter.includes('"not_run"'));
check("Industrial Tool adapters include IfcOpenShell execution path", industrialTools.includes("runBimIfcAdapterTask") && industrialTools.includes("bimIfcAdapterManifest") && industrialTools.includes("detectBimIfcAdapter"));
check("IfcOpenShell adapter writes BIM dry-run artifacts", ["ifc-check-plan.md", "expected-input.json", "expected-artifacts.json", "command-preview.sh"].every((needle) => bimAdapter.includes(needle)));
check("IfcOpenShell adapter writes inspection report and summary", bimAdapter.includes("bim-inspection-report.json") && bimAdapter.includes("bim-summary.md"));
check("IfcOpenShell adapter confines outputs and IFC paths", bimAdapter.includes("BIM output path escapes workspace") && bimAdapter.includes("BIM output path must stay under .hicode/artifacts") && bimAdapter.includes("BIM IFC path escapes workspace"));
check("IfcOpenShell adapter forbids code compliance conclusions", bimAdapter.includes("complianceConclusion: null") && bimAdapter.includes("does not conclude compliance with local building codes"));
check("IfcOpenShell dry-run gates are simulated", bimAdapter.includes("bim.ifc.dry_run") && bimAdapter.includes('"simulated"'));
check("Industrial Tool adapters include SolidWorks bridge path", industrialTools.includes("runSolidWorksBridgeAdapterTask") && industrialTools.includes("solidWorksBridgeAdapterManifest") && industrialTools.includes("detectSolidWorksBridgeAdapter"));
check("SolidWorks bridge detects unsupported platforms", solidWorksAdapter.includes("unsupported_platform") && solidWorksAdapter.includes("requires Windows"));
check("SolidWorks bridge writes required dry-run artifacts", ["solidworks-run-plan.md", "solidworks-bridge-plan.md", "macro-template.bas", "expected-artifacts.json", "manual-setup.md", "metadata.json"].every((needle) => solidWorksAdapter.includes(needle)));
check("SolidWorks bridge marks external artifacts explicitly", solidWorksAdapter.includes("external_required") && solidWorksAdapter.includes("externalRequired") && solidWorksAdapter.includes("generated: false") && solidWorksAdapter.includes("simulated: false"));
check("SolidWorks bridge confines outputs to project artifacts", solidWorksAdapter.includes("SolidWorks output path escapes workspace") && solidWorksAdapter.includes("SolidWorks output path must stay under .hicode/artifacts"));
check("SolidWorks bridge requires commercial authorization", solidWorksAdapter.includes("explicit human authorization") && solidWorksAdapter.includes("commercialLicenseRequired: true"));
check("SolidWorks bridge does not execute COM automatically", solidWorksAdapter.includes("Hi Code does not execute this macro automatically") && solidWorksAdapter.includes("external_required in Sprint 6F"));
check("Industrial Tool adapters include AVEVA bridge path", industrialTools.includes("runAvevaBridgeAdapterTask") && industrialTools.includes("avevaBridgeAdapterManifest") && industrialTools.includes("detectAvevaBridgeAdapter"));
check("AVEVA bridge rejects plaintext credentials", avevaAdapter.includes("plaintext credentials are not allowed") && avevaAdapter.includes("FORBIDDEN_CREDENTIAL_FIELDS"));
check("AVEVA bridge writes required dry-run templates", ["aveva-integration-plan.md", "data-exchange-schema.json", "tag-list-template.csv", "equipment-list-template.csv", "line-list-template.csv", "document-register-template.csv", "sync-risk-checklist.md", "metadata.json"].every((needle) => avevaAdapter.includes(needle)));
check("AVEVA bridge marks enterprise outputs explicitly", avevaAdapter.includes("external_required") && avevaAdapter.includes("manual_approval_required") && avevaAdapter.includes("simulated: true"));
check("AVEVA bridge confines outputs to project artifacts", avevaAdapter.includes("AVEVA output path escapes workspace") && avevaAdapter.includes("AVEVA output path must stay under .hicode/artifacts"));
check("AVEVA bridge blocks real connector execution", avevaAdapter.includes("never connects to a real AVEVA system") && avevaAdapter.includes("external_required in Sprint 6G"));
check("AVEVA bridge checks HTTPS endpoint and allowed operations", avevaAdapter.includes("aveva.endpoint.non_https") && avevaAdapter.includes("AVEVA requested operation is not allowed by profile"));
check("Quality Gate Runner defines required gate types", ["command_gate", "file_exists_gate", "schema_gate", "artifact_integrity_gate", "security_gate", "human_approval_gate", "adapter_gate", "documentation_gate"].every((needle) => qualityGates.includes(needle)));
check("Quality Gate Runner defines release gate statuses", ["passed", "failed", "warning", "skipped", "simulated", "not_run", "requires_approval"].every((needle) => qualityGates.includes(`"${needle}"`)));
check("Quality Gate command execution avoids shell syntax", qualityGates.includes("shell: false") && qualityGates.includes("hasShellSyntax") && qualityGates.includes("filteredEnv"));
check("Quality Gate Runner confines artifact paths", qualityGates.includes("gate path escapes workspace") && qualityGates.includes("safePath(workspace"));
check("Quality Gate simulated adapter is not passed", qualityGates.includes('simulated ? "simulated"') && qualityGates.includes("cannot pass release gate"));
check("Release Builder confines release and artifact paths", releaseBuilder.includes("releasePath") && releaseBuilder.includes("escapes workspace") && releaseBuilder.includes("assertInside(this.workspacePath"));
check("Release Builder writes required package files", ["release-manifest.json", "release-notes.md", "evidence-report.md", "checksums.sha256"].every((needle) => releaseBuilder.includes(needle)));
check("Release Builder blocks failed and approval gates", releaseBuilder.includes("RELEASE_GATE_BLOCKING_STATUSES") && releaseBuilder.includes('"failed"') && releaseBuilder.includes('"requires_approval"') && releaseBuilder.includes("release is not ready"));
check("Release Builder marks simulated without passing", releaseBuilder.includes("SIMULATED / DRY-RUN EVIDENCE") && releaseBuilder.includes('"simulated"') && releaseBuilder.includes("simulatedGates"));
check("Definition of Done detects skeleton delivery risks", ["empty_file", "todo_only_file", "placeholder_content", "mock_only_production_path", "fake_pass_gate", "simulated_artifact_marked_real"].every((needle) => definitionOfDone.includes(needle)));
check("Definition of Done writes durable evidence", definitionOfDone.includes(".hicode") && definitionOfDone.includes("definition-of-done") && definitionOfDone.includes("writeEvidence"));
check("Release Builder runs Definition of Done and blocks release", releaseBuilder.includes("runDefinitionOfDone") && releaseBuilder.includes("definitionOfDoneToEvidence") && releaseBuilder.includes("Definition of Done failed"));
check("Patch Arena runs skeleton detector for candidates", patchArenaService.includes("runDefinitionOfDone") && patchArenaService.includes("skeleton detector") && patchArenaService.includes("definition-of-done.json"));
check("Renderer exposes DoD, skeleton risk, and artifact completeness", releaseCenterPanel.includes("renderDefinitionOfDoneChecklist") && patchArenaPanel.includes("renderSkeletonRisk") && industrialProjectPanel.includes("summarizeArtifactCompleteness"));
check("Release Builder records Job-facing release package artifact path", fs.readFileSync(path.join(root, "electron", "services", "release-service.mjs"), "utf8").includes("type: \"release_package\"") && fs.readFileSync(path.join(root, "electron", "services", "release-service.mjs"), "utf8").includes("release.readiness"));
check("Industrial Control Box sample confines paths to workspace", sampleProject.includes("sample project path escapes workspace") && sampleProject.includes("safeJoin(workspace") && sampleProject.includes("removeKnownSamplePath"));
check("Industrial Control Box sample uses real adapters and Release Builder", sampleProject.includes("runAdapterTask") && sampleProject.includes("adapterId: \"freecad\"") && sampleProject.includes("adapterId: \"kicad\"") && sampleProject.includes("adapterId: \"openplc\"") && sampleProject.includes("new ReleaseBuilder"));
check("Industrial Control Box sample writes required real artifacts", ["requirements.md", "requirements.json", "plc-program.st", "io-map.csv", "safety-interlocks.md", "system-bom.csv", "release-manifest.json"].every((needle) => sampleProject.includes(needle)));
check("Industrial Control Box sample marks dry-run and not_run evidence", sampleProject.includes("result.simulated") && sampleProject.includes("artifact.simulated") && sampleProject.includes("\"not_run\""));
check("Sample Project service records Job Center artifact and gate evidence", sampleProjectService.includes("jobStore.addArtifact") && sampleProjectService.includes("jobStore.addGateResult") && sampleProjectService.includes("sample.release.built"));
check("release:check uses package-manager independent verifier", pkg.scripts["release:check"] === "node scripts/verify.mjs --release");
check("production audit uses package-lock and HTTPS registry", pkg.scripts["audit:prod"] === "node scripts/audit-production.mjs --audit-level=high" && productionAuditScript.includes("package-lock.json") && productionAuditScript.includes('registry.protocol !== "https:"'));
check("package version is on v0.6 alpha development line", /^0\.6\.0-alpha\.\d+$/.test(pkg.version));
check("verify script includes version sync", verifyScript.includes('"sync:version"') && verifyScript.includes("scripts/sync-version.mjs"));
check("verify script includes build", verifyScript.includes('run("build"'));
check("verify script includes syntax check", verifyScript.includes("runSyntaxCheck()") && verifyScript.includes("electron/main.mjs"));
check("verify script includes feature tests", verifyScript.includes('"test:feature"') && verifyScript.includes("test/feature-tests.mjs"));
check("verify script includes runtime protocol tests", verifyScript.includes('"test:runtime-protocol"') && verifyScript.includes("test/runtime-protocol-tests.mjs"));
check("verify script includes typed runtime store tests", verifyScript.includes('"test:runtime-stores"') && verifyScript.includes("test/runtime-store-tests.mjs"));
check("verify script includes runtime store integration tests", verifyScript.includes('"test:runtime-store-integration"') && verifyScript.includes("test/runtime-store-integration-tests.mjs"));
check("verify script includes turn recovery tests", verifyScript.includes('"test:turn-recovery"') && verifyScript.includes("test/turn-recovery-tests.mjs"));
check("verify script includes Electron compatibility tests", verifyScript.includes('"test:electron-compatibility"') && verifyScript.includes("test/electron-compatibility-tests.mjs"));
check("verify script includes service tests", verifyScript.includes('"test:services"'));
check("verify script includes job center tests", verifyScript.includes('"test:jobs"'));
check("verify script includes provider tests", verifyScript.includes('"test:providers"'));
check("verify script includes worktree tests", verifyScript.includes('"test:worktrees"'));
check("verify script includes patch arena tests", verifyScript.includes('"test:arena"'));
check("verify script includes industrial project tests", verifyScript.includes('"test:industrial"'));
check("verify script includes domain pack tests", verifyScript.includes('"test:domain-packs"'));
check("verify script includes agent team tests", verifyScript.includes('"test:agent-team"'));
check("verify script includes industrial tool tests", verifyScript.includes('"test:industrial-tools"'));
check("verify script includes quality gate tests", verifyScript.includes('"test:quality-gates"'));
check("verify script includes release builder tests", verifyScript.includes('"test:release-builder"'));
check("verify script includes sample project tests", verifyScript.includes('"test:samples"'));
check("verify script includes Definition of Done tests", verifyScript.includes('"test:dod"'));
check("verify script includes program control tests", verifyScript.includes('"test:program"') && verifyScript.includes("test/program-control-tests.mjs"));
check("verify script includes usage persistence tests", verifyScript.includes('"test:usage"') && verifyScript.includes("test/usage-store-tests.mjs"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
