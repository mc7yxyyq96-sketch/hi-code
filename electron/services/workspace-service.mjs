import fs from "node:fs";
import path from "node:path";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "release", "__pycache__"]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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
  replaySessionMessages = () => [],
  getRuntime,
  configPath,
  loadConfig,
  defaultProfile,
  buildSystemPrompt,
  send,
  attachmentStore,
  fetchImpl = fetch,
}) {
  if (!attachmentStore?.putBuffer || !attachmentStore?.get) throw new Error("workspace-service requires attachmentStore");

  const attachFile = async (payload = {}) => {
    try {
      const data = ipcObject(payload);
      const runtime = getRuntime();
      const sessionId = ipcString(runtime?.sessionId).trim();
      if (!sessionId) return { ok: false, error: "当前会话尚未准备好，请稍后重试" };
      let name;
      let buffer;

      if (typeof data.dataUrl === "string" && data.dataUrl.trim()) {
        const parsed = parseImageDataUrl(data.dataUrl);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        name = ipcString(data.name, "pasted-image.png");
        buffer = parsed.buffer;
      } else {
        const imagesOnly = data.imagesOnly === true;
        const result = await dialog.showOpenDialog(getWindow(), {
          properties: ["openFile"],
          filters: imagesOnly
            ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }]
            : [
                { name: "Supported attachments", extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "json", "csv", "log"] },
                { name: "All files", extensions: ["*"] },
              ],
        });
        if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true, error: "已取消选择附件" };
        const sourcePath = result.filePaths[0];
        const stat = fs.statSync(sourcePath);
        if (!stat.isFile()) return { ok: false, error: "请选择一个文件" };
        name = path.basename(sourcePath);
        buffer = fs.readFileSync(sourcePath);
      }

      const record = attachmentStore.putBuffer({ sessionId, name, data: buffer });
      if (data.imagesOnly === true && record.kind !== "image") {
        attachmentStore.remove(record.id);
        return { ok: false, error: "请选择 PNG、JPG、GIF 或 WebP 图片" };
      }
      return attachmentResult(record);
    } catch (error) {
      return { ok: false, error: error?.message ?? "附件添加失败" };
    }
  };

  return {
    async pickFolder() {
      const result = await dialog.showOpenDialog(getWindow(), { properties: ["openDirectory"] });
      if (!result.canceled && result.filePaths[0]) {
        setCwd(result.filePaths[0]);
        buildRuntime();
      }
      return getCwd();
    },

    attachFile,

    attachImage(payload = {}) {
      return attachFile({ ...ipcObject(payload), imagesOnly: true });
    },

    listAttachments(id) {
      const sessionId = ipcString(id, getRuntime()?.sessionId || "").trim();
      if (!sessionId) return [];
      return attachmentStore.list(sessionId).map(attachmentResult);
    },

    removeAttachment(id) {
      const attachmentId = ipcString(id).trim();
      const record = attachmentStore.get(attachmentId);
      if (!record) return { ok: false, error: "附件不存在" };
      if (record.sessionId !== getRuntime()?.sessionId) return { ok: false, error: "不能删除其他会话的附件" };
      return { ok: attachmentStore.remove(attachmentId) };
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
        const sessionId = ipcString(id);
        const messages = runtime ? runtime.resume(sessionId) : [];
        return messages?.length ? messages : replaySessionMessages(sessionId);
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
        const sessionId = ipcString(id);
        const removed = deleteSession(sessionId);
        if (removed) attachmentStore.removeSession(sessionId);
        return removed;
      } catch {
        return false;
      }
    },

    readSession(id) {
      try {
        const sessionId = ipcString(id);
        const messages = formatSessionMessages(loadSession(sessionId));
        return messages.length ? messages : replaySessionMessages(sessionId);
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
        const parsed = JSON.parse(configText);
        validateModelProtocolConfig(parsed);
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
      let protocol;
      try {
        protocol = normalizeModelProtocol(data.protocol);
      } catch (error) {
        return { ok: false, error: error?.message ?? "模型协议无效" };
      }
      if (!baseURL) return { ok: false, error: "请填写 Base URL" };
      if (!model) return { ok: false, error: "请填写模型名" };
      if (!apiKey && protocol !== "ollama_chat") return { ok: false, error: "请填写 API Key；本地 Ollama 原生协议可以留空" };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const request = buildModelTestRequest({ baseURL, apiKey, model, protocol });
        const res = await fetchImpl(request.url, {
          method: "POST",
          signal: controller.signal,
          headers: request.headers,
          body: JSON.stringify(request.body),
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, error: modelTestError(res.status, text, baseURL) };
        validateModelTestResponse(protocol, text);
        return { ok: true, message: "连接成功", capabilities: modelCapabilityHint({ baseURL, model, protocol }) };
      } catch (error) {
        return { ok: false, error: modelTestNetworkError(error, baseURL) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function validateModelProtocolConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("配置必须是 JSON 对象");
  normalizeModelProtocol(config.protocol);
  if (config.profiles !== undefined) {
    if (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) {
      throw new Error("profiles 必须是对象");
    }
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error(`模型配置 ${name} 必须是对象`);
      try {
        normalizeModelProtocol(profile.protocol);
      } catch {
        throw new Error(`模型配置 ${name} 的 protocol 只支持 chat_completions、responses、anthropic_messages 或 ollama_chat`);
      }
    }
  }
  return true;
}

function normalizeModelProtocol(value) {
  if (value === undefined || value === null || value === "") return "chat_completions";
  if (["chat_completions", "responses", "anthropic_messages", "ollama_chat"].includes(value)) return value;
  throw new Error("protocol 只支持 chat_completions、responses、anthropic_messages 或 ollama_chat");
}

export function registerWorkspaceIpc({ register, workspace }) {
  if (!register) throw new Error("registerWorkspaceIpc requires register");
  if (!workspace) throw new Error("registerWorkspaceIpc requires workspace service");

  register.handle("pick-folder", () => workspace.pickFolder());
  register.handle("attach-file", (_event, payload) => workspace.attachFile(payload));
  register.handle("attach-image", (_event, payload) => workspace.attachImage(payload));
  register.handle("attachments:list", (_event, sessionId) => workspace.listAttachments(sessionId));
  register.handle("attachment:remove", (_event, id) => workspace.removeAttachment(id));
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
  if (String(dataUrl || "").length > Math.ceil(MAX_ATTACHMENT_BYTES * 1.5)) return { ok: false, error: "图片超过 8MB，请压缩后再添加" };
  const match = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match) return { ok: false, error: "粘贴内容不是支持的图片格式" };
  const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return { ok: false, error: "图片内容为空" };
  if (buffer.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: "图片超过 8MB，请压缩后再添加" };
  return { ok: true, mime, buffer };
}

function attachmentResult(record) {
  return {
    ok: true,
    id: record.id,
    name: record.name,
    kind: record.kind,
    mimeType: record.mimeType,
    mime: record.mimeType,
    size: record.size,
    sha256: record.sha256,
  };
}

function shouldOmitTemperatureForBaseURL(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
}

export function buildModelTestRequest({ baseURL, apiKey, model, protocol }) {
  const normalizedProtocol = normalizeModelProtocol(protocol);
  const headers = { "content-type": "application/json" };
  let url;
  let body;

  if (normalizedProtocol === "responses") {
    url = secureModelTestEndpoint(baseURL, "responses", "Responses");
    headers.authorization = `Bearer ${apiKey}`;
    body = {
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: "Reply with ok." }] }],
      max_output_tokens: 8,
      stream: false,
      store: false,
    };
  } else if (normalizedProtocol === "anthropic_messages") {
    url = secureModelTestEndpoint(baseURL, "messages", "Anthropic Messages", { defaultPath: "/v1/messages" });
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with ok." }],
      stream: false,
    };
  } else if (normalizedProtocol === "ollama_chat") {
    url = secureOllamaTestEndpoint(baseURL);
    if (apiKey && apiKey !== "sk-no-key-required") headers.authorization = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [{ role: "user", content: "Reply with ok." }],
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 8 },
    };
  } else {
    url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;
    headers.authorization = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [{ role: "user", content: "Reply with ok." }],
      max_tokens: 8,
      stream: false,
    };
    if (!shouldOmitTemperatureForBaseURL(baseURL)) body.temperature = 0;
  }

  return { url, headers, body, protocol: normalizedProtocol };
}

export function validateModelTestResponse(protocol, text) {
  const normalizedProtocol = normalizeModelProtocol(protocol);
  if (normalizedProtocol === "chat_completions") return true;
  let response;
  try {
    response = JSON.parse(text || "{}");
  } catch {
    throw new Error("模型连接返回了无效 JSON");
  }
  if (normalizedProtocol === "responses" && response.status !== "completed") {
    throw new Error(`Responses 连接返回非完成状态：${String(response.status || "unknown")}`);
  }
  if (normalizedProtocol === "anthropic_messages" && (response.type !== "message" || response.role !== "assistant" || !Array.isArray(response.content))) {
    throw new Error("Anthropic Messages 连接未返回有效 assistant message");
  }
  if (normalizedProtocol === "ollama_chat" && (response.done !== true || !response.message || response.message.role !== "assistant")) {
    throw new Error("Ollama 原生连接未返回完成的 assistant message");
  }
  return true;
}

function secureModelTestEndpoint(baseURL, suffix, label, { defaultPath = "" } = {}) {
  const url = secureModelTestBaseURL(baseURL, label);
  const current = url.pathname.replace(/\/+$/, "");
  if (current.endsWith(`/${suffix}`)) url.pathname = current;
  else if (!current && defaultPath) url.pathname = defaultPath;
  else url.pathname = `${current}/${suffix}`.replace(/^\/\//, "/");
  return url.toString();
}

function secureOllamaTestEndpoint(baseURL) {
  const url = secureModelTestBaseURL(baseURL, "Ollama");
  const current = url.pathname.replace(/\/+$/, "");
  if (current.endsWith("/api/chat")) url.pathname = current;
  else if (current.endsWith("/api")) url.pathname = `${current}/chat`;
  else url.pathname = `${current}/api/chat`.replace(/^\/\//, "/");
  return url.toString();
}

function secureModelTestBaseURL(baseURL, label) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(`${label} Base URL 无效`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${label} 远程连接必须使用 HTTPS；本机回环地址可以使用 HTTP`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} Base URL 不能包含凭据、查询参数或片段`);
  }
  return url;
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
    .map((m) => formatSessionMessage(m))
    .filter((m) => (m.text.length > 0 || m.attachments?.length) && !m.text.startsWith("[Earlier conversation summary]"));
}

function formatSessionMessage(message) {
  if (!Array.isArray(message.content)) return { role: message.role, text: String(message.content || "").trim() };
  const attachments = message.content
    .filter((part) => part?.type === "attachment_ref" && part.attachment)
    .map((part) => ({ ...part.attachment }));
  const text = message.content
    .filter((part) => part?.type !== "attachment_ref")
    .map((part) => part?.type === "text" ? part.text : "[image]")
    .join(" ")
    .trim();
  return { role: message.role, text, ...(attachments.length ? { attachments } : {}) };
}
