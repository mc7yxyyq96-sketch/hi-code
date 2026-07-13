import fs from "node:fs";
import path from "node:path";
import {
  normalizeReleaseChannel,
  planVersionTransition,
  updaterChannelName,
} from "./release-policy.mjs";

const UPDATE_STATES = Object.freeze([
  "disabled", "idle", "checking", "available", "up_to_date", "downloading", "downloaded", "installing", "error",
]);

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function cleanError(error) {
  return String(error?.message || error || "更新失败")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 600);
}

function cleanUpdateInfo(info) {
  if (!info || typeof info !== "object") return null;
  return {
    version: typeof info.version === "string" ? info.version : "",
    releaseName: typeof info.releaseName === "string" ? info.releaseName.slice(0, 200) : "",
    releaseDate: typeof info.releaseDate === "string" ? info.releaseDate : "",
  };
}

export function validateEmbeddedReleaseManifest(manifest, currentVersion) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, reason: "release_manifest_missing" };
  if (manifest.schemaVersion !== 1) return { ok: false, reason: "release_manifest_schema_unsupported" };
  if (manifest.version !== currentVersion) return { ok: false, reason: "release_manifest_version_mismatch" };
  try {
    normalizeReleaseChannel(manifest.channel);
  } catch {
    return { ok: false, reason: "release_manifest_channel_invalid" };
  }
  if (!/^(signed|integrity_verified|unsigned)$/.test(manifest.artifactTrust || "")) return { ok: false, reason: "release_manifest_trust_invalid" };
  if (typeof manifest.updateEnabled !== "boolean") return { ok: false, reason: "release_manifest_update_flag_invalid" };
  return { ok: true, manifest };
}

export function readEmbeddedReleaseManifest(resourcesPath) {
  if (!resourcesPath) return null;
  return readJson(path.join(resourcesPath, "release-channel.json"));
}

export function createUpdateService({
  updater,
  getVersion,
  isPackaged,
  resourcesPath,
  settingsPath,
  dialog,
  logger = null,
  beforeInstall = null,
  embeddedManifest = undefined,
  platform = process.platform,
  appImagePath = process.env.APPIMAGE || "",
} = {}) {
  if (typeof getVersion !== "function") throw new Error("createUpdateService requires getVersion");
  if (typeof isPackaged !== "function") throw new Error("createUpdateService requires isPackaged");
  const currentVersion = () => String(getVersion() || "");
  const initialSettings = settingsPath ? readJson(settingsPath) : null;
  const initialManifest = embeddedManifest === undefined ? readEmbeddedReleaseManifest(resourcesPath) : embeddedManifest;
  let selectedChannel;
  try {
    selectedChannel = normalizeReleaseChannel(initialSettings?.channel || initialManifest?.channel || "stable");
  } catch {
    selectedChannel = "stable";
  }
  let configured = false;
  let downloadedFiles = [];
  let state = {
    status: "idle",
    currentVersion: currentVersion(),
    channel: selectedChannel,
    availableVersion: "",
    progress: null,
    error: "",
    updatedAt: new Date().toISOString(),
  };
  const listeners = [];

  function emit(type, detail = {}) {
    if (typeof logger === "function") logger(`update.${type}`, detail);
  }

  function setState(status, patch = {}) {
    if (!UPDATE_STATES.includes(status)) throw new Error(`Invalid update state: ${status}`);
    state = {
      ...state,
      ...patch,
      status,
      channel: selectedChannel,
      currentVersion: currentVersion(),
      updatedAt: new Date().toISOString(),
    };
    emit("state", { status, channel: selectedChannel, availableVersion: state.availableVersion, error: state.error });
    return { ...state };
  }

  function releaseManifest() {
    return embeddedManifest === undefined ? readEmbeddedReleaseManifest(resourcesPath) : embeddedManifest;
  }

  function capabilities() {
    if (!isPackaged()) return { ok: true, available: false, reason: "unpackaged_app", message: "开发模式不会安装更新，请使用已打包版本验证更新。" };
    if (!updater || typeof updater.checkForUpdates !== "function") return { ok: true, available: false, reason: "updater_unavailable", message: "当前安装包不包含更新运行时。" };
    if (platform === "linux" && !appImagePath) {
      return { ok: true, available: false, reason: "linux_package_manual_update", message: "DEB 安装包由系统包管理器手动更新；应用内更新仅支持 AppImage。" };
    }
    const checked = validateEmbeddedReleaseManifest(releaseManifest(), currentVersion());
    if (!checked.ok) return { ok: true, available: false, reason: checked.reason, message: "安装包缺少有效的发布信任清单，自动更新已禁用。" };
    if (!checked.manifest.updateEnabled) {
      return {
        ok: true,
        available: false,
        reason: "unsigned_or_unapproved_build",
        message: "当前是 unsigned 开发/CI 构建，自动更新已禁用；请从官方发布页手动更新。",
        artifactTrust: checked.manifest.artifactTrust,
      };
    }
    if (checked.manifest.artifactTrust !== "signed" && checked.manifest.artifactTrust !== "integrity_verified") {
      return { ok: true, available: false, reason: "unsigned_build", message: "未签名安装包不能启用自动更新。" };
    }
    return { ok: true, available: true, reason: "", message: "", artifactTrust: checked.manifest.artifactTrust };
  }

  function bind(event, handler) {
    updater.on(event, handler);
    listeners.push([event, handler]);
  }

  function configure() {
    if (configured || !capabilities().available) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = selectedChannel !== "stable";
    updater.channel = updaterChannelName(selectedChannel);
    bind("checking-for-update", () => setState("checking", { error: "", progress: null }));
    bind("update-available", (info) => {
      const safeInfo = cleanUpdateInfo(info);
      if (safeInfo?.version) setState("available", { availableVersion: safeInfo.version, info: safeInfo, error: "" });
    });
    bind("update-not-available", () => setState("up_to_date", { availableVersion: "", info: null, error: "" }));
    bind("download-progress", (progress) => setState("downloading", {
      progress: {
        percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
        transferred: Math.max(0, Number(progress?.transferred) || 0),
        total: Math.max(0, Number(progress?.total) || 0),
      },
    }));
    bind("update-downloaded", (info) => {
      const safeInfo = cleanUpdateInfo(info);
      setState("downloaded", { availableVersion: safeInfo?.version || state.availableVersion, info: safeInfo, progress: { percent: 100 } });
    });
    bind("error", (error) => setState("error", { error: cleanError(error), progress: null }));
    configured = true;
  }

  async function checkUpdates() {
    const capability = capabilities();
    if (!capability.available) {
      setState("disabled", { error: capability.message });
      return { ok: false, disabled: true, error: capability.message, reason: capability.reason, current: currentVersion(), channel: selectedChannel };
    }
    configure();
    setState("checking", { error: "", progress: null });
    try {
      const result = await updater.checkForUpdates();
      const info = cleanUpdateInfo(result?.updateInfo);
      if (!info?.version) {
        setState("up_to_date", { availableVersion: "", info: null });
        return { ok: true, current: currentVersion(), latest: currentVersion(), hasUpdate: false, channel: selectedChannel };
      }
      const transition = planVersionTransition({
        currentVersion: currentVersion(),
        targetVersion: info.version,
        channel: selectedChannel,
        verified: true,
      });
      if (!transition.ok) {
        if (transition.reason === "same_version" || transition.reason === "channel_mismatch" || transition.direction === "rollback") {
          setState("up_to_date", { availableVersion: "", info: null });
          return { ok: true, current: currentVersion(), latest: info.version, hasUpdate: false, channel: selectedChannel, ignoredReason: transition.reason };
        }
        throw new Error(`Update transition rejected: ${transition.reason}`);
      }
      setState("available", { availableVersion: info.version, info, error: "" });
      return { ok: true, current: currentVersion(), latest: info.version, hasUpdate: true, channel: selectedChannel, status: "available" };
    } catch (error) {
      const message = cleanError(error);
      setState("error", { error: message });
      return { ok: false, error: message, current: currentVersion(), channel: selectedChannel };
    }
  }

  async function downloadUpdate() {
    if (state.status !== "available") return { ok: false, error: "请先检查更新并确认有可用版本。" };
    setState("downloading", { progress: { percent: 0 }, error: "" });
    try {
      const files = await updater.downloadUpdate();
      downloadedFiles = Array.isArray(files) ? files.filter((file) => typeof file === "string") : [];
      if (state.status !== "downloaded") setState("downloaded", { progress: { percent: 100 } });
      return { ok: true, status: "downloaded", version: state.availableVersion };
    } catch (error) {
      const message = cleanError(error);
      setState("error", { error: message, progress: null });
      return { ok: false, error: message };
    }
  }

  async function installUpdate() {
    if (state.status !== "downloaded" || !downloadedFiles.length) return { ok: false, error: "尚未完成更新包下载与校验。" };
    if (!dialog || typeof dialog.showMessageBox !== "function") return { ok: false, error: "主进程确认对话框不可用。" };
    const answer = await dialog.showMessageBox({
      type: "question",
      buttons: ["安装并重启", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "安装 Hi Code 更新",
      message: `已验证并下载 v${state.availableVersion}。现在关闭 Hi Code 并安装更新吗？`,
      detail: "未保存的编辑内容不会由更新器自动保存。",
    });
    if (answer.response !== 0) return { ok: false, cancelled: true, error: "用户取消安装。" };
    if (typeof beforeInstall === "function") await beforeInstall();
    setState("installing", { error: "" });
    emit("install.requested", { version: state.availableVersion, userConfirmed: true });
    setImmediate(() => updater.quitAndInstall(false, true));
    return { ok: true, installing: true, version: state.availableVersion };
  }

  function getStatus() {
    const capability = capabilities();
    return { ok: true, capability, state: { ...state, downloadedFiles: downloadedFiles.length } };
  }

  function setChannel(value) {
    const channel = normalizeReleaseChannel(value, "__invalid__");
    selectedChannel = channel;
    if (settingsPath) atomicWriteJson(settingsPath, { schemaVersion: 1, channel });
    if (configured) {
      updater.allowPrerelease = channel !== "stable";
      updater.channel = updaterChannelName(channel);
    }
    setState("idle", { availableVersion: "", info: null, progress: null, error: "" });
    emit("channel.changed", { channel, updaterChannel: updaterChannelName(channel) });
    return { ok: true, channel };
  }

  function dispose() {
    if (updater && typeof updater.off === "function") {
      for (const [event, handler] of listeners) updater.off(event, handler);
    }
    listeners.length = 0;
    configured = false;
  }

  return { capabilities, checkUpdates, downloadUpdate, installUpdate, getStatus, setChannel, dispose };
}
