#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function packageName(lockPath, metadata) {
  if (metadata?.name) return metadata.name;
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? lockPath : lockPath.slice(index + marker.length);
}

function purlName(name) {
  if (!name.startsWith("@")) return encodeURIComponent(name);
  const [scope, pkg] = name.split("/");
  return `${encodeURIComponent(scope)}/${encodeURIComponent(pkg || "")}`;
}

function resolveDependencyPath(lockPackages, ownerPath, dependency) {
  let cursor = ownerPath;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${dependency}` : `node_modules/${dependency}`;
    if (lockPackages[candidate]) return candidate;
    const nested = cursor.lastIndexOf("/node_modules/");
    if (nested === -1) {
      if (!cursor) break;
      cursor = "";
    } else {
      cursor = cursor.slice(0, nested);
    }
  }
  return null;
}

function integrityHash(integrity) {
  const match = String(integrity || "").match(/^sha512-([A-Za-z0-9+/=]+)$/);
  return match ? [{ alg: "SHA-512", content: Buffer.from(match[1], "base64").toString("hex") }] : undefined;
}

function deterministicSerial(lockText, version) {
  const hex = crypto.createHash("sha256").update(lockText).update(version).digest("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sbomTimestamp(env = process.env) {
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : new Date().toISOString();
}

export function createCycloneDxBom({ pkg, lock, lockText = JSON.stringify(lock), env = process.env }) {
  const lockPackages = lock?.packages || {};
  const rootMetadata = lockPackages[""] || {};
  const reachable = new Set();
  const queue = [];
  const dependencyRefs = new Map();
  const unresolved = [];

  for (const dependency of Object.keys(rootMetadata.dependencies || pkg.dependencies || {})) {
    const resolved = resolveDependencyPath(lockPackages, "", dependency);
    if (resolved) queue.push(resolved);
    else unresolved.push({ owner: pkg.name, dependency });
  }

  while (queue.length) {
    const lockPath = queue.shift();
    if (reachable.has(lockPath)) continue;
    const metadata = lockPackages[lockPath];
    if (!metadata || metadata.dev === true) continue;
    reachable.add(lockPath);
    const refs = [];
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      const resolved = resolveDependencyPath(lockPackages, lockPath, dependency);
      if (resolved && lockPackages[resolved]?.dev !== true) {
        queue.push(resolved);
        refs.push(resolved);
      } else {
        unresolved.push({ owner: packageName(lockPath, metadata), dependency });
      }
    }
    dependencyRefs.set(lockPath, refs);
  }

  const componentForPath = new Map();
  const components = [...reachable].map((lockPath) => {
    const metadata = lockPackages[lockPath];
    const name = packageName(lockPath, metadata);
    const version = metadata.version || "0.0.0-unknown";
    const bomRef = `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}?path=${encodeURIComponent(lockPath)}`;
    componentForPath.set(lockPath, bomRef);
    const component = {
      type: "library",
      "bom-ref": bomRef,
      name,
      version,
      purl: `pkg:npm/${purlName(name)}@${encodeURIComponent(version)}`,
      scope: "required",
    };
    const hashes = integrityHash(metadata.integrity);
    if (hashes) component.hashes = hashes;
    if (metadata.license) component.licenses = [{ license: { id: metadata.license } }];
    if (metadata.resolved) component.externalReferences = [{ type: "distribution", url: metadata.resolved }];
    return component;
  }).sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));

  const appRef = `pkg:npm/${purlName(pkg.name)}@${encodeURIComponent(pkg.version)}`;
  const dependencies = [{
    ref: appRef,
    dependsOn: Object.keys(rootMetadata.dependencies || pkg.dependencies || {})
      .map((name) => resolveDependencyPath(lockPackages, "", name))
      .filter(Boolean)
      .map((lockPath) => componentForPath.get(lockPath))
      .filter(Boolean)
      .sort(),
  }];
  for (const lockPath of [...reachable].sort()) {
    dependencies.push({
      ref: componentForPath.get(lockPath),
      dependsOn: (dependencyRefs.get(lockPath) || [])
        .map((dependencyPath) => componentForPath.get(dependencyPath))
        .filter(Boolean)
        .sort(),
    });
  }

  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: deterministicSerial(lockText, pkg.version),
    version: 1,
    metadata: {
      timestamp: sbomTimestamp(env),
      tools: { components: [{ type: "application", name: "Hi Code release SBOM generator", version: "1" }] },
      component: {
        type: "application",
        "bom-ref": appRef,
        name: pkg.name,
        version: pkg.version,
        purl: appRef,
        licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
      },
      properties: [
        { name: "hicode:lockfileVersion", value: String(lock.lockfileVersion || "unknown") },
        { name: "hicode:dependencyScope", value: "production" },
      ],
    },
    components,
    dependencies,
    compositions: [{ aggregate: unresolved.length ? "incomplete" : "complete", assemblies: [appRef] }],
    vulnerabilities: [],
    ...(unresolved.length ? { annotations: [{ subjects: [appRef], text: `Unresolved production dependencies: ${JSON.stringify(unresolved)}` }] } : {}),
  };
}

export function generateSbom(root = defaultRoot, { env = process.env } = {}) {
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const lockText = fs.readFileSync(lockPath, "utf8");
  const lock = JSON.parse(lockText);
  const bom = createCycloneDxBom({ pkg, lock, lockText, env });
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir, { recursive: true });
  const outputPath = path.join(releaseDir, `sbom-v${pkg.version}.cdx.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, { mode: 0o644 });
  return { outputPath, bom };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = generateSbom();
  const aggregate = result.bom.compositions[0].aggregate;
  console.log(`[sbom] wrote ${path.relative(defaultRoot, result.outputPath)} (${result.bom.components.length} production components, ${aggregate})`);
  if (aggregate !== "complete") process.exitCode = 1;
}
