/* Hi Code renderer — Codex-like workspace UI. */
if (!window.hicode) {
  const outputHandlers = [], readyHandlers = [], turnDoneHandlers = [], askHandlers = [], toolEventHandlers = [], diffsChangedHandlers = [];
  const sessions = [
    { id: "demo-1", firstPrompt: "优化 Hi Code 米白色工作台界面", updatedAt: Date.now() - 1000 * 60 * 12, messageCount: 8 },
    { id: "demo-2", firstPrompt: "检查 MCP 权限与文件沙箱", updatedAt: Date.now() - 1000 * 60 * 58, messageCount: 14 },
    { id: "demo-3", firstPrompt: "给 reviewer 加只读 bash", updatedAt: Date.now() - 1000 * 60 * 180, messageCount: 6 },
  ];
  let demoUser = null;
  const demoStore = [
    { id: "skill-playwright", kind: "skill", category: "browser", name: "Playwright UI 验证", summary: "驱动真实浏览器验证本地 UI。", tags: ["browser", "qa"], installed: false },
    { id: "skill-security-review", kind: "skill", category: "security", name: "代码安全审查", summary: "按威胁模型审查路径、命令、MCP、密钥和权限边界。", tags: ["security", "review"], installed: false },
    { id: "mcp-filesystem", kind: "mcp", category: "local", name: "Filesystem MCP", summary: "把当前项目目录暴露给 MCP 工具。", tags: ["mcp", "filesystem"], installed: false },
    { id: "mcp-github", kind: "mcp", category: "git", name: "GitHub MCP", summary: "连接 GitHub issue、PR、repo 上下文。", tags: ["mcp", "github", "git"], installed: false },
    { id: "agent-reviewer", kind: "agent", category: "code", name: "Reviewer Agent", summary: "只读代码审查员，检查风险和测试缺口。", tags: ["agent", "review"], installed: false },
    { id: "agent-architect", kind: "agent", category: "code", name: "Architect Agent", summary: "负责拆任务、定边界、做方案和验收标准。", tags: ["agent", "architecture"], installed: false },
    { id: "plugin-git-workflow", kind: "plugin", category: "git", name: "Git 工作流套件", summary: "提供 diff、stage、commit、PR 能力。", tags: ["plugin", "git"], installed: false },
    { id: "plugin-data-analytics", kind: "plugin", category: "data", name: "数据分析套件", summary: "面向报表、仪表盘、KPI 分析的数据工作流。", tags: ["plugin", "data"], installed: false },
  ];
  const demoFiles = {
    "/Users/liu/vibe": [
      { name: "src", path: "/Users/liu/vibe/src", dir: true },
      { name: "renderer", path: "/Users/liu/vibe/renderer", dir: true },
      { name: "package.json", path: "/Users/liu/vibe/package.json", dir: false },
      { name: "README.md", path: "/Users/liu/vibe/README.md", dir: false },
    ],
    "/Users/liu/vibe/src": [
      { name: "agent.ts", path: "/Users/liu/vibe/src/agent.ts", dir: false },
      { name: "runtime.ts", path: "/Users/liu/vibe/src/runtime.ts", dir: false },
      { name: "tools", path: "/Users/liu/vibe/src/tools", dir: true },
    ],
    "/Users/liu/vibe/renderer": [
      { name: "index.html", path: "/Users/liu/vibe/renderer/index.html", dir: false },
      { name: "renderer.js", path: "/Users/liu/vibe/renderer/renderer.js", dir: false },
      { name: "style.css", path: "/Users/liu/vibe/renderer/style.css", dir: false },
    ],
  };
  const demoEvents = [
    {
      id: "evt-demo-1",
      type: "tool:start",
      tool: "read_file",
      title: "Read src/runtime.ts",
      summary: "src/runtime.ts",
      status: "done",
      createdAt: Date.now() - 1000 * 60 * 3,
    },
    {
      id: "evt-demo-2",
      type: "diff:created",
      tool: "edit_file",
      title: "Changed renderer/renderer.js",
      summary: "renderer/renderer.js",
      status: "done",
      path: "renderer/renderer.js",
      diffId: "diff-demo-1",
      createdAt: Date.now() - 1000 * 80,
    },
  ];
  const demoDiffs = [
    {
      id: "diff-demo-1",
      sessionId: "demo",
      turnId: "demo-turn-1",
      path: "renderer/renderer.js",
      absPath: "/Users/liu/vibe/renderer/renderer.js",
      before: "function renderWorkbench() {\n  return \"chat only\";\n}\n",
      after: "function renderWorkbench() {\n  return \"timeline + diff\";\n}\n",
      status: "pending",
      tool: "edit_file",
      createdAt: Date.now() - 1000 * 80,
    },
  ];
  let demoConfig = {
    defaultProfile: "default",
    profiles: {
      default: {
        name: "default",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: "",
        model: "deepseek-chat",
        contextWindow: 65536,
        temperature: 0.2,
      },
    },
    compactThreshold: 0.75,
    reasoningLevel: "medium",
    sandbox: false,
    mcpServers: {},
  };
  window.hicode = {
    onOutput: (cb) => outputHandlers.push(cb),
    onReady: (cb) => {
      readyHandlers.push(cb);
      const p = demoConfig.profiles[demoConfig.defaultProfile] || demoConfig.profiles.default;
      setTimeout(() => cb({ model: p.model, baseURL: p.baseURL, cwd: "/Users/liu/vibe" }), 20);
    },
    onAsk: (cb) => askHandlers.push(cb),
    onTurnDone: (cb) => turnDoneHandlers.push(cb),
    onToolEvent: (cb) => toolEventHandlers.push(cb),
    onDiffsChanged: (cb) => diffsChangedHandlers.push(cb),
    send: (text) => {
      const now = Date.now();
      const evt = {
        id: `evt-demo-${now}`,
        type: "tool:start",
        tool: text.startsWith("/") ? "command" : "grep",
        title: text.startsWith("/") ? `Run ${text}` : "Grep project context",
        summary: text,
        status: "running",
        createdAt: now,
      };
      demoEvents.push(evt);
      toolEventHandlers.forEach((cb) => cb(evt));
      const lines = text.startsWith("/")
        ? [`执行 ${text}`, "读取项目上下文...", "完成。"]
        : ["我会先查看相关文件，然后给出最小修改。", "", "⏺ read_file  src/runtime.ts", "  │ 128\tasync function handleInput(input: string): Promise<void> {", "", "建议：保留权限确认、收紧文件边界，并在界面中展示工具活动。"];
      let i = 0;
      const tick = () => {
        if (i < lines.length) {
          outputHandlers.forEach((cb) => cb(lines[i++] + "\n"));
          setTimeout(tick, 80);
        } else {
          evt.status = "done";
          evt.updatedAt = Date.now();
          toolEventHandlers.forEach((cb) => cb({ ...evt, type: "tool:done" }));
          diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
          turnDoneHandlers.forEach((cb) => cb());
        }
      };
      setTimeout(tick, 80);
    },
    answer: () => {},
    interrupt: () => turnDoneHandlers.forEach((cb) => cb()),
    listToolEvents: async () => demoEvents,
    listDiffs: async () => demoDiffs,
    acceptDiff: async (id) => {
      const diff = demoDiffs.find((x) => x.id === id);
      if (diff) diff.status = "accepted";
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, diff };
    },
    rejectDiff: async (id) => {
      const diff = demoDiffs.find((x) => x.id === id);
      if (diff) diff.status = "rejected";
      diffsChangedHandlers.forEach((cb) => cb([...demoDiffs]));
      return { ok: true, diff };
    },
    pickFolder: async () => "/Users/liu/vibe",
    getCwd: async () => "/Users/liu/vibe",
    listDir: async (dir) => demoFiles[dir || "/Users/liu/vibe"] || [],
    readFile: async (p) => ({ path: p, content: `// ${p}\n\nexport function demo() {\n  return "Hi Code";\n}\n` }),
    listSessions: async () => sessions,
    resumeSession: async () => [
      { role: "user", text: "优化 Hi Code 米白色工作台界面" },
      { role: "assistant", text: "已切换到米白色工作台，并保留会话、命令、权限与文件预览。" },
    ],
    deleteSession: async () => true,
    getConfig: async () => JSON.stringify(demoConfig, null, 2),
	    saveConfig: async (text) => {
      try {
        demoConfig = JSON.parse(text);
        const p = demoConfig.profiles?.[demoConfig.defaultProfile] || demoConfig.profiles?.default || {};
        readyHandlers.forEach((cb) => cb({ model: p.model || "model", baseURL: p.baseURL || "", cwd: "/Users/liu/vibe" }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || "invalid JSON" };
      }
    },
	    testModel: async () => ({ ok: true, message: "连接成功" }),
    authStatus: async () => ({ user: demoUser }),
    register: async ({ email, name }) => {
      demoUser = { email, name: name || email.split("@")[0] };
      return { ok: true, user: demoUser };
    },
    login: async ({ email }) => {
      demoUser = { email, name: email.split("@")[0] };
      return { ok: true, user: demoUser };
    },
    logout: async () => {
      demoUser = null;
      return { ok: true };
    },
    listCapabilities: async () => ({
      plugins: [
        { name: "github", description: "仓库、Issue、PR 与代码协作", status: "installed", source: "~/.codex/plugins/cache" },
        { name: "notion", description: "文档、知识库与任务管理", status: "installed", source: "~/.codex/plugins/cache" },
        { name: "data-analytics", description: "报告、仪表盘与数据分析", status: "installed", source: "~/.codex/plugins/cache" },
      ],
      skills: [
        { name: "playwright", description: "用真实浏览器验证 UI 流程", path: "~/.codex/skills/playwright/SKILL.md", status: "available" },
        { name: "openai-docs", description: "查询 OpenAI 官方产品文档", path: "~/.codex/skills/.system/openai-docs/SKILL.md", status: "available" },
        { name: "codex-security:security-scan", description: "仓库级安全扫描", path: "~/.codex/plugins/cache/...", status: "available" },
      ],
      mcp: [
        { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], status: "configured", envCount: 0 },
      ],
    }),
    listStore: async (options = {}) => {
      const query = String(options.query || "").trim().toLowerCase();
      const items = demoStore.filter((item) => {
        if (!query) return true;
        const haystack = [item.id, item.kind, item.category, item.name, item.summary, ...(item.tags || [])].join(" ").toLowerCase();
        return query.split(/\s+/).every((term) => haystack.includes(term));
      });
      return {
      sourceId: "all",
      source: { id: "all", name: "全部源", region: "All", note: "聚合内置、本机 Codex 和国内镜像。" },
      sources: [
        { id: "all", name: "全部源", region: "All", note: "聚合内置、本机 Codex、国内镜像和 GitHub。" },
        { id: "builtin-cn", name: "内置源（中国友好）", region: "CN", note: "NPM 类安装使用 npmmirror。" },
        { id: "codex-local", name: "本机 Codex 缓存", region: "Local", note: "扫描 ~/.codex 中的 Skills 和 Plugins。" },
        { id: "npm-mirror", name: "NPM MCP 镜像", region: "CN", note: "从 npmmirror 搜索 MCP server 包。" },
        { id: "gitee-mirror", name: "Gitee 镜像源", region: "CN", note: "预留国内镜像 catalog。" },
        { id: "github-search", name: "GitHub 搜索源", region: "Global", note: "搜索 GitHub 仓库并下载 zip。" },
        { id: "github-cn", name: "GitHub 国内代理", region: "CN", note: "搜索 GitHub，下载时优先使用国内代理。" },
        { id: "github-catalog", name: "GitHub Catalog", region: "Global", note: "官方 raw catalog。" },
      ],
        query,
        totalItems: demoStore.length,
        filteredItems: items.length,
        items,
      };
    },
    setStoreSource: async () => ({ ok: true }),
    previewStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (!item) return { ok: false, error: "商店条目不存在" };
      const base = `/Users/liu/.vibe/store/${item.kind}s/${item.id}`;
      const changes = item.kind === "mcp"
        ? [{ action: "write", target: "~/.vibe/config.json", detail: `新增或覆盖 mcpServers.${item.id.replace(/^mcp-/, "")}` }]
        : [{ action: "write", target: `${base}/manifest.json`, detail: `安装 ${item.kind} 配置` }];
      return {
        ok: true,
        preview: {
          item,
          source: { id: "builtin-cn", name: "内置源（中国友好）", region: "CN" },
          changes,
          permissions: [
            item.kind === "mcp" ? "允许 Hi Code 配置并启动 stdio MCP。" : "允许 Hi Code 写入本地商店目录。",
            "安装后可在对应能力页中查看和使用。",
          ],
          warnings: item.id === "mcp-github" ? ["需要安装后配置 GITHUB_TOKEN。"] : [],
          env: item.id === "mcp-github" ? [{ key: "GITHUB_TOKEN", required: true }] : [],
          restartRequired: item.kind === "mcp",
        },
      };
    },
    installStoreItem: async (id) => {
      const item = demoStore.find((x) => x.id === id);
      if (item) item.installed = true;
      return { ok: true, item };
    },
	  };
}

const $ = (id) => document.getElementById(id);
const auth = $("auth"), appRoot = $("app");
const authTitle = $("authTitle"), authForm = $("authForm"), authStatus = $("authStatus");
const authName = $("authName"), authEmail = $("authEmail"), authPassword = $("authPassword"), nameField = $("nameField");
const loginTab = $("loginTab"), registerTab = $("registerTab"), authSubmit = $("authSubmit");
const userName = $("userName"), userEmail = $("userEmail"), userInitial = $("userInitial");
const main = $("main"), home = $("home"), chatview = $("chatview"), chat = $("chat");
const homeSlot = $("homeSlot"), chatSlot = $("chatSlot");
const greeting = $("greeting"), sessionsEl = $("sessions"), searchInput = $("search");
const projName = $("projName"), modelSide = $("modelNameSide");
const askBox = $("ask"), askQ = $("ask-q");
const timelineList = $("timelineList");
const diffList = $("diffList"), diffView = $("diffView"), diffSummary = $("diffSummary");
const diffAccept = $("diffAccept"), diffReject = $("diffReject");
const settings = $("settings"), cfg = $("cfg"), cfgErr = $("cfg-err");
const currentProject = $("currentProject");
const filesModal = $("files"), filePath = $("filePath"), fileList = $("fileList"), filePreview = $("filePreview");
const capabilityView = $("capabilityView"), capTitle = $("capTitle"), capSubtitle = $("capSubtitle"), capSummary = $("capSummary"), capList = $("capList"), capActions = $("capActions");
const storeConfirm = $("storeConfirm"), storeConfirmTitle = $("storeConfirmTitle"), storeConfirmSub = $("storeConfirmSub");
const storeConfirmSummary = $("storeConfirmSummary"), storeConfirmChanges = $("storeConfirmChanges"), storeConfirmPerms = $("storeConfirmPerms"), storeConfirmWarnings = $("storeConfirmWarnings");
const storeConfirmClose = $("storeConfirmClose"), storeConfirmCancel = $("storeConfirmCancel"), storeConfirmInstall = $("storeConfirmInstall");
const providerGrid = $("providerGrid");
const providerHint = $("providerHint");
const quickBaseURL = $("quickBaseURL"), quickApiKey = $("quickApiKey"), quickModel = $("quickModel"), quickContext = $("quickContext");
const advancedConfig = $("advanced-config");

// Build the single composer from the template, start it in the home slot.
const composer = $("composer-tpl").content.firstElementChild.cloneNode(true);
homeSlot.appendChild(composer);
const input = composer.querySelector("#input");
const sendBtn = composer.querySelector("#send");
const stopBtn = composer.querySelector("#stop");
const cmdmenu = composer.querySelector("#cmdmenu");
const modelPicker = composer.querySelector("#modelPicker");
const modelPill = composer.querySelector("#modelPill");
const modelName = composer.querySelector("#modelName");
const accessBtn = composer.querySelector("#access");
const accessLabel = composer.querySelector("#accessLabel");

let busy = false, agentBody = null, agentRaw = "", yolo = false, cwd = "", inChat = false;
let cfgText = "", selectedProvider = "deepseek";
let authMode = "login", currentCapability = "";
let capabilityCache = null;
let storeCache = null, storeCacheKey = "", storeKind = "all", storeCategory = "all", storeQuery = "", storeMessage = "", storeSearchTimer = null, storeRequestSeq = 0;
let storePage = 1;
const STORE_PAGE_SIZE = 24;
let pendingStoreInstall = null;
let toolEvents = [], diffs = [], selectedDiffId = null;
let storeSearchComposing = false, composerComposing = false;

const REASONING_LEVELS = [
  ["low", "低", "更快响应，适合简单改动"],
  ["medium", "中", "日常编码默认"],
  ["high", "高", "更充分地规划和审查"],
  ["ultra", "超高", "复杂任务和多文件重构"],
];

const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "DeepSeek 官方 OpenAI 兼容接口，填 API Key 即可。",
  },
  kimi: {
    label: "Kimi 全球",
    baseURL: "https://api.moonshot.ai/v1",
    model: "kimi-k2.7-code",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Moonshot/Kimi 全球开放平台，适合在 platform.kimi.ai 创建的 API Key。",
  },
  "kimi-cn": {
    label: "Kimi 国内",
    baseURL: "https://api.moonshot.cn/v1",
    model: "kimi-k2.7-code",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Moonshot/Kimi 国内开放平台，适合在国内控制台创建的 API Key。",
  },
  "kimi-code": {
    label: "Kimi Code",
    baseURL: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    credentialGroup: "kimi",
    note: "Kimi Code 专用 OpenAI 兼容入口，适合 Kimi Code 订阅/编码密钥。",
  },
  qwen: {
    label: "通义千问",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    contextWindow: 131072,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "阿里云百炼 DashScope OpenAI 兼容模式，填百炼 API Key 即可。",
  },
  zhipu: {
    label: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    contextWindow: 131072,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "智谱开放平台 OpenAI 兼容接口，填 API Key 即可。",
  },
  minimax: {
    label: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    model: "MiniMax-M1",
    contextWindow: 262144,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "MiniMax OpenAI 兼容接口，适合长上下文和 Agentic 任务。",
  },
  siliconflow: {
    label: "硅基流动",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "硅基流动模型聚合接口，国内下载和访问相对友好。",
  },
  gemini: {
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-pro",
    contextWindow: 1048576,
    apiKey: "",
    keyPlaceholder: "AIza...",
    apiOnly: true,
    note: "Google Gemini OpenAI 兼容接口，填 Gemini API Key 即可。",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    contextWindow: 128000,
    apiKey: "",
    keyPlaceholder: "sk-or-...",
    apiOnly: true,
    note: "OpenRouter 聚合接口，可在高级 JSON 中替换为任意模型 ID。",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4.1",
    contextWindow: 128000,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: true,
    note: "OpenAI 官方接口，填 API Key 即可。",
  },
  ollama: {
    label: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    model: "deepseek-chat",
    contextWindow: 65536,
    apiKey: "sk-no-key-required",
    keyPlaceholder: "sk-no-key-required",
    apiOnly: false,
    note: "本地 OpenAI 兼容服务，通常不需要真实 API Key。",
  },
  custom: {
    label: "自定义",
    baseURL: "",
    model: "",
    contextWindow: 65536,
    apiKey: "",
    keyPlaceholder: "sk-...",
    apiOnly: false,
    note: "填写任意 OpenAI 兼容服务的 Base URL、模型名和 API Key。",
  },
};

/* ---------- auth ---------- */
function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  authTitle.textContent = isRegister ? "注册" : "登录";
  authSubmit.textContent = isRegister ? "创建账号" : "登录";
  nameField.classList.toggle("hidden", !isRegister);
  loginTab.classList.toggle("active", !isRegister);
  registerTab.classList.toggle("active", isRegister);
  authStatus.textContent = "";
  authStatus.classList.remove("ok");
  authPassword.autocomplete = isRegister ? "new-password" : "current-password";
}

function showSignedIn(user) {
  auth.classList.add("hidden");
  appRoot.classList.remove("hidden");
  userName.textContent = user?.name || "Hi Code";
  userEmail.textContent = user?.email || "本地账号";
  userInitial.textContent = (user?.name || user?.email || "H").trim().slice(0, 1).toUpperCase();
  input.focus();
}

function showSignedOut() {
  appRoot.classList.add("hidden");
  auth.classList.remove("hidden");
  setAuthMode("login");
  authEmail.focus();
}

function setAuthStatus(text, ok = false) {
  authStatus.textContent = text;
  authStatus.classList.toggle("ok", ok);
}

async function initAuth() {
  const status = await window.hicode.authStatus();
  if (status?.user) showSignedIn(status.user);
  else showSignedOut();
}

loginTab.onclick = () => setAuthMode("login");
registerTab.onclick = () => setAuthMode("register");
authForm.onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    name: authName.value.trim(),
    email: authEmail.value.trim(),
    password: authPassword.value,
  };
  const r = authMode === "register"
    ? await window.hicode.register(payload)
    : await window.hicode.login(payload);
  if (!r.ok) return setAuthStatus(r.error || "认证失败");
  setAuthStatus("已登录", true);
  authPassword.value = "";
  showSignedIn(r.user);
};

$("logoutBtn").onclick = async () => {
  await window.hicode.logout();
  showSignedOut();
};

/* ---------- ANSI → HTML ---------- */
const esc = (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c);
const escAll = (s) => s.replace(/[&<>]/g, esc);
const colorClass = (n) => ({30:"c-gray",90:"c-gray",31:"c-red",91:"c-red",32:"c-green",92:"c-green",33:"c-yellow",93:"c-yellow",34:"c-blue",94:"c-blue",35:"c-magenta",95:"c-magenta",36:"c-cyan",96:"c-cyan"})[n];
function ansiToHtml(s) {
  let html = "", i = 0, bold = false, color = null, open = false;
  const cur = () => [bold ? "c-bold" : null, color].filter(Boolean);
  const sync = () => { if (open) { html += "</span>"; open = false; } const c = cur(); if (c.length) { html += `<span class="${c.join(" ")}">`; open = true; } };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\x1b" && s[i + 1] === "[") {
      const m = /^\x1b\[([0-9;]*)m/.exec(s.slice(i));
      if (!m) break;
      const codes = m[1].split(";").filter((x) => x !== "").map(Number);
      if (!codes.length) codes.push(0);
      for (const c of codes) { if (c === 0) { bold = false; color = null; } else if (c === 1) bold = true; else if (c === 22) bold = false; else if (c === 39) color = null; else color = colorClass(c) ?? color; }
      sync(); i += m[0].length;
    } else { html += esc(ch); i++; }
  }
  if (open) html += "</span>";
  return html;
}

/* ---------- view switching ---------- */
function setActiveNav(id) {
  document.querySelectorAll(".nav-row").forEach((btn) => btn.classList.toggle("active", btn.id === id));
}

function showChat() {
  if (inChat) return;
  inChat = true;
  main.className = "chatting";
  home.classList.add("hidden");
  capabilityView.classList.add("hidden");
  chatview.classList.remove("hidden");
  chatSlot.appendChild(composer);
  setActiveNav("chatNav");
  input.focus();
}
function showHome() {
  inChat = false;
  main.className = "home";
  chatview.classList.add("hidden");
  capabilityView.classList.add("hidden");
  home.classList.remove("hidden");
  homeSlot.appendChild(composer);
  setActiveNav("chatNav");
  input.focus();
}

async function showCapabilities(kind) {
  inChat = false;
  main.className = "capability";
  home.classList.add("hidden");
  chatview.classList.add("hidden");
  capabilityView.classList.remove("hidden");
  currentCapability = kind;
  setActiveNav(kind === "plugins" ? "pluginsBtn" : kind === "skills" ? "skillsBtn" : "mcpBtn");
  await renderCapabilities(kind);
}

async function showStore() {
  inChat = false;
  main.className = "capability";
  home.classList.add("hidden");
  chatview.classList.add("hidden");
  capabilityView.classList.remove("hidden");
  setActiveNav("storeBtn");
  await renderStore();
}

/* ---------- chat rendering ---------- */
const atBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
const scrollDown = () => (chat.scrollTop = chat.scrollHeight);
function addUserMessage(text) {
  const el = document.createElement("div"); el.className = "msg user";
  el.innerHTML = `<div class="bubble"></div>`; el.querySelector(".bubble").textContent = text;
  chat.appendChild(el); scrollDown();
}
function startAgentMessage() {
  const el = document.createElement("div"); el.className = "msg agent";
  el.innerHTML = `<div class="avatar"><span class="logo"></span></div><div class="agent-body"></div>`;
  chat.appendChild(el); agentBody = el.querySelector(".agent-body"); agentRaw = ""; scrollDown();
}
function appendOutput(chunk) {
  if (!agentBody) startAgentMessage();
  const stick = atBottom(); agentRaw += chunk; agentBody.innerHTML = ansiToHtml(agentRaw);
  if (stick) scrollDown();
}
function addSystemNote(text) {
  const el = document.createElement("div"); el.className = "msg agent";
  el.innerHTML = `<div class="avatar"><span class="logo"></span></div><div class="agent-body c-gray"></div>`;
  el.querySelector(".agent-body").textContent = text; chat.appendChild(el); scrollDown();
}
function setBusy(v) {
  busy = v;
  sendBtn.classList.toggle("hidden", v); stopBtn.classList.toggle("hidden", !v); input.disabled = v;
  if (!v) input.focus();
}
function runLine(text) {
  if (!text || busy) return;
  showChat();
  addUserMessage(text); startAgentMessage(); setBusy(true);
  window.hicode.send(text);
}
function submit() {
  const t = input.value.trim(); if (!t || busy) return;
  input.value = ""; input.style.height = "auto"; hideMenu(); runLine(t);
}

/* ---------- workbench timeline + diff ---------- */
async function refreshWorkbench() {
  await Promise.all([refreshToolEvents(), refreshDiffs()]);
}

async function refreshToolEvents() {
  if (!window.hicode.listToolEvents) return;
  toolEvents = await window.hicode.listToolEvents();
  renderTimeline();
}

async function refreshDiffs() {
  if (!window.hicode.listDiffs) return;
  setDiffs(await window.hicode.listDiffs());
}

function addToolEvent(event) {
  const parentId = event?.payload?.parentId;
  const idx = toolEvents.findIndex((item) => item.id === event.id || (parentId && item.id === parentId));
  if (idx >= 0) {
    toolEvents[idx] = {
      ...toolEvents[idx],
      ...event,
      id: toolEvents[idx].id,
      type: toolEvents[idx].type,
      updatedAt: event.updatedAt || Date.now(),
    };
  } else {
    toolEvents.push(event);
  }
  toolEvents = toolEvents.slice(-120);
  renderTimeline();
}

function renderTimeline() {
  if (!timelineList) return;
  timelineList.innerHTML = "";
  const items = [...toolEvents].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.textContent = "工具调用会显示在这里。";
    timelineList.appendChild(empty);
    return;
  }
  for (const event of items.slice(0, 80)) {
    const row = document.createElement("button");
    row.className = `timeline-row ${statusClass(event.status)} ${event.type.replace(":", "-")}`;
    row.innerHTML = `
      <span class="timeline-dot"></span>
      <span class="timeline-main">
        <span class="timeline-title"></span>
        <span class="timeline-meta"></span>
      </span>
    `;
    row.querySelector(".timeline-title").textContent = event.title || event.tool || event.type;
    row.querySelector(".timeline-meta").textContent = timelineMeta(event);
    row.onclick = () => {
      if (event.diffId) selectDiff(event.diffId);
    };
    timelineList.appendChild(row);
  }
}

function timelineMeta(event) {
  const bits = [];
  if (event.type === "permission:requested") bits.push("permission");
  else bits.push(event.tool || event.type);
  if (event.status) bits.push(statusText(event.status));
  if (event.summary && event.summary !== event.title) bits.push(String(event.summary).slice(0, 80));
  return bits.filter(Boolean).join(" · ");
}

function statusText(status) {
  return {
    running: "running",
    done: "done",
    error: "error",
    denied: "denied",
  }[status] || status;
}

function statusClass(status) {
  return {
    running: "is-running",
    done: "is-done",
    error: "is-error",
    denied: "is-denied",
  }[status] || "";
}

function setDiffs(next) {
  diffs = Array.isArray(next) ? next : [];
  if (!selectedDiffId || !diffs.some((diff) => diff.id === selectedDiffId)) {
    selectedDiffId = diffs[0]?.id || null;
  }
  renderDiffs();
}

function renderDiffs() {
  if (!diffList || !diffView) return;
  diffList.innerHTML = "";
  const pending = diffs.filter((diff) => diff.status === "pending").length;
  diffSummary.textContent = `${pending} pending · ${diffs.length} total`;
  if (!diffs.length) {
    diffList.innerHTML = `<div class="diff-empty">Agent 修改文件后会出现在这里。</div>`;
    diffView.textContent = "还没有文件改动。";
    setDiffButtons(false);
    return;
  }

  for (const diff of diffs) {
    const row = document.createElement("button");
    row.className = `diff-row ${diff.id === selectedDiffId ? "active" : ""} diff-${diff.status}`;
    row.innerHTML = `
      <span class="diff-file"></span>
      <span class="diff-status"></span>
    `;
    row.querySelector(".diff-file").textContent = diff.path;
    row.querySelector(".diff-status").textContent = diffStatusText(diff.status);
    row.onclick = () => selectDiff(diff.id);
    diffList.appendChild(row);
  }

  const selected = diffs.find((diff) => diff.id === selectedDiffId) || diffs[0];
  selectedDiffId = selected?.id || null;
  if (!selected) return;
  diffView.innerHTML = renderUnifiedDiff(selected);
  setDiffButtons(selected.status === "pending");
}

function selectDiff(id) {
  selectedDiffId = id;
  renderDiffs();
}

function setDiffButtons(enabled) {
  diffAccept.disabled = !enabled;
  diffReject.disabled = !enabled;
}

function diffStatusText(status) {
  return {
    pending: "Pending",
    accepted: "Accepted",
    rejected: "Rejected",
    undone: "Undone",
  }[status] || status;
}

function renderUnifiedDiff(diff) {
  const rows = [
    { kind: "meta", text: `--- ${diff.path}${diff.before === null ? " (new file)" : ""}` },
    { kind: "meta", text: `+++ ${diff.path}` },
  ];
  const before = splitLines(diff.before ?? "");
  const after = splitLines(diff.after ?? "");
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const oldLine = before[i];
    const newLine = after[i];
    if (oldLine === newLine && oldLine !== undefined) {
      rows.push({ kind: "ctx", text: ` ${oldLine}` });
    } else {
      if (oldLine !== undefined) rows.push({ kind: "del", text: `-${oldLine}` });
      if (newLine !== undefined) rows.push({ kind: "add", text: `+${newLine}` });
    }
    if (rows.length > 800) {
      rows.push({ kind: "meta", text: "... diff truncated in preview ..." });
      break;
    }
  }
  return rows.map((row) => `<span class="diff-code-line ${row.kind}">${escAll(row.text) || " "}</span>`).join("");
}

function splitLines(text) {
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

diffAccept.onclick = async () => {
  if (!selectedDiffId || !window.hicode.acceptDiff) return;
  const r = await window.hicode.acceptDiff(selectedDiffId);
  if (!r?.ok) addSystemNote(r?.error || "Accept 失败");
  await refreshDiffs();
};
diffReject.onclick = async () => {
  if (!selectedDiffId || !window.hicode.rejectDiff) return;
  const r = await window.hicode.rejectDiff(selectedDiffId);
  if (!r?.ok) addSystemNote(r?.error || "Reject 失败");
  await refreshDiffs();
};

/* ---------- IPC in ---------- */
window.hicode.onReady((d) => {
  cwd = d.cwd;
  setCurrentModelDisplay(d);
  projName.textContent = shortPath(d.cwd);
  currentProject.textContent = shortPath(d.cwd);
  loadSessions();
  refreshWorkbench();
});
window.hicode.onOutput((s) => appendOutput(s));
window.hicode.onTurnDone(() => { setBusy(false); agentBody = null; loadSessions(); refreshWorkbench(); });
window.hicode.onToolEvent?.((event) => addToolEvent(event));
window.hicode.onDiffsChanged?.((nextDiffs) => setDiffs(nextDiffs));
window.hicode.onAsk(({ id, q }) => {
  askQ.textContent = q; askBox.classList.remove("hidden");
  askBox.querySelectorAll(".btn").forEach((b) => { b.onclick = () => { askBox.classList.add("hidden"); window.hicode.answer(id, b.dataset.v); }; });
  scrollDown();
});

/* ---------- sessions ---------- */
let allSessions = [];
async function loadSessions() {
  allSessions = await window.hicode.listSessions();
  renderSessions(searchInput.value.trim());
}
function renderSessions(filter) {
  const list = filter ? allSessions.filter((s) => (s.firstPrompt || "").toLowerCase().includes(filter.toLowerCase())) : allSessions;
  sessionsEl.innerHTML = "";
  if (!list.length) { sessionsEl.innerHTML = `<div class="sess s muted" style="padding:8px 10px">还没有会话</div>`; return; }
  for (const s of list) {
    const el = document.createElement("div"); el.className = "sess";
    el.innerHTML = `<div class="sess-main"><div class="t"></div><div class="s"></div></div><button class="sess-del" title="删除">×</button>`;
    el.querySelector(".t").textContent = s.firstPrompt || "(空会话)";
    el.querySelector(".s").textContent = `${new Date(s.updatedAt).toLocaleString()} · ${s.messageCount} 条`;
    el.querySelector(".sess-main").onclick = () => openSession(s.id);
    el.querySelector(".sess-del").onclick = async (e) => {
      e.stopPropagation();
      await window.hicode.deleteSession(s.id);
      loadSessions();
    };
    sessionsEl.appendChild(el);
  }
}

/** Open a saved session: restore it silently and render its history (no /resume echo). */
async function openSession(id) {
  if (busy) return;
  const msgs = await window.hicode.resumeSession(id);
  chat.innerHTML = "";
  showChat();
  for (const m of msgs) {
    if (m.role === "user") addUserMessage(m.text);
    else { startAgentMessage(); agentBody.textContent = m.text; }
  }
  agentBody = null;
  scrollDown();
}
searchInput.addEventListener("input", () => renderSessions(searchInput.value.trim()));

/* ---------- greeting ---------- */
function setGreeting() {
  const h = new Date().getHours();
  greeting.textContent = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

/* ---------- sidebar + composer controls ---------- */
$("chatNav").onclick = showHome;
$("newChat").onclick = () => { chat.innerHTML = ""; window.hicode.send("/clear"); showHome(); setGreeting(); };
$("searchToggle").onclick = () => {
  const w = $("searchWrap"); w.classList.toggle("hidden");
  if (!w.classList.contains("hidden")) searchInput.focus(); else { searchInput.value = ""; renderSessions(""); }
};
$("cmdBtn").onclick = () => { input.value = "/"; input.focus(); showMenu("/"); };
async function pickFolder() {
  const dir = await window.hicode.pickFolder();
  if (dir) {
    cwd = dir;
    projName.textContent = shortPath(dir);
    currentProject.textContent = shortPath(dir);
    chat.innerHTML = "";
    loadSessions();
    if (inChat) addSystemNote("已切换到 " + dir);
  }
}
$("projRow").onclick = pickFolder;
$("settingsBtn").onclick = openSettings;
$("filesBtn").onclick = () => openFiles(cwd);
$("storeBtn").onclick = showStore;
$("pluginsBtn").onclick = () => showCapabilities("plugins");
$("skillsBtn").onclick = () => showCapabilities("skills");
$("mcpBtn").onclick = () => showCapabilities("mcp");
storeConfirmClose.onclick = closeStoreInstallPreview;
storeConfirmCancel.onclick = closeStoreInstallPreview;
storeConfirmInstall.onclick = confirmStoreInstall;
$("diffBtn").onclick = () => { showChat(); refreshWorkbench(); };
$("modelsBtn").onclick = openSettings;
composer.querySelector("#attach").onclick = pickFolder;
modelPill.onclick = (e) => {
  e.stopPropagation();
  toggleModelPicker();
};
modelPicker.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => hideModelPicker());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideModelPicker();
});
accessBtn.onclick = () => {
  yolo = !yolo;
  accessBtn.classList.toggle("full", yolo);
  accessLabel.textContent = yolo ? "完全访问" : "需确认";
  window.hicode.send("/yolo");
};
sendBtn.onclick = submit;
stopBtn.onclick = () => {
  if (!busy) return;
  window.hicode.interrupt();
  setBusy(false);
};

/* ---------- quick cards ---------- */
document.querySelectorAll(".qcard").forEach((card) => {
  if (card.id === "connectApiCard") {
    card.onclick = openSettings;
    return;
  }
  card.onclick = () => {
    const cmd = card.dataset.cmd, arg = input.value.trim();
    if (!arg) { input.placeholder = `先输入目标,再点「${card.querySelector(".qt").textContent}」…`; input.focus(); return; }
    input.value = ""; runLine(`/${cmd} ${arg}`);
  };
});

/* ---------- capabilities ---------- */
const CAPABILITY_META = {
  plugins: {
    title: "插件",
    subtitle: "本机可用的 Codex/Hi Code 扩展入口。",
    icon: "i-plug",
    empty: "还没有发现本地插件缓存。",
    nav: "pluginsBtn",
  },
  skills: {
    title: "Skill",
    subtitle: "可复用的工作流说明，会影响 agent 做事方式。",
    icon: "i-spark",
    empty: "还没有发现本地 Skill。",
    nav: "skillsBtn",
  },
  mcp: {
    title: "MCP",
    subtitle: "从 ~/.vibe/config.json 读取的 Model Context Protocol 服务。",
    icon: "i-network",
    empty: "还没有配置 MCP server。",
    nav: "mcpBtn",
  },
};

async function getCapabilities(refresh = false) {
  if (!capabilityCache || refresh) capabilityCache = await window.hicode.listCapabilities();
  return capabilityCache;
}

async function renderCapabilities(kind, refresh = false) {
  const meta = CAPABILITY_META[kind];
  const all = await getCapabilities(refresh);
  const items = all[kind] || [];
  capTitle.textContent = meta.title;
  capSubtitle.textContent = meta.subtitle;
  capActions.innerHTML = "";
  capSummary.innerHTML = "";
  capList.innerHTML = "";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "ghost";
  refreshBtn.textContent = "刷新";
  refreshBtn.onclick = () => renderCapabilities(kind, true);
  capActions.appendChild(refreshBtn);

  if (kind === "mcp") {
    const cfgBtn = document.createElement("button");
    cfgBtn.className = "primary";
    cfgBtn.textContent = "配置 MCP";
    cfgBtn.onclick = openSettings;
    capActions.appendChild(cfgBtn);
  }

  const stats = [
    ["Plugins", all.plugins?.length || 0],
    ["Skills", all.skills?.length || 0],
    ["MCP", all.mcp?.length || 0],
  ];
  for (const [label, value] of stats) {
    const stat = document.createElement("div");
    stat.className = "cap-stat";
    stat.innerHTML = `<b></b><span></span>`;
    stat.querySelector("b").textContent = String(value);
    stat.querySelector("span").textContent = label;
    capSummary.appendChild(stat);
  }

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "cap-empty";
    empty.textContent = meta.empty;
    capList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "cap-item";
    row.innerHTML = `
      <div class="cap-icon"><span class="${meta.icon}"></span></div>
      <div class="cap-main">
        <div class="cap-name"></div>
        <div class="cap-desc"></div>
        <div class="cap-meta"></div>
      </div>
      <button class="cap-badge"></button>
    `;
    row.querySelector(".cap-name").textContent = item.name;
    row.querySelector(".cap-desc").textContent = capabilityDescription(kind, item);
    row.querySelector(".cap-meta").textContent = capabilityMeta(kind, item);
    const action = row.querySelector(".cap-badge");
    action.textContent = capabilityActionLabel(kind, item);
    action.onclick = () => useCapability(kind, item);
    capList.appendChild(row);
  }
}

function capabilityDescription(kind, item) {
  if (kind === "mcp") return `${item.command || ""} ${(item.args || []).join(" ")}`.trim() || "MCP server";
  return item.description || (kind === "skills" ? "本地 Skill" : "本地插件");
}

function capabilityMeta(kind, item) {
  if (kind === "mcp") return `${item.status || "configured"} · env ${item.envCount || 0}`;
  if (kind === "skills") return item.path || item.status || "";
  return `${item.status || "installed"} · ${item.source || ""}`;
}

function capabilityActionLabel(kind) {
  if (kind === "skills") return "使用";
  if (kind === "mcp") return "/mcp";
  return "已安装";
}

function useCapability(kind, item) {
  if (kind === "skills") {
    showHome();
    input.value = `$${item.name} `;
    input.focus();
    return;
  }
  if (kind === "mcp") {
    runLine("/mcp");
  }
}

/* ---------- store ---------- */
const STORE_KIND_LABELS = { all: "全部", plugin: "插件", skill: "Skill", mcp: "MCP", agent: "Agent" };
const STORE_CATEGORY_LABELS = {
  all: "全部分类",
  code: "代码",
  git: "Git",
  browser: "浏览器",
  review: "审查",
  automation: "自动化",
  security: "安全",
  data: "数据",
  design: "设计",
  docs: "文档",
  local: "本地",
  other: "其他",
};

function storeQueryOptions() {
  return { query: storeQuery.trim() };
}

async function getStore(refresh = false) {
  const key = JSON.stringify(storeQueryOptions());
  if (!storeCache || refresh || storeCacheKey !== key) {
    storeCache = await window.hicode.listStore(storeQueryOptions());
    storeCacheKey = key;
  }
  return storeCache;
}

function commitStoreSearch(value, immediate = false) {
  storeQuery = value;
  storeMessage = "";
  storePage = 1;
  if (storeSearchTimer) clearTimeout(storeSearchTimer);
  const run = () => {
    storeCache = null;
    renderStore(true);
  };
  if (immediate) run();
  else storeSearchTimer = setTimeout(run, 260);
}

async function renderStore(refresh = false) {
  const requestSeq = ++storeRequestSeq;
  const keepSearchFocus = document.activeElement?.id === "storeSearchInput";
  const store = await getStore(refresh);
  if (requestSeq !== storeRequestSeq) return;
  const items = store.items || [];
  const activeSource = store.source || (store.sources || []).find((s) => s.id === store.sourceId) || {};
  capTitle.textContent = "技能商店";
  capSubtitle.textContent = `当前源：${activeSource.name || "全部源"}。${activeSource.note || "聚合展示插件、Skill、MCP 和 Agent，搜索后可直接安装。"}`;
  capActions.innerHTML = "";
  capSummary.innerHTML = "";
  capList.innerHTML = "";

  const searchWrap = document.createElement("div");
  searchWrap.className = "store-search";
  const searchIcon = document.createElement("span");
  searchIcon.className = "i-search";
  const searchInput = document.createElement("input");
  searchInput.id = "storeSearchInput";
  searchInput.type = "search";
  searchInput.placeholder = "搜索插件 / Skill / MCP / Agent";
  searchInput.value = storeQuery;
  searchInput.oncompositionstart = () => {
    storeSearchComposing = true;
  };
  searchInput.oncompositionend = () => {
    storeSearchComposing = false;
    commitStoreSearch(searchInput.value, true);
  };
  searchInput.oninput = (e) => {
    if (storeSearchComposing || e.isComposing) return;
    commitStoreSearch(searchInput.value);
  };
  searchInput.onkeydown = (e) => {
    if (storeSearchComposing || e.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitStoreSearch(searchInput.value, true);
    }
  };
  searchWrap.append(searchIcon, searchInput);
  if (storeQuery) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "store-search-clear";
    clearBtn.textContent = "清除";
    clearBtn.onclick = () => {
      storeQuery = "";
      storeMessage = "";
      storePage = 1;
      storeCache = null;
      renderStore(true);
    };
    searchWrap.appendChild(clearBtn);
  }
  capActions.appendChild(searchWrap);

  const sourceSelect = document.createElement("select");
  sourceSelect.className = "store-source";
  sourceSelect.title = "选择下载源";
  for (const source of store.sources || []) {
    const opt = document.createElement("option");
    opt.value = source.id;
    opt.textContent = `${source.region === "CN" ? "国内 · " : source.region === "Local" ? "本机 · " : source.id?.startsWith("github") ? "GitHub · " : source.region === "All" ? "" : ""}${source.name}`;
    opt.selected = source.id === store.sourceId;
    sourceSelect.appendChild(opt);
  }
  sourceSelect.onchange = async () => {
    await window.hicode.setStoreSource(sourceSelect.value);
    storeCache = null;
    storePage = 1;
    storeMessage = "来源已切换，已按当前搜索重新查询。";
    renderStore(true);
  };
  capActions.appendChild(sourceSelect);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "ghost";
  refreshBtn.textContent = "刷新";
  refreshBtn.onclick = () => {
    storeCache = null;
    renderStore(true);
  };
  capActions.appendChild(refreshBtn);

  const kinds = ["plugin", "skill", "mcp", "agent"];
  for (const kind of kinds) {
    const stat = document.createElement("div");
    stat.className = "cap-stat";
    stat.innerHTML = `<b></b><span></span>`;
    stat.querySelector("b").textContent = String(items.filter((x) => x.kind === kind).length);
    stat.querySelector("span").textContent = STORE_KIND_LABELS[kind];
    capSummary.appendChild(stat);
  }

  const filters = document.createElement("div");
  filters.className = "store-filters";
  const filtered = items.filter((item) =>
    (storeKind === "all" || item.kind === storeKind) &&
    (storeCategory === "all" || (item.category || "other") === storeCategory)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / STORE_PAGE_SIZE));
  storePage = Math.min(Math.max(1, storePage), totalPages);
  const pageStart = (storePage - 1) * STORE_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + STORE_PAGE_SIZE);
  const resultInfo = document.createElement("div");
  resultInfo.className = "store-result-info";
  const totalItems = Number.isFinite(store.totalItems) ? store.totalItems : items.length;
  const sourceName = activeSource.name || "全部源";
  const pageRange = filtered.length
    ? ` · 第 ${storePage} / ${totalPages} 页 · ${pageStart + 1}-${Math.min(pageStart + STORE_PAGE_SIZE, filtered.length)}`
    : "";
  resultInfo.textContent = storeQuery.trim()
    ? `${sourceName} 搜索“${storeQuery.trim()}”：命中 ${filtered.length} / ${totalItems}${pageRange}`
    : `${sourceName}：显示 ${filtered.length} / ${totalItems} 个条目${pageRange}`;
  const kindBar = document.createElement("div");
  kindBar.className = "store-segment";
  for (const kind of ["all", ...kinds]) {
    const btn = document.createElement("button");
    btn.className = kind === storeKind ? "active" : "";
    btn.textContent = STORE_KIND_LABELS[kind];
    btn.onclick = () => { storeKind = kind; storePage = 1; renderStore(); };
    kindBar.appendChild(btn);
  }
  const categories = ["all", ...Array.from(new Set(items.map((x) => x.category || "other"))).sort()];
  if (storeCategory !== "all" && !categories.includes(storeCategory)) categories.push(storeCategory);
  const catBar = document.createElement("div");
  catBar.className = "store-segment";
  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.className = cat === storeCategory ? "active" : "";
    btn.textContent = STORE_CATEGORY_LABELS[cat] || cat;
    btn.onclick = () => { storeCategory = cat; storePage = 1; renderStore(); };
    catBar.appendChild(btn);
  }
  filters.append(resultInfo, kindBar, catBar);
  capList.appendChild(filters);

  if (storeMessage) {
    const msg = document.createElement("div");
    msg.className = "store-message";
    msg.textContent = storeMessage;
    capList.appendChild(msg);
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "cap-empty";
    empty.textContent = storeQuery.trim()
      ? `没有在 ${sourceName} 中找到“${storeQuery.trim()}”。可以换一个来源、调整分类，或清空搜索。`
      : "当前筛选下没有可安装条目。";
    capList.appendChild(empty);
    if (keepSearchFocus) restoreStoreSearchFocus(searchInput);
    return;
  }

  if (filtered.length > STORE_PAGE_SIZE) {
    capList.appendChild(renderStorePager(filtered.length));
  }

  for (const item of pageItems) {
    const row = document.createElement("div");
    row.className = "cap-item store-item";
    row.innerHTML = `
      <div class="cap-icon"><span class="${storeIcon(item.kind)}"></span></div>
      <div class="cap-main">
        <div class="cap-name"></div>
        <div class="cap-desc"></div>
        <div class="cap-meta"></div>
      </div>
      <button class="cap-badge"></button>
    `;
    row.querySelector(".cap-name").textContent = item.name;
    row.querySelector(".cap-desc").textContent = item.summary || "";
    const itemSource = item.sourceName || (item.source === "builtin" ? "内置" : item.source || sourceName);
    row.querySelector(".cap-meta").textContent = [
      STORE_KIND_LABELS[item.kind] || item.kind,
      STORE_CATEGORY_LABELS[item.category] || item.category || "其他",
      itemSource,
      (item.tags || []).join(", "),
    ].filter(Boolean).join(" · ");
    const action = row.querySelector(".cap-badge");
    action.textContent = item.installed ? "已安装" : "安装";
    action.classList.toggle("installed", item.installed);
    action.disabled = Boolean(item.installed);
    action.onclick = () => openStoreInstallPreview(item.id);
    capList.appendChild(row);
  }
  if (filtered.length > STORE_PAGE_SIZE) {
    capList.appendChild(renderStorePager(filtered.length));
  }
  if (keepSearchFocus) restoreStoreSearchFocus(searchInput);
}

function renderStorePager(total) {
  const totalPages = Math.max(1, Math.ceil(total / STORE_PAGE_SIZE));
  const pager = document.createElement("div");
  pager.className = "store-pager";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "上一页";
  prev.disabled = storePage <= 1;
  prev.onclick = () => {
    storePage = Math.max(1, storePage - 1);
    renderStore();
  };
  const label = document.createElement("span");
  label.textContent = `第 ${storePage} / ${totalPages} 页`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "下一页";
  next.disabled = storePage >= totalPages;
  next.onclick = () => {
    storePage = Math.min(totalPages, storePage + 1);
    renderStore();
  };
  pager.append(prev, label, next);
  return pager;
}

async function openStoreInstallPreview(itemId) {
  const result = await window.hicode.previewStoreItem(itemId);
  if (!result.ok) {
    storeMessage = result.error || "无法生成安装预览";
    await renderStore();
    return;
  }
  const preview = result.preview;
  pendingStoreInstall = preview.item?.id || itemId;
  storeConfirmTitle.textContent = `安装 ${preview.item?.name || itemId}`;
  storeConfirmSub.textContent = `${STORE_KIND_LABELS[preview.item?.kind] || preview.item?.kind || "扩展"} · ${preview.source?.name || "下载源"}`;
  storeConfirmSummary.textContent = preview.item?.summary || "安装前请确认下面的文件变更和权限说明。";
  renderStorePreviewList(storeConfirmChanges, preview.changes || [], (change) =>
    `${STORE_ACTION_LABELS[change.action] || change.action} · ${change.target}${change.detail ? ` · ${change.detail}` : ""}`
  );
  renderStorePreviewList(storeConfirmPerms, preview.permissions || [], (permission) => permission);
  const warnings = [
    ...(preview.warnings || []),
    ...(preview.env || []).filter((e) => e.required).map((e) => `需要配置环境变量 ${e.key}`),
    preview.restartRequired ? "MCP 安装后可能需要重启应用或重新初始化 MCP 连接。" : "",
  ].filter(Boolean);
  if (warnings.length) {
    storeConfirmWarnings.classList.remove("hidden");
    storeConfirmWarnings.innerHTML = "";
    for (const warning of warnings) {
      const item = document.createElement("div");
      item.textContent = warning;
      storeConfirmWarnings.appendChild(item);
    }
  } else {
    storeConfirmWarnings.classList.add("hidden");
    storeConfirmWarnings.innerHTML = "";
  }
  storeConfirmInstall.textContent = "确认安装";
  storeConfirmInstall.disabled = false;
  storeConfirm.classList.remove("hidden");
}

function renderStorePreviewList(root, items, format) {
  root.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "store-confirm-empty";
    empty.textContent = "没有需要展示的项目。";
    root.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "store-confirm-row";
    row.textContent = format(item);
    root.appendChild(row);
  }
}

function closeStoreInstallPreview() {
  pendingStoreInstall = null;
  storeConfirm.classList.add("hidden");
}

async function confirmStoreInstall() {
  if (!pendingStoreInstall) return;
  const itemId = pendingStoreInstall;
  storeConfirmInstall.textContent = "安装中";
  storeConfirmInstall.disabled = true;
  const result = await window.hicode.installStoreItem(itemId);
  if (result.ok) {
    storeMessage = `${result.item?.name || itemId} 已安装。`;
    capabilityCache = null;
    storeCache = null;
    closeStoreInstallPreview();
    await renderStore(true);
  } else {
    storeConfirmInstall.textContent = "确认安装";
    storeConfirmInstall.disabled = false;
    storeConfirmWarnings.classList.remove("hidden");
    const item = document.createElement("div");
    item.textContent = result.error || "安装失败";
    storeConfirmWarnings.appendChild(item);
  }
}

function restoreStoreSearchFocus(inputEl) {
  setTimeout(() => {
    inputEl.focus();
    const end = inputEl.value.length;
    inputEl.setSelectionRange(end, end);
  }, 0);
}

const STORE_ACTION_LABELS = { write: "写入", download: "下载", update: "更新" };

function storeIcon(kind) {
  if (kind === "skill") return "i-spark";
  if (kind === "mcp") return "i-network";
  if (kind === "agent") return "i-users";
  return "i-plug";
}

/* ---------- settings ---------- */
async function openSettings() {
  setCfgStatus("");
  cfgText = (await window.hicode.getConfig()) || "";
  cfg.value = cfgText || JSON.stringify(makeConfigFromQuick({}), null, 2);
  hydrateQuickForm(cfg.value);
  advancedConfig.classList.add("hidden");
  settings.classList.remove("hidden");
  setTimeout(() => quickApiKey.focus(), 0);
}

$("cfg-cancel").onclick = () => settings.classList.add("hidden");
$("quickModelForm").onsubmit = (e) => e.preventDefault();
$("advanced-toggle").onclick = () => {
  advancedConfig.classList.toggle("hidden");
  if (!advancedConfig.classList.contains("hidden")) cfg.value = JSON.stringify(makeConfigFromQuick(parseConfig(cfg.value)), null, 2);
};
$("cfg-save").onclick = async () => saveConfigText(cfg.value, "JSON 已保存,模型已重载。");
$("quick-save").onclick = async () => {
  const problem = validateQuickProfile(quickProfile());
  if (problem) return setCfgStatus(problem);
  const next = makeConfigFromQuick(parseConfig(cfg.value || cfgText));
  await saveConfigText(JSON.stringify(next, null, 2), "模型 API 已保存,模型已重载。");
};
$("cfg-test").onclick = async () => {
  const profile = quickProfile();
  const problem = validateQuickProfile(profile);
  if (problem) return setCfgStatus(problem);
  setCfgStatus("正在测试连接...");
  const r = await window.hicode.testModel(profile);
  setCfgStatus(r.ok ? "连接成功,可以保存使用。" : (r.error || "连接失败"), r.ok);
};

providerGrid.querySelectorAll(".provider").forEach((btn) => {
  btn.onclick = () => {
    const previousProvider = selectedProvider;
    selectedProvider = btn.dataset.provider;
    applyProvider(selectedProvider, true, previousProvider);
  };
});

function setCurrentModelDisplay(profile = {}) {
  const label = profile.model || "model";
  modelName.textContent = label;
  modelName.title = profile.baseURL || "";
  modelSide.textContent = label;
}

async function toggleModelPicker() {
  if (!modelPicker.classList.contains("hidden")) return hideModelPicker();
  await renderModelPicker();
  modelPicker.classList.remove("hidden");
}

function hideModelPicker() {
  modelPicker.classList.add("hidden");
}

async function renderModelPicker() {
  cfgText = (await window.hicode.getConfig()) || "";
  const config = normalizeConfig(parseConfig(cfgText));
  const profiles = config.profiles || {};
  const profileKeys = Object.keys(profiles);
  const reasoning = config.reasoningLevel || "medium";

  modelPicker.innerHTML = "";
  modelPicker.appendChild(modelPickerSection("推理", REASONING_LEVELS.map(([key, label, desc]) => {
    const item = pickerRow(label, desc, key === reasoning);
    item.onclick = () => switchReasoningLevel(key);
    return item;
  })));

  const modelRows = profileKeys
    .filter((key) => profiles[key]?.model)
    .map((key) => {
      const profile = profiles[key];
      const item = pickerRow(profile.model, modelSubtitle(key, profile), key === config.defaultProfile);
      item.onclick = () => switchModelProfile(key);
      return item;
    });

  if (modelRows.length) {
    modelPicker.appendChild(modelPickerSection("模型", modelRows));
  } else {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "还没有接入模型。";
    modelPicker.appendChild(modelPickerSection("模型", [empty]));
  }

  const footer = document.createElement("div");
  footer.className = "picker-footer";
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.textContent = "管理 API 和模型";
  settingsBtn.onclick = () => {
    hideModelPicker();
    openSettings();
  };
  footer.appendChild(settingsBtn);
  modelPicker.appendChild(footer);
}

function modelPickerSection(title, rows) {
  const section = document.createElement("div");
  section.className = "picker-section";
  const head = document.createElement("div");
  head.className = "picker-title";
  head.textContent = title;
  section.appendChild(head);
  for (const row of rows) section.appendChild(row);
  return section;
}

function pickerRow(label, subtitle, active = false) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "picker-row" + (active ? " active" : "");
  const text = document.createElement("span");
  text.className = "picker-text";
  const main = document.createElement("span");
  main.className = "picker-main";
  main.textContent = label;
  const sub = document.createElement("span");
  sub.className = "picker-sub";
  sub.textContent = subtitle || "";
  text.append(main, sub);
  const check = document.createElement("span");
  check.className = "picker-check";
  check.textContent = active ? "✓" : "";
  row.append(text, check);
  return row;
}

function modelSubtitle(key, profile = {}) {
  const host = profile.baseURL ? profile.baseURL.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : "custom";
  return `${key} · ${host}`;
}

async function switchReasoningLevel(level) {
  const config = normalizeConfig(parseConfig((await window.hicode.getConfig()) || cfgText));
  config.reasoningLevel = level;
  await saveConfigText(JSON.stringify(config, null, 2), `推理等级已切换为 ${reasoningLabel(level)}。`, { closeSettings: false });
  await renderModelPicker();
}

async function switchModelProfile(profileKey) {
  const config = normalizeConfig(parseConfig((await window.hicode.getConfig()) || cfgText));
  if (!config.profiles?.[profileKey]) return;
  config.defaultProfile = profileKey;
  config.roleModels = rewriteRoleModels(config.roleModels, profileKey);
  config.councilMembers = [profileKey];
  config.councilSynthesizer = profileKey;
  await saveConfigText(JSON.stringify(config, null, 2), `模型已切换为 ${config.profiles[profileKey].model}。`, { closeSettings: false });
  hideModelPicker();
}

function reasoningLabel(level) {
  return REASONING_LEVELS.find(([key]) => key === level)?.[1] || "中";
}

async function saveConfigText(text, okMessage, options = {}) {
  const r = await window.hicode.saveConfig(text);
  if (r.ok) {
    cfgText = text;
    setCurrentModelDisplay(defaultProfileFromConfig(parseConfig(text)));
    if (options.closeSettings !== false) settings.classList.add("hidden");
    if (inChat) addSystemNote(okMessage);
  } else {
    setCfgStatus(r.error || "保存失败");
  }
}

function parseConfig(text) {
  try { return text ? JSON.parse(text) : {}; }
  catch { return {}; }
}

function normalizeConfig(config = {}) {
  const profiles = config.profiles && typeof config.profiles === "object" ? { ...config.profiles } : {};
  if (!Object.keys(profiles).length && (config.baseURL || config.apiKey || config.model)) {
    profiles.default = {
      name: "default",
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
      contextWindow: config.contextWindow,
      temperature: config.temperature,
    };
  }
  const defaultProfile = config.defaultProfile || Object.keys(profiles)[0] || "default";
  return {
    ...config,
    profiles,
    defaultProfile,
    roleModels: config.roleModels && typeof config.roleModels === "object" ? config.roleModels : {},
    councilMembers: Array.isArray(config.councilMembers) ? config.councilMembers : [],
    councilSynthesizer: config.councilSynthesizer || defaultProfile,
    reasoningLevel: config.reasoningLevel || "medium",
  };
}

function hydrateQuickForm(text) {
  const current = defaultProfileFromConfig(parseConfig(text));
  selectedProvider = guessProvider(current.baseURL);
  setProviderActive(selectedProvider);
  quickBaseURL.value = current.baseURL || PROVIDERS[selectedProvider].baseURL;
  quickApiKey.value = current.apiKey || PROVIDERS[selectedProvider].apiKey;
  quickModel.value = current.model || PROVIDERS[selectedProvider].model;
  quickContext.value = String(current.contextWindow || PROVIDERS[selectedProvider].contextWindow);
  syncProviderFormMode();
}

function defaultProfileFromConfig(config) {
  if (config.profiles && typeof config.profiles === "object") {
    const key = config.defaultProfile || "default";
    return { ...(config.profiles[key] || config.profiles.default || {}) };
  }
  return {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    contextWindow: config.contextWindow,
    temperature: config.temperature,
  };
}

function quickProfile() {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  const baseURL = quickBaseURL.value.trim() || preset.baseURL;
  const apiKey = quickApiKey.value.trim() || (isLocalEndpoint(baseURL) ? "sk-no-key-required" : preset.apiKey);
  return {
    name: "default",
    baseURL,
    apiKey,
    model: quickModel.value.trim() || preset.model,
    contextWindow: Number(quickContext.value) || preset.contextWindow,
    temperature: typeof preset.temperature === "number" ? preset.temperature : 0.2,
  };
}

function validateQuickProfile(profile) {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  if (providerIsApiOnly(selectedProvider) && !profile.apiKey) return `请粘贴 ${preset.label} API Key`;
  if (!profile.baseURL) return "请填写 Base URL";
  if (!profile.model) return "请填写模型名";
  if (!profile.apiKey && !isLocalEndpoint(profile.baseURL)) return "请粘贴云端模型的 API Key";
  return "";
}

function makeConfigFromQuick(existing) {
  const profile = quickProfile();
  const defaultKey = providerProfileKey(selectedProvider);
  const profiles = existing.profiles && typeof existing.profiles === "object"
    ? { ...existing.profiles }
    : {};
  profiles[defaultKey] = { ...(profiles[defaultKey] || {}), ...profile, name: defaultKey };
  return {
    ...existing,
    defaultProfile: defaultKey,
    profiles,
    roleModels: rewriteRoleModels(existing.roleModels, defaultKey),
    councilMembers: [defaultKey],
    councilSynthesizer: defaultKey,
    compactThreshold: typeof existing.compactThreshold === "number" ? existing.compactThreshold : 0.75,
    reasoningLevel: existing.reasoningLevel || "medium",
    sandbox: existing.sandbox === true,
    mcpServers: existing.mcpServers || {},
  };
}

function providerProfileKey(providerKey) {
  return (providerKey || "default").replace(/[^a-z0-9._-]+/gi, "-") || "default";
}

function rewriteRoleModels(roleModels, profileKey) {
  const roles = ["architect", "coder", "reviewer", "tester", "explorer"];
  const next = roleModels && typeof roleModels === "object" ? { ...roleModels } : {};
  for (const role of roles) next[role] = profileKey;
  return next;
}

function applyProvider(key, overwrite, previousKey = selectedProvider) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  const saved = overwrite ? savedProfileForProvider(key) : null;
  const savedApiKey = saved?.apiKey || savedApiKeyForProvider(key);
  setProviderActive(key);
  if (overwrite || !quickBaseURL.value) quickBaseURL.value = saved?.baseURL || preset.baseURL;
  if (overwrite || !quickModel.value) quickModel.value = saved?.model || preset.model;
  if (overwrite || !quickContext.value) quickContext.value = String(saved?.contextWindow || preset.contextWindow);
  const keepApiKey = overwrite
    && quickApiKey.value
    && providerCredentialGroup(previousKey) === providerCredentialGroup(key)
    && !preset.apiKey
    && !savedApiKey;
  if (overwrite && !keepApiKey) quickApiKey.value = savedApiKey || preset.apiKey || "";
  else if (!quickApiKey.value && preset.apiKey) quickApiKey.value = preset.apiKey;
  syncProviderFormMode();
  setCfgStatus("");
}

function savedProfileForProvider(key) {
  const config = normalizeConfig(parseConfig(cfg.value || cfgText));
  const profiles = config.profiles || {};
  const directKey = providerProfileKey(key);
  if (profiles[directKey]) return profiles[directKey];
  return Object.values(profiles).find((profile) => guessProvider(profile?.baseURL || "") === key);
}

function savedApiKeyForProvider(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  if (!preset.credentialGroup) return "";
  const config = normalizeConfig(parseConfig(cfg.value || cfgText));
  const profiles = Object.values(config.profiles || {});
  return profiles.find((profile) => providerCredentialGroup(guessProvider(profile?.baseURL || "")) === preset.credentialGroup)?.apiKey || "";
}

function setCfgStatus(text, ok = false) {
  cfgErr.textContent = text;
  cfgErr.classList.toggle("ok", ok);
}

function setProviderActive(key) {
  providerGrid.querySelectorAll(".provider").forEach((btn) => btn.classList.toggle("active", btn.dataset.provider === key));
}

function guessProvider(baseURL = "") {
  if (baseURL.includes("deepseek.com")) return "deepseek";
  if (baseURL.includes("api.kimi.com")) return "kimi-code";
  if (baseURL.includes("moonshot.cn")) return "kimi-cn";
  if (baseURL.includes("moonshot.ai")) return "kimi";
  if (baseURL.includes("dashscope.aliyuncs.com")) return "qwen";
  if (baseURL.includes("bigmodel.cn")) return "zhipu";
  if (baseURL.includes("minimax.io")) return "minimax";
  if (baseURL.includes("siliconflow.cn")) return "siliconflow";
  if (baseURL.includes("generativelanguage.googleapis.com")) return "gemini";
  if (baseURL.includes("openrouter.ai")) return "openrouter";
  if (baseURL.includes("api.openai.com")) return "openai";
  if (baseURL.includes("127.0.0.1") || baseURL.includes("localhost")) return "ollama";
  return "custom";
}

function providerIsApiOnly(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  return preset.apiOnly === true;
}

function providerCredentialGroup(key) {
  const preset = PROVIDERS[key] || PROVIDERS.custom;
  return preset.credentialGroup || key || "custom";
}

function syncProviderFormMode() {
  const preset = PROVIDERS[selectedProvider] || PROVIDERS.custom;
  const card = settings.querySelector(".settings-card");
  const apiOnly = providerIsApiOnly(selectedProvider);
  card.classList.toggle("api-key-only", apiOnly);
  quickApiKey.placeholder = preset.keyPlaceholder || "sk-...";
  providerHint.textContent = apiOnly
    ? `${preset.label} 已内置 Base URL、默认模型和上下文窗口，只需要粘贴 API Key。${preset.note ? " " + preset.note : ""}`
    : preset.note || "";
  providerHint.title = `${preset.baseURL || "custom"} · ${preset.model || "custom model"}`;
}

function isLocalEndpoint(baseURL = "") {
  return /^(http:\/\/)?(127\.0\.0\.1|localhost|\[::1\])/.test(baseURL);
}

/* ---------- file browser ---------- */
let fileDir = "";
async function openFiles(dir) {
  fileDir = dir || cwd;
  filesModal.classList.remove("hidden");
  await renderFiles(fileDir);
}
$("file-close").onclick = () => filesModal.classList.add("hidden");
filesModal.addEventListener("click", (e) => {
  if (e.target === filesModal) filesModal.classList.add("hidden");
});

async function renderFiles(dir) {
  fileDir = dir;
  filePath.textContent = shortPath(dir);
  filePreview.textContent = "选择一个文件预览内容。";
  const entries = await window.hicode.listDir(dir);
  fileList.innerHTML = "";
  if (dir !== cwd) {
    const up = document.createElement("button");
    up.className = "file-row";
    up.innerHTML = `<span class="i-chev back"></span><span>返回上级</span>`;
    up.onclick = () => renderFiles(parentDir(dir));
    fileList.appendChild(up);
  }
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "这个目录没有可显示的文件。";
    fileList.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("button");
    row.className = "file-row";
    row.innerHTML = `<span class="${entry.dir ? "i-folder" : "i-edit"}"></span><span></span>`;
    row.querySelector("span:last-child").textContent = entry.name;
    row.onclick = async () => {
      if (entry.dir) return renderFiles(entry.path);
      const result = await window.hicode.readFile(entry.path);
      filePreview.textContent = result.error || result.content || "";
      filePath.textContent = shortPath(result.path || entry.path);
    };
    fileList.appendChild(row);
  }
}

function parentDir(p) {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return "/" + parts.slice(0, -1).join("/");
}

/* ---------- slash menu ---------- */
const COMMANDS = [["/team","架构师→程序员→审查员"],["/build","经理拆解 + 并行执行"],["/agent","委派单个角色"],["/council","多模型作答 + 综合"],["/debate","多模型辩论 + 裁决"],["/models","模型配置"],["/diff","Git 改动"],["/undo","撤销上一轮"],["/compact","压缩上下文"],["/sessions","历史会话"],["/mcp","MCP 服务"],["/sandbox","切换沙箱"],["/cost","用量"],["/tools","工具列表"],["/clear","清空对话"],["/help","全部命令"]];
let menuIdx = 0;
const menuVisible = () => !cmdmenu.classList.contains("hidden");
const curSlash = () => input.value.toLowerCase().match(/^\/[a-z]*/)?.[0] ?? "/";
function showMenu(filter) {
  const items = COMMANDS.filter(([n]) => n.startsWith(filter));
  if (!items.length) return hideMenu();
  menuIdx = Math.min(menuIdx, items.length - 1);
  cmdmenu.innerHTML = items.map(([n, d], i) => `<div class="item ${i === menuIdx ? "active" : ""}" data-name="${n}"><span class="name">${n}</span><span class="desc">${d}</span></div>`).join("");
  cmdmenu.querySelectorAll(".item").forEach((el) => { el.onclick = () => { input.value = el.dataset.name + " "; hideMenu(); input.focus(); }; });
  cmdmenu.classList.remove("hidden");
}
function hideMenu() { cmdmenu.classList.add("hidden"); menuIdx = 0; }

/* ---------- input ---------- */
input.addEventListener("compositionstart", () => {
  composerComposing = true;
});
input.addEventListener("compositionend", () => {
  composerComposing = false;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
  if (/^\/[a-z]*$/i.test(input.value)) showMenu(input.value.toLowerCase()); else hideMenu();
});
input.addEventListener("keydown", (e) => {
  if (composerComposing || e.isComposing) return;
  if (menuVisible()) {
    const items = cmdmenu.querySelectorAll(".item");
    if (e.key === "ArrowDown") { e.preventDefault(); menuIdx = (menuIdx + 1) % items.length; showMenu(curSlash()); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); menuIdx = (menuIdx - 1 + items.length) % items.length; showMenu(curSlash()); return; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const a = cmdmenu.querySelector(".item.active"); if (a) { input.value = a.dataset.name + " "; hideMenu(); } return; }
    if (e.key === "Escape") { hideMenu(); return; }
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
});
input.addEventListener("input", (e) => {
  input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px";
  if (composerComposing || e.isComposing) return;
  if (/^\/[a-z]*$/i.test(input.value)) showMenu(input.value.toLowerCase()); else hideMenu();
});

function shortPath(p) { const m = p && p.match(/^\/Users\/[^/]+/); return m ? p.replace(m[0], "~") : (p || ""); }

setGreeting();
initAuth();
input.focus();
