#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listReleaseArtifacts, sha256File } from "./release-artifacts.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");

export function writeChecksums({ releaseDir, version }) {
  const artifacts = listReleaseArtifacts(releaseDir, version);
  if (!artifacts.length) throw new Error(`no release artifacts found for version ${version}`);
  const lines = artifacts.map((name) => `${sha256File(path.join(releaseDir, name))}  ${name}`);
  const outputPath = path.join(releaseDir, `SHA256SUMS-v${version}.txt`);
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o644 });
  return { outputPath, lines, artifacts };
}

export function verifyChecksums({ releaseDir, version }) {
  const checksumPath = path.join(releaseDir, `SHA256SUMS-v${version}.txt`);
  if (!fs.existsSync(checksumPath)) throw new Error(`checksum manifest is missing: ${path.basename(checksumPath)}`);
  const entries = fs.readFileSync(checksumPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/i);
    if (!match) throw new Error(`invalid checksum line: ${line}`);
    return { digest: match[1].toLowerCase(), name: match[2] };
  });
  const expected = listReleaseArtifacts(releaseDir, version);
  const manifestNames = entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(manifestNames) !== JSON.stringify(expected)) {
    throw new Error("checksum manifest does not cover the current release artifact set");
  }
  for (const entry of entries) {
    const actual = sha256File(path.join(releaseDir, entry.name));
    if (actual !== entry.digest) throw new Error(`checksum mismatch: ${entry.name}`);
  }
  return { checksumPath, entries };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releaseDir = path.join(root, "release");
  try {
    if (process.argv.includes("--verify")) {
      const verified = verifyChecksums({ releaseDir, version: pkg.version });
      console.log(`[checksums] verified ${verified.entries.length} artifacts from ${path.relative(root, verified.checksumPath)}`);
    } else {
      const written = writeChecksums({ releaseDir, version: pkg.version });
      console.log(`[checksums] wrote ${path.relative(root, written.outputPath)}`);
      for (const line of written.lines) console.log(line);
    }
  } catch (error) {
    console.error(`[checksums] ${error.message}`);
    process.exitCode = 1;
  }
}
