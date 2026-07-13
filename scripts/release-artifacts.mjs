import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PACKAGE_EXTENSIONS = Object.freeze([".dmg", ".exe", ".zip", ".AppImage", ".deb", ".blockmap"]);
const UPDATE_METADATA_RE = /^(?:latest|beta|alpha)(?:-(?:mac|linux))?\.ya?ml$/i;

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function isReleaseArtifact(name, version) {
  const base = path.basename(String(name || ""));
  if (!base || base.startsWith("builder-") || base.startsWith("SHA256SUMS-")) return false;
  if (UPDATE_METADATA_RE.test(base)) return true;
  if (base === `sbom-v${version}.cdx.json` || base === `provenance-v${version}.json`) return true;
  return base.includes(version) && PACKAGE_EXTENSIONS.some((extension) => base.endsWith(extension));
}

export function listReleaseArtifacts(releaseDir, version, { exclude = [] } = {}) {
  if (!fs.existsSync(releaseDir)) return [];
  const excluded = new Set(exclude.map((value) => path.basename(value)));
  return fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !excluded.has(name) && isReleaseArtifact(name, version))
    .sort((a, b) => a.localeCompare(b));
}

export function artifactSubjects(releaseDir, names) {
  return names.map((name) => ({
    name,
    digest: { sha256: sha256File(path.join(releaseDir, name)) },
  }));
}
