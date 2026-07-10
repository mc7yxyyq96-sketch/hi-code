// Hi Code — Electron main process. Reuses the compiled agent core (dist/) and
// projects typed runtime events to the renderer over the existing IPC surface.
process.env.FORCE_COLOR = "1"; // make chalk emit ANSI even without a TTY

import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { loadConfig, defaultProfile, HICODE_DIR } from "../dist/config.js";
import { createRuntime, buildSystemPrompt } from "../dist/runtime.js";
import { setSpinnerEnabled } from "../dist/ui.js";
import { initMcp } from "../dist/mcp.js";
import { listSessions, deleteSession, loadSession, replaySessionMessages } from "../dist/session-store.js";
import { DiffService } from "../dist/diff-service.js";
import { readRecoverableTasks, readRecoverableTasksFromLogs } from "../dist/recovery.js";
import { RuntimeJobQueue } from "../dist/job-queue.js";
import { JobStore } from "../dist/job-center.js";
import { WorktreeRunner } from "../dist/worktree-runner.js";
import { PatchArenaStore } from "../dist/patch-arena.js";
import {
  gitWorkflowStatus,
  gitFileDiff,
  gitStage,
  gitUnstage,
  gitGenerateCommitMessage,
  gitCommit,
} from "../dist/git.js";
import { registerIpcHandlers } from "./ipc/register-ipc-handlers.mjs";
import { createRuntimeService } from "./services/runtime-service.mjs";
import { createQueueService } from "./services/queue-service.mjs";
import { createMcpService } from "./services/mcp-service.mjs";
import { createStoreService } from "./services/store-service.mjs";
import { createJobService } from "./services/job-service.mjs";
import { createProviderService } from "./services/provider-service.mjs";
import { createWorktreeService } from "./services/worktree-service.mjs";
import { createPatchArenaService } from "./services/patch-arena-service.mjs";
import { createIndustrialProjectService } from "./services/industrial-project-service.mjs";
import { createDomainPackManager, createDomainPackService } from "./services/domain-pack-service.mjs";
import { createAgentTeamService, createAgentTeamStore } from "./services/agent-team-service.mjs";
import { createIndustrialToolRegistry, createIndustrialToolService } from "./services/industrial-tool-service.mjs";
import { createQualityGateService } from "./services/quality-gate-service.mjs";
import { createReleaseService } from "./services/release-service.mjs";
import { createSampleProjectService } from "./services/sample-project-service.mjs";
import { createGitService } from "./services/git-service.mjs";
import { createDiffIpcService } from "./services/diff-service.mjs";
import { createWorkspaceService, modelCapabilityHint } from "./services/workspace-service.mjs";
import { createSecurityService, redactSensitive } from "./services/security-service.mjs";
import { createAppInfoService } from "./services/app-info-service.mjs";
import { createUsageService } from "./services/usage-service.mjs";
import { recordUsage } from "../dist/usage-store.js";
import { RuntimeEventBus } from "../dist/runtime-event-sink.js";
import { connectAssistantTextOutput } from "../dist/runtime-client-adapters.js";
import { openMacApp, parseOpenAppRequest } from "./services/native-open-service.mjs";
import { BUILTIN_STORE_CATALOG } from "./store-catalog.mjs";

// Data dir (~/.hicode, or a legacy ~/.vibe if that's what exists) is resolved
// in src/config.ts so the CLI and the desktop app always agree on it.
const CONFIG_PATH = path.join(HICODE_DIR, "config.json");
const AUTH_PATH = path.join(HICODE_DIR, "auth.json");
const STORE_PATH = path.join(HICODE_DIR, "store.json");
const STORE_DIR = path.join(HICODE_DIR, "store");
const LOG_DIR = path.join(HICODE_DIR, "logs");
const JOB_CENTER_PATH = path.join(HICODE_DIR, "jobs", "job-center.json");
const PROVIDER_CONFIG_PATH = path.join(HICODE_DIR, "providers", "providers.json");
const PROVIDER_RUN_DIR = path.join(HICODE_DIR, "providers", "runs");
const WORKTREE_RUNNER_DIR = path.join(HICODE_DIR, "worktrees");
const PATCH_ARENA_PATH = path.join(HICODE_DIR, "patch-arena", "arena-runs.json");
const PATCH_ARENA_ARTIFACT_DIR = path.join(HICODE_DIR, "patch-arena", "artifacts");
const DOMAIN_PACK_DIR = path.join(HICODE_DIR, "domain-packs");
const AGENT_TEAM_DIR = path.join(HICODE_DIR, "agent-team");
const CODEX_DIR = path.join(os.homedir(), ".codex");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;
let runtime = null;
let cwd = os.homedir();
let mainServices = null;
const askResolvers = new Map();
let askSeq = 0;
const toolEvents = [];
const diffService = new DiffService(() => cwd);
const worktreeRunner = new WorktreeRunner({ safeRoot: WORKTREE_RUNNER_DIR });
const patchArenaStore = new PatchArenaStore({ storePath: PATCH_ARENA_PATH });
const domainPackManager = createDomainPackManager({ safeRoot: DOMAIN_PACK_DIR });
const agentTeamStore = createAgentTeamStore({ safeRoot: AGENT_TEAM_DIR });
const industrialToolRegistry = createIndustrialToolRegistry();
const jobStore = new JobStore({
  storePath: JOB_CENTER_PATH,
  allowedArtifactRoots: [HICODE_DIR, () => cwd],
});
const MAX_TOOL_EVENTS = 500;
const legacyStdoutBridgeEnabled = process.env.HICODE_LEGACY_STDOUT_BRIDGE !== "0";
const runtimeEventBus = new RuntimeEventBus({
  onListenerError: (error, event) => appendRuntimeLog({
    id: `runtime-listener-${Date.now()}`,
    type: "runtime-listener:error",
    title: "Runtime event listener failed",
    summary: error?.message || String(error),
    payload: { sourceEventId: event.id, sourceEventType: event.type },
    createdAt: Date.now(),
  }),
});
runtimeEventBus.subscribe(handleRuntimeEvent);
connectAssistantTextOutput(runtimeEventBus, {
  write: (text) => send("output", text),
});
const storeItemCache = new Map();
const runtimeJobStatusMirror = new Map();
let activeRuntimeJobCenterId = null;
const inputQueue = new RuntimeJobQueue(
  async (job) => runRuntimeQueueJob(job),
  (state) => handleInputQueueState(state),
  (err) => send("output", `error: ${err?.message ?? err}\n`),
  { storePath: path.join(HICODE_DIR, "jobs", "runtime-jobs.json"), historyLimit: 100 },
);

const STORE_SOURCES = [
  {
    id: "all",
    name: "全部源",
    region: "All",
    catalogURL: "aggregate://all",
    npmRegistry: "https://registry.npmmirror.com",
    note: "聚合内置推荐、本机 Codex 缓存、国内 NPM 镜像、Gitee、GitHub 和官方源。",
  },
  {
    id: "builtin-cn",
    name: "内置源（中国友好）",
    region: "CN",
    catalogURL: "builtin://catalog",
    npmRegistry: "https://registry.npmmirror.com",
    note: "无需联网即可浏览；NPM 类 MCP 使用 npmmirror。",
  },
  {
    id: "codex-local",
    name: "本机 Codex 缓存",
    region: "Local",
    catalogURL: "local://codex",
    npmRegistry: "https://registry.npmmirror.com",
    note: "扫描 ~/.codex 中已经下载的 Skills 和 Plugins，可导入到 Hi Code。",
  },
  {
    id: "npm-mirror",
    name: "NPM MCP 镜像",
    region: "CN",
    catalogURL: "npm://mcp",
    npmRegistry: "https://registry.npmmirror.com",
    note: "从 npmmirror 搜索 MCP server 包，安装时自动使用国内 registry。",
  },
  {
    id: "gitee-mirror",
    name: "Gitee 镜像源",
    region: "CN",
    catalogURL: "https://gitee.com/hicode-ai/skill-store/raw/main/catalog.json", // 预留:gitee 镜像建立后生效,
    npmRegistry: "https://registry.npmmirror.com",
    note: "预留给国内镜像 catalog。",
  },
  {
    id: "github-search",
    name: "GitHub 搜索源",
    region: "Global",
    catalogURL: "github://search",
    npmRegistry: "https://registry.npmjs.org",
    note: "直接搜索 GitHub 仓库，安装时下载仓库 zip 到本地缓存。",
  },
  {
    id: "github-cn",
    name: "GitHub 国内代理",
    region: "CN",
    catalogURL: "github://search-cn",
    npmRegistry: "https://registry.npmmirror.com",
    note: "搜索 GitHub 仓库，下载时优先使用国内 GitHub 代理。",
  },
  {
    id: "github-catalog",
    name: "GitHub Catalog",
    region: "Global",
    catalogURL: "https://raw.githubusercontent.com/mc7yxyyq96-sketch/hi-code/main/store/catalog.json",
    npmRegistry: "https://registry.npmjs.org",
    note: "从 GitHub raw catalog 拉取官方/社区条目。",
  },
];


function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function rememberToolEvent(event) {
  toolEvents.push(event);
  while (toolEvents.length > MAX_TOOL_EVENTS) toolEvents.shift();
  appendRuntimeLog(event);
  send("tool-event", event);
}

function appendRuntimeLog(event) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `events-${day}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(redactSensitive(event)) + "\n", { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  } catch {
    /* logging must never break the agent loop */
  }
}

function normalizeRuntimeEvent(event = {}) {
  return {
    id: event.id || `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: event.sessionId || runtime?.sessionId || "",
    turnId: event.turnId || "",
    type: event.type || "tool:output",
    tool: event.tool,
    title: event.title || event.type || "Event",
    summary: event.summary,
    status: event.status,
    path: event.path,
    diffId: event.diffId,
    payload: event.payload,
    createdAt: event.createdAt || Date.now(),
    updatedAt: event.updatedAt,
  };
}

function handleRuntimeEvent(event) {
  const normalized = normalizeRuntimeEvent(event);
  let diffChanged = false;

  if (normalized.type === "diff:created" && normalized.payload?.diff) {
    const diff = {
      ...normalized.payload.diff,
      sessionId: normalized.payload.diff.sessionId || normalized.sessionId,
      turnId: normalized.payload.diff.turnId || normalized.turnId,
      status: normalized.payload.diff.status || "pending",
      createdAt: normalized.payload.diff.createdAt || normalized.createdAt,
    };
    diffService.upsert(diff);
    diffChanged = true;
  }

  if (normalized.type === "diff:updated") {
    const id = normalized.diffId || normalized.payload?.diffId;
    const status = normalized.payload?.status;
    if (id && status && diffService.updateStatus(id, status).ok) diffChanged = true;
  }

  // Deltas are already durable in the protocol store and project directly to
  // chat. Keeping every token in the legacy timeline/log would duplicate data.
  if (normalized.type !== "assistant:delta") {
    rememberToolEvent(normalized);
    recordRuntimeEventForActiveJob(normalized);
  }
  if (normalized.type === "turn:done") {
    try {
      recordUsage({
        durationMs: Number(normalized.payload?.durationMs) || 0,
        model: runtime?.cfg ? defaultProfile(runtime.cfg).model : undefined,
        reasoningLevel: runtime?.cfg?.reasoningLevel,
      });
    } catch {
      /* usage tracking must never break runtime events */
    }
  }
  if (diffChanged) send("diffs-changed", listDiffs());
  return normalized.id;
}

function recordRuntimeEventForActiveJob(event) {
  if (!activeRuntimeJobCenterId) return;
  try {
    jobStore.appendJobEvent(activeRuntimeJobCenterId, {
      type: `runtime.${event.type}`,
      message: event.summary || event.title || event.type,
      actor: event.tool || "hicode-runtime",
      data: event,
      now: event.createdAt || Date.now(),
    });
    const diff = event.payload?.diff;
    if (event.type === "diff:created" && diff?.path) {
      jobStore.addArtifact(activeRuntimeJobCenterId, {
        type: "diff",
        path: diff.absPath || diff.path,
        name: diff.path,
        producedBy: { executor: event.tool || "hicode-runtime" },
        metadata: { diffId: diff.id, status: diff.status || "pending" },
        now: diff.createdAt || event.createdAt || Date.now(),
      });
    }
  } catch (err) {
    appendRuntimeLog({
      id: `job-event-${Date.now()}`,
      type: "job-center:error",
      title: "Job Center event append failed",
      summary: err?.message || String(err),
      createdAt: Date.now(),
    });
  }
}

function sendInputQueueState(state = inputQueue.state()) {
  send("runtime-queue", {
    running: state.running ? publicJobState(state.running) : null,
    queued: state.queued.map(publicJobState),
    history: (state.history || []).map(publicJobState),
  });
}

function handleInputQueueState(state = inputQueue.state()) {
  sendInputQueueState(state);
  syncRuntimeJobsToJobCenter(state);
}

function publicJobState(job) {
  return {
    id: job.id,
    jobCenterId: jobCenterIdFromRuntimeJob(job),
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    summary: summarizeQueuedInput(job.input),
  };
}

function syncRuntimeJobsToJobCenter(state) {
  activeRuntimeJobCenterId = jobCenterIdFromRuntimeJob(state.running);
  for (const job of [state.running, ...(state.queued || []), ...(state.history || [])].filter(Boolean)) {
    const jobCenterId = jobCenterIdFromRuntimeJob(job);
    if (!jobCenterId) continue;
    const mappedStatus = runtimeStatusToJobStatus(job.status);
    const mirrorKey = `${job.id}:${mappedStatus}`;
    if (runtimeJobStatusMirror.get(job.id) === mirrorKey) continue;
    try {
      const current = jobStore.getJob(jobCenterId);
      if (!current || current.status === mappedStatus) {
        runtimeJobStatusMirror.set(job.id, mirrorKey);
        continue;
      }
      jobStore.updateJob(jobCenterId, {
        status: mappedStatus,
        error: job.error,
        now: job.finishedAt || job.startedAt || job.queuedAt,
      });
      jobStore.appendJobEvent(jobCenterId, {
        type: "runtime.queue.status",
        message: `Runtime queue job ${job.id} is ${job.status}`,
        actor: "runtime_queue",
        data: { runtimeJobId: job.id, runtimeStatus: job.status },
        now: job.finishedAt || job.startedAt || Date.now(),
      });
      runtimeJobStatusMirror.set(job.id, mirrorKey);
    } catch (err) {
      appendRuntimeLog({
        id: `job-sync-${Date.now()}`,
        type: "job-center:error",
        title: "Job Center runtime sync failed",
        summary: err?.message || String(err),
        createdAt: Date.now(),
      });
    }
  }
}

function runtimeStatusToJobStatus(status) {
  return {
    queued: "queued",
    running: "running",
    done: "succeeded",
    error: "failed",
    canceled: "cancelled",
  }[status] || "queued";
}

function jobCenterIdFromRuntimeJob(job) {
  const id = job?.metadata?.jobCenterId;
  return typeof id === "string" ? id : null;
}

function summarizeQueuedInput(input) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function listToolEvents() {
  return [...toolEvents];
}

function listDiffs() {
  return diffService.list();
}

function acceptDiff(id) {
  const result = diffService.accept(id);
  if (result.ok) emitDiffStatusEvent(result.diff, "accepted", "accept", `Accepted ${result.diff.path}`);
  return result;
}

function rejectDiff(id) {
  const result = diffService.reject(id);
  if (result.ok) emitDiffStatusEvent(result.diff, "rejected", "reject", `Rejected ${result.diff.path}`);
  return result;
}

function acceptAllDiffs() {
  const pending = listDiffs().filter((diff) => diff.status === "pending");
  const errors = [];
  let count = 0;
  for (const diff of pending) {
    const result = acceptDiff(diff.id);
    if (result.ok) count++;
    else errors.push(`${diff.path}: ${result.error}`);
  }
  send("diffs-changed", listDiffs());
  if (errors.length) return { ok: false, count, error: errors.slice(0, 3).join("\n") };
  return { ok: true, count };
}

function rejectAllDiffs() {
  const pending = listDiffs().filter((diff) => diff.status === "pending");
  const errors = [];
  let count = 0;
  for (const diff of pending) {
    const result = rejectDiff(diff.id);
    if (result.ok) count++;
    else errors.push(`${diff.path}: ${result.error}`);
  }
  send("diffs-changed", listDiffs());
  if (errors.length) return { ok: false, count, error: errors.slice(0, 3).join("\n") };
  return { ok: true, count };
}

function clearArchivedDiffs() {
  const count = diffService.clearArchived();
  send("diffs-changed", listDiffs());
  return { ok: true, count };
}

function emitDiffStatusEvent(diff, status, tool, title) {
  handleRuntimeEvent({
    sessionId: diff.sessionId,
    turnId: diff.turnId,
    type: "diff:updated",
    tool,
    title,
    summary: diff.path,
    status: "done",
    path: diff.path,
    diffId: diff.id,
    payload: { diffId: diff.id, status },
  });
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

function ensurePrivateDir() {
  fs.mkdirSync(HICODE_DIR, { recursive: true, mode: 0o700 });
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writePrivateJson(file, value) {
  ensurePrivateDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function ensureStoreDir(...parts) {
  const dir = path.join(STORE_DIR, ...parts);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function loadStoreState() {
  const state = readJsonFile(STORE_PATH, { sourceId: "all", installed: {} });
  if (!state.installed || typeof state.installed !== "object") state.installed = {};
  if (!state.sourceId) state.sourceId = "all";
  if (state.schemaVersion !== 2) {
    state.sourceId = "all";
    state.schemaVersion = 2;
  }
  for (const record of Object.values(state.installed)) {
    if (record && typeof record === "object" && !Object.prototype.hasOwnProperty.call(record, "enabled")) {
      record.enabled = true;
    }
  }
  return state;
}

function saveStoreState(state) {
  writePrivateJson(STORE_PATH, state);
}

function activeStoreSource() {
  const state = loadStoreState();
  return STORE_SOURCES.find((s) => s.id === state.sourceId) || STORE_SOURCES[0];
}

function storeSourcesForQuery(selectedSource) {
  if (selectedSource?.id && selectedSource.id !== "all") return [selectedSource];
  return STORE_SOURCES.filter((s) => s.id !== "all");
}

async function fetchCatalogForSource(source, filters) {
  if (!source) return [];
  if (source.id === "builtin-cn") return BUILTIN_STORE_CATALOG.map((item) => withStoreSource(item, source));
  if (source.id === "codex-local") return localCodexStoreCatalog().map((item) => withStoreSource(item, source));
  if (source.id === "npm-mirror") return fetchNpmMcpCatalog(filters.query, source);
  if (source.id === "github-search" || source.id === "github-cn") return fetchGitHubStoreCatalog(filters.query, source);
  return (await fetchRemoteCatalog(source)).map((item) => withStoreSource(item, source));
}

function withStoreSource(item, source) {
  return {
    ...item,
    sourceId: source.id,
    sourceName: source.name,
    sourceRegion: source.region,
    source: item.source || source.name,
  };
}

async function fetchRemoteCatalog(source) {
  if (!source || source.catalogURL === "builtin://catalog") return [];
  if (!/^https?:\/\//.test(source.catalogURL)) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(source.catalogURL, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function localCodexStoreCatalog() {
  return [
    ...localCodexSkillItems(),
    ...localCodexPluginItems(),
  ];
}

function localCodexSkillItems() {
  const roots = [
    path.join(CODEX_DIR, "skills"),
    path.join(CODEX_DIR, "vendor_imports", "skills"),
    path.join(CODEX_DIR, "plugins", "cache"),
  ];
  const items = new Map();
  for (const root of roots) {
    for (const file of findSkillFiles(root, 2500)) {
      const skill = parseSkill(file);
      if (!skill) continue;
      const id = `codex-skill-${safeStoreName(skill.name)}`;
      if (items.has(id)) continue;
      items.set(id, {
        id,
        kind: "skill",
        category: categoryForText(`${skill.name} ${skill.description} ${file}`),
        name: skill.name,
        summary: skill.description,
        tags: ["codex", "skill", ...tagsForText(`${skill.name} ${skill.description} ${file}`)],
        aliases: [skill.name, path.basename(path.dirname(file)), ...aliasesForText(`${skill.name} ${skill.description}`)],
        source: "Codex 本机缓存",
        install: {
          kind: "skill",
          dir: safeStoreName(skill.name),
          skill: {
            name: skill.name,
            description: skill.description,
            sourcePath: file,
          },
        },
      });
    }
  }
  return Array.from(items.values());
}

function localCodexPluginItems() {
  const roots = [
    path.join(CODEX_DIR, "plugins", "cache"),
    path.join(CODEX_DIR, "vendor_imports", "plugins"),
  ];
  const items = new Map();
  for (const root of roots) {
    for (const file of findNamedFiles(root, ".codex-plugin", "plugin.json", 400)) {
      const plugin = parsePluginManifest(file);
      if (!plugin) continue;
      const id = `codex-plugin-${safeStoreName(plugin.name)}`;
      if (items.has(id)) continue;
      items.set(id, {
        id,
        kind: "plugin",
        category: categoryForText(`${plugin.name} ${plugin.description} ${file}`),
        name: plugin.displayName || plugin.name,
        summary: plugin.description || "本机 Codex 插件，可导入 Hi Code 商店。",
        tags: ["codex", "plugin", ...tagsForText(`${plugin.name} ${plugin.description} ${file}`)],
        aliases: [plugin.name, plugin.displayName, ...aliasesForText(`${plugin.name} ${plugin.description}`)].filter(Boolean),
        source: "Codex 本机缓存",
        install: {
          kind: "plugin",
          manifest: {
            name: plugin.name,
            version: plugin.version || "0.1.0",
            description: plugin.description || "Imported Codex plugin.",
            contributes: plugin.contributes || [],
            sourcePath: file,
            sourceRoot: path.dirname(path.dirname(file)),
          },
        },
      });
    }
  }
  return Array.from(items.values());
}

function parsePluginManifest(file) {
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const name = manifest.name || manifest.id || path.basename(path.dirname(path.dirname(file)));
    return {
      name: String(name),
      displayName: manifest.displayName || manifest.title || manifest.name,
      description: manifest.description || manifest.summary || pluginDescription(String(name)),
      version: manifest.version,
      contributes: Array.isArray(manifest.contributes) ? manifest.contributes : [],
    };
  } catch {
    return null;
  }
}

function findNamedFiles(root, parentName, fileName, maxFiles = 200) {
  const found = [];
  const seen = new Set();
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && found.length < maxFiles) {
    const { dir, depth } = stack.pop();
    if (!dir || seen.has(dir) || depth > 8) continue;
    seen.add(dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", ".venv", "__pycache__"].includes(entry.name)) stack.push({ dir: p, depth: depth + 1 });
      } else if (entry.isFile() && entry.name === fileName && path.basename(path.dirname(p)) === parentName) {
        found.push(p);
        if (found.length >= maxFiles) break;
      }
    }
  }
  return found;
}

const CURATED_NPM_MCP_PACKAGES = [
  { pkg: "@modelcontextprotocol/server-filesystem", name: "Filesystem MCP", category: "local", summary: "本地文件系统 MCP server。", args: ["."] },
  { pkg: "@modelcontextprotocol/server-memory", name: "Memory MCP", category: "local", summary: "跨会话记忆和知识图谱 MCP server。" },
  { pkg: "@modelcontextprotocol/server-sequential-thinking", name: "Sequential Thinking MCP", category: "code", summary: "多步推理和计划 MCP server。" },
  { pkg: "@modelcontextprotocol/server-github", name: "GitHub MCP", category: "git", summary: "GitHub repo、issue、PR 上下文 MCP server。", env: { GITHUB_TOKEN: "填入你的 GitHub token" } },
  { pkg: "@modelcontextprotocol/server-brave-search", name: "Brave Search MCP", category: "browser", summary: "联网搜索 MCP server。", env: { BRAVE_API_KEY: "填入你的 Brave Search API Key" } },
  { pkg: "@modelcontextprotocol/server-puppeteer", name: "Puppeteer MCP", category: "browser", summary: "浏览器自动化 MCP server。" },
  { pkg: "@modelcontextprotocol/server-fetch", name: "Fetch MCP", category: "browser", summary: "网页抓取和 HTTP 请求 MCP server。" },
  { pkg: "@modelcontextprotocol/server-sqlite", name: "SQLite MCP", category: "data", summary: "SQLite 数据库访问 MCP server。" },
  { pkg: "@modelcontextprotocol/server-postgres", name: "Postgres MCP", category: "data", summary: "PostgreSQL 数据库访问 MCP server。", env: { POSTGRES_CONNECTION_STRING: "填入你的 PostgreSQL 连接串" } },
  { pkg: "@modelcontextprotocol/server-slack", name: "Slack MCP", category: "docs", summary: "Slack 消息和频道上下文 MCP server。", env: { SLACK_BOT_TOKEN: "填入你的 Slack bot token", SLACK_TEAM_ID: "填入你的 Slack team id" } },
];

async function fetchNpmMcpCatalog(query, source) {
  const curated = CURATED_NPM_MCP_PACKAGES.map((item) => npmPackageToMcpItem(item, source));
  const search = normalizeSearchValue(query);
  if (!search) return curated;

  const endpoint = `${source.npmRegistry.replace(/\/+$/, "")}/-/v1/search?text=${encodeURIComponent(`mcp ${search}`)}&size=80`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return curated;
    const json = await res.json();
    const dynamic = (Array.isArray(json.objects) ? json.objects : [])
      .map((entry) => npmSearchEntryToMcpItem(entry, source))
      .filter(Boolean);
    return mergeStoreItems([...curated, ...dynamic]);
  } catch {
    return curated;
  } finally {
    clearTimeout(timer);
  }
}

function npmSearchEntryToMcpItem(entry, source) {
  const pkg = entry?.package || {};
  const name = String(pkg.name || "");
  const text = `${name} ${pkg.description || ""} ${(pkg.keywords || []).join(" ")}`.toLowerCase();
  if (!name || (!text.includes("mcp") && !text.includes("modelcontextprotocol"))) return null;
  return npmPackageToMcpItem({
    pkg: name,
    name,
    category: categoryForText(text),
    summary: pkg.description || "NPM MCP server package.",
    keywords: pkg.keywords || [],
    version: pkg.version,
  }, source);
}

function npmPackageToMcpItem(item, source) {
  const pkg = item.pkg;
  const serverName = safeStoreName(pkg.replace(/^@/, "").replace(/\//g, "-").replace(/^modelcontextprotocol-server-/, ""));
  return withStoreSource({
    id: `npm-mcp-${safeStoreName(pkg)}`,
    kind: "mcp",
    category: item.category || categoryForText(`${pkg} ${item.summary || ""}`),
    name: item.name || pkg,
    summary: item.summary || "NPM MCP server package.",
    tags: ["mcp", "npm", "npmmirror", ...(item.keywords || []), ...tagsForText(`${pkg} ${item.summary || ""}`)],
    aliases: [pkg, serverName, ...(item.keywords || []), ...aliasesForText(`${pkg} ${item.summary || ""}`)],
    source: "NPM MCP 镜像",
    install: {
      kind: "mcp",
      server: {
        name: serverName,
        command: "npx",
        args: ["-y", pkg, ...(item.args || [])],
        ...(item.env ? { env: item.env } : {}),
      },
    },
  }, source);
}

const CURATED_GITHUB_STORE_REPOS = [
  {
    fullName: "modelcontextprotocol/servers",
    name: "MCP Servers",
    description: "Model Context Protocol 官方/参考 server 集合。",
    topics: ["mcp", "server", "filesystem", "github", "postgres", "slack"],
  },
  {
    fullName: "github/github-mcp-server",
    name: "GitHub MCP Server",
    description: "GitHub 官方 MCP server。",
    topics: ["mcp", "github", "pull-request", "issue"],
  },
  {
    fullName: "browserbase/mcp-server-browserbase",
    name: "Browserbase MCP Server",
    description: "Browserbase 浏览器自动化 MCP server。",
    topics: ["mcp", "browser", "automation"],
  },
  {
    fullName: "upstash/context7",
    name: "Context7 MCP",
    description: "为 LLM 提供最新文档上下文的 MCP server。",
    topics: ["mcp", "docs", "context"],
  },
];

async function fetchGitHubStoreCatalog(query, source) {
  const curated = CURATED_GITHUB_STORE_REPOS.map((repo) => githubRepoToStoreItem(repo, source));
  const search = normalizeSearchValue(query);
  if (!search) return curated;

  const apiQuery = `${search} (mcp OR codex OR skill OR plugin)`;
  const endpoint = `https://api.github.com/search/repositories?q=${encodeURIComponent(apiQuery)}&sort=stars&order=desc&per_page=50`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "accept": "application/vnd.github+json",
        "user-agent": "Hi-Code-Store",
      },
    });
    if (!res.ok) return curated;
    const json = await res.json();
    const dynamic = (Array.isArray(json.items) ? json.items : [])
      .map((repo) => githubRepoToStoreItem(repo, source))
      .filter(Boolean);
    return mergeStoreItems([...curated, ...dynamic]);
  } catch {
    return curated;
  } finally {
    clearTimeout(timer);
  }
}

function githubRepoToStoreItem(repo, source) {
  const fullName = repo.full_name || repo.fullName;
  if (!fullName || !String(fullName).includes("/")) return null;
  const name = repo.name || fullName.split("/").pop();
  const description = repo.description || "GitHub repository.";
  const topics = Array.isArray(repo.topics) ? repo.topics : [];
  const text = `${fullName} ${name} ${description} ${topics.join(" ")}`;
  const kind = githubKindForText(text);
  const defaultBranch = repo.default_branch || "main";
  return withStoreSource({
    id: `github-${safeStoreName(fullName)}`,
    kind,
    category: categoryForText(text),
    name,
    summary: description,
    tags: ["github", ...topics, ...tagsForText(text)],
    aliases: [fullName, name, ...topics, ...aliasesForText(text)],
    source: "GitHub",
    install: {
      kind: "download",
      url: `https://github.com/${fullName}/archive/refs/heads/${defaultBranch}.zip`,
      mirrors: {
        CN: `https://gh.llkk.cc/https://github.com/${fullName}/archive/refs/heads/${defaultBranch}.zip`,
        "github-search": `https://github.com/${fullName}/archive/refs/heads/${defaultBranch}.zip`,
        "github-cn": `https://gh.llkk.cc/https://github.com/${fullName}/archive/refs/heads/${defaultBranch}.zip`,
      },
      filename: `${safeStoreName(fullName)}.zip`,
    },
  }, source);
}

function githubKindForText(text = "") {
  const value = String(text).toLowerCase();
  if (/mcp|model context protocol/.test(value)) return "mcp";
  if (/agent|智能体/.test(value)) return "agent";
  if (/skill|技能/.test(value)) return "skill";
  return "plugin";
}

function mergeStoreItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id || map.has(item.id)) continue;
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function categoryForText(text = "") {
  const value = String(text).toLowerCase();
  if (/security|安全|漏洞|threat|attack|审查|review/.test(value)) return "review";
  if (/github|git|pr|commit|diff/.test(value)) return "git";
  if (/browser|chrome|playwright|puppeteer|web|网页|浏览器/.test(value)) return "browser";
  if (/figma|canva|image|design|设计|图片/.test(value)) return "design";
  if (/data|sql|postgres|sqlite|analytics|kpi|dashboard|数据|报表/.test(value)) return "data";
  if (/doc|pdf|notion|slack|sheet|文档|表格/.test(value)) return "docs";
  if (/local|filesystem|memory|电脑|本机|文件/.test(value)) return "local";
  if (/agent|code|coding|test|build|代码/.test(value)) return "code";
  return "other";
}

function tagsForText(text = "") {
  const value = String(text).toLowerCase();
  const tags = [];
  for (const [pattern, tag] of [
    [/review|审查/, "review"],
    [/security|安全/, "security"],
    [/github|git/, "git"],
    [/browser|chrome|playwright|puppeteer/, "browser"],
    [/figma|canva|design|设计/, "design"],
    [/data|sql|analytics|数据/, "data"],
    [/mcp/, "mcp"],
  ]) {
    if (pattern.test(value)) tags.push(tag);
  }
  return tags;
}

function aliasesForText(text = "") {
  const value = String(text).toLowerCase();
  const aliases = [];
  if (/review|审查/.test(value)) aliases.push("自动审查", "代码审查", "PR审查");
  if (/security|安全/.test(value)) aliases.push("安全审查", "漏洞扫描");
  if (/browser|playwright|puppeteer/.test(value)) aliases.push("浏览器测试", "UI验证");
  if (/figma|design|设计/.test(value)) aliases.push("设计", "Figma");
  if (/data|sql|analytics|数据/.test(value)) aliases.push("数据分析", "报表");
  return aliases;
}

function normalizeStoreItem(item) {
  return {
    id: String(item.id || ""),
    kind: item.kind,
    category: item.category || "other",
    name: item.name || item.id,
    summary: item.summary || item.description || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    source: item.source || "remote",
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceRegion: item.sourceRegion,
    install: item.install || {},
  };
}

const STORE_KINDS = new Set(["plugin", "skill", "mcp", "agent"]);
const STORE_INSTALL_KINDS = new Set(["plugin", "skill", "mcp", "agent", "download"]);
const STORE_ID_RE = /^[a-z0-9][a-z0-9._:-]{1,79}$/i;
const STORE_ENV_PLACEHOLDER_RE = /填入|your_|token|<.+>|replace/i;

function displayPath(file) {
  return file.replace(os.homedir(), "~");
}

function safeStoreName(value, fallback = "item") {
  return String(value || fallback).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80) || fallback;
}

function isTrustedLocalStoreSource(source) {
  return source?.id === "codex-local" || String(source?.catalogURL || "").startsWith("local://");
}

function localStoreRoots() {
  return [CODEX_DIR, STORE_DIR].filter(Boolean);
}

function pathInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolvedPathInside(root, target) {
  try {
    const base = fs.existsSync(root) ? fs.realpathSync.native(root) : path.resolve(root);
    const abs = fs.existsSync(target) ? fs.realpathSync.native(target) : path.resolve(target);
    return pathInside(base, abs);
  } catch {
    return false;
  }
}

function assertStoreManagedPath(target, label = "path") {
  const abs = path.resolve(String(target || ""));
  if (!resolvedPathInside(STORE_DIR, abs)) {
    throw new Error(`${label} 不在 Hi Code 商店安全目录内`);
  }
  return abs;
}

function safeRemoveStorePath(target) {
  if (!target) return false;
  const abs = assertStoreManagedPath(target, "卸载路径");
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
}

function validateLocalInstallPath(file, source, label) {
  if (!file) return null;
  if (!isTrustedLocalStoreSource(source)) {
    return `${label} 只允许来自可信本地源，远程 catalog 不得引用本机路径`;
  }
  try {
    const real = fs.realpathSync.native(String(file));
    const roots = localStoreRoots().map((root) => {
      try {
        return fs.realpathSync.native(root);
      } catch {
        return path.resolve(root);
      }
    });
    if (!roots.some((root) => pathInside(root, real))) {
      return `${label} 必须位于可信本地源目录内`;
    }
  } catch {
    return `${label} 路径不存在或不可读取`;
  }
  return null;
}

function safeDownloadFilename(filename, url, fallbackId) {
  const fromUrl = (() => {
    try {
      return path.basename(new URL(String(url || "")).pathname);
    } catch {
      return "";
    }
  })();
  const raw = path.basename(String(filename || fromUrl || `${fallbackId}.bin`));
  return safeStoreName(raw, `${safeStoreName(fallbackId)}.bin`);
}

function publicDownloadUrlLabel(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    if (url.search) url.search = "?...";
    return url.toString();
  } catch {
    return String(value || "");
  }
}

function downloadCandidateUrls(item, source) {
  const install = item.install || {};
  const mirrors = install.mirrors && typeof install.mirrors === "object" ? install.mirrors : {};
  const candidates = [];
  const add = (url) => {
    const value = String(url || "").trim();
    if (!value || !validUrl(value) || candidates.includes(value)) return;
    candidates.push(value);
  };

  add(mirrors[source?.id]);
  add(mirrors[source?.region]);
  if (source?.id === "github-cn" || source?.region === "CN") {
    add(install.url);
    add(mirrors["github-search"]);
  }
  add(mirrors.CN);
  add(mirrors.Global);
  for (const url of Object.values(mirrors)) add(url);
  add(install.url);
  return candidates;
}

function validUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateStoreItem(raw, source = sourceForStoreItem(raw || {})) {
  const item = normalizeStoreItem(raw);
  const errors = [];
  const warnings = [];

  if (!item.id || !STORE_ID_RE.test(item.id) || item.id.includes("/") || item.id.includes("\\")) {
    errors.push("id 必须是 2-80 位安全标识，只能包含字母、数字、点、下划线、冒号或短横线");
  }
  if (!STORE_KINDS.has(item.kind)) errors.push("kind 必须是 plugin、skill、mcp 或 agent");
  if (!item.name || String(item.name).trim().length < 2) warnings.push("name 过短，界面会回退到 id");
  if (!item.install || typeof item.install !== "object" || Array.isArray(item.install)) {
    errors.push("install 必须是对象");
  }

  const installKind = item.install?.kind || item.kind;
  if (!STORE_INSTALL_KINDS.has(installKind)) errors.push("install.kind 不受支持");
  if (installKind !== "download" && installKind !== item.kind) warnings.push("install.kind 与条目 kind 不一致");

  if (installKind === "skill") {
    if (item.install?.dir && /[\\/]/.test(String(item.install.dir))) errors.push("skill install.dir 不能包含路径分隔符");
    if (item.install?.skill && typeof item.install.skill !== "object") errors.push("skill 配置必须是对象");
    const sourcePathError = validateLocalInstallPath(item.install?.skill?.sourcePath, source, "skill.sourcePath");
    if (sourcePathError) errors.push(sourcePathError);
  }

  if (installKind === "mcp") {
    const server = item.install?.server;
    if (!server || typeof server !== "object") errors.push("MCP 条目必须提供 install.server");
    else {
      if (!server.name || !STORE_ID_RE.test(String(server.name))) errors.push("MCP server.name 必须是安全标识");
      if (!server.command || typeof server.command !== "string") errors.push("MCP server.command 必须是字符串");
      if (server.args && (!Array.isArray(server.args) || server.args.some((a) => typeof a !== "string"))) errors.push("MCP server.args 必须是字符串数组");
      if (server.env && (typeof server.env !== "object" || Array.isArray(server.env))) errors.push("MCP server.env 必须是对象");
      if (server.env) {
        for (const [key, value] of Object.entries(server.env)) {
          if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) warnings.push(`环境变量 ${key} 命名不规范`);
          if (STORE_ENV_PLACEHOLDER_RE.test(String(value))) warnings.push(`环境变量 ${key} 需要安装后手动填写`);
        }
      }
    }
  }

  if (installKind === "agent") {
    if (item.install?.agent && typeof item.install.agent !== "object") errors.push("agent 配置必须是对象");
    if (!item.install?.agent?.role) warnings.push("agent.role 缺失，将使用条目 id 作为角色配置文件名");
  }

  if (installKind === "plugin") {
    if (item.install?.manifest && typeof item.install.manifest !== "object") errors.push("plugin manifest 必须是对象");
    const manifestName = item.install?.manifest?.name;
    if (manifestName && /[\\/]/.test(String(manifestName))) errors.push("plugin manifest.name 不能包含路径分隔符");
    const sourceRootError = validateLocalInstallPath(item.install?.manifest?.sourceRoot, source, "plugin manifest.sourceRoot");
    if (sourceRootError) errors.push(sourceRootError);
  }

  if (installKind === "download") {
    const install = item.install || {};
    const urls = [install.url, ...Object.values(install.mirrors || {})].filter(Boolean);
    if (!urls.length) errors.push("download 安装必须提供 url 或 mirrors");
    for (const url of urls) {
      if (!validUrl(url)) errors.push(`下载地址无效: ${url}`);
      else if (String(url).startsWith("http:") && !isTrustedLocalStoreSource(source)) errors.push("远程下载必须使用 HTTPS");
      else if (String(url).startsWith("http:")) warnings.push("下载地址使用 HTTP，仅允许可信本地源使用");
    }
    if (install.filename && /[\\/]/.test(String(install.filename))) errors.push("download filename 不能包含路径分隔符");
    if (install.sha256 && !/^[a-f0-9]{64}$/i.test(String(install.sha256))) errors.push("download sha256 必须是 64 位十六进制字符串");
    if (install.signature && typeof install.signature !== "string") errors.push("download signature 必须是字符串");
    if (install.signatureAlgorithm && !["minisign", "cosign", "sigstore", "ed25519", "rsa-pss-sha256"].includes(String(install.signatureAlgorithm))) {
      errors.push("download signatureAlgorithm 不受支持");
    }
    if (install.signature && !install.signatureAlgorithm) warnings.push("download 提供了 signature，但未声明 signatureAlgorithm");
    if (install.signatureAlgorithm && !install.signature) warnings.push("download 声明了 signatureAlgorithm，但未提供 signature");
    if (!install.sha256) warnings.push("download 条目未提供 sha256，暂无法做完整性校验");
    if (!install.signature) warnings.push("download 条目未提供 signature；当前版本仅强制 sha256，签名校验字段已预留");
  }

  return {
    item: {
      ...item,
      install: item.install || {},
      validationErrors: errors,
      validationWarnings: warnings,
      valid: errors.length === 0,
    },
    errors,
    warnings,
  };
}

function normalizeStoreOptions(options = {}) {
  const query = String(options.query || "").trim().slice(0, 120);
  const kind = STORE_KINDS.has(options.kind) ? options.kind : "all";
  const category = String(options.category || "all").trim() || "all";
  return { query, kind, category };
}

function storeSearchText(item) {
  const install = item.install || {};
  const server = install.server || {};
  const skill = install.skill || {};
  const agent = install.agent || {};
  const manifest = install.manifest || {};
  return [
    item.id,
    item.kind,
    item.category,
    item.name,
    item.summary,
    item.source,
    ...(item.tags || []),
    ...(item.aliases || []),
    server.name,
    server.command,
    ...(Array.isArray(server.args) ? server.args : []),
    ...(server.env ? Object.keys(server.env) : []),
    skill.name,
    skill.description,
    agent.role,
    agent.modelProfile,
    manifest.name,
    manifest.version,
    ...(Array.isArray(manifest.contributes) ? manifest.contributes : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

const STORE_SEARCH_SYNONYMS = {
  "自动审查": ["自动代码审查", "代码审查", "review", "reviewer", "diff", "pr", "安全审查", "测试缺口"],
  "审查": ["review", "reviewer", "代码审查", "安全审查", "质量检查"],
  "代码审查": ["自动审查", "review", "reviewer", "pr", "diff"],
  "安全审查": ["security", "漏洞", "密钥", "权限", "mcp安全"],
  "测试": ["qa", "playwright", "ui验证", "回归"],
  "浏览器": ["browser", "playwright", "chrome", "ui验证"],
  "打开": ["启动", "open", "本机应用", "app", "macos"],
  "应用": ["app", "本机应用", "macos", "open"],
  "插件": ["plugin"],
  "技能": ["skill"],
  "智能体": ["agent"],
};

function normalizeSearchValue(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function storeQueryTerms(query) {
  const normalized = normalizeSearchValue(query);
  if (!normalized) return [];
  const terms = new Set([normalized, ...normalized.split(/\s+/).filter(Boolean)]);
  for (const [key, aliases] of Object.entries(STORE_SEARCH_SYNONYMS)) {
    if (normalized.includes(key.toLowerCase())) {
      terms.add(key.toLowerCase());
      for (const alias of aliases) terms.add(String(alias).toLowerCase());
    }
  }
  return Array.from(terms);
}

function storeSearchScore(item, filters) {
  const terms = storeQueryTerms(filters.query);
  if (!terms.length) return 1;
  const haystack = storeSearchText(item);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (haystack.includes(term)) score += term === normalizeSearchValue(filters.query) ? 8 : 3;
  }
  const name = normalizeSearchValue(item.name);
  const summary = normalizeSearchValue(item.summary);
  if (name.includes(normalizeSearchValue(filters.query))) score += 12;
  if (summary.includes(normalizeSearchValue(filters.query))) score += 5;
  return score;
}

function matchesStoreFilters(item, filters) {
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.category !== "all" && (item.category || "other") !== filters.category) return false;
  if (!filters.query) return true;
  return storeSearchScore(item, filters) > 0;
}

async function listStoreCatalog(options = {}) {
  const filters = normalizeStoreOptions(options);
  const state = loadStoreState();
  const source = activeStoreSource();
  const sourcesToQuery = storeSourcesForQuery(source);
  const catalogs = await Promise.all(sourcesToQuery.map(async (s) => {
    try {
      return await fetchCatalogForSource(s, filters);
    } catch {
      return [];
    }
  }));
  const rawItems = catalogs.flat();
  const merged = new Map();
  const invalidItems = [];
  for (const raw of rawItems) {
    const rawSource = STORE_SOURCES.find((s) => s.id === raw.sourceId) || source;
    const { item } = validateStoreItem(raw, rawSource);
    if (!item.valid) {
      invalidItems.push({
        id: item.id || "(missing id)",
        name: item.name || item.id || "(unnamed)",
        errors: item.validationErrors,
      });
      continue;
    }
    const sourceForItem = STORE_SOURCES.find((s) => s.id === item.sourceId) || source;
    const installedRecord = state.installed[item.id];
    merged.set(item.id, {
      ...item,
      sourceId: sourceForItem.id,
      sourceName: item.sourceName || sourceForItem.name,
      sourceRegion: item.sourceRegion || sourceForItem.region,
      installed: Boolean(installedRecord),
      enabled: installedRecord?.enabled !== false,
      installedAt: installedRecord?.installedAt,
    });
  }
  const allItems = Array.from(merged.values());
  for (const item of allItems) storeItemCache.set(item.id, item);
  const items = allItems
    .filter((item) => matchesStoreFilters(item, filters))
    .sort((a, b) => storeSearchScore(b, filters) - storeSearchScore(a, filters) || String(a.name).localeCompare(String(b.name), "zh-CN"));
  return {
    sourceId: source.id,
    source,
    sources: STORE_SOURCES,
    query: filters.query,
    kind: filters.kind,
    category: filters.category,
    totalItems: allItems.length,
    filteredItems: items.length,
    remoteItems: rawItems.length,
    invalidItems: invalidItems.length,
    catalogIssues: invalidItems.slice(0, 20),
    items,
  };
}

function setStoreSource(sourceId) {
  const source = STORE_SOURCES.find((s) => s.id === String(sourceId || ""));
  if (!source) return { ok: false, error: "下载源不存在" };
  const state = loadStoreState();
  state.sourceId = source.id;
  saveStoreState(state);
  return { ok: true, source };
}

function writeTextFilePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function installSkill(item) {
  const dirName = item.install?.dir || item.id.replace(/[^a-z0-9._-]+/gi, "-");
  const dir = ensureStoreDir("skills", dirName);
  const skill = item.install?.skill || {};
  const sourcePath = skill.sourcePath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    const content = fs.readFileSync(sourcePath, "utf8");
    writeTextFilePrivate(path.join(dir, "SKILL.md"), content);
    return { path: path.join(dir, "SKILL.md"), sourcePath };
  }
  const name = skill.name || item.name || item.id;
  const description = skill.description || item.summary || "Hi Code Store skill.";
  const body = skill.body || "Follow the task-specific workflow described by this skill.";
  const content = `---\nname: "${name}"\ndescription: "${description.replaceAll('"', "'")}"\n---\n\n# ${name}\n\n${body}\n`;
  writeTextFilePrivate(path.join(dir, "SKILL.md"), content);
  return { path: path.join(dir, "SKILL.md") };
}

function withNpmMirrorArgs(args, source) {
  if (!source?.npmRegistry || source.npmRegistry === "https://registry.npmjs.org") return args;
  if (!Array.isArray(args) || args.some((a) => String(a).startsWith("--registry"))) return args;
  return [`--registry=${source.npmRegistry}`, ...args];
}

function installMcp(item, source) {
  const cfg = readJsonFile(CONFIG_PATH, {});
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
  const server = item.install?.server;
  if (!server?.name || !server?.command) throw new Error("invalid MCP manifest");
  cfg.mcpServers[server.name] = {
    command: server.command,
    args: withNpmMirrorArgs(Array.isArray(server.args) ? server.args : [], source),
    ...(server.env ? { env: server.env } : {}),
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
  buildRuntime();
  return { server: server.name, mcpConfig: cfg.mcpServers[server.name] };
}

function installAgent(item) {
  const dir = ensureStoreDir("agents");
  const agent = item.install?.agent || {};
  const id = item.id.replace(/[^a-z0-9._-]+/gi, "-");
  const file = path.join(dir, `${id}.json`);
  writeTextFilePrivate(file, JSON.stringify({ id: item.id, name: item.name, ...agent }, null, 2));
  return { path: file };
}

function installPlugin(item) {
  const manifest = item.install?.manifest || { name: item.id, version: "0.1.0" };
  const dirName = (manifest.name || item.id).replace(/[^a-z0-9._-]+/gi, "-");
  const dir = ensureStoreDir("plugins", dirName);
  if (manifest.sourceRoot && fs.existsSync(manifest.sourceRoot)) {
    fs.cpSync(manifest.sourceRoot, dir, { recursive: true });
  }
  const file = path.join(dir, "plugin.json");
  writeTextFilePrivate(file, JSON.stringify({ id: item.id, displayName: item.name, ...manifest }, null, 2));
  return { path: file };
}

function walkStoreFiles(root, predicate, maxFiles = 2000) {
  const found = [];
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited++ >= maxFiles) break;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (predicate(file, entry)) found.push(file);
    }
  }
  return found;
}

function extractDownloadedArchive(file, extractDir) {
  const absFile = assertStoreManagedPath(file, "下载文件");
  const absExtractDir = assertStoreManagedPath(extractDir, "解压目录");
  fs.rmSync(absExtractDir, { recursive: true, force: true });
  fs.mkdirSync(absExtractDir, { recursive: true, mode: 0o700 });
  const attempts = [
    { command: "unzip", args: ["-q", absFile, "-d", absExtractDir] },
    { command: "ditto", args: ["-x", "-k", absFile, absExtractDir] },
  ];
  const errors = [];
  for (const attempt of attempts) {
    const run = spawnSync(attempt.command, attempt.args, { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
    if (run.status === 0) {
      const escaped = walkStoreFiles(absExtractDir, (candidate) => !resolvedPathInside(absExtractDir, candidate), 5000);
      if (escaped.length) {
        fs.rmSync(absExtractDir, { recursive: true, force: true });
        return { ok: false, error: "下载包包含越界路径，已拒绝导入" };
      }
      return { ok: true, path: absExtractDir, command: attempt.command };
    }
    errors.push(`${attempt.command}: ${String(run.stderr || run.error?.message || "failed").trim()}`);
  }
  return { ok: false, error: errors.filter(Boolean).join("；") || "无法解压下载包" };
}

function writeDownloadedSkillWrapper(item, downloadMeta = {}) {
  const dir = ensureStoreDir("skills", safeStoreName(item.id));
  const file = path.join(dir, "SKILL.md");
  const description = item.summary || "Hi Code Store downloaded skill.";
  const body = [
    `# ${item.name || item.id}`,
    "",
    description,
    "",
    "This entry was installed from Hi Code Store as a downloaded package. Review the cached source archive before using it as a workflow instruction.",
    downloadMeta.extractedPath ? `Source cache: ${displayPath(downloadMeta.extractedPath)}` : "",
  ].filter(Boolean).join("\n");
  writeTextFilePrivate(file, `---\nname: "${String(item.name || item.id).replaceAll('"', "'")}"\ndescription: "${String(description).replaceAll('"', "'")}"\n---\n\n${body}\n`);
  return { kind: "skill", path: file, generated: true };
}

function writeDownloadedPluginDescriptor(item, downloadMeta = {}) {
  const dir = ensureStoreDir("plugins", safeStoreName(item.id));
  const file = path.join(dir, "plugin.json");
  writeTextFilePrivate(file, JSON.stringify({
    id: item.id,
    name: item.id,
    displayName: item.name,
    version: "0.0.0-store",
    description: item.summary || "",
    sourceArchive: downloadMeta.path || "",
    extractedPath: downloadMeta.extractedPath || "",
    generatedDescriptor: true,
    executionEnabled: false,
  }, null, 2));
  return { kind: "plugin", path: file, generated: true, executionEnabled: false };
}

function writeDownloadedMcpDescriptor(item, downloadMeta = {}) {
  const dir = ensureStoreDir("mcp");
  const file = path.join(dir, `${safeStoreName(item.id)}.json`);
  writeTextFilePrivate(file, JSON.stringify({
    id: item.id,
    name: item.name,
    summary: item.summary || "",
    sourceArchive: downloadMeta.path || "",
    extractedPath: downloadMeta.extractedPath || "",
    configured: false,
    externalApprovalRequired: true,
  }, null, 2));
  return { kind: "mcp", path: file, generated: true, configured: false };
}

function writeDownloadedAgentDescriptor(item, downloadMeta = {}) {
  const dir = ensureStoreDir("agents");
  const file = path.join(dir, `${safeStoreName(item.id)}.json`);
  writeTextFilePrivate(file, JSON.stringify({
    id: item.id,
    name: item.name,
    role: item.name || item.id,
    summary: item.summary || "",
    sourceArchive: downloadMeta.path || "",
    extractedPath: downloadMeta.extractedPath || "",
    externalApprovalRequired: true,
  }, null, 2));
  return { kind: "agent", path: file, generated: true };
}

function importDownloadedPackage(item, downloadMeta) {
  const imported = [];
  const warnings = [];
  if (!String(downloadMeta.path || "").toLowerCase().endsWith(".zip")) {
    warnings.push("下载文件不是 zip，已缓存但未导入能力目录。");
    return { imported, warnings };
  }

  const extractDir = path.join(path.dirname(downloadMeta.path), "extracted");
  const extracted = extractDownloadedArchive(downloadMeta.path, extractDir);
  if (!extracted.ok) {
    warnings.push(`下载包已缓存，但导入失败：${extracted.error}`);
    return { imported, warnings, extractedPath: extractDir };
  }

  const skillFiles = walkStoreFiles(extracted.path, (file) => path.basename(file).toLowerCase() === "skill.md");
  const pluginManifests = walkStoreFiles(extracted.path, (file) => path.basename(file) === "plugin.json" && path.basename(path.dirname(file)) === ".codex-plugin");
  const packageFiles = walkStoreFiles(extracted.path, (file) => path.basename(file).toLowerCase() === "package.json", 800);

  if ((item.kind === "skill" || skillFiles.length) && skillFiles[0]) {
    const dir = ensureStoreDir("skills", safeStoreName(item.id));
    const dest = path.join(dir, "SKILL.md");
    writeTextFilePrivate(dest, fs.readFileSync(skillFiles[0], "utf8"));
    imported.push({ kind: "skill", path: dest, sourcePath: skillFiles[0] });
  }

  if ((item.kind === "plugin" || pluginManifests.length) && pluginManifests[0]) {
    const pluginRoot = path.dirname(path.dirname(pluginManifests[0]));
    const destRoot = ensureStoreDir("plugins", safeStoreName(item.id));
    fs.rmSync(destRoot, { recursive: true, force: true });
    fs.cpSync(pluginRoot, destRoot, { recursive: true, dereference: false });
    imported.push({ kind: "plugin", path: path.join(destRoot, ".codex-plugin", "plugin.json"), root: destRoot, sourcePath: pluginRoot });
  }

  if (!imported.length && item.kind === "skill") imported.push(writeDownloadedSkillWrapper(item, { ...downloadMeta, extractedPath: extracted.path }));
  if (!imported.length && item.kind === "plugin") imported.push(writeDownloadedPluginDescriptor(item, { ...downloadMeta, extractedPath: extracted.path }));
  if (!imported.length && item.kind === "mcp") imported.push(writeDownloadedMcpDescriptor(item, { ...downloadMeta, extractedPath: extracted.path }));
  if (!imported.length && item.kind === "agent") imported.push(writeDownloadedAgentDescriptor(item, { ...downloadMeta, extractedPath: extracted.path }));

  if (!skillFiles.length && !pluginManifests.length && packageFiles.length) {
    warnings.push("下载包包含 package.json，但没有声明 Hi Code Skill 或插件 manifest，已作为商店条目记录。");
  }

  return { imported, warnings, extractedPath: extracted.path, extractCommand: extracted.command };
}

async function installDownload(item, source) {
  const install = item.install || {};
  const urls = downloadCandidateUrls(item, source);
  if (!urls.length) throw new Error("这个条目没有可用下载地址");
  const attempts = [];
  let bytes = null;
  let finalUrl = "";
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        attempts.push({ url: publicDownloadUrlLabel(url), ok: false, status: res.status });
        continue;
      }
      bytes = Buffer.from(await res.arrayBuffer());
      finalUrl = url;
      attempts.push({ url: publicDownloadUrlLabel(url), ok: true, status: res.status || 200 });
      break;
    } catch (err) {
      attempts.push({ url: publicDownloadUrlLabel(url), ok: false, error: err?.name === "AbortError" ? "timeout" : (err?.message || "download failed") });
    } finally {
      clearTimeout(timer);
    }
  }
  if (!bytes || !finalUrl) {
    const summary = attempts.map((a) => `${a.url} ${a.status ? `HTTP ${a.status}` : a.error || "failed"}`).join("；");
    throw new Error(`下载失败，已尝试 ${attempts.length} 个地址：${summary}`);
  }
  if (install.sha256) {
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actual !== String(install.sha256).toLowerCase()) {
      throw new Error(`下载文件 sha256 不匹配: expected ${install.sha256}, got ${actual}`);
    }
  }
  const dir = ensureStoreDir("downloads", item.id.replace(/[^a-z0-9._-]+/gi, "-"));
  const filename = safeDownloadFilename(install.filename, finalUrl, item.id);
  const file = path.join(dir, filename);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  const importResult = importDownloadedPackage(item, { path: file, bytes: bytes.length, url: finalUrl });
  writeTextFilePrivate(path.join(dir, "manifest.json"), JSON.stringify({
    id: item.id,
    name: item.name,
    kind: item.kind,
    source: source.id,
    file,
    downloadUrl: publicDownloadUrlLabel(finalUrl),
    attempts,
    imported: importResult.imported || [],
    warnings: importResult.warnings || [],
    extractedPath: importResult.extractedPath || "",
    sha256: install.sha256 || "",
    signature: install.signature || "",
    signatureAlgorithm: install.signatureAlgorithm || "",
  }, null, 2));
  return {
    path: file,
    bytes: bytes.length,
    downloadUrl: publicDownloadUrlLabel(finalUrl),
    attempts,
    imported: importResult.imported || [],
    warnings: importResult.warnings || [],
    extractedPath: importResult.extractedPath || "",
  };
}

function downloadUrlForSource(item, source) {
  return downloadCandidateUrls(item, source)[0] || "";
}

function previewChange(action, target, detail) {
  return { action, target: displayPath(target), detail };
}

function buildInstallPreview(item, source) {
  const { errors, warnings: validationWarnings } = validateStoreItem(item, source);
  const changes = [];
  const permissions = [];
  const warnings = [...validationWarnings];
  const installKind = item.install?.kind || item.kind;
  const env = [];
  let restartRequired = false;

  if (errors.length) {
    return { ok: false, error: errors.join("；"), errors };
  }

  if (installKind === "download") {
    const url = downloadUrlForSource(item, source);
    const urls = downloadCandidateUrls(item, source);
    const dir = path.join(STORE_DIR, "downloads", safeStoreName(item.id));
    const filename = safeDownloadFilename(item.install?.filename, url, item.id);
    changes.push(previewChange("download", url, "从当前下载源拉取安装包"));
    if (urls.length > 1) changes.push(previewChange("download", `${urls.length} 个候选下载地址`, "当前下载源失败时自动尝试备用镜像或 GitHub 直连"));
    changes.push(previewChange("write", path.join(dir, filename), "写入下载缓存文件"));
    changes.push(previewChange("write", path.join(dir, "manifest.json"), "记录下载来源和安装元数据"));
    permissions.push("允许 Hi Code 从网络下载该条目的安装文件。");
    permissions.push("允许 Hi Code 写入本地商店缓存目录。");
    if (!item.install?.sha256) warnings.push("此下载条目未提供 sha256；必须由用户在安装预览中显式确认后才能继续。");
    if (source.id !== "builtin-cn") warnings.push(`当前下载源为 ${source.name}，请确认 catalog 来源可信。`);
  } else if (item.kind === "skill") {
    const dirName = item.install?.dir || safeStoreName(item.id);
    const skillFile = path.join(STORE_DIR, "skills", dirName, "SKILL.md");
    const sourcePath = item.install?.skill?.sourcePath;
    changes.push(previewChange("write", skillFile, sourcePath ? `从 ${displayPath(sourcePath)} 导入 Skill 指令文件` : "安装 Skill 指令文件"));
    permissions.push("允许 Hi Code 在后续对话中读取该 Skill，并把它作为 agent 工作流指令。");
  } else if (item.kind === "mcp") {
    const server = item.install?.server || {};
    const cfg = readJsonFile(CONFIG_PATH, {});
    const args = withNpmMirrorArgs(Array.isArray(server.args) ? server.args : [], source);
    changes.push(previewChange("write", CONFIG_PATH, `新增或覆盖 mcpServers.${server.name}`));
    permissions.push(`允许 Hi Code 配置并启动 stdio MCP: ${[server.command, ...args].filter(Boolean).join(" ")}`);
    permissions.push("MCP 工具执行时仍会进入 Hi Code 权限确认流程。");
    restartRequired = true;
    if (cfg.mcpServers?.[server.name]) warnings.push(`将覆盖已有 MCP 配置: ${server.name}`);
    if (server.command === "npx" && source.npmRegistry && source.npmRegistry !== "https://registry.npmjs.org") {
      warnings.push(`npx 将使用国内镜像: ${source.npmRegistry}`);
    }
    for (const [key, value] of Object.entries(server.env || {})) {
      env.push({ key, required: STORE_ENV_PLACEHOLDER_RE.test(String(value)) });
    }
  } else if (item.kind === "agent") {
    const file = path.join(STORE_DIR, "agents", `${safeStoreName(item.id)}.json`);
    changes.push(previewChange("write", file, "安装 Agent 角色配置"));
    permissions.push("允许 Hi Code 在 /agent、/team 或商店入口中使用该 Agent 配置。");
  } else if (item.kind === "plugin") {
    const manifest = item.install?.manifest || { name: item.id, version: "0.1.0" };
    const dirName = safeStoreName(manifest.name || item.id);
    const file = path.join(STORE_DIR, "plugins", dirName, "plugin.json");
    if (manifest.sourceRoot) changes.push(previewChange("write", path.join(STORE_DIR, "plugins", dirName), `从 ${displayPath(manifest.sourceRoot)} 导入插件目录`));
    changes.push(previewChange("write", file, "安装插件 manifest"));
    permissions.push("允许该插件在 Hi Code 中声明命令、视图、Skill 或其他扩展入口。");
  }

  return {
    ok: true,
    item: {
      id: item.id,
      kind: item.kind,
      category: item.category,
      name: item.name,
      summary: item.summary,
      tags: item.tags,
      source: item.source,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
    },
    source: {
      id: source.id,
      name: source.name,
      region: source.region,
      catalogURL: source.catalogURL,
      npmRegistry: source.npmRegistry,
    },
    installKind,
    changes,
    permissions,
    warnings,
    env,
    restartRequired,
  };
}

async function previewStoreItem(itemId) {
  let item = storeItemCache.get(itemId);
  if (!item) {
    const catalog = await listStoreCatalog();
    item = catalog.items.find((x) => x.id === itemId);
  }
  if (!item) return { ok: false, error: "商店条目不存在或 manifest 未通过校验" };
  const source = sourceForStoreItem(item);
  const preview = buildInstallPreview(item, source);
  if (!preview.ok) return preview;
  return { ok: true, preview };
}

async function installStoreItem(itemId, options = {}) {
  const previewResult = await previewStoreItem(itemId);
  if (!previewResult.ok) return previewResult;
  const item = storeItemCache.get(itemId);
  if (!item) return { ok: false, error: "商店条目不存在或 manifest 未通过校验" };
  const source = sourceForStoreItem(item);
  try {
    let result;
    if (item.install?.kind === "download") {
      if (!item.install?.sha256 && options.allowUnverifiedDownload !== true) {
        return { ok: false, needUserConfirmation: true, error: "下载条目未提供 sha256，需要用户确认安装预览后才能继续。" };
      }
      result = await installDownload(item, source);
    }
    else if (item.kind === "skill") result = installSkill(item);
    else if (item.kind === "mcp") result = installMcp(item, source);
    else if (item.kind === "agent") result = installAgent(item);
    else if (item.kind === "plugin") result = installPlugin(item);
    else throw new Error("unsupported store item kind");

    const state = loadStoreState();
    state.installed[item.id] = {
      kind: item.kind,
      name: item.name,
      summary: item.summary || "",
      category: item.category || "other",
      tags: item.tags || [],
      sourceId: source.id,
      installedAt: Date.now(),
      enabled: true,
      result,
      preview: previewResult.preview,
    };
    saveStoreState(state);
    return { ok: true, item: { ...item, installed: true }, result };
  } catch (err) {
    return { ok: false, error: err?.message || "安装失败" };
  }
}

function storeRecordManagedPaths(record) {
  const paths = [];
  const add = (value) => {
    if (!value || typeof value !== "string") return;
    const abs = path.resolve(value);
    if (resolvedPathInside(STORE_DIR, abs) && !paths.includes(abs)) paths.push(abs);
  };
  add(record?.result?.path);
  add(record?.result?.extractedPath);
  for (const imported of record?.result?.imported || []) {
    add(imported.path);
    add(imported.root);
    if (imported.path && path.basename(imported.path).toLowerCase() === "skill.md") add(path.dirname(imported.path));
    if (imported.path && path.basename(imported.path).toLowerCase() === "plugin.json") add(path.dirname(imported.path));
  }
  if (record?.result?.path) {
    const resultPath = path.resolve(record.result.path);
    if (resolvedPathInside(path.join(STORE_DIR, "downloads"), resultPath)) add(path.dirname(resultPath));
    if (path.basename(resultPath).toLowerCase() === "skill.md") add(path.dirname(resultPath));
    if (path.basename(resultPath).toLowerCase() === "plugin.json") add(path.dirname(resultPath));
  }
  return paths.sort((a, b) => b.length - a.length);
}

function disabledStorePathPrefixes() {
  const state = loadStoreState();
  return Object.values(state.installed)
    .filter((record) => record?.enabled === false)
    .flatMap((record) => storeRecordManagedPaths(record));
}

function isDisabledStorePath(target) {
  const abs = path.resolve(String(target || ""));
  return disabledStorePathPrefixes().some((prefix) => resolvedPathInside(prefix, abs));
}

function storeRecordForManagedPath(target, kind = "") {
  if (!target) return null;
  const abs = path.resolve(String(target));
  const state = loadStoreState();
  for (const [id, record] of Object.entries(state.installed)) {
    if (kind && record?.kind !== kind) continue;
    if (storeRecordManagedPaths(record).some((prefix) => resolvedPathInside(prefix, abs))) {
      return { id, record };
    }
  }
  return null;
}

function removeConfiguredMcpServer(record) {
  const serverName = record?.result?.server;
  if (!serverName) return false;
  const cfg = readJsonFile(CONFIG_PATH, {});
  if (!cfg.mcpServers?.[serverName]) return false;
  delete cfg.mcpServers[serverName];
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
  buildRuntime();
  return true;
}

function restoreConfiguredMcpServer(record) {
  const serverName = record?.result?.server;
  const mcpConfig = record?.result?.mcpConfig;
  if (!serverName || !mcpConfig?.command) return false;
  const cfg = readJsonFile(CONFIG_PATH, {});
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
  cfg.mcpServers[serverName] = mcpConfig;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
  buildRuntime();
  return true;
}

function setStoreItemEnabled(itemId, enabled) {
  const id = String(itemId || "");
  const state = loadStoreState();
  const record = state.installed[id];
  if (!record) return { ok: false, error: "该条目尚未安装" };
  record.enabled = Boolean(enabled);
  record.updatedAt = Date.now();
  let mcpChanged = false;
  if (record.kind === "mcp") mcpChanged = enabled ? restoreConfiguredMcpServer(record) : removeConfiguredMcpServer(record);
  saveStoreState(state);
  return { ok: true, item: { id, name: record.name, kind: record.kind, enabled: record.enabled, installed: true }, mcpChanged };
}

function enableStoreItem(itemId) {
  return setStoreItemEnabled(itemId, true);
}

function disableStoreItem(itemId) {
  return setStoreItemEnabled(itemId, false);
}

function uninstallStoreItem(itemId) {
  const id = String(itemId || "");
  const state = loadStoreState();
  const record = state.installed[id];
  if (!record) return { ok: false, error: "该条目尚未安装" };
  removeConfiguredMcpServer(record);
  const removed = [];
  for (const target of storeRecordManagedPaths(record)) {
    try {
      if (safeRemoveStorePath(target)) removed.push(displayPath(target));
    } catch {
      // Best-effort cleanup is still constrained by safeRemoveStorePath.
    }
  }
  delete state.installed[id];
  saveStoreState(state);
  return { ok: true, item: { id, name: record.name, kind: record.kind, installed: false }, removed };
}

function translateStoreItemToChinese(item = {}) {
  const text = String(item.summary || item.description || "").trim();
  if (!text) return "暂无简介。";
  if (/[\u4e00-\u9fff]/.test(text)) return text;
  let zh = text
    .replace(/\bPlugin for\b/gi, "用于")
    .replace(/\bA plugin for\b/gi, "用于")
    .replace(/\bAn? macro\b/gi, "宏")
    .replace(/\bexporting\b/gi, "导出")
    .replace(/\bmodels\b/gi, "模型")
    .replace(/\bsystems\b/gi, "系统")
    .replace(/\bautomation\b/gi, "自动化")
    .replace(/\bworkflow\b/gi, "工作流")
    .replace(/\bagents?\b/gi, "智能体")
    .replace(/\breview\b/gi, "审查")
    .replace(/\bdata\b/gi, "数据")
    .replace(/\bdocuments?\b/gi, "文档")
    .replace(/\bsource code\b/gi, "源代码")
    .replace(/\bproject\b/gi, "项目")
    .replace(/\bwith\b/gi, "包含")
    .replace(/\band\b/gi, "和");
  if (zh === text) zh = `该条目用于扩展 Hi Code 工作台能力。原始简介：${text}`;
  return zh;
}

async function getStoreItemDetail(itemId) {
  let item = storeItemCache.get(itemId);
  if (!item) {
    const catalog = await listStoreCatalog();
    item = catalog.items.find((x) => x.id === itemId);
  }
  const state = loadStoreState();
  const record = state.installed[itemId];
  if (!item && !record) return { ok: false, error: "商店条目不存在" };
  const merged = item || {
    id: itemId,
    kind: record.kind,
    category: record.category || "other",
    name: record.name,
    summary: record.summary || "",
    tags: record.tags || [],
    sourceId: record.sourceId,
  };
  return {
    ok: true,
    item: {
      id: merged.id,
      kind: merged.kind,
      category: merged.category,
      name: merged.name,
      summary: merged.summary,
      tags: merged.tags || [],
      source: merged.source,
      sourceId: merged.sourceId,
      sourceName: merged.sourceName,
      installed: Boolean(record),
      enabled: record?.enabled !== false,
      installedAt: record?.installedAt,
    },
    detail: {
      translatedSummary: translateStoreItemToChinese(merged),
      installKind: merged.install?.kind || merged.kind,
      installedRecord: record ? {
        enabled: record.enabled !== false,
        installedAt: record.installedAt,
        sourceId: record.sourceId,
        result: record.result,
      } : null,
    },
  };
}

function sourceForStoreItem(item) {
  return STORE_SOURCES.find((s) => s.id === item.sourceId)
    || STORE_SOURCES.find((s) => s.id === "builtin-cn")
    || STORE_SOURCES[0];
}

function publicUser(user) {
  if (!user) return null;
  return { email: user.email, name: user.name || user.email.split("@")[0] };
}

function loadAuthStore() {
  const store = readJsonFile(AUTH_PATH, { users: {}, session: null });
  if (!store.users || typeof store.users !== "object") store.users = {};
  if (!("session" in store)) store.session = null;
  return store;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.salt || !user?.hash) return false;
  const candidate = crypto.scryptSync(password, user.salt, 64);
  const saved = Buffer.from(user.hash, "hex");
  return saved.length === candidate.length && crypto.timingSafeEqual(saved, candidate);
}

function currentAuthUser() {
  const store = loadAuthStore();
  return publicUser(store.session ? store.users[store.session] : null);
}

function registerAuthUser(payload = {}) {
  const email = normalizeEmail(payload.email);
  const name = String(payload.name || "").trim();
  const password = String(payload.password || "");
  if (!email || !email.includes("@")) return { ok: false, error: "请输入有效邮箱" };
  if (password.length < 6) return { ok: false, error: "密码至少 6 位" };

  const store = loadAuthStore();
  if (store.users[email]) return { ok: false, error: "这个邮箱已经注册" };
  const { salt, hash } = hashPassword(password);
  store.users[email] = { email, name: name || email.split("@")[0], salt, hash, createdAt: Date.now() };
  store.session = email;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true, user: publicUser(store.users[email]) };
}

function loginAuthUser(payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const store = loadAuthStore();
  const user = store.users[email];
  if (!user || !verifyPassword(password, user)) return { ok: false, error: "邮箱或密码不正确" };
  store.session = email;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true, user: publicUser(user) };
}

function logoutAuthUser() {
  const store = loadAuthStore();
  store.session = null;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function findSkillFiles(root, maxFiles = 80) {
  const found = [];
  const seen = new Set();
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length && found.length < maxFiles) {
    const { dir, depth } = stack.pop();
    if (!dir || seen.has(dir) || depth > 7) continue;
    seen.add(dir);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", ".venv", "__pycache__"].includes(entry.name)) stack.push({ dir: p, depth: depth + 1 });
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(p);
        if (found.length >= maxFiles) break;
      }
    }
  }
  return found;
}

function parseSkill(file) {
  try {
    const text = fs.readFileSync(file, "utf8").slice(0, 4000);
    const managed = storeRecordForManagedPath(file, "skill");
    const name = text.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() || path.basename(path.dirname(file));
    const description = text.match(/^description:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() || "本地 Skill";
    return {
      id: managed?.id,
      name,
      description: managed?.record?.summary || description,
      path: file,
      status: managed?.record?.enabled === false ? "disabled" : "available",
      source: managed ? "Hi Code Store" : undefined,
      storeItemId: managed?.id,
      enabled: managed ? managed.record.enabled !== false : undefined,
    };
  } catch {
    return null;
  }
}

function storeCapabilityEntries(kind) {
  const state = loadStoreState();
  return Object.entries(state.installed)
    .filter(([, record]) => record?.kind === kind)
    .map(([id, record]) => ({
      id,
      name: record.name || id,
      description: record.summary || record.preview?.item?.summary || `Hi Code Store ${kind}`,
      path: record.result?.imported?.[0]?.path || record.result?.path || "",
      source: "Hi Code Store",
      storeItemId: id,
      status: record.enabled === false ? "disabled" : kind === "mcp" ? (record.result?.server ? "configured" : "installed") : "installed",
      enabled: record.enabled !== false,
    }));
}

function listLocalSkills() {
  const roots = [
    path.join(STORE_DIR, "skills"),
    path.join(CODEX_DIR, "skills"),
    path.join(CODEX_DIR, "plugins", "cache"),
  ];
  const byName = new Map();
  for (const root of roots) {
    for (const file of findSkillFiles(root)) {
      if (isDisabledStorePath(file)) continue;
      const skill = parseSkill(file);
      if (skill && !byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }
  for (const skill of storeCapabilityEntries("skill")) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function listLocalPlugins() {
  const roots = [
    path.join(STORE_DIR, "plugins"),
    path.join(CODEX_DIR, "plugins", "cache", "openai-curated-remote"),
    path.join(CODEX_DIR, "plugins", "cache", "openai-curated"),
    path.join(CODEX_DIR, "plugins", "cache", "openai-bundled"),
    path.join(CODEX_DIR, "plugins", "cache", "openai-primary-runtime"),
  ];
  const plugins = new Map();
  for (const root of roots) {
    let names = [];
    try {
      names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = path.join(root, name);
      if (isDisabledStorePath(dir)) continue;
      const managed = storeRecordForManagedPath(dir, "plugin");
      const pluginId = managed?.id || name;
      const pluginName = managed?.record?.name || name;
      if (plugins.has(pluginName)) continue;
      plugins.set(pluginName, {
        id: pluginId,
        name: pluginName,
        description: managed?.record?.summary || pluginDescription(name),
        status: managed?.record?.enabled === false ? "disabled" : "installed",
        source: managed ? "Hi Code Store" : root.replace(os.homedir(), "~"),
        storeItemId: managed?.id,
        enabled: managed ? managed.record.enabled !== false : undefined,
      });
    }
  }
  for (const plugin of storeCapabilityEntries("plugin")) {
    if (!plugins.has(plugin.name)) plugins.set(plugin.name, plugin);
  }
  return Array.from(plugins.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function pluginDescription(name) {
  const known = {
    github: "仓库、Issue、PR 与代码协作",
    notion: "文档、知识库与任务管理",
    canva: "设计、演示与社媒素材",
    "hugging-face": "模型、数据集、Spaces 与训练任务",
    "data-analytics": "报告、仪表盘与数据分析",
    figma: "设计文件、组件与代码映射",
    "computer-use": "本地应用和浏览器自动化",
    "codex-security": "代码安全扫描与漏洞修复",
  };
  return known[name] || "本地插件";
}

function listConfiguredMcpServers() {
  const cfg = loadConfig();
  const servers = Object.entries(cfg.mcpServers || {}).map(([name, server]) => ({
    name,
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    envCount: server.env ? Object.keys(server.env).length : 0,
    status: "configured",
  }));
  for (const entry of storeCapabilityEntries("mcp")) {
    if (!servers.some((server) => server.name === entry.name)) {
      servers.push({
        name: entry.name,
        command: entry.command || "",
        args: [],
        envCount: 0,
        status: entry.status,
        source: entry.source,
        storeItemId: entry.storeItemId,
      });
    }
  }
  return servers;
}

function listLocalAgents() {
  const agents = new Map();
  const root = path.join(STORE_DIR, "agents");
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(root, entry.name);
    if (isDisabledStorePath(file)) continue;
    const data = readJsonFile(file, null);
    if (!data?.id && !data?.name) continue;
    agents.set(data.id || data.name, {
      id: data.id || data.name,
      name: data.name || data.role || data.id,
      description: data.summary || data.description || "Hi Code Store Agent",
      role: data.role || data.name || data.id,
      path: file,
      status: "installed",
      source: "Hi Code Store",
      storeItemId: data.id || storeRecordForManagedPath(file, "agent")?.id,
      enabled: true,
    });
  }
  for (const agent of storeCapabilityEntries("agent")) {
    if (!agents.has(agent.id)) {
      agents.set(agent.id, {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        role: agent.name,
        path: agent.path,
        status: "installed",
        source: "Hi Code Store",
      });
    }
  }
  return Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function resolveInCwd(p = cwd) {
  const cwdReal = fs.realpathSync.native(cwd);
  const abs = path.resolve(path.isAbsolute(p) ? p : path.join(cwd, p));
  if (!fs.existsSync(abs)) return null;
  const real = fs.realpathSync.native(abs);
  const rel = path.relative(cwdReal, real);
  if (rel && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  return real;
}

async function handleNativeOpenApp(text) {
  const request = parseOpenAppRequest(text);
  if (!request) return false;
  const title = `Open ${request.appName}`;
  const startId = handleRuntimeEvent({
    type: "tool:start",
    tool: "open_app",
    title,
    summary: `open -a ${request.appName}`,
    status: "running",
    payload: { appName: request.appName, requested: request.requested },
  });
  const result = await openMacApp(request.appName, request.candidates);
  handleRuntimeEvent({
    type: "tool:done",
    tool: "open_app",
    title,
    summary: result.ok ? "ok" : result.error,
    status: result.ok ? "done" : "error",
    payload: { parentId: startId, appName: result.appName || request.appName, requested: request.requested },
  });
  if (result.ok) {
    send("output", `已打开 ${request.requested}${result.appName && result.appName !== request.requested ? `（${result.appName}）` : ""}。\n`);
    return true;
  }
  send("output", `没能打开 ${request.requested}：${result.error}。将继续交给 Agent 处理。\n`);
  return false;
}

async function runRuntimeQueueJob(job) {
  try {
    await runRuntimeInput(job.input, job.metadata || {});
  } finally {
    finalizeIsolatedRuntimeJob(job);
  }
}

async function runRuntimeInput(text, metadata = {}) {
  if (!runtime) return;
  try {
    const executionCwd = typeof metadata.executionCwd === "string" ? metadata.executionCwd : "";
    if (executionCwd && path.resolve(executionCwd) !== path.resolve(cwd)) {
      await runRuntimeInputInIsolatedCwd(text, executionCwd);
    } else {
      const handledNative = await handleNativeOpenApp(text);
      if (!handledNative) await runtime.handleInput(text);
    }
  } catch (err) {
    send("output", `error: ${err?.message ?? err}\n`);
  } finally {
    send("turn-done");
  }
}

async function runRuntimeInputInIsolatedCwd(text, executionCwd) {
  const cfg = loadConfig();
  const ask = makeRendererAsk();
  const p = defaultProfile(cfg);
  const isolatedRuntime = createRuntime({
    cfg,
    cwd: executionCwd,
    mode: "default",
    systemPrompt: buildSystemPrompt(executionCwd, p.model, cfg.reasoningLevel),
    ask,
    eventSink: runtimeEventBus,
    legacyAssistantOutput: false,
    allowProcessExit: false,
  });
  send("output", `\n[isolated] ${executionCwd}\n`);
  try {
    await isolatedRuntime.handleInput(text);
  } finally {
    isolatedRuntime.shutdown();
  }
}

function finalizeIsolatedRuntimeJob(job) {
  const workspace = job?.metadata?.isolatedWorkspace;
  const jobCenterId = jobCenterIdFromRuntimeJob(job);
  if (!workspace || !jobCenterId) return;
  try {
    const changes = worktreeRunner.collectChanges(workspace);
    jobStore.appendJobEvent(jobCenterId, {
      type: changes.ok ? "worktree.patch.collected" : "worktree.patch.failed",
      message: changes.ok ? changes.summary : (changes.error || "patch collection failed"),
      actor: "worktree-runner",
      status: changes.ok ? "succeeded" : "failed",
      data: {
        workspaceId: workspace.id,
        changedFiles: changes.changedFiles,
        riskNotes: changes.riskNotes,
      },
    });
    for (const artifact of changes.artifacts || []) {
      jobStore.addArtifact(jobCenterId, {
        type: artifact.type,
        path: artifact.path,
        name: artifact.name,
        size: artifact.size,
        producedBy: { executor: "worktree-runner" },
        metadata: { workspaceId: workspace.id, providerRunId: job.metadata?.providerRunId },
      });
    }
    if (job.metadata?.cleanupIsolatedWorkspace !== false && workspace.mode !== "dry-run" && workspace.mode !== "direct") {
      const cleanup = worktreeRunner.cleanupWorkspace(workspace);
      jobStore.appendJobEvent(jobCenterId, {
        type: cleanup.ok ? "worktree.cleaned" : "worktree.cleanup.failed",
        message: cleanup.ok ? `Cleaned workspace ${workspace.id}` : (cleanup.error || "cleanup failed"),
        actor: "worktree-runner",
        status: cleanup.ok ? "succeeded" : "failed",
        data: { workspaceId: workspace.id, path: workspace.workspacePath, removed: cleanup.removed },
      });
    }
  } catch (err) {
    const preserved = worktreeRunner.preserveWorkspaceOnFailure(workspace, err?.message || "finalize isolated workspace failed");
    try {
      jobStore.appendJobEvent(jobCenterId, {
        type: "worktree.preserved",
        message: preserved.reason,
        actor: "worktree-runner",
        status: "warning",
        data: { workspaceId: workspace.id, path: workspace.workspacePath },
      });
    } catch {
      /* finalization must not crash queue draining */
    }
  }
}

// Temporary compatibility path for slash commands and legacy tool framing.
// Assistant model text always uses RuntimeEventBus, even when this is enabled.
function installBridge() {
  setSpinnerEnabled(false);
  console.log = (...a) => forwardRuntimeOutput(a.map(String).join(" ") + "\n");
  console.error = (...a) => forwardRuntimeOutput(a.map(String).join(" ") + "\n");
  process.stdout.write = (chunk, enc, cb) => {
    forwardRuntimeOutput(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof enc === "function") enc();
    else if (typeof cb === "function") cb();
    return true;
  };
}

function forwardRuntimeOutput(text) {
  const filtered = filterRuntimeOutput(text);
  if (filtered) send("output", filtered);
}

function filterRuntimeOutput(text) {
  const chunks = String(text || "").match(/[^\r\n]*(?:\r?\n|$)/g) || [];
  let output = "";
  for (const chunk of chunks) {
    if (!chunk) continue;
    const line = chunk.replace(/\r?\n$/, "");
    const ending = chunk.slice(line.length);
    if (shouldForwardRuntimeOutput(line)) output += line + ending;
  }
  return output;
}

function shouldForwardRuntimeOutput(text) {
  const clean = String(text || "").replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
  const trimmed = clean.trimStart();
  if (!trimmed) return true;
  return ![
    /^●\s/,
    /^⏺\s/,
    /^[┌│└]/,
    /^╔══/,
    /^╚══/,
    /^║\s/,
    /^↘\s*@/,
    /^↙\s*@/,
    /^▶\s/,
    /^◆\s/,
    /^★\s*synthesis/i,
    /^✓\s/,
    /^↳\s/,
    /^goal:/i,
    /^question:/i,
    /^members:/i,
    /^task plan:/i,
    /^⚠\s*permission required/i,
    /^permission required/i,
  ].some((pattern) => pattern.test(trimmed));
}

function buildRuntime() {
  const cfg = loadConfig();
  const ask = makeRendererAsk();
  const p = defaultProfile(cfg);
  runtime = createRuntime({
    cfg,
    cwd,
    mode: "default",
    systemPrompt: buildSystemPrompt(cwd, p.model, cfg.reasoningLevel),
    ask,
    eventSink: runtimeEventBus,
    legacyAssistantOutput: false,
    allowProcessExit: false,
  });
  send("ready", {
    model: p.model,
    baseURL: p.baseURL,
    cwd,
    reasoningLevel: cfg.reasoningLevel,
    version: app.getVersion(),
    sessionId: runtime?.sessionId || "",
    capabilities: modelCapabilityHint(p),
  });
  sendInputQueueState();
}

function makeRendererAsk() {
  return (q) =>
    new Promise((resolve) => {
      const id = ++askSeq;
      askResolvers.set(id, resolve);
      send("ask", { id, q: stripAnsi(q) });
    });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: "Hi Code",
    backgroundColor: "#f6f1e7",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.on("closed", () => {
    win = null;
  });
  win.once("ready-to-show", () => {
    win?.show();
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.on("did-finish-load", async () => {
    buildRuntime();
    await mainServices?.mcp?.initializeConfiguredServers();
    win?.show();
  });
  return win;
}

function ensureMainWindow() {
  const existing = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!existing) {
    return createWindow();
  }
  win = existing;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

mainServices = createMainServices();
registerIpcHandlers({
  services: mainServices,
  ipcMain,
  dialog,
  shell,
  logger: (event, payload) => appendRuntimeLog({ id: `ipc-${Date.now()}`, type: event, title: event, payload, createdAt: Date.now() }),
});

app.whenReady().then(() => {
  if (legacyStdoutBridgeEnabled) installBridge();
  else setSpinnerEnabled(false);
  ensureMainWindow();
  app.on("activate", () => {
    ensureMainWindow();
  });
  setTimeout(() => ensureMainWindow(), 500);
});

app.on("window-all-closed", () => {
  if (runtime) runtime.shutdown();
  if (process.platform !== "darwin") app.quit();
});

function createMainServices() {
  const services = {
    runtime: createRuntimeService({
      getRuntime: () => runtime,
      inputQueue,
      askResolvers,
      send,
      jobStore,
      getCwd: () => cwd,
    }),
    queue: createQueueService({ inputQueue }),
    security: createSecurityService({
      currentAuthUser,
      registerUser: registerAuthUser,
      loginUser: loginAuthUser,
      logoutUser: logoutAuthUser,
      logger: (event, payload) => appendRuntimeLog({ id: `security-${Date.now()}`, type: event, title: event, payload, createdAt: Date.now() }),
    }),
    mcp: createMcpService({
      initMcp,
      loadConfig,
      listLocalPlugins,
      listLocalSkills,
      listConfiguredMcpServers,
      listLocalAgents,
    }),
    store: createStoreService({
      listStoreCatalog,
      setStoreSource,
      previewStoreItem,
      installStoreItem,
      getStoreItemDetail,
      enableStoreItem,
      disableStoreItem,
      uninstallStoreItem,
    }),
    job: createJobService({ jobStore, shell, allowedArtifactRoots: [HICODE_DIR, () => cwd] }),
    provider: createProviderService({
      inputQueue,
      jobStore,
      diffService,
      worktreeRunner,
      getCwd: () => cwd,
      configPath: PROVIDER_CONFIG_PATH,
      runArtifactDir: PROVIDER_RUN_DIR,
      interruptRuntime: () => mainServices?.runtime?.interrupt(),
      logger: (event, payload) => appendRuntimeLog({ id: `provider-${Date.now()}`, type: event, title: event, payload, createdAt: Date.now() }),
    }),
    worktree: createWorktreeService({
      runner: worktreeRunner,
      jobStore,
      getCwd: () => cwd,
    }),
    diff: createDiffIpcService({
      logDir: LOG_DIR,
      listToolEvents,
      readRecoverableTasksFromLogs,
      readRecoverableTasks,
      listDiffs,
      acceptDiff,
      rejectDiff,
      acceptAllDiffs,
      rejectAllDiffs,
      clearArchivedDiffs,
    }),
    git: createGitService({
      getCwd: () => cwd,
      gitWorkflowStatus,
      gitFileDiff,
      gitStage,
      gitUnstage,
      gitGenerateCommitMessage,
      gitCommit,
    }),
    workspace: createWorkspaceService({
      dialog,
      getWindow: () => win,
      getCwd: () => cwd,
      setCwd: (nextCwd) => { cwd = nextCwd; },
      buildRuntime,
      resolveInCwd,
      listSessions,
      deleteSession,
      loadSession,
      replaySessionMessages,
      getRuntime: () => runtime,
      configPath: CONFIG_PATH,
      loadConfig,
      defaultProfile,
      buildSystemPrompt,
      send,
    }),
    appInfo: createAppInfoService({
      getVersion: () => app.getVersion(),
      shell,
      dataDir: HICODE_DIR,
      configPath: CONFIG_PATH,
    }),
    usage: createUsageService({ logDir: LOG_DIR }),
  };
  services.arena = createPatchArenaService({
    arenaStore: patchArenaStore,
    jobStore,
    worktreeRunner,
    getCwd: () => cwd,
    artifactRoot: PATCH_ARENA_ARTIFACT_DIR,
    providerService: services.provider,
    shell,
  });
  services.industrialProject = createIndustrialProjectService({
    getCwd: () => cwd,
    jobStore,
  });
  services.domainPack = createDomainPackService({
    manager: domainPackManager,
    getCwd: () => cwd,
    jobStore,
  });
  services.agentTeam = createAgentTeamService({
    store: agentTeamStore,
    domainPackManager,
    jobStore,
    getCwd: () => cwd,
  });
  services.industrialTool = createIndustrialToolService({
    registry: industrialToolRegistry,
    getCwd: () => cwd,
    jobStore,
    domainPackManager,
  });
  services.qualityGate = createQualityGateService({
    getCwd: () => cwd,
    jobStore,
  });
  services.release = createReleaseService({
    getCwd: () => cwd,
    jobStore,
    shell,
  });
  services.sampleProject = createSampleProjectService({
    getCwd: () => cwd,
    jobStore,
    registry: industrialToolRegistry,
    domainPackManager,
  });
  return services;
}
