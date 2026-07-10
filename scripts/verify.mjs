#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

const testFiles = [
  ["test:feature", "test/feature-tests.mjs"],
  ["test:runtime-protocol", "test/runtime-protocol-tests.mjs"],
  ["test:runtime-events", "test/runtime-event-sink-tests.mjs"],
  ["test:runtime-concurrency", "test/runtime-concurrency-tests.mjs"],
  ["test:runtime-clients", "test/runtime-client-adapter-tests.mjs"],
  ["test:services", "test/main-process-services-tests.mjs"],
  ["test:jobs", "test/job-center-tests.mjs"],
  ["test:providers", "test/provider-tests.mjs"],
  ["test:worktrees", "test/worktree-runner-tests.mjs"],
  ["test:arena", "test/patch-arena-tests.mjs"],
  ["test:industrial", "test/industrial-project-tests.mjs"],
  ["test:domain-packs", "test/domain-pack-tests.mjs"],
  ["test:agent-team", "test/agent-team-tests.mjs"],
  ["test:industrial-tools", "test/industrial-tool-tests.mjs"],
  ["test:quality-gates", "test/quality-gate-tests.mjs"],
  ["test:release-builder", "test/release-builder-tests.mjs"],
  ["test:samples", "test/industrial-control-box-sample-tests.mjs"],
  ["test:dod", "test/definition-of-done-tests.mjs"],
  ["test:renderer", "test/renderer-architecture-tests.mjs"],
  ["test:entrypoints", "test/entrypoint-tests.mjs"],
  ["test:program", "test/program-control-tests.mjs"],
  ["test:security", "test/security-baseline.mjs"],
  ["test:usage", "test/usage-store-tests.mjs"],
];

function run(label, command, args) {
  console.log(`\n[verify] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[verify] ${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[verify] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function runBuild() {
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  run("build", node, [tsc, "-p", "tsconfig.json"]);
  const binPath = path.join(root, "dist", "index.js");
  if (fs.existsSync(binPath)) fs.chmodSync(binPath, 0o755);
}

function runSyntaxCheck() {
  for (const file of ["electron/main.mjs", "electron/preload.cjs", "renderer/renderer.js"]) {
    run(`check:syntax ${file}`, node, ["--check", file]);
  }
}

run("sync:version", node, ["scripts/sync-version.mjs"]);
runBuild();
runSyntaxCheck();
for (const [label, file] of testFiles) {
  run(label, [node][0], [file]);
}

console.log("\n[verify] all checks passed");
