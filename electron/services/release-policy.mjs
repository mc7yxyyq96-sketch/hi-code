import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RELEASE_CHANNELS = Object.freeze(["stable", "beta", "nightly"]);
export const RELEASE_MODES = Object.freeze(["development", "ci", "release"]);

const SENSITIVE_RELEASE_KEYS = Object.freeze([
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_NAME",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "GH_TOKEN",
]);

const BASE_BUILD_ENV = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TMP", "TEMP", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "ProgramFiles", "ProgramFiles(x86)", "CI", "GITHUB_ACTIONS", "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_EVENT_NAME",
  "RUNNER_OS", "RUNNER_ARCH", "RUNNER_TEMP", "RUNNER_TOOL_CACHE", "SOURCE_DATE_EPOCH",
  "npm_config_arch", "npm_config_platform", "npm_config_target_arch", "npm_config_target_platform",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
]);

export function normalizeReleaseChannel(value, fallback = "stable") {
  const channel = String(value || "").trim().toLowerCase();
  if (RELEASE_CHANNELS.includes(channel)) return channel;
  if (RELEASE_CHANNELS.includes(fallback)) return fallback;
  throw new Error(`Unsupported release channel: ${value}`);
}

export function normalizeReleaseMode(value, fallback = "development") {
  const mode = String(value || "").trim().toLowerCase();
  if (RELEASE_MODES.includes(mode)) return mode;
  if (RELEASE_MODES.includes(fallback)) return fallback;
  throw new Error(`Unsupported release mode: ${value}`);
}

export function parseReleaseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid release version: ${value}`);
  return {
    raw: String(value).replace(/^v/i, ""),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifier(a, b) {
  const aNumber = /^\d+$/.test(a) ? Number(a) : null;
  const bNumber = /^\d+$/.test(b) ? Number(b) : null;
  if (aNumber !== null && bNumber !== null) return Math.sign(aNumber - bNumber);
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  return a.localeCompare(b);
}

export function compareReleaseVersions(a, b) {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const compared = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (compared !== 0) return compared < 0 ? -1 : 1;
  }
  return 0;
}

export function inferReleaseChannel(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed.prerelease.length) return "stable";
  const label = parsed.prerelease.join(".").toLowerCase();
  return /(?:^|\.)(?:beta|rc)(?:\.|$)/.test(label) ? "beta" : "nightly";
}

export function updaterChannelName(channel) {
  return ({ stable: "latest", beta: "beta", nightly: "alpha" })[normalizeReleaseChannel(channel)];
}

export function resolveBuilderPlatform(args = [], fallback = process.platform) {
  const requested = [
    ["--mac", "darwin"],
    ["--win", "win32"],
    ["--linux", "linux"],
  ].filter(([flag]) => args.includes(flag));
  if (requested.length > 1) {
    throw new Error("Package one platform per controlled builder invocation");
  }
  return requested[0]?.[1] || fallback;
}

export function prepareBuilderArguments(args = [], policy) {
  if (!policy) throw new Error("prepareBuilderArguments requires a release policy");
  for (const value of args) {
    const argument = String(value || "");
    if (argument === "--publish" || argument === "-p" || argument.startsWith("--publish=") || argument.startsWith("-p=")) {
      throw new Error("Builder publish mode is controlled by the release policy");
    }
    if (argument === "--config" || argument === "-c" || argument.startsWith("--config=") || argument.startsWith("-c=") || argument.startsWith("--config.")) {
      throw new Error("Builder configuration overrides are not allowed in the controlled release pipeline");
    }
  }
  resolveBuilderPlatform(args);
  return [
    ...args,
    `--config.publish.channel=${policy.updaterChannel}`,
    "--publish",
    policy.publishAllowed ? "always" : "never",
  ];
}

export function channelAcceptsVersion(channel, version) {
  const selected = normalizeReleaseChannel(channel);
  const candidate = inferReleaseChannel(version);
  if (selected === "stable") return candidate === "stable";
  if (selected === "beta") return candidate === "stable" || candidate === "beta";
  return true;
}

export function planVersionTransition({ currentVersion, targetVersion, channel = "stable", recoveryMode = false, userApproved = false, verified = false }) {
  const direction = compareReleaseVersions(currentVersion, targetVersion);
  if (direction === 0) return { ok: false, reason: "same_version", direction: "none" };
  if (!verified) return { ok: false, reason: "package_not_verified", direction: direction < 0 ? "upgrade" : "rollback" };
  if (direction < 0) {
    if (!channelAcceptsVersion(channel, targetVersion)) return { ok: false, reason: "channel_mismatch", direction: "upgrade" };
    return { ok: true, direction: "upgrade", requiresApproval: true };
  }
  if (!recoveryMode) return { ok: false, reason: "automatic_downgrade_forbidden", direction: "rollback" };
  if (!userApproved) return { ok: false, reason: "rollback_requires_approval", direction: "rollback" };
  return { ok: true, direction: "rollback", requiresApproval: true, recoveryMode: true };
}

function hasAll(env, keys) {
  return keys.every((key) => typeof env[key] === "string" && env[key].trim().length > 0);
}

export function inspectSigningEnvironment({ env = process.env, platform = process.platform } = {}) {
  const appleIdentity = Boolean(env.CSC_NAME) || hasAll(env, ["CSC_LINK", "CSC_KEY_PASSWORD"]);
  const appleNotarization = hasAll(env, ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"])
    || hasAll(env, ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]);
  const windowsIdentity = hasAll(env, ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"])
    || hasAll(env, ["CSC_LINK", "CSC_KEY_PASSWORD"])
    || Boolean(env.CSC_NAME);
  const signed = platform === "darwin" ? appleIdentity : platform === "win32" ? windowsIdentity : false;
  return {
    platform,
    signed,
    notarized: platform === "darwin" ? appleIdentity && appleNotarization : false,
    credentialPresence: {
      signingIdentity: platform === "darwin" ? appleIdentity : platform === "win32" ? windowsIdentity : false,
      notarization: platform === "darwin" ? appleNotarization : false,
    },
  };
}

export function createReleasePolicy({ version, platform = process.platform, mode, channel, env = process.env, publishRequested, sourceState = null } = {}) {
  const normalizedMode = normalizeReleaseMode(mode || env.HICODE_RELEASE_MODE || (env.CI ? "ci" : "development"));
  const inferredChannel = inferReleaseChannel(version);
  const normalizedChannel = normalizeReleaseChannel(channel || env.HICODE_RELEASE_CHANNEL || inferredChannel);
  const signing = inspectSigningEnvironment({ env, platform });
  const approved = env.HICODE_RELEASE_APPROVED === "1";
  const wantsPublish = publishRequested ?? env.HICODE_RELEASE_PUBLISH === "1";
  const hasPublishToken = Boolean(env.GH_TOKEN || env.GITHUB_TOKEN);
  const errors = [];
  const warnings = [];

  if (normalizedChannel !== inferredChannel) {
    errors.push(`Version ${version} belongs to ${inferredChannel}, not ${normalizedChannel}`);
  }
  if (normalizedMode === "release" && !approved) errors.push("Release mode requires HICODE_RELEASE_APPROVED=1");
  if (normalizedMode === "release" && sourceState?.ok !== true) errors.push("Release mode requires an inspectable Git source state");
  if (normalizedMode === "release" && sourceState?.ok === true && sourceState.clean !== true) errors.push("Release mode requires a clean Git source tree");
  if (normalizedMode === "release" && platform === "darwin" && !signing.signed) errors.push("macOS release mode requires a signing identity");
  if (normalizedMode === "release" && platform === "darwin" && !signing.notarized) errors.push("macOS release mode requires notarization credentials");
  if (normalizedMode === "release" && platform === "win32" && !signing.signed) errors.push("Windows release mode requires a signing identity");
  if (wantsPublish && normalizedMode !== "release") errors.push("Publishing is only allowed in release mode");
  if (wantsPublish && !approved) errors.push("Publishing requires explicit release approval");
  if (wantsPublish && !hasPublishToken) errors.push("Publishing requires GH_TOKEN or GITHUB_TOKEN");

  if (normalizedMode !== "release") warnings.push("Artifacts are unsigned development/CI output and must not be promoted as signed releases");
  if (platform === "linux" && !signing.signed) warnings.push("Linux artifacts use HTTPS/update-metadata integrity only; no detached package signature is configured");

  const trustedForAutomaticUpdate = normalizedMode === "release"
    && approved
    && (platform === "darwin" ? signing.signed && signing.notarized : platform === "win32" ? signing.signed : true);
  const artifactTrust = signing.signed ? "signed" : platform === "linux" && trustedForAutomaticUpdate ? "integrity_verified" : "unsigned";

  return {
    schemaVersion: 1,
    version: parseReleaseVersion(version).raw,
    mode: normalizedMode,
    channel: normalizedChannel,
    updaterChannel: updaterChannelName(normalizedChannel),
    platform,
    approvalRecorded: approved,
    publishRequested: wantsPublish,
    publishAllowed: wantsPublish && errors.length === 0,
    source: sourceState ? {
      inspectable: sourceState.ok === true,
      clean: sourceState.clean === true,
      commit: sourceState.commit || "",
      changedPaths: Number(sourceState.changedPaths) || 0,
    } : null,
    signing: {
      status: signing.signed ? "configured" : "not_configured",
      notarizationStatus: platform === "darwin" ? (signing.notarized ? "configured" : "not_configured") : "not_applicable",
      credentialPresence: signing.credentialPresence,
    },
    artifactTrust,
    updateEnabled: trustedForAutomaticUpdate,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

export function buildReleaseChildEnv({ env = process.env, policy, shimPath = "" } = {}) {
  if (!policy) throw new Error("buildReleaseChildEnv requires a release policy");
  const output = {};
  for (const key of BASE_BUILD_ENV) {
    if (typeof env[key] === "string") output[key] = env[key];
  }
  if (output.SystemRoot) {
    output.ComSpec = path.win32.join(output.SystemRoot, "System32", "cmd.exe");
  }
  output.PATH = [shimPath, output.PATH].filter(Boolean).join(path.delimiter);
  output.HICODE_RELEASE_MODE = policy.mode;
  output.HICODE_RELEASE_CHANNEL = policy.channel;
  output.HICODE_RELEASE_APPROVED = policy.approvalRecorded ? "1" : "0";
  output.CSC_IDENTITY_AUTO_DISCOVERY = policy.signing.status === "configured" ? "true" : "false";
  output.npm_config_user_agent = "npm/11.9.0 hicode-electron-builder";

  if (policy.mode === "release" && policy.approvalRecorded) {
    for (const key of SENSITIVE_RELEASE_KEYS) {
      if (typeof env[key] === "string") output[key] = env[key];
    }
    if (policy.publishAllowed) output.GH_TOKEN = env.GH_TOKEN || env.GITHUB_TOKEN;
  }
  return output;
}

export function releaseEnvironmentSummary(env) {
  const keys = Object.keys(env || {}).sort();
  return {
    keys,
    sensitiveKeys: keys.filter((key) => SENSITIVE_RELEASE_KEYS.includes(key)).map((key) => `${key}=[PRESENT]`),
  };
}

function stableTimestamp(env = process.env) {
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : new Date().toISOString();
}

export function writeEmbeddedReleaseManifest({ root, policy, env = process.env } = {}) {
  if (!root || !policy) throw new Error("writeEmbeddedReleaseManifest requires root and policy");
  const outputPath = path.join(root, "build", "generated", "release-channel.json");
  const payload = {
    schemaVersion: 1,
    version: policy.version,
    channel: policy.channel,
    updaterChannel: policy.updaterChannel,
    mode: policy.mode,
    artifactTrust: policy.artifactTrust,
    signed: policy.signing.status === "configured",
    notarized: policy.signing.notarizationStatus === "configured",
    updateEnabled: policy.updateEnabled,
    generatedAt: stableTimestamp(env),
    policyDigest: crypto.createHash("sha256").update(JSON.stringify({
      version: policy.version,
      channel: policy.channel,
      mode: policy.mode,
      platform: policy.platform,
      artifactTrust: policy.artifactTrust,
      updateEnabled: policy.updateEnabled,
    })).digest("hex"),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 });
  return { outputPath, payload };
}
