#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = path.join(root, "node_modules", "npm", "bin", "npm-cli.js");
const builderCli = path.join(root, "node_modules", "electron-builder", "cli.js");

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
  const result = spawnSync(process.execPath, [builderCli, ...process.argv.slice(2)], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${shimDir}${path.delimiter}${process.env.PATH || ""}`,
      npm_execpath: npmCli,
      npm_config_user_agent: "npm/11.9.0 hicode-electron-builder",
    },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[electron-builder] failed to start: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} finally {
  fs.rmSync(shimDir, { recursive: true, force: true });
}
