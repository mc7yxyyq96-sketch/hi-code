#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(pkg.version || "").trim();

if (!version) {
  console.error("[checksums] package.json version is required");
  process.exit(1);
}

if (!fs.existsSync(releaseDir)) {
  console.error("[checksums] release directory does not exist. Build packages first.");
  process.exit(1);
}

const allowedExtensions = new Set([".dmg", ".exe", ".zip"]);
const artifacts = fs.readdirSync(releaseDir)
  .filter((name) => name.includes(version))
  .filter((name) => allowedExtensions.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b));

if (!artifacts.length) {
  console.error(`[checksums] no release artifacts found for version ${version}`);
  process.exit(1);
}

const lines = artifacts.map((name) => {
  const absolutePath = path.join(releaseDir, name);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  return `${digest}  release/${name}`;
});

const outputPath = path.join(releaseDir, `SHA256SUMS-v${version}.txt`);
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o644 });

console.log(`[checksums] wrote release/SHA256SUMS-v${version}.txt`);
for (const line of lines) console.log(line);
