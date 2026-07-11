import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.log("[terminal-package] skipped: macOS package inspection only; Windows/Linux execute the real terminal in CI");
  process.exit(0);
}

const releaseRoot = path.resolve("release");
const app = ["mac-arm64", "mac", "mac-x64"]
  .map((directory) => path.join(releaseRoot, directory, "Hi Code.app"))
  .find((candidate) => fs.existsSync(candidate));
assert.ok(app, "Packaged Hi Code.app is missing; run npm run dist:mac first");

const resources = path.join(app, "Contents", "Resources");
const unpackedPty = path.join(resources, "app.asar.unpacked", "node_modules", "node-pty");
const host = `darwin-${process.arch}`;
const binary = path.join(unpackedPty, "prebuilds", host, "pty.node");
const helper = path.join(unpackedPty, "prebuilds", host, "spawn-helper");

assert.ok(fs.statSync(path.join(resources, "app.asar")).size > 100_000, "app.asar is missing or empty");
assert.ok(fs.statSync(binary).size > 20_000, `Packaged PTY binary is missing: ${binary}`);
assert.ok(fs.statSync(helper).size > 5_000, `Packaged spawn helper is missing: ${helper}`);
fs.accessSync(helper, fs.constants.X_OK);

console.log(`[terminal-package] app: ${app}`);
console.log(`[terminal-package] node-pty: ${unpackedPty}`);
console.log("\n=== 4 passed, 0 failed ===");
