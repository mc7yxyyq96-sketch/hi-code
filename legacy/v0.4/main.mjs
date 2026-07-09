// Hi Code — Electron main process. Reuses the compiled agent core (dist/) and
// bridges its terminal-style output to the renderer over IPC.
process.env.FORCE_COLOR = "1"; // make chalk emit ANSI even without a TTY

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { loadConfig, defaultProfile } from "../dist/config.js";
import { createRuntime, buildSystemPrompt } from "../dist/runtime.js";
import { setSpinnerEnabled } from "../dist/ui.js";
import { initMcp } from "../dist/mcp.js";
import { listSessions, deleteSession } from "../dist/session-store.js";
import { DiffService } from "../dist/diff-service.js";

const CONFIG_PATH = path.join(os.homedir(), ".vibe", "config.json");
const VIBE_DIR = path.join(os.homedir(), ".vibe");
const AUTH_PATH = path.join(VIBE_DIR, "auth.json");
const STORE_PATH = path.join(VIBE_DIR, "store.json");
const STORE_DIR = path.join(VIBE_DIR, "store");
const CODEX_DIR = path.join(os.homedir(), ".codex");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win = null;
let runtime = null;
let cwd = os.homedir();
const askResolvers = new Map();
let askSeq = 0;
const toolEvents = [];
const diffService = new DiffService(() => cwd);
const MAX_TOOL_EVENTS = 500;
const storeItemCache = new Map();

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
    catalogURL: "https://gitee.com/hicode-ai/skill-store/raw/main/catalog.json",
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
    catalogURL: "https://raw.githubusercontent.com/hicode-ai/skill-store/main/catalog.json",
    npmRegistry: "https://registry.npmjs.org",
    note: "从 GitHub raw catalog 拉取官方/社区条目。",
  },
];

const BUILTIN_STORE_CATALOG = [
  {
    id: "skill-auto-code-review",
    kind: "skill",
    category: "review",
    name: "自动代码审查",
    summary: "像 Codex/Claude Code 一样读取 git diff、定位风险、指出缺陷和测试缺口。",
    tags: ["自动审查", "代码审查", "review", "pr", "diff", "bug", "测试", "安全"],
    aliases: ["自动审查", "自动代码审查", "审查代码", "代码review", "review code", "PR审查", "变更审查", "diff审查"],
    source: "builtin",
    install: {
      kind: "skill",
      dir: "auto-code-review",
      skill: {
        name: "auto-code-review",
        description: "Use when the user asks to automatically review code, PRs, diffs, branches, or recent changes for bugs, regressions, security issues, and missing tests.",
        body: "Start with git status and git diff. Inspect changed files before judging. Lead with concrete findings ordered by severity, include file/line references when possible, then list test gaps and assumptions. If no issues are found, say so directly.",
      },
    },
  },
  {
    id: "agent-auto-reviewer",
    kind: "agent",
    category: "review",
    name: "自动审查 Agent",
    summary: "只读 reviewer，自动检查变更风险、回归、权限边界和缺失测试。",
    tags: ["自动审查", "reviewer", "agent", "qa", "security"],
    aliases: ["自动审查", "reviewer", "代码审查员", "自动review", "质量审查", "安全审查"],
    source: "builtin",
    install: {
      kind: "agent",
      agent: {
        role: "reviewer",
        modelProfile: "default",
        bashMode: "read-only",
        prompt: "Review the repository or diff without modifying files. Prioritize correctness, security, regressions, missing tests, and user-visible behavior changes. Return findings first.",
      },
    },
  },
  {
    id: "plugin-auto-review-workflow",
    kind: "plugin",
    category: "review",
    name: "自动审查工作流",
    summary: "预置 /review 工作流、审查面板和 reviewer/测试 Agent 编排入口。",
    tags: ["自动审查", "review", "plugin", "workflow", "codex"],
    aliases: ["自动审查", "review workflow", "审查工作流", "codex review", "claude code review"],
    source: "builtin",
    install: {
      kind: "plugin",
      manifest: {
        name: "auto-review-workflow",
        version: "0.1.0",
        contributes: ["commands:/review", "views:review-panel", "agents:reviewer", "skills:auto-code-review"],
      },
    },
  },
  {
    id: "skill-local-app-control",
    kind: "skill",
    category: "local",
    name: "本机应用控制",
    summary: "识别“打开 ToDesk / Apple Music / Chrome”等请求，并通过 macOS open 启动应用。",
    tags: ["本机应用", "打开app", "macOS", "automation", "ToDesk", "Apple Music"],
    aliases: ["打开app", "打开应用", "启动应用", "打开Apple Music", "打开ToDesk", "本机控制", "电脑控制"],
    source: "builtin",
    install: {
      kind: "skill",
      dir: "local-app-control",
      skill: {
        name: "local-app-control",
        description: "Use when the user asks to open or launch local macOS applications such as ToDesk, Music, Chrome, Safari, WeChat, or Terminal.",
        body: "For app-launch requests, use the local app open capability or bash `open -a <App Name>` when allowed. Confirm the app was opened or explain the exact macOS error.",
      },
    },
  },
  {
    id: "skill-playwright",
    kind: "skill",
    category: "browser",
    name: "Playwright UI 验证",
    summary: "驱动真实浏览器做 UI 流程验证、截图和回归检查。",
    tags: ["browser", "qa", "frontend", "自动测试", "UI审查"],
    aliases: ["UI验证", "自动测试", "浏览器测试", "截图验证", "playwright", "前端审查"],
    source: "builtin",
    install: {
      kind: "skill",
      dir: "playwright-ui",
      skill: {
        name: "playwright-ui",
        description: "Use when validating a local web UI with Playwright screenshots, snapshots, clicks, typing, and basic flow checks.",
        body: "Prefer the bundled Playwright CLI wrapper when available. Open the target, take a snapshot, interact through stable refs, and capture screenshots under output/playwright/.",
      },
    },
  },
  {
    id: "skill-security-review",
    kind: "skill",
    category: "security",
    name: "代码安全审查",
    summary: "按威胁模型审查路径、命令、MCP、密钥和权限边界。",
    tags: ["security", "review", "自动审查", "安全审查"],
    aliases: ["自动审查", "安全审查", "漏洞扫描", "密钥泄露", "权限审查", "MCP安全"],
    source: "builtin",
    install: {
      kind: "skill",
      dir: "security-review",
      skill: {
        name: "security-review",
        description: "Use when reviewing repository changes for security issues, including path traversal, command execution, secrets, auth, and MCP/tool boundaries.",
        body: "Prioritize exploitable findings with file/line references. Verify source-to-sink paths and avoid speculative issues.",
      },
    },
  },
  {
    id: "mcp-filesystem",
    kind: "mcp",
    category: "local",
    name: "Filesystem MCP",
    summary: "把当前项目目录暴露给 MCP 工具，适合本地文件读写类工作流。",
    tags: ["mcp", "filesystem", "文件系统", "本地文件"],
    aliases: ["文件系统", "本地文件", "读写文件", "filesystem"],
    source: "npm",
    install: {
      kind: "mcp",
      server: {
        name: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      },
    },
  },
  {
    id: "mcp-github",
    kind: "mcp",
    category: "git",
    name: "GitHub MCP",
    summary: "连接 GitHub issue、PR、repo 上下文。需要配置 GITHUB_TOKEN。",
    tags: ["mcp", "github", "git", "PR审查"],
    aliases: ["github", "PR", "issue", "pull request", "仓库", "代码审查"],
    source: "npm",
    install: {
      kind: "mcp",
      server: {
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "填入你的 GitHub token" },
      },
    },
  },
  {
    id: "agent-reviewer",
    kind: "agent",
    category: "code",
    name: "Reviewer Agent",
    summary: "专门做代码审查、风险发现、测试缺口检查的只读审查员。",
    tags: ["agent", "review", "qa", "自动审查"],
    aliases: ["自动审查", "reviewer", "代码审查员", "质量检查", "测试缺口"],
    source: "builtin",
    install: {
      kind: "agent",
      agent: {
        role: "reviewer",
        modelProfile: "default",
        bashMode: "read-only",
        prompt: "Review code changes for bugs, regressions, missing tests, and security risks. Prefer concrete file references.",
      },
    },
  },
  {
    id: "agent-architect",
    kind: "agent",
    category: "code",
    name: "Architect Agent",
    summary: "负责拆任务、定边界、做方案和验收标准的架构 Agent。",
    tags: ["agent", "architecture", "规划", "架构"],
    aliases: ["架构", "规划", "拆任务", "技术方案", "全栈经理"],
    source: "builtin",
    install: {
      kind: "agent",
      agent: {
        role: "architect",
        modelProfile: "default",
        bashMode: "read-only",
        prompt: "Plan implementation boundaries, contracts, migration steps, and validation strategy before coding.",
      },
    },
  },
  {
    id: "plugin-git-workflow",
    kind: "plugin",
    category: "git",
    name: "Git 工作流套件",
    summary: "提供 diff、stage、commit、PR 相关命令和 UI 能力的插件骨架。",
    tags: ["plugin", "git", "diff", "commit", "PR审查"],
    aliases: ["git", "diff", "commit", "stage", "PR", "变更审查"],
    source: "builtin",
    install: {
      kind: "plugin",
      manifest: {
        name: "git-workflow",
        version: "0.1.0",
        contributes: ["commands", "views", "skills"],
      },
    },
  },
  {
    id: "plugin-data-analytics",
    kind: "plugin",
    category: "data",
    name: "数据分析套件",
    summary: "面向报表、仪表盘、KPI 分析的数据工作流插件骨架。",
    tags: ["plugin", "data", "dashboard", "报表", "数据分析"],
    aliases: ["数据分析", "报表", "仪表盘", "dashboard", "KPI"],
    source: "builtin",
    install: {
      kind: "plugin",
      manifest: {
        name: "data-analytics",
        version: "0.1.0",
        contributes: ["skills", "reports", "dashboards"],
      },
    },
  },
];

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function rememberToolEvent(event) {
  toolEvents.push(event);
  while (toolEvents.length > MAX_TOOL_EVENTS) toolEvents.shift();
  send("tool-event", event);
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

  rememberToolEvent(normalized);
  if (diffChanged) send("diffs-changed", listDiffs());
  return normalized.id;
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
  fs.mkdirSync(VIBE_DIR, { recursive: true, mode: 0o700 });
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

function validUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateStoreItem(raw) {
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
  }

  if (installKind === "mcp" || item.kind === "mcp") {
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
  }

  if (installKind === "download") {
    const install = item.install || {};
    const urls = [install.url, ...Object.values(install.mirrors || {})].filter(Boolean);
    if (!urls.length) errors.push("download 安装必须提供 url 或 mirrors");
    for (const url of urls) {
      if (!validUrl(url)) errors.push(`下载地址无效: ${url}`);
      else if (String(url).startsWith("http:")) warnings.push("下载地址使用 HTTP，建议换成 HTTPS 或可信内网源");
    }
    if (install.filename && /[\\/]/.test(String(install.filename))) errors.push("download filename 不能包含路径分隔符");
    if (!install.sha256) warnings.push("download 条目未提供 sha256，暂无法做完整性校验");
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
    const { item } = validateStoreItem(raw);
    if (!item.valid) {
      invalidItems.push({
        id: item.id || "(missing id)",
        name: item.name || item.id || "(unnamed)",
        errors: item.validationErrors,
      });
      continue;
    }
    const sourceForItem = STORE_SOURCES.find((s) => s.id === item.sourceId) || source;
    merged.set(item.id, {
      ...item,
      sourceId: sourceForItem.id,
      sourceName: item.sourceName || sourceForItem.name,
      sourceRegion: item.sourceRegion || sourceForItem.region,
      installed: Boolean(state.installed[item.id]),
      installedAt: state.installed[item.id]?.installedAt,
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
  return { server: server.name };
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

async function installDownload(item, source) {
  const install = item.install || {};
  const url = install.mirrors?.[source.id] || install.mirrors?.[source.region] || install.url;
  if (!url) throw new Error("这个条目没有可用下载地址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const dir = ensureStoreDir("downloads", item.id.replace(/[^a-z0-9._-]+/gi, "-"));
    const filename = install.filename || path.basename(new URL(url).pathname) || `${item.id}.bin`;
    const file = path.join(dir, filename);
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    writeTextFilePrivate(path.join(dir, "manifest.json"), JSON.stringify({ id: item.id, name: item.name, kind: item.kind, source: source.id, file }, null, 2));
    return { path: file, bytes: bytes.length };
  } finally {
    clearTimeout(timer);
  }
}

function downloadUrlForSource(item, source) {
  const install = item.install || {};
  return install.mirrors?.[source.id] || install.mirrors?.[source.region] || install.url || "";
}

function previewChange(action, target, detail) {
  return { action, target: displayPath(target), detail };
}

function buildInstallPreview(item, source) {
  const { errors, warnings: validationWarnings } = validateStoreItem(item);
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
    const dir = path.join(STORE_DIR, "downloads", safeStoreName(item.id));
    const filename = item.install?.filename || (url ? path.basename(new URL(url).pathname) : "") || `${item.id}.bin`;
    changes.push(previewChange("download", url, "从当前下载源拉取安装包"));
    changes.push(previewChange("write", path.join(dir, filename), "写入下载缓存文件"));
    changes.push(previewChange("write", path.join(dir, "manifest.json"), "记录下载来源和安装元数据"));
    permissions.push("允许 Hi Code 从网络下载该条目的安装文件。");
    permissions.push("允许 Hi Code 写入本地商店缓存目录。");
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

async function installStoreItem(itemId) {
  const previewResult = await previewStoreItem(itemId);
  if (!previewResult.ok) return previewResult;
  const item = storeItemCache.get(itemId);
  if (!item) return { ok: false, error: "商店条目不存在或 manifest 未通过校验" };
  const source = sourceForStoreItem(item);
  try {
    let result;
    if (item.install?.kind === "download") result = await installDownload(item, source);
    else if (item.kind === "skill") result = installSkill(item);
    else if (item.kind === "mcp") result = installMcp(item, source);
    else if (item.kind === "agent") result = installAgent(item);
    else if (item.kind === "plugin") result = installPlugin(item);
    else throw new Error("unsupported store item kind");

    const state = loadStoreState();
    state.installed[item.id] = {
      kind: item.kind,
      name: item.name,
      sourceId: source.id,
      installedAt: Date.now(),
      result,
      preview: previewResult.preview,
    };
    saveStoreState(state);
    return { ok: true, item: { ...item, installed: true }, result };
  } catch (err) {
    return { ok: false, error: err?.message || "安装失败" };
  }
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
    const name = text.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() || path.basename(path.dirname(file));
    const description = text.match(/^description:\s*["']?([^"'\n]+)["']?/m)?.[1]?.trim() || "本地 Skill";
    return { name, description, path: file, status: "available" };
  } catch {
    return null;
  }
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
      const skill = parseSkill(file);
      if (skill && !byName.has(skill.name)) byName.set(skill.name, skill);
    }
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
      if (plugins.has(name)) continue;
      plugins.set(name, {
        name,
        description: pluginDescription(name),
        status: "installed",
        source: root.replace(os.homedir(), "~"),
      });
    }
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
  return Object.entries(cfg.mcpServers || {}).map(([name, server]) => ({
    name,
    command: server.command,
    args: Array.isArray(server.args) ? server.args : [],
    envCount: server.env ? Object.keys(server.env).length : 0,
    status: "configured",
  }));
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

function parseOpenAppRequest(text) {
  const value = String(text || "")
    .trim()
    .replace(/[。.!！?？]+$/g, "");
  const match = value.match(/^(?:帮我|请|麻烦你|能不能)?\s*(?:打开|启动|运行)\s*(?:一下|下)?\s*(.+)$/i);
  if (!match) return null;
  const rawName = match[1].trim().replace(/^[-—:：\s]+/, "");
  if (!rawName || rawName.length > 80) return null;
  const normalized = rawName.toLowerCase().replace(/\s+/g, " ").trim();
  const aliases = {
    "apple music": "Music",
    "music": "Music",
    "音乐": "Music",
    "音乐app": "Music",
    "todesk": "ToDesk",
    "to desk": "ToDesk",
    "向日葵": "SunloginClient",
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "谷歌浏览器": "Google Chrome",
    "safari": "Safari",
    "微信": "WeChat",
    "wechat": "WeChat",
    "终端": "Terminal",
    "terminal": "Terminal",
    "访达": "Finder",
    "finder": "Finder",
  };
  return {
    requested: rawName,
    appName: aliases[normalized] || rawName.replace(/\bapp$/i, "").trim(),
  };
}

function openMacApp(appName) {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, error: "本机应用启动目前只支持 macOS。" });
      return;
    }
    const child = spawn("/usr/bin/open", ["-a", appName], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: err.trim() || `open -a 退出码 ${code}` });
    });
  });
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
  const result = await openMacApp(request.appName);
  handleRuntimeEvent({
    type: "tool:done",
    tool: "open_app",
    title,
    summary: result.ok ? "ok" : result.error,
    status: result.ok ? "done" : "error",
    payload: { parentId: startId, appName: request.appName, requested: request.requested },
  });
  send("output", result.ok
    ? `已打开 ${request.requested}。\n`
    : `没能打开 ${request.requested}：${result.error}\n`);
  send("turn-done");
  return true;
}

// Route the agent core's console/stdout output to the renderer.
function installBridge() {
  setSpinnerEnabled(false);
  console.log = (...a) => send("output", a.map(String).join(" ") + "\n");
  console.error = (...a) => send("output", a.map(String).join(" ") + "\n");
  process.stdout.write = (chunk, enc, cb) => {
    send("output", typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof enc === "function") enc();
    else if (typeof cb === "function") cb();
    return true;
  };
}

function buildRuntime() {
  const cfg = loadConfig();
  const ask = (q) =>
    new Promise((resolve) => {
      const id = ++askSeq;
      askResolvers.set(id, resolve);
      send("ask", { id, q: stripAnsi(q) });
    });
  const p = defaultProfile(cfg);
  runtime = createRuntime({
    cfg,
    cwd,
    mode: "default",
    systemPrompt: buildSystemPrompt(cwd, p.model, cfg.reasoningLevel),
    ask,
    emitEvent: handleRuntimeEvent,
  });
  send("ready", { model: p.model, baseURL: p.baseURL, cwd, reasoningLevel: cfg.reasoningLevel });
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
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.webContents.on("did-finish-load", async () => {
    buildRuntime();
    const cfg = loadConfig();
    if (Object.keys(cfg.mcpServers).length) await initMcp(cfg.mcpServers).catch(() => {});
  });
}

app.whenReady().then(() => {
  installBridge();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (runtime) runtime.shutdown();
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC ----
ipcMain.on("input", async (_e, text) => {
  if (!runtime) return;
  try {
    const handledNative = await handleNativeOpenApp(text);
    if (!handledNative) await runtime.handleInput(text);
  } catch (err) {
    send("output", `error: ${err?.message ?? err}\n`);
  }
  send("turn-done");
});

ipcMain.on("ask-response", (_e, { id, value }) => {
  const r = askResolvers.get(id);
  if (r) {
    askResolvers.delete(id);
    r(value);
  }
});

ipcMain.on("interrupt", () => {
  const stopped = runtime?.abort();
  if (stopped) send("output", "\n⏹ 已请求停止当前任务。\n");
  send("turn-done");
});

ipcMain.handle("auth-status", () => ({ user: currentAuthUser() }));

ipcMain.handle("register", (_e, payload) => {
  const email = normalizeEmail(payload?.email);
  const name = String(payload?.name || "").trim();
  const password = String(payload?.password || "");
  if (!email || !email.includes("@")) return { ok: false, error: "请输入有效邮箱" };
  if (password.length < 6) return { ok: false, error: "密码至少 6 位" };

  const store = loadAuthStore();
  if (store.users[email]) return { ok: false, error: "这个邮箱已经注册" };
  const { salt, hash } = hashPassword(password);
  store.users[email] = { email, name: name || email.split("@")[0], salt, hash, createdAt: Date.now() };
  store.session = email;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true, user: publicUser(store.users[email]) };
});

ipcMain.handle("login", (_e, payload) => {
  const email = normalizeEmail(payload?.email);
  const password = String(payload?.password || "");
  const store = loadAuthStore();
  const user = store.users[email];
  if (!user || !verifyPassword(password, user)) return { ok: false, error: "邮箱或密码不正确" };
  store.session = email;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true, user: publicUser(user) };
});

ipcMain.handle("logout", () => {
  const store = loadAuthStore();
  store.session = null;
  writePrivateJson(AUTH_PATH, store);
  return { ok: true };
});

ipcMain.handle("list-capabilities", () => {
  return {
    plugins: listLocalPlugins(),
    skills: listLocalSkills(),
    mcp: listConfiguredMcpServers(),
  };
});

ipcMain.handle("list-store", async (_e, options) => listStoreCatalog(options));

ipcMain.handle("set-store-source", (_e, sourceId) => {
  const source = STORE_SOURCES.find((s) => s.id === sourceId);
  if (!source) return { ok: false, error: "下载源不存在" };
  const state = loadStoreState();
  state.sourceId = source.id;
  saveStoreState(state);
  return { ok: true, source };
});

ipcMain.handle("preview-store-item", async (_e, itemId) => previewStoreItem(itemId));

ipcMain.handle("install-store-item", async (_e, itemId) => installStoreItem(itemId));

ipcMain.handle("tool-events:list", () => listToolEvents());

ipcMain.handle("diffs:list", () => listDiffs());

ipcMain.handle("diffs:accept", (_e, id) => acceptDiff(id));

ipcMain.handle("diffs:reject", (_e, id) => rejectDiff(id));

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (!r.canceled && r.filePaths[0]) {
    cwd = r.filePaths[0];
    buildRuntime();
  }
  return cwd;
});

ipcMain.handle("get-cwd", () => cwd);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "release", "__pycache__"]);

ipcMain.handle("list-dir", (_e, dir) => {
  const target = resolveInCwd(dir || cwd);
  if (!target) return [];
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return entries
      .filter((e) => !(e.isDirectory() && IGNORE_DIRS.has(e.name)) && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(target, e.name), dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});

ipcMain.handle("read-file", (_e, p) => {
  try {
    const target = resolveInCwd(p);
    if (!target) return { error: "path escapes workspace" };
    const stat = fs.statSync(target);
    if (stat.size > 1_000_000) return { error: "file too large to preview" };
    return { content: fs.readFileSync(target, "utf8"), path: target };
  } catch (err) {
    return { error: err?.message ?? "cannot read file" };
  }
});

ipcMain.handle("list-sessions", () => {
  try {
    return listSessions(cwd);
  } catch {
    return [];
  }
});

ipcMain.handle("resume-session", (_e, id) => {
  try {
    return runtime ? runtime.resume(id) : [];
  } catch {
    return [];
  }
});

ipcMain.handle("delete-session", (_e, id) => {
  try {
    return deleteSession(id);
  } catch {
    return false;
  }
});

ipcMain.handle("get-config", () => {
  try {
    return fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  } catch {
    return "";
  }
});

ipcMain.handle("save-config", (_e, text) => {
  try {
    JSON.parse(text); // validate
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(CONFIG_PATH, text, { mode: 0o600 });
    try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
    const cfg = loadConfig();
    const p = defaultProfile(cfg);
    if (runtime?.updateConfig) {
      runtime.updateConfig(cfg, buildSystemPrompt(cwd, p.model, cfg.reasoningLevel));
      send("ready", { model: p.model, baseURL: p.baseURL, cwd, reasoningLevel: cfg.reasoningLevel });
    } else {
      buildRuntime();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? "invalid JSON" };
  }
});

ipcMain.handle("test-model", async (_e, profile) => {
  const baseURL = String(profile?.baseURL || "").replace(/\/+$/, "");
  const apiKey = String(profile?.apiKey || "");
  const model = String(profile?.model || "");
  if (!baseURL) return { ok: false, error: "请填写 Base URL" };
  if (!model) return { ok: false, error: "请填写模型名" };
  if (!apiKey) return { ok: false, error: "请填写 API Key；本地模型可填 sk-no-key-required" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const body = {
      model,
      messages: [{ role: "user", content: "Reply with ok." }],
      max_tokens: 8,
      stream: false,
    };
    if (!shouldOmitTemperatureForBaseURL(baseURL)) body.temperature = 0;

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: modelTestError(res.status, text, baseURL) };
    return { ok: true, message: "连接成功" };
  } catch (err) {
    const message = err?.name === "AbortError" ? "连接超时" : (err?.message ?? "连接失败");
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
});

function shouldOmitTemperatureForBaseURL(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
}

function modelTestError(status, text, baseURL) {
  const raw = String(text || "").slice(0, 220);
  const endpoint = String(baseURL || "");
  if (status === 401) {
    if (isKimiEndpoint(endpoint)) {
      return `Kimi 鉴权失败：请确认 API Key 属于当前线路。国内开放平台请选择“Kimi 国内”，全球平台请选择“Kimi 全球”，Kimi Code 订阅请选择“Kimi Code”。如果截图或地址栏暴露过 Key，请在控制台删除后重建。原始错误：HTTP 401 ${raw}`;
    }
    return `API Key 鉴权失败：请确认 Key 完整、未过期、账户可用。原始错误：HTTP 401 ${raw}`;
  }
  if (status === 404 && isKimiEndpoint(endpoint)) {
    return `Kimi 地址或模型不匹配：请换一个 Kimi 入口，或在高级 JSON 里改成控制台支持的模型名。原始错误：HTTP 404 ${raw}`;
  }
  if (status === 400 && isKimiEndpoint(endpoint) && /temperature/i.test(raw)) {
    return `Kimi 参数校验失败：该模型可能不接受 temperature 参数，新版请求已自动省略 temperature。请重新测试。原始错误：HTTP 400 ${raw}`;
  }
  return `HTTP ${status}: ${raw}`;
}

function isKimiEndpoint(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
}
