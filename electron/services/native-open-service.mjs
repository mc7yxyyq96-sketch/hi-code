import { spawn } from "node:child_process";

const OPEN_APP_ALIASES = Object.freeze({
  "apple music": "Music",
  music: "Music",
  "音乐": "Music",
  "音乐app": "Music",
  todesk: "ToDesk",
  "to desk": "ToDesk",
  "向日葵": "SunloginClient",
  chrome: "Google Chrome",
  "google chrome": "Google Chrome",
  "谷歌浏览器": "Google Chrome",
  safari: "Safari",
  "微信": "WeChat",
  wechat: "WeChat",
  "终端": "Terminal",
  terminal: "Terminal",
  "访达": "Finder",
  finder: "Finder",
  wps: ["WPS Office", "WPS Writer", "Kingsoft WPS", "WPS"],
  "wps office": ["WPS Office", "WPS Writer", "Kingsoft WPS", "WPS"],
  "金山文档": ["WPS Office", "WPS Writer", "Kingsoft WPS", "WPS"],
  "金山办公": ["WPS Office", "WPS Writer", "Kingsoft WPS", "WPS"],
  word: ["Microsoft Word", "Word"],
  "microsoft word": ["Microsoft Word", "Word"],
});

export function parseOpenAppRequest(text) {
  const value = String(text || "")
    .trim()
    .replace(/[。.!！?？]+$/g, "");
  const match = value.match(/^(?:帮我|请|麻烦你|能不能)?\s*(?:打开|启动|运行)\s*(?:一下|下)?\s*(.+)$/i);
  if (!match) return null;

  const rawName = match[1]
    .trim()
    .replace(/^[-—:：\s]+/, "")
    .replace(/\s*(?:一下|下)$/u, "");
  if (!rawName || rawName.length > 80) return null;
  const normalized = rawName.toLowerCase().replace(/\s+/g, " ").trim();
  const alias = OPEN_APP_ALIASES[normalized];
  if (!alias) return null;

  return {
    requested: rawName,
    appName: Array.isArray(alias) ? alias[0] : alias,
    candidates: Array.isArray(alias) ? alias : [alias],
  };
}

export function openMacApp(appName, candidates = [appName]) {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve({ ok: false, error: "本机应用启动目前只支持 macOS。" });
      return;
    }

    const names = [...new Set((candidates || [appName]).filter(Boolean))];
    const errors = [];
    const tryOne = (idx) => {
      const name = names[idx];
      if (!name) {
        resolve({ ok: false, error: errors.filter(Boolean).join("；") || `找不到应用 ${appName}` });
        return;
      }
      const child = spawn("/usr/bin/open", ["-a", name], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (chunk) => {
        err += chunk.toString();
      });
      child.on("error", (error) => {
        errors.push(`${name}: ${error.message}`);
        tryOne(idx + 1);
      });
      child.on("close", (code) => {
        if (code === 0) resolve({ ok: true, appName: name });
        else {
          errors.push(`${name}: ${err.trim() || `open -a 退出码 ${code}`}`);
          tryOne(idx + 1);
        }
      });
    };
    tryOne(0);
  });
}
