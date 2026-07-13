#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildReleaseChildEnv,
  createReleasePolicy,
  prepareBuilderArguments,
  releaseEnvironmentSummary,
  resolveBuilderPlatform,
  writeEmbeddedReleaseManifest,
} from "../electron/services/release-policy.mjs";
import { inspectReleaseSource } from "./release-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = path.join(root, "node_modules", "npm", "bin", "npm-cli.js");
const builderCli = path.join(root, "node_modules", "electron-builder", "cli.js");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createNpmShim(directory) {
  if (process.platform === "win32") {
    const shimPath = path.join(directory, "npm.cmd");
    fs.writeFileSync(shimPath, `@echo off\r\n"${process.execPath}" "${npmCli}" %*\r\n`, { mode: 0o700 });
    return shimPath;
  }
  const shimPath = path.join(directory, "npm");
  fs.writeFileSync(shimPath, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(npmCli)} "$@"\n`, { mode: 0o700 });
  return shimPath;
}

function clearGeneratedUpdateMetadata() {
  const releaseDir = path.join(root, "release");
  if (!fs.existsSync(releaseDir)) return;
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:latest|beta|alpha)(?:-(?:mac|linux))?\.ya?ml$/i.test(entry.name)) {
      fs.rmSync(path.join(releaseDir, entry.name), { force: true });
    }
  }
}

function clearPlatformArtifacts(platform, version) {
  const releaseDir = path.join(root, "release");
  if (!fs.existsSync(releaseDir)) return;
  const marker = platform === "darwin" ? "-mac-" : platform === "win32" ? "-win-" : "-linux-";
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.includes(version) && entry.name.includes(marker)) {
      fs.rmSync(path.join(releaseDir, entry.name), { force: true });
    }
  }
}

if (!fs.existsSync(npmCli)) {
  console.error(`[electron-builder] pinned npm CLI is missing: ${npmCli}`);
  process.exit(1);
}
if (!fs.existsSync(builderCli)) {
  console.error(`[electron-builder] electron-builder CLI is missing: ${builderCli}`);
  process.exit(1);
}

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-electron-builder-"));
try {
  createNpmShim(shimDir);
  const builderArgs = process.argv.slice(2);
  const platform = resolveBuilderPlatform(builderArgs);
  const sourceState = inspectReleaseSource(root, process.env);
  const policy = createReleasePolicy({ version: pkg.version, platform, sourceState });
  const embedded = writeEmbeddedReleaseManifest({ root, policy });
  if (!policy.ok) {
    for (const error of policy.errors) console.error(`[release-policy] ${error}`);
    process.exitCode = 1;
  } else {
    const childEnv = buildReleaseChildEnv({ env: process.env, policy, shimPath: shimDir });
    childEnv.npm_execpath = npmCli;
    clearGeneratedUpdateMetadata();
    clearPlatformArtifacts(platform, policy.version);
    const publishMode = policy.publishAllowed ? "always" : "never";
    const effectiveArgs = prepareBuilderArguments(builderArgs, policy);
    console.log(`[release-policy] mode=${policy.mode} channel=${policy.channel} trust=${policy.artifactTrust} publish=${publishMode}`);
    console.log(`[release-policy] embedded=${path.relative(root, embedded.outputPath)} env=${JSON.stringify(releaseEnvironmentSummary(childEnv))}`);
    const result = spawnSync(process.execPath, [builderCli, ...effectiveArgs], {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(`[electron-builder] failed to start: ${result.error.message}`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  }
} catch (error) {
  console.error(`[electron-builder] ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(shimDir, { recursive: true, force: true });
}
