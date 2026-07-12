#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const testFiles = [
  ["test:feature", "test/feature-tests.mjs"],
  ["test:runtime-protocol", "test/runtime-protocol-tests.mjs"],
  ["test:runtime-stores", "test/runtime-store-tests.mjs"],
  ["test:runtime-store-integration", "test/runtime-store-integration-tests.mjs"],
  ["test:turn-recovery", "test/turn-recovery-tests.mjs"],
  ["test:electron-compatibility", "test/electron-compatibility-tests.mjs"],
  ["test:runtime-events", "test/runtime-event-sink-tests.mjs"],
  ["test:runtime-concurrency", "test/runtime-concurrency-tests.mjs"],
  ["test:runtime-clients", "test/runtime-client-adapter-tests.mjs"],
  ["test:runtime-control", "test/runtime-control-tests.mjs"],
  ["test:git-collaboration", "test/git-collaboration-tests.mjs"],
  ["test:services", "test/main-process-services-tests.mjs"],
  ["test:jobs", "test/job-center-tests.mjs"],
  ["test:providers", "test/provider-tests.mjs"],
  ["test:model-providers", "test/model-provider-tests.mjs"],
  ["test:openai-responses", "test/openai-responses-provider-tests.mjs"],
  ["test:anthropic-ollama", "test/anthropic-ollama-provider-tests.mjs"],
  ["test:attachment-command", "test/attachment-command-registry-tests.mjs"],
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
  ["test:app-shell", "test/app-shell-tests.ts", tsx],
  ["test:workspace-shell", "test/workspace-shell-tests.ts", tsx],
  ["test:editor-workbench", "test/editor-workbench-tests.ts", tsx],
  ["test:terminal-service", "test/terminal-service-tests.mjs"],
  ["test:terminal-renderer", "test/terminal-workbench-tests.ts", tsx],
  ["test:preview-service", "test/preview-service-tests.mjs"],
  ["test:preview-renderer", "test/preview-workbench-tests.ts", tsx],
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
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  run("renderer:typecheck", node, [tsc, "-p", "renderer/tsconfig.json", "--noEmit"]);
  run("renderer:build", node, [vite, "build", "--config", "vite.renderer.config.ts"]);
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
for (const [label, file, loader] of testFiles) {
  run(label, node, loader ? [loader, file] : [file]);
}

console.log("\n[verify] all checks passed");
