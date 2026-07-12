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
const gitCore = fs.readFileSync(path.join(root, "src", "git.ts"), "utf8");
const gitCollaboration = fs.readFileSync(path.join(root, "src", "git-collaboration.ts"), "utf8");
const gitService = fs.readFileSync(path.join(root, "electron", "services", "git-service.mjs"), "utf8");
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
const modelProvider = fs.readFileSync(path.join(root, "src", "model-provider.ts"), "utf8");
const openAIResponsesProvider = fs.readFileSync(path.join(root, "src", "openai-responses-provider.ts"), "utf8");
const anthropicMessagesProvider = fs.readFileSync(path.join(root, "src", "anthropic-messages-provider.ts"), "utf8");
const ollamaChatProvider = fs.readFileSync(path.join(root, "src", "ollama-chat-provider.ts"), "utf8");
const providerHttpTransport = fs.readFileSync(path.join(root, "src", "provider-http-transport.ts"), "utf8");
const agent = fs.readFileSync(path.join(root, "src", "agent.ts"), "utf8");
const context = fs.readFileSync(path.join(root, "src", "context.ts"), "utf8");
const council = fs.readFileSync(path.join(root, "src", "agents", "council.ts"), "utf8");
const manager = fs.readFileSync(path.join(root, "src", "agents", "manager.ts"), "utf8");
const workspaceService = fs.readFileSync(path.join(root, "electron", "services", "workspace-service.mjs"), "utf8");
const secretStoreService = fs.readFileSync(path.join(root, "electron", "services", "secret-store-service.mjs"), "utf8");
const secretReferences = fs.readFileSync(path.join(root, "src", "secret-references.ts"), "utf8");
const configSource = fs.readFileSync(path.join(root, "src", "config.ts"), "utf8");
const editorService = fs.readFileSync(path.join(root, "electron", "services", "editor-service.mjs"), "utf8");
const terminalService = fs.readFileSync(path.join(root, "electron", "services", "terminal-service.mjs"), "utf8");
const previewService = fs.readFileSync(path.join(root, "electron", "services", "preview-service.mjs"), "utf8");
const attachmentStore = fs.readFileSync(path.join(root, "src", "attachment-store.ts"), "utf8");
const attachmentMaterializer = fs.readFileSync(path.join(root, "src", "attachment-materializer.ts"), "utf8");
const commandRegistry = fs.readFileSync(path.join(root, "src", "command-registry.ts"), "utf8");
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
check("Responses remote endpoints require HTTPS", openAIResponsesProvider.includes('url.protocol !== "https:"') && openAIResponsesProvider.includes('url.protocol === "http:" && loopback') && openAIResponsesProvider.includes("provider_endpoint_insecure"));
check("Responses requests disable provider-side storage", openAIResponsesProvider.includes("store: false") && openAIResponsesProvider.includes('persistence: "store-disabled"'));
check("Responses credentials stay out of descriptors and persisted events", !openAIResponsesProvider.includes("metadata: { apiKey") && openAIResponsesProvider.includes("redactSensitiveText") === false && modelProvider.includes("redactSensitiveText(original"));
check("Responses tool streams reject unannounced items", openAIResponsesProvider.includes("provider_tool_sequence_invalid") && openAIResponsesProvider.includes("function-call item was not announced"));
check("native provider endpoints require HTTPS or loopback HTTP", providerHttpTransport.includes('url.protocol !== "https:"') && providerHttpTransport.includes('url.protocol === "http:" && loopback') && providerHttpTransport.includes("provider_endpoint_insecure"));
check("native provider response readers are bounded", providerHttpTransport.includes("MAX_JSON_BYTES") && providerHttpTransport.includes("MAX_STREAM_BYTES") && providerHttpTransport.includes("MAX_STREAM_BUFFER_BYTES") && providerHttpTransport.includes("provider_stream_too_large"));
check("Anthropic credentials stay in request headers only", anthropicMessagesProvider.includes('"x-api-key"') && !anthropicMessagesProvider.includes("metadata: { apiKey") && anthropicMessagesProvider.includes('credentialStorage: "secret-reference-or-environment"'));
check("Anthropic tool streams require announced content blocks", anthropicMessagesProvider.includes("provider_tool_sequence_invalid") && anthropicMessagesProvider.includes("delta has no announced content block"));
check("Ollama raw thinking is disabled and never emitted", ollamaChatProvider.includes("think: false") && ollamaChatProvider.includes("message.thinking is intentionally discarded") && !ollamaChatProvider.includes("sink.emit({ type: \"reasoning"));
check("Ollama placeholder key is not sent as authorization", ollamaChatProvider.includes("NO_KEY_PLACEHOLDER") && ollamaChatProvider.includes("key !== NO_KEY_PLACEHOLDER"));
check("app version is synced from package metadata", main.includes("version: app.getVersion()") && main.includes("getVersion: () => app.getVersion()") && syncVersionScript.includes("app.getVersion()") && syncVersionScript.includes("appVersionEl.textContent"));
check("preload does not expose ipcRenderer", !/ipcRenderer[,}]/.test(preload) && !/ipcRenderer:\s*ipcRenderer/.test(preload));
check("preload does not expose generic invoke", !/invoke:\s*\(/.test(preload));
check("preload validates string parameters", preload.includes("requireString(") && preload.includes("checkedInvoke("));
check("preload normalizes object parameters", preload.includes("optionalObject(") && preload.includes("stringArray("));
check("preload exposes read-only credential status without a secret getter", preload.includes('getCredentialStatus: () => safeInvoke("config:credential-status")') && !preload.includes("getSecret:"));
check("preload exposes bounded typed attachment API", preload.includes("function runtimeInput") && preload.includes("attachmentIds.length > 8") && preload.includes('attachFile: (payload) => safeInvoke("attach-file", optionalObject(payload))') && preload.includes('removeAttachment: (id) => checkedInvoke("attachment:remove"'));
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
check("editor preload validates bounded path content and revision payloads", preload.includes("function editorOpenRequest") && preload.includes("function editorSaveRequest") && preload.includes("expectedRevision must be a valid SHA-256 revision") && preload.includes('safeInvoke("editor:file:save", checked.value)'));
check("editor service confines paths and rejects stale writes", editorService.includes("resolveInCwd(requestedPath)") && editorService.includes('failure("path_outside_workspace"') && editorService.includes('code: "file_conflict"') && editorService.includes("beforeReplace.file.revision !== expectedRevision"));
check("editor service uses bounded UTF-8 snapshots and atomic sibling replacement", editorService.includes("MAX_EDITOR_BYTES") && editorService.includes('TextDecoder("utf-8", { fatal: true })') && editorService.includes('openSync(tempPath, "wx"') && editorService.includes("renameSync(tempPath, current.target)"));
check("editor IPC remains centralized and typed", ipcRegister.includes("registerEditorIpc") && !/ipcMain\.handle\(["']editor:file:/.test(main));
check("terminal preload validates session, dimensions, and bounded input", preload.includes("function terminalSessionId") && preload.includes("function terminalSize") && preload.includes("function terminalInput") && preload.includes("64 * 1024"));
check("terminal IPC remains centralized without raw PTY exposure", ipcRegister.includes("registerTerminalIpc") && !/ipcMain\.handle\(["']terminal:/.test(main) && !preload.includes("node-pty"));
check("terminal start requires runtime policy authorization before spawn", terminalService.indexOf("await authorize(") < terminalService.indexOf("pty.spawn(") && main.includes("requestPermission(currentRuntime.execEnv.perms"));
check("terminal sessions are owner-scoped and close with their window", terminalService.includes("session.ownerId !== owner.id") && terminalService.includes('owner.once("destroyed"') && main.includes("closeAllForOwner(ownerId"));
check("terminal environment is minimized and persisted logs omit content", terminalService.includes("buildSafeChildEnv") && terminalService.includes("HISTFILE: os.devNull") && terminalService.includes("sanitizeTerminalLog") && !/env:\s*process\.env/.test(terminalService));
check("terminal output and transcript are bounded", terminalService.includes("MAX_TERMINAL_OUTPUT_EVENT_BYTES") && terminalService.includes("MAX_TERMINAL_TRANSCRIPT_BYTES") && terminalService.includes("utf8Tail"));
check("terminal cleanup covers process groups, descendants, and Windows trees", terminalService.includes("collectUnixDescendants") && terminalService.includes('process.kill(-pid, "SIGTERM")') && terminalService.includes('"/T", "/F"'));
check("preview preload validates URLs ids selectors and events", preload.includes("function previewOpenRequest") && preload.includes("function previewId") && preload.includes("function previewSelectors") && preload.includes("function previewEvent") && preload.includes('safeInvoke("preview:verify"'));
check("preview IPC remains centralized and typed", ipcRegister.includes("registerPreviewIpc") && !/ipcMain\.handle\(["']preview:/.test(main));
check("preview accepts only loopback HTTP without credentials or fragments", previewService.includes('url.protocol !== "http:"') && previewService.includes("LOOPBACK_HOSTS") && previewService.includes("url.username || url.password") && previewService.includes("if (url.hash)"));
check("preview WebContents are isolated from Node preload and DevTools", previewService.includes("contextIsolation: true") && previewService.includes("sandbox: true") && previewService.includes("nodeIntegration: false") && previewService.includes("nodeIntegrationInWorker: false") && previewService.includes("webviewTag: false") && previewService.includes("devTools: false") && !/webPreferences:\s*\{[^}]*preload:/s.test(previewService));
check("preview denies popups navigation downloads permissions and external resources", previewService.includes('return { action: "deny" }') && previewService.includes('contents.on("will-navigate"') && previewService.includes('contents.on("will-redirect"') && previewService.includes('previewSession.on("will-download"') && previewService.includes("setPermissionRequestHandler") && previewService.includes("setPermissionCheckHandler") && previewService.includes("onBeforeRequest"));
check("preview lifecycle is owner and workspace scoped", previewService.includes("record.ownerId !== owner.id") && previewService.includes("record.workspace !== resolveWorkspace") && previewService.includes('record.owner.once("destroyed"') && main.includes("preview?.closeAllForOwner") && main.includes('preview?.closeAll?.("app_quit")'));
check("preview evidence is bounded owner-only and cannot fake pass", previewService.includes("MAX_PREVIEW_SCREENSHOT_BYTES") && previewService.includes("mode: 0o600") && previewService.includes('status = checks.every((check) => check.status === "passed") ? "passed" : "failed"') && previewService.includes("writeJsonAtomic"));
check("attachments use app-data content addressing without source paths", main.includes("ATTACHMENT_STORE_DIR") && main.includes("new FileAttachmentStore") && attachmentStore.includes("sha256") && attachmentStore.includes("blobKey") && !attachmentStore.includes("sourcePath"));
check("attachment store enforces owner permissions and integrity", attachmentStore.includes("0o700") && attachmentStore.includes("0o600") && attachmentStore.includes("attachment_integrity_failed") && attachmentStore.includes("isSymbolicLink"));
check("attachment capability checks happen before transport", agent.includes("materializeAttachmentMessages") && attachmentMaterializer.indexOf("negotiateModelProviderCapabilities") < attachmentMaterializer.indexOf("store.read(record.id)"));
check("command registry fails closed on alias and route conflicts", commandRegistry.includes("command_alias_conflict") && commandRegistry.includes("command_route_conflict") && runtime.includes("commandRegistry.resolve"));
check("workspace image compatibility path still restricts data URL formats and size", workspaceService.includes("MAX_ATTACHMENT_BYTES") && workspaceService.includes("image\\/(?:png|jpe?g|gif|webp)") && workspaceService.includes("parseImageDataUrl"));
check("workspace config writes are delegated to the secure store", workspaceService.includes("secretStore.persistConfig(parsed)") && workspaceService.includes("secretStore.readConfigForRenderer()") && !workspaceService.includes("fs.writeFileSync(configPath"));
check("secret references are versioned validated and separate from values", secretReferences.includes('SECRET_REFERENCE_PREFIX = "hicode-secret:v1"') && secretReferences.includes("validateSecretRef") && secretReferences.includes("findPlaintextConfigSecrets") && secretReferences.includes("prepareConfigForSecretPersistence"));
check("desktop secrets use Electron safeStorage and reject Linux basic_text", main.includes("safeStorage") && main.includes("desktopSecretStore.migrateLegacyConfig()") && secretStoreService.includes("safeStorage.encryptString") && secretStoreService.includes("safeStorage.decryptString") && secretStoreService.includes('backend === "basic_text"'));
check("credential migration is atomic and reversibly encrypted", secretStoreService.includes("rollbackMigration") && secretStoreService.includes("migration-journal.json") && secretStoreService.includes("restoreOptionalFile") && secretStoreService.includes("atomicWritePrivate") && secretStoreService.includes("ciphertext: encrypt(JSON.stringify(snapshot))"));
check("desktop config loading rejects legacy plaintext after migration attempt", main.includes("allowLegacyPlaintext: false") && configSource.includes("options.allowLegacyPlaintext !== false"));
check("CLI credential fallback is environment-only and profile specific", configSource.includes("profileApiKeyEnvName(profileKey)") && secretReferences.includes("HICODE_PROFILE_") && !secretStoreService.includes("masterPassword"));
check("model image rejection returns actionable guidance", llm.includes("当前模型或服务商接口拒绝了图片输入") && llm.includes("hasImageContent(messages)"));
check("model provider descriptors exclude credentials", modelProvider.includes('credentialStorage: "secret-reference-or-environment"') && !/metadata:\s*\{[^}]*apiKey/s.test(modelProvider));
check("model provider errors redact authorization and secret fields", modelProvider.includes("redactSensitiveText") && modelProvider.includes("sanitizeDetails") && modelProvider.includes("authorization\\s*:\\s*bearer"));
check("model capability negotiation happens before adapter execution", modelProvider.indexOf("negotiateModelProviderCapabilities(adapter.descriptor, requirements)") < modelProvider.indexOf("await adapter.run({"));
check("production orchestration uses the model provider facade", agent.includes("streamModelProfile") && context.includes("completeModelProfile") && council.includes("completeModelProfile") && manager.includes("completeModelProfile") && !agent.includes("streamChat("));
check("main process wires Release Builder service", main.includes("createReleaseService") && ipcRegister.includes("registerReleaseIpc"));
check("main process wires Sample Project service", main.includes("createSampleProjectService") && ipcRegister.includes("registerSampleProjectIpc") && ipcRegister.includes("sampleProject"));
check("no direct IPC handle registrations in main", (main.match(/ipcMain\.handle\(/g) || []).length === 0);
check("bash tool filters inherited env", bash.includes("filterEnv(") && !/env:\s*process\.env/.test(bash));
check("safe child env service denies inherited secrets by default", processEnvService.includes("SAFE_CHILD_ENV_KEYS") && processEnvService.includes("SENSITIVE_ENV_KEY_RE") && processEnvService.includes("redactEnvForLogs"));
check("Git commands use minimized child environments", gitCore.includes("buildSafeChildEnv") && gitCollaboration.includes("buildSafeChildEnv") && !/env:\s*process\.env/.test(gitCore) && !/env:\s*process\.env/.test(gitCollaboration));
check("GitHub collaboration strips ambient credentials and interactive prompts", gitCollaboration.includes('GIT_TERMINAL_PROMPT: "0"') && gitCollaboration.includes('GH_PROMPT_DISABLED: "1"') && !gitCollaboration.includes("GITHUB_TOKEN") && !gitCollaboration.includes("SSH_AUTH_SOCK"));
check("branch switching and Pull Request creation reject dirty worktrees", (gitCollaboration.match(/requireCleanWorktree\(repo\.root, runGit\)/g) || []).length >= 3 && gitCollaboration.includes('code: "dirty_worktree"'));
check("Pull Request creation requires a fresh main-process confirmation", gitService.indexOf("await authorizePullRequest(") < gitService.indexOf("collaboration.createPullRequest(") && main.includes("async function authorizePullRequest") && main.includes("不会自动合并"));
check("Git delivery forbids force push and automatic merge", gitCollaboration.includes('"push", "--set-upstream", "origin", "HEAD"') && !/--force|\bmerge\b/.test(gitCollaboration));
check("Git preload validates bounded branch and Pull Request payloads", preload.includes("function gitBranchRequest") && preload.includes("function gitPullRequest") && preload.includes('safeInvoke("git:pr:create", checked.value)'));
check("failed and pending CI conclusions remain truthful", gitCollaboration.includes('return "failed"') && gitCollaboration.includes('return "pending"') && gitCollaboration.includes('counts.failed ? "failed" : counts.pending ? "pending"'));
check("MCP server process uses safe child env", mcp.includes("buildSafeChildEnv") && !mcp.includes("...process.env"));
check("FreeCAD execution uses safe child env", freeCadAdapter.includes("buildSafeChildEnv") && !freeCadAdapter.includes("...process.env, HICODE_FREECAD_OUTPUT_DIR"));
check("Electron E2E isolates HOME and USERPROFILE", electronE2e.includes("safeElectronEnv(isolatedHome)") && electronE2e.includes("env.HOME = isolatedHome") && electronE2e.includes("env.USERPROFILE = isolatedHome") && !electronE2e.includes('"PATH", "HOME"'));
check("Electron E2E rejects inherited secret variables", electronE2e.includes("sensitiveKeys") && electronE2e.includes("TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY") && electronE2e.includes("assert.deepEqual(environment.sensitiveKeys, [])"));
check("Electron E2E verifies secure credential persistence or fail-closed behavior", electronE2e.includes("verifySecureCredentialStorage") && electronE2e.includes("contains plaintext credential") && electronE2e.includes("secure storage is unavailable"));
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
check("verify script includes authoritative runtime control tests", verifyScript.includes('"test:runtime-control"') && verifyScript.includes("test/runtime-control-tests.mjs"));
check("verify script includes protected Git collaboration tests", verifyScript.includes('"test:git-collaboration"') && verifyScript.includes("test/git-collaboration-tests.mjs"));
check("verify script includes secret reference and safeStorage tests", verifyScript.includes('"test:secrets"') && verifyScript.includes('"test:secret-store"'));
check("verify script includes typed runtime store tests", verifyScript.includes('"test:runtime-stores"') && verifyScript.includes("test/runtime-store-tests.mjs"));
check("verify script includes runtime store integration tests", verifyScript.includes('"test:runtime-store-integration"') && verifyScript.includes("test/runtime-store-integration-tests.mjs"));
check("verify script includes turn recovery tests", verifyScript.includes('"test:turn-recovery"') && verifyScript.includes("test/turn-recovery-tests.mjs"));
check("verify script includes Electron compatibility tests", verifyScript.includes('"test:electron-compatibility"') && verifyScript.includes("test/electron-compatibility-tests.mjs"));
check("verify script includes service tests", verifyScript.includes('"test:services"'));
check("verify script includes job center tests", verifyScript.includes('"test:jobs"'));
check("verify script includes provider tests", verifyScript.includes('"test:providers"'));
check("verify script includes model provider tests", verifyScript.includes('"test:model-providers"') && verifyScript.includes("test/model-provider-tests.mjs"));
check("verify script includes OpenAI Responses conformance tests", verifyScript.includes('"test:openai-responses"') && verifyScript.includes("test/openai-responses-provider-tests.mjs"));
check("verify script includes Anthropic and Ollama conformance tests", verifyScript.includes('"test:anthropic-ollama"') && verifyScript.includes("test/anthropic-ollama-provider-tests.mjs"));
check("verify script includes attachment and command contracts", verifyScript.includes('"test:attachment-command"') && verifyScript.includes("test/attachment-command-registry-tests.mjs"));
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
check("verify script includes typed App Shell tests", verifyScript.includes('"test:app-shell"') && verifyScript.includes("test/app-shell-tests.ts"));
check("verify script includes typed workspace shell tests", verifyScript.includes('"test:workspace-shell"') && verifyScript.includes("test/workspace-shell-tests.ts"));
check("verify script includes conflict-safe editor workbench tests", verifyScript.includes('"test:editor-workbench"') && verifyScript.includes("test/editor-workbench-tests.ts"));
check("verify script includes integrated terminal tests", verifyScript.includes('"test:terminal-service"') && verifyScript.includes("test/terminal-service-tests.mjs") && verifyScript.includes('"test:terminal-renderer"') && verifyScript.includes("test/terminal-workbench-tests.ts"));
check("verify script includes secure app preview tests", verifyScript.includes('"test:preview-service"') && verifyScript.includes("test/preview-service-tests.mjs") && verifyScript.includes('"test:preview-renderer"') && verifyScript.includes("test/preview-workbench-tests.ts"));
check("verify script includes program control tests", verifyScript.includes('"test:program"') && verifyScript.includes("test/program-control-tests.mjs"));
check("verify script includes usage persistence tests", verifyScript.includes('"test:usage"') && verifyScript.includes("test/usage-store-tests.mjs"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
