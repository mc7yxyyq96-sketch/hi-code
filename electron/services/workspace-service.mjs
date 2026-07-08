import fs from "node:fs";
import path from "node:path";
import { contentText } from "../../dist/context.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "release", "__pycache__"]);
const ATTACHMENT_DIR = path.join(".hicode", "attachments");
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
]);
const IMAGE_EXT_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

export function createWorkspaceService({
  dialog,
  getWindow,
  getCwd,
  setCwd,
  buildRuntime,
  resolveInCwd,
  listSessions,
  deleteSession,
  loadSession,
  getRuntime,
  configPath,
  loadConfig,
  defaultProfile,
  buildSystemPrompt,
  send,
  fetchImpl = fetch,
}) {
  return {
    async pickFolder() {
      const result = await dialog.showOpenDialog(getWindow(), { properties: ["openDirectory"] });
      if (!result.canceled && result.filePaths[0]) {
        setCwd(result.filePaths[0]);
        buildRuntime();
      }
      return getCwd();
    },

    async attachImage(payload = {}) {
      try {
        const data = ipcObject(payload);
        if (typeof data.dataUrl === "string" && data.dataUrl.trim()) {
          const parsed = parseImageDataUrl(data.dataUrl);
          if (!parsed.ok) return { ok: false, error: parsed.error };
          return writeAttachment({
            cwd: getCwd(),
            name: data.name,
            ext: parsed.ext,
            mime: parsed.mime,
            buffer: parsed.buffer,
          });
        }

        const result = await dialog.showOpenDialog(getWindow(), {
          properties: ["openFile"],
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
        });
        if (result.canceled || !result.filePaths?.[0]) {
          return { ok: false, canceled: true, error: "已取消选择图片" };
        }

        const sourcePath = result.filePaths[0];
        const ext = path.extname(sourcePath).toLowerCase();
        const mime = IMAGE_EXT_MIME.get(ext);
        if (!mime) return { ok: false, error: "只支持 PNG、JPG、GIF、WebP 图片附件" };
        const stat = fs.statSync(sourcePath);
        if (!stat.isFile()) return { ok: false, error: "请选择一个图片文件" };
        if (stat.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "图片超过 8MB，请压缩后再添加" };
        return writeAttachment({
          cwd: getCwd(),
          name: path.basename(sourcePath),
          ext,
          mime,
          buffer: fs.readFileSync(sourcePath),
        });
      } catch (error) {
        return { ok: false, error: error?.message ?? "图片附件失败" };
      }
    },

    getCwd,

    listDir(dir) {
      const target = resolveInCwd(ipcString(dir, getCwd()));
      if (!target) return [];
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        return entries
          .filter((entry) => !(entry.isDirectory() && IGNORE_DIRS.has(entry.name)) && !entry.name.startsWith("."))
          .map((entry) => ({ name: entry.name, path: path.join(target, entry.name), dir: entry.isDirectory() }))
          .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      } catch {
        return [];
      }
    },

    readFile(filePath) {
      try {
        const target = resolveInCwd(ipcString(filePath));
        if (!target) return { error: "path escapes workspace" };
        const stat = fs.statSync(target);
        if (stat.size > 1_000_000) return { error: "file too large to preview" };
        return { content: fs.readFileSync(target, "utf8"), path: target };
      } catch (error) {
        return { error: error?.message ?? "cannot read file" };
      }
    },

    listSessions() {
      try {
        return listSessions(getCwd());
      } catch {
        return [];
      }
    },

    resumeSession(id) {
      try {
        const runtime = getRuntime();
        return runtime ? runtime.resume(ipcString(id)) : [];
      } catch {
        return [];
      }
    },

    newSession() {
      try {
        const runtime = getRuntime();
        if (!runtime?.startNewSession) return { ok: false, error: "runtime not ready" };
        if (runtime.isBusy?.()) return { ok: false, error: "当前任务仍在运行，结束后再新建对话" };
        const result = runtime.startNewSession();
        const cfg = loadConfig();
        const profile = defaultProfile(cfg);
        send("ready", {
          model: profile.model,
          baseURL: profile.baseURL,
          cwd: getCwd(),
          reasoningLevel: cfg.reasoningLevel,
          sessionId: result.sessionId,
          capabilities: modelCapabilityHint(profile),
        });
        return { ok: true, sessionId: result.sessionId };
      } catch (error) {
        return { ok: false, error: error?.message ?? "new session failed" };
      }
    },

    deleteSession(id) {
      try {
        return deleteSession(ipcString(id));
      } catch {
        return false;
      }
    },

    readSession(id) {
      try {
        return formatSessionMessages(loadSession(ipcString(id)));
      } catch {
        return [];
      }
    },

    getConfig() {
      try {
        return fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      } catch {
        return "";
      }
    },

    saveConfig(text) {
      try {
        const configText = ipcString(text);
        JSON.parse(configText);
        fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(configPath, configText, { mode: 0o600 });
        try { fs.chmodSync(configPath, 0o600); } catch {}
        const cfg = loadConfig();
        const profile = defaultProfile(cfg);
        const runtime = getRuntime();
        if (runtime?.updateConfig) {
          runtime.updateConfig(cfg, buildSystemPrompt(getCwd(), profile.model, cfg.reasoningLevel));
          send("ready", {
            model: profile.model,
            baseURL: profile.baseURL,
            cwd: getCwd(),
            reasoningLevel: cfg.reasoningLevel,
            sessionId: runtime?.sessionId || "",
            capabilities: modelCapabilityHint(profile),
          });
        } else {
          buildRuntime();
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error?.message ?? "invalid JSON" };
      }
    },

    async testModel(profile) {
      const data = ipcObject(profile);
      const baseURL = ipcString(data.baseURL).replace(/\/+$/, "");
      const apiKey = ipcString(data.apiKey);
      const model = ipcString(data.model);
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

        const res = await fetchImpl(`${baseURL}/chat/completions`, {
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
        return { ok: true, message: "连接成功", capabilities: modelCapabilityHint({ baseURL, model }) };
      } catch (error) {
        return { ok: false, error: modelTestNetworkError(error, baseURL) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function registerWorkspaceIpc({ register, workspace }) {
  if (!register) throw new Error("registerWorkspaceIpc requires register");
  if (!workspace) throw new Error("registerWorkspaceIpc requires workspace service");

  register.handle("pick-folder", () => workspace.pickFolder());
  register.handle("attach-image", (_event, payload) => workspace.attachImage(payload));
  register.handle("get-cwd", () => workspace.getCwd());
  register.handle("list-dir", (_event, dir) => workspace.listDir(dir));
  register.handle("read-file", (_event, filePath) => workspace.readFile(filePath));
  register.handle("list-sessions", () => workspace.listSessions());
  register.handle("resume-session", (_event, id) => workspace.resumeSession(id));
  register.handle("new-session", () => workspace.newSession());
  register.handle("delete-session", (_event, id) => workspace.deleteSession(id));
  register.handle("read-session", (_event, id) => workspace.readSession(id));
  register.handle("get-config", () => workspace.getConfig());
  register.handle("save-config", (_event, text) => workspace.saveConfig(text));
  register.handle("test-model", (_event, profile) => workspace.testModel(profile));
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match) return { ok: false, error: "粘贴内容不是支持的图片格式" };
  const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const ext = IMAGE_MIME_EXT.get(mime);
  if (!ext) return { ok: false, error: "只支持 PNG、JPG、GIF、WebP 图片附件" };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return { ok: false, error: "图片内容为空" };
  if (buffer.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: "图片超过 8MB，请压缩后再添加" };
  return { ok: true, mime, ext, buffer };
}

function writeAttachment({ cwd, name, ext, mime, buffer }) {
  const safeName = safeAttachmentName(name, ext);
  const relativePath = path.posix.join(...ATTACHMENT_DIR.split(path.sep), safeName);
  const target = safeNewWorkspacePath(cwd, relativePath);
  if (!target) return { ok: false, error: "图片附件路径超出当前工作区" };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, buffer, { mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch {}
  const verified = safeExistingWorkspacePath(cwd, target);
  if (!verified) {
    try { fs.rmSync(target, { force: true }); } catch {}
    return { ok: false, error: "图片附件写入后路径校验失败" };
  }
  return {
    ok: true,
    name: safeName,
    path: verified,
    relativePath,
    mime,
    size: buffer.length,
  };
}

function safeAttachmentName(name, ext) {
  const base = path.basename(String(name || "image")).replace(/\.[^.]+$/, "");
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "image";
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${nonce}-${cleaned}${ext}`;
}

function safeExistingWorkspacePath(cwd, filePath) {
  const cwdReal = fs.realpathSync.native(cwd);
  const real = fs.realpathSync.native(filePath);
  return isPathInside(cwdReal, real) ? real : null;
}

function safeNewWorkspacePath(cwd, relativePath) {
  const cwdReal = fs.realpathSync.native(cwd);
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || path.isAbsolute(normalized)) return null;
  const target = path.resolve(cwd, normalized);
  const workspaceAbs = path.resolve(cwd);
  if (!isPathInside(workspaceAbs, target)) return null;

  let nearest = path.dirname(target);
  while (!fs.existsSync(nearest)) {
    const next = path.dirname(nearest);
    if (next === nearest) return null;
    nearest = next;
  }
  const nearestReal = fs.realpathSync.native(nearest);
  if (!isPathInside(cwdReal, nearestReal)) return null;
  return target;
}

function isPathInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function shouldOmitTemperatureForBaseURL(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
}

export function modelCapabilityHint(profile = {}) {
  const model = String(profile.model || "").toLowerCase();
  const baseURL = String(profile.baseURL || "").toLowerCase();
  const haystack = `${model} ${baseURL}`;
  const supportedPattern = /\b(gpt-4o|gpt-4\.1|o4|gemini|qwen[-_/]vl|qvq|vl\b|vision|visual|multimodal|omni|glm-4v|grok.*vision|claude-3|claude.*sonnet|claude.*opus)\b/;
  const unsupportedPattern = /\b(deepseek-(chat|reasoner|coder)|kimi-k2|kimi.*coding|kimi-for-coding|coder|coding|embedding|rerank|text-embedding)\b/;
  if (supportedPattern.test(haystack)) {
    return {
      vision: {
        status: "supported",
        supported: true,
        confidence: "heuristic",
        reason: "模型名称或服务商入口包含常见视觉/多模态标识。",
        recommendation: "可以直接发送图片；如果服务商仍拒绝，请换成该服务商明确标注支持视觉的模型。",
      },
    };
  }
  if (unsupportedPattern.test(haystack)) {
    return {
      vision: {
        status: "unsupported",
        supported: false,
        confidence: "heuristic",
        reason: "当前模型名称更像文本/代码模型，通常不接收 image_url 输入。",
        recommendation: "发图识别前请切换到 GPT-4o、Gemini、Qwen-VL、GLM-4V 等视觉/多模态模型，或把图片内容改成文字描述。",
      },
    };
  }
  return {
    vision: {
      status: "unknown",
      supported: null,
      confidence: "unknown",
      reason: "无法仅凭模型名称确认图片能力。",
      recommendation: "可以尝试发送图片；若失败，请换成服务商明确标注支持视觉/多模态的模型。",
    },
  };
}

export function modelTestError(status, text, baseURL) {
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
  if (status === 403) {
    return `访问被拒绝：Key 有效但没有该模型的使用权限，请到服务商控制台确认已开通此模型。原始错误：HTTP 403 ${raw}`;
  }
  if (status === 404) {
    return `地址或模型名不对：请检查 Base URL 是否以 /v1 这类前缀结尾、模型名是否与服务商控制台一致。原始错误：HTTP 404 ${raw}`;
  }
  if (status === 429) {
    return `请求被限流或额度不足：请稍后重试，或到服务商控制台检查余额/速率限制。原始错误：HTTP 429 ${raw}`;
  }
  if (status >= 500) {
    return `服务商服务端异常：一般稍后重试即可，持续失败请检查服务商状态页。原始错误：HTTP ${status} ${raw}`;
  }
  return `HTTP ${status}: ${raw}`;
}

export function modelTestNetworkError(error, baseURL) {
  const msg = String(error?.message ?? "");
  const code = String(error?.cause?.code ?? error?.code ?? "");
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(String(baseURL || ""));
  if (error?.name === "AbortError") {
    return "连接超时（15 秒）：请检查网络，或确认 Base URL 可达；国外服务在国内直连常见超时。";
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(msg)) {
    return isLocal
      ? "连接被拒绝：本地模型服务未启动。请先启动 Ollama / vLLM 等本地服务，再测试连接。"
      : "连接被拒绝：目标地址没有服务在监听，请检查 Base URL 的主机和端口。";
  }
  if (code === "ENOTFOUND" || /ENOTFOUND|getaddrinfo/.test(msg)) {
    return "域名无法解析：请检查 Base URL 拼写，或确认当前网络可以访问该服务商。";
  }
  if (code === "CERT_HAS_EXPIRED" || /certificate|SSL|TLS/i.test(msg)) {
    return `TLS/证书错误：${msg}。如使用自建服务请检查证书配置。`;
  }
  if (/fetch failed/i.test(msg)) {
    return isLocal
      ? "网络请求失败：本地服务可能未启动或端口不对。请确认本地模型服务正在运行。"
      : "网络请求失败：请检查网络连接和 Base URL；如在代理环境，请确认代理放行了该地址。";
  }
  return msg || "连接失败";
}

function isKimiEndpoint(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
}

function formatSessionMessages(stored) {
  if (!stored?.messages) return [];
  return stored.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, text: contentText(m.content).trim() }))
    .filter((m) => m.text.length > 0 && !m.text.startsWith("[Earlier conversation summary]"));
}
