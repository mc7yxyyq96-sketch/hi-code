#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const SEVERITY_RANK = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

export function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  const remainder = lockPath.slice(index + marker.length);
  const parts = remainder.split("/");
  if (!parts[0]) return null;
  return parts[0].startsWith("@") && parts[1]
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
}

export function collectProductionVersions(lockfile) {
  if (!lockfile || lockfile.lockfileVersion < 2 || !lockfile.packages) {
    throw new Error("package-lock.json must use lockfileVersion 2 or newer");
  }

  const versions = new Map();
  for (const [lockPath, metadata] of Object.entries(lockfile.packages)) {
    if (!lockPath || !metadata || metadata.dev === true || metadata.link === true) continue;
    if (typeof metadata.version !== "string" || !metadata.version) continue;
    const name = packageNameFromLockPath(lockPath);
    if (!name) continue;
    const known = versions.get(name) || new Set();
    known.add(metadata.version);
    versions.set(name, known);
  }

  return Object.fromEntries(
    [...versions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => [name, [...values].sort()]),
  );
}

export function normalizeAdvisories(payload) {
  const advisories = [];
  for (const [packageName, entries] of Object.entries(payload || {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      advisories.push({
        packageName,
        severity: String(entry.severity || "unknown").toLowerCase(),
        title: String(entry.title || entry.name || "Unnamed advisory"),
        vulnerableVersions: String(entry.vulnerable_versions || entry.vulnerableVersions || "unknown"),
        url: typeof entry.url === "string" ? entry.url : null,
        source: entry.source ?? entry.id ?? null,
      });
    }
  }
  return advisories;
}

export function findBlockingAdvisories(advisories, minimumSeverity = "high") {
  const minimumRank = SEVERITY_RANK[minimumSeverity];
  if (minimumRank === undefined) throw new Error(`Unsupported audit severity: ${minimumSeverity}`);
  return advisories.filter((entry) => (SEVERITY_RANK[entry.severity] ?? -1) >= minimumRank);
}

export function resolveRegistry(value = DEFAULT_REGISTRY) {
  const registry = new URL(value || DEFAULT_REGISTRY);
  if (registry.protocol !== "https:") {
    throw new Error("Production audit registry must use HTTPS");
  }
  registry.pathname = `${registry.pathname.replace(/\/$/, "")}/-/npm/v1/security/advisories/bulk`;
  return registry;
}

async function requestAdvisories(registry, versions) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(registry, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "hi-code-production-audit/1",
      },
      body: JSON.stringify(versions),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Registry audit request failed with HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function runProductionAudit({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  minimumSeverity = "high",
  registryUrl = process.env.npm_config_registry || DEFAULT_REGISTRY,
  outputJson = false,
} = {}) {
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) {
    throw new Error("package-lock.json is required for the production dependency audit");
  }

  const lockfile = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const versions = collectProductionVersions(lockfile);
  const registry = resolveRegistry(registryUrl);
  const advisories = normalizeAdvisories(await requestAdvisories(registry, versions));
  const blocking = findBlockingAdvisories(advisories, minimumSeverity);
  const result = {
    ok: blocking.length === 0,
    minimumSeverity,
    registry: registry.origin,
    auditedPackages: Object.keys(versions).length,
    advisories,
    blocking,
  };

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[audit:prod] audited ${result.auditedPackages} production packages`);
    console.log(`[audit:prod] ${advisories.length} advisories, ${blocking.length} blocking at ${minimumSeverity}+`);
    for (const advisory of blocking) {
      console.error(
        `[audit:prod] ${advisory.severity.toUpperCase()} ${advisory.packageName}: ${advisory.title}`,
      );
      if (advisory.url) console.error(`  ${advisory.url}`);
    }
  }
  return result;
}

async function main() {
  const outputJson = process.argv.includes("--json");
  const levelArg = process.argv.find((arg) => arg.startsWith("--audit-level="));
  const minimumSeverity = levelArg ? levelArg.slice("--audit-level=".length) : "high";
  const result = await runProductionAudit({ minimumSeverity, outputJson });
  process.exitCode = result.ok ? 0 : 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(`[audit:prod] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
