#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "reports", "evidence", "baseline");
const logDir = path.join(evidenceDir, "logs");
const stagingLogDir = path.join(evidenceDir, ".logs-next");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;

const commands = [
  { id: "build", command: npm, args: ["run", "build"] },
  { id: "verify", command: npm, args: ["run", "verify"] },
  { id: "release-check", command: npm, args: ["run", "release:check"] },
  { id: "feature-tests", command: node, args: ["test/feature-tests.mjs"] },
  { id: "security-tests", command: npm, args: ["run", "test:security"] },
  { id: "dod-tests", command: npm, args: ["run", "test:dod"] },
  { id: "dod-scan", command: npm, args: ["run", "scan:dod"] },
  { id: "production-audit", command: npm, args: ["run", "audit:prod"] },
  { id: "git-diff-check", command: "git", args: ["diff", "--check"] },
];

function safeProcessEnv() {
  const allowed = [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
    "TMPDIR", "TMP", "TEMP", "SystemRoot", "USERPROFILE", "CI", "TERM",
    "COLORTERM", "npm_config_registry", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  ];
  const env = {};
  for (const key of allowed) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.HICODE_PROGRAM_BASELINE = "1";
  return env;
}

function redact(text) {
  return String(text || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function git(args, { preserveLeadingWhitespace = false } = {}) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: safeProcessEnv() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${redact(result.stderr).trim()}`);
  }
  return preserveLeadingWhitespace ? result.stdout.trimEnd() : result.stdout.trim();
}

function runCommand(spec) {
  const startedAt = new Date();
  const started = process.hrtime.bigint();
  const result = spawnSync(spec.command, spec.args, {
    cwd: root,
    encoding: "utf8",
    env: safeProcessEnv(),
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const endedAt = new Date();
  const exitCode = result.error ? 1 : (result.status ?? 1);
  const display = [spec.command, ...spec.args].join(" ");
  const output = redact([
    `$ ${display}`,
    result.stdout || "",
    result.stderr || "",
    result.error ? `[capture-error] ${result.error.message}` : "",
  ].filter(Boolean).join("\n")).trimEnd() + "\n";
  const logPath = path.posix.join("reports", "evidence", "baseline", "logs", `${spec.id}.log`);
  fs.writeFileSync(path.join(stagingLogDir, `${spec.id}.log`), output, { mode: 0o644 });
  console.log(`[program:baseline] ${spec.id}: ${exitCode === 0 ? "pass" : "fail"} (${durationMs.toFixed(0)} ms)`);
  return {
    id: spec.id,
    command: display,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Math.round(durationMs),
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
    logPath,
    logSha256: sha256(output),
  };
}

function parseDirtyPaths(status) {
  return status.split("\n").filter(Boolean).map((line) => line.slice(3).replace(/^"|"$/g, ""));
}

function main() {
  const startedAt = new Date();
  fs.rmSync(stagingLogDir, { recursive: true, force: true });
  fs.mkdirSync(stagingLogDir, { recursive: true, mode: 0o755 });

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const sourceCommit = git(["rev-parse", "HEAD"]);
  const sourceCommitDate = git(["show", "-s", "--format=%cI", "HEAD"]);
  const sourceCommitSubject = git(["show", "-s", "--format=%s", "HEAD"]);
  const branch = git(["branch", "--show-current"]);
  const remote = git(["remote", "get-url", "origin"]);
  const status = git(["status", "--short"], { preserveLeadingWhitespace: true });
  const dirtyPaths = parseDirtyPaths(status);
  const runtimeProductDirtyPaths = dirtyPaths.filter((file) => /^(src|electron|renderer)\//.test(file));

  const results = commands.map(runCommand);
  const completedAt = new Date();
  const failed = results.filter((result) => result.status === "failed");
  const manifest = {
    schemaVersion: 1,
    evidenceType: "program-baseline",
    taskId: "HC-PROG-100",
    source: {
      version: packageJson.version,
      commit: sourceCommit,
      commitDate: sourceCommitDate,
      commitSubject: sourceCommitSubject,
      branch,
      remote,
      sourceCommitRecorded: true,
    },
    capture: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      workingTreeClean: dirtyPaths.length === 0,
      dirtyPaths,
      runtimeProductDirtyPaths,
      note: "The source commit is the immutable baseline. Control-plane bootstrap files were intentionally uncommitted during capture.",
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      node: process.version,
    },
    commands: results,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      allPassed: failed.length === 0,
    },
    historicalEvidence: {
      finalAcceptance: "reports/final-acceptance-historical.md",
      auditArchivePolicy: "reports/audit/README.md",
      authoritativeCurrentStatus: "reports/program/status.md",
    },
  };

  fs.rmSync(logDir, { recursive: true, force: true });
  fs.renameSync(stagingLogDir, logDir);
  fs.writeFileSync(path.join(evidenceDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  console.log(`[program:baseline] manifest: reports/evidence/baseline/manifest.json`);
  if (failed.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[program:baseline] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
