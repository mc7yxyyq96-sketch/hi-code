import fs from "node:fs";
import path from "node:path";
import { contentText } from "../../dist/context.js";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "release", "__pycache__"]);

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
          send("ready", { model: profile.model, baseURL: profile.baseURL, cwd: getCwd(), reasoningLevel: cfg.reasoningLevel, sessionId: runtime?.sessionId || "" });
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
        return { ok: true, message: "连接成功" };
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
  register.handle("get-cwd", () => workspace.getCwd());
  register.handle("list-dir", (_event, dir) => workspace.listDir(dir));
  register.handle("read-file", (_event, filePath) => workspace.readFile(filePath));
  register.handle("list-sessions", () => workspace.listSessions());
  register.handle("resume-session", (_event, id) => workspace.resumeSession(id));
  register.handle("delete-session", (_event, id) => workspace.deleteSession(id));
  register.handle("read-session", (_event, id) => workspace.readSession(id));
  register.handle("get-config", () => workspace.getConfig());
  register.handle("save-config", (_event, text) => workspace.saveConfig(text));
  register.handle("test-model", (_event, profile) => workspace.testModel(profile));
}

function shouldOmitTemperatureForBaseURL(baseURL) {
  const value = String(baseURL || "").toLowerCase();
  return value.includes("moonshot.") || value.includes("api.kimi.com");
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
