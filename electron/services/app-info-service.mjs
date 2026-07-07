import fs from "node:fs";

// About/settings support: app metadata, data-dir access, fixed project pages,
// and a GitHub release update check. Pages are a fixed whitelist so the
// renderer can never ask the main process to open an arbitrary URL.
const REPO_URL = "https://github.com/mc7yxyyq96-sketch/hi-code";
const APP_PAGES = Object.freeze({
  repo: REPO_URL,
  releases: `${REPO_URL}/releases`,
  issues: `${REPO_URL}/issues`,
  license: `${REPO_URL}/blob/main/LICENSE`,
});
const LATEST_RELEASE_API = "https://api.github.com/repos/mc7yxyyq96-sketch/hi-code/releases/latest";

/** Compare dotted versions ("0.5.1" vs "0.5.0"); returns -1 / 0 / 1. */
export function compareVersions(a, b) {
  const pa = String(a || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function createAppInfoService({ getVersion, shell, dataDir, configPath, fetchImpl = fetch, platform = process.platform, arch = process.arch, versions = process.versions }) {
  if (typeof getVersion !== "function") throw new Error("createAppInfoService requires getVersion");
  if (!dataDir) throw new Error("createAppInfoService requires dataDir");

  return {
    getInfo() {
      return {
        ok: true,
        version: getVersion(),
        electron: versions.electron || "",
        chrome: versions.chrome || "",
        node: versions.node || "",
        platform,
        arch,
        dataDir,
        configPath: configPath || "",
        repoUrl: REPO_URL,
        license: "MIT",
      };
    },

    async openDataDir() {
      if (!shell || typeof shell.openPath !== "function") return { ok: false, error: "shell 不可用" };
      try {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      } catch {
        /* openPath reports unreadable paths below */
      }
      const problem = await shell.openPath(dataDir);
      return problem ? { ok: false, error: problem } : { ok: true, path: dataDir };
    },

    async revealConfig() {
      if (!configPath) return { ok: false, error: "配置文件路径未知" };
      if (fs.existsSync(configPath) && shell && typeof shell.showItemInFolder === "function") {
        shell.showItemInFolder(configPath);
        return { ok: true, path: configPath };
      }
      // No config saved yet — fall back to the data dir so the button still helps.
      return this.openDataDir();
    },

    async openPage(target) {
      const url = APP_PAGES[String(target || "")];
      if (!url) return { ok: false, error: `未知页面: ${target}` };
      if (!shell || typeof shell.openExternal !== "function") return { ok: false, error: "shell 不可用" };
      await shell.openExternal(url);
      return { ok: true, url };
    },

    async checkUpdates() {
      const current = getVersion();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetchImpl(LATEST_RELEASE_API, {
          signal: controller.signal,
          headers: { accept: "application/vnd.github+json", "user-agent": `hi-code/${current}` },
        });
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            return { ok: false, error: "GitHub 接口限流，请稍后再试，或直接打开下载页查看。", current };
          }
          return { ok: false, error: `检查更新失败（HTTP ${res.status}），可直接打开下载页查看。`, current };
        }
        const data = await res.json();
        const latest = String(data.tag_name || data.name || "").replace(/^v/i, "");
        if (!latest) return { ok: false, error: "无法解析最新版本号，可直接打开下载页查看。", current };
        return {
          ok: true,
          current,
          latest,
          hasUpdate: compareVersions(current, latest) < 0,
          url: data.html_url || APP_PAGES.releases,
          publishedAt: data.published_at || "",
        };
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        return {
          ok: false,
          error: timedOut
            ? "检查更新超时：网络无法访问 GitHub，可直接打开下载页查看。"
            : "检查更新失败：当前网络无法访问 GitHub，可直接打开下载页查看。",
          current,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function registerAppInfoIpc({ register, appInfo }) {
  if (!register) throw new Error("registerAppInfoIpc requires register");
  if (!appInfo) throw new Error("registerAppInfoIpc requires appInfo service");

  register.handle("app:info", () => appInfo.getInfo());
  register.handle("app:open-data-dir", () => appInfo.openDataDir());
  register.handle("app:reveal-config", () => appInfo.revealConfig());
  register.handle("app:open-page", (_event, target) => appInfo.openPage(target));
  register.handle("app:check-updates", () => appInfo.checkUpdates());
}
