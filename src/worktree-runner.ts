import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createTwoFilesPatch } from "diff";

export const WORKTREE_RUNNER_SCHEMA_VERSION = 1;
export const WORKTREE_MANIFEST = ".hicode-worktree-runner.json";

export type WorkspaceMode = "auto" | "worktree" | "copy" | "dry-run" | "direct";
export type WorkspaceActualMode = "worktree" | "copy" | "dry-run" | "direct";

export interface WorktreeRunnerOptions {
  safeRoot: string;
  idPrefix?: string;
}

export interface IsolatedWorkspaceRequest {
  sourcePath: string;
  mode?: WorkspaceMode;
  idPrefix?: string;
  jobId?: string;
  providerId?: string;
  providerRunId?: string;
  allowDirty?: boolean;
  allowDirect?: boolean;
  preserveOnFailure?: boolean;
  now?: number;
}

export interface IsolatedWorkspace {
  schemaVersion: typeof WORKTREE_RUNNER_SCHEMA_VERSION;
  id: string;
  mode: WorkspaceActualMode;
  sourcePath: string;
  workspacePath: string;
  safeRoot: string;
  createdAt: number;
  createdBy: "hicode-worktree-runner";
  jobId?: string;
  providerId?: string;
  providerRunId?: string;
  gitRoot?: string;
  baseRef?: string;
  dirtySource?: boolean;
  dryRun?: boolean;
  preserveOnFailure?: boolean;
  logs: string[];
  riskNotes: string[];
}

export interface RunCommandRequest {
  workspace: IsolatedWorkspace;
  command: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface RunCommandResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number;
  output: string;
  logs: string[];
}

export interface CollectedChanges {
  ok: boolean;
  workspace: IsolatedWorkspace;
  changedFiles: string[];
  patch: string;
  summary: string;
  logs: string[];
  artifacts: Array<{ type: string; path: string; name: string; size?: number }>;
  riskNotes: string[];
  error?: string;
}

export interface CleanupResult {
  ok: boolean;
  id: string;
  workspacePath: string;
  removed: boolean;
  preserved?: boolean;
  logs: string[];
  error?: string;
}

export interface PreserveResult {
  ok: true;
  id: string;
  workspacePath: string;
  reason: string;
  logs: string[];
}

interface FileSnapshot {
  rel: string;
  abs: string;
  exists: boolean;
  size: number;
}

export class WorktreeRunner {
  private readonly safeRoot: string;
  private readonly idPrefix: string;

  constructor(options: WorktreeRunnerOptions) {
    if (!options?.safeRoot) throw new Error("WorktreeRunner requires safeRoot");
    this.safeRoot = path.resolve(options.safeRoot);
    this.idPrefix = options.idPrefix || "hicode";
    fs.mkdirSync(this.safeRoot, { recursive: true, mode: 0o700 });
  }

  createIsolatedWorkspace(request: IsolatedWorkspaceRequest): IsolatedWorkspace {
    return createIsolatedWorkspace({ ...request, safeRoot: this.safeRoot, idPrefix: this.idPrefix });
  }

  runInIsolatedWorkspace(request: Omit<RunCommandRequest, "workspace"> & { workspace: IsolatedWorkspace }): RunCommandResult {
    return runInIsolatedWorkspace(request);
  }

  collectChanges(workspace: IsolatedWorkspace): CollectedChanges {
    return collectChanges(workspace);
  }

  generatePatch(workspace: IsolatedWorkspace): string {
    return generatePatch(workspace);
  }

  cleanupWorkspace(workspace: IsolatedWorkspace): CleanupResult {
    return cleanupWorkspace(workspace);
  }

  preserveWorkspaceOnFailure(workspace: IsolatedWorkspace, reason: string): PreserveResult {
    return preserveWorkspaceOnFailure(workspace, reason);
  }
}

export function createIsolatedWorkspace(input: IsolatedWorkspaceRequest & { safeRoot: string; idPrefix?: string }): IsolatedWorkspace {
  const safeRoot = realOrResolve(input.safeRoot);
  fs.mkdirSync(safeRoot, { recursive: true, mode: 0o700 });
  const sourcePath = realOrResolve(input.sourcePath);
  assertInside(safeRoot, path.join(safeRoot, "probe"));
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isDirectory()) throw new Error("sourcePath must be an existing directory");

  const requestedMode = input.mode || "auto";
  if (requestedMode === "direct") {
    if (!input.allowDirect) throw new Error("direct mode requires explicit allowDirect");
    return directWorkspace({ input, safeRoot, sourcePath });
  }
  if (requestedMode === "dry-run") return dryRunWorkspace({ input, safeRoot, sourcePath });

  const git = detectGit(sourcePath);
  const dirty = git?.dirty || false;
  if (dirty && !input.allowDirty) {
    throw new Error("main workspace has uncommitted changes; isolated execution requires a clean workspace or explicit allowDirty");
  }

  if ((requestedMode === "auto" || requestedMode === "worktree") && git?.root) {
    const result = tryCreateGitWorktree({ input, safeRoot, sourcePath, git });
    if (result.ok) return result.workspace;
    if (requestedMode === "worktree") throw new Error(result.error);
  }
  if (requestedMode === "auto" || requestedMode === "copy") return createCopySandbox({ input, safeRoot, sourcePath, git });
  throw new Error(`unsupported workspace mode: ${requestedMode}`);
}

export function runInIsolatedWorkspace(request: RunCommandRequest): RunCommandResult {
  const workspace = normalizeWorkspace(request.workspace);
  if (workspace.mode === "dry-run") {
    return {
      ok: true,
      command: request.command,
      cwd: workspace.workspacePath,
      exitCode: 0,
      output: "dry-run: command not executed",
      logs: ["dry-run skipped command execution"],
    };
  }
  if (!request.command || typeof request.command !== "string") throw new Error("command must be a non-empty string");
  assertManagedWorkspace(workspace);
  const result = spawnSync("bash", ["-lc", request.command], {
    cwd: workspace.workspacePath,
    encoding: "utf8",
    timeout: Math.min(Math.max(Number(request.timeoutMs || 120000), 1000), 600000),
    env: sanitizeCommandEnv(request.env),
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const exitCode = result.status ?? (result.error ? 127 : 0);
  return {
    ok: exitCode === 0,
    command: request.command,
    cwd: workspace.workspacePath,
    exitCode,
    output,
    logs: [`command exited with ${exitCode}`],
  };
}

export function collectChanges(workspaceInput: IsolatedWorkspace): CollectedChanges {
  const workspace = normalizeWorkspace(workspaceInput);
  const logs = [`collecting changes from ${workspace.mode} workspace`];
  const riskNotes = [...workspace.riskNotes];
  try {
    const patch = generatePatch(workspace);
    validatePatchPaths(patch);
    const changedFiles = changedFilesFromPatch(patch);
    const artifacts: CollectedChanges["artifacts"] = [];
    const patchArtifact = writePatchArtifact(workspace, patch);
    if (patchArtifact) artifacts.push(patchArtifact);
    const summary = changedFiles.length
      ? `${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}`
      : "No changes collected";
    return { ok: true, workspace, changedFiles, patch, summary, logs, artifacts, riskNotes };
  } catch (error) {
    return {
      ok: false,
      workspace,
      changedFiles: [],
      patch: "",
      summary: "Change collection failed",
      logs,
      artifacts: [],
      riskNotes,
      error: errorMessage(error),
    };
  }
}

export function generatePatch(workspaceInput: IsolatedWorkspace): string {
  const workspace = normalizeWorkspace(workspaceInput);
  if (workspace.mode === "dry-run" || workspace.mode === "direct") return "";
  assertManagedWorkspace(workspace);
  const patch = workspace.mode === "worktree"
    ? generateGitPatch(workspace)
    : generateCopyPatch(workspace);
  validatePatchPaths(patch);
  return patch;
}

export function cleanupWorkspace(workspaceInput: IsolatedWorkspace): CleanupResult {
  const workspace = normalizeWorkspace(workspaceInput);
  const logs: string[] = [];
  if (workspace.mode === "direct" || workspace.mode === "dry-run") {
    return { ok: true, id: workspace.id, workspacePath: workspace.workspacePath, removed: false, logs: ["nothing to cleanup for direct/dry-run workspace"] };
  }
  try {
    assertManagedWorkspace(workspace);
    if (workspace.mode === "worktree" && workspace.gitRoot) {
      const remove = git(workspace.gitRoot, ["worktree", "remove", "--force", workspace.workspacePath]);
      logs.push(remove.ok ? "git worktree removed" : `git worktree remove failed: ${remove.err || remove.out}`);
    }
    if (fs.existsSync(workspace.workspacePath)) fs.rmSync(workspace.workspacePath, { recursive: true, force: true });
    const parent = path.dirname(workspace.workspacePath);
    if (isInside(workspace.safeRoot, parent) && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
      logs.push("workspace parent removed");
    }
    return { ok: true, id: workspace.id, workspacePath: workspace.workspacePath, removed: true, logs };
  } catch (error) {
    return { ok: false, id: workspace.id, workspacePath: workspace.workspacePath, removed: false, preserved: true, logs, error: errorMessage(error) };
  }
}

export function preserveWorkspaceOnFailure(workspaceInput: IsolatedWorkspace, reason: string): PreserveResult {
  const workspace = normalizeWorkspace(workspaceInput);
  return {
    ok: true,
    id: workspace.id,
    workspacePath: workspace.workspacePath,
    reason: reason || "workspace preserved after failure",
    logs: [`preserved ${workspace.workspacePath}`],
  };
}

export function validatePatchPaths(patch: string): void {
  const lines = String(patch || "").split("\n");
  for (const line of lines) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("diff --git ")) continue;
    const candidates = line.startsWith("diff --git ")
      ? line.slice("diff --git ".length).trim().split(/\s+/)
      : [line.slice(4).trim()];
    for (const raw of candidates) {
      const file = raw.replace(/^"|"$/g, "");
      if (!file || file === "/dev/null") continue;
      const normalized = file.replace(/^a\//, "").replace(/^b\//, "");
      if (path.isAbsolute(normalized) || normalized.split(/[\\/]+/).includes("..")) {
        throw new Error(`patch path escapes workspace: ${file}`);
      }
    }
  }
}

function tryCreateGitWorktree({ input, safeRoot, sourcePath, git: gitInfo }: {
  input: IsolatedWorkspaceRequest;
  safeRoot: string;
  sourcePath: string;
  git: { root: string; head: string; dirty: boolean };
}): { ok: true; workspace: IsolatedWorkspace } | { ok: false; error: string } {
  const id = newWorkspaceId(input.idPrefix, input.jobId);
  const workspacePath = path.join(safeRoot, id, "workspace");
  assertInside(safeRoot, workspacePath);
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true, mode: 0o700 });
  const add = git(gitInfo.root, ["worktree", "add", "--detach", workspacePath, gitInfo.head || "HEAD"]);
  if (!add.ok) return { ok: false, error: add.err || add.out || "git worktree add failed" };
  const workspace = baseWorkspace({
    input,
    safeRoot,
    sourcePath,
    workspacePath,
    id,
    mode: "worktree",
    gitRoot: gitInfo.root,
    baseRef: gitInfo.head,
    dirtySource: gitInfo.dirty,
    riskNotes: [],
    logs: [`created git worktree at ${workspacePath}`],
  });
  writeManifest(workspace);
  return { ok: true, workspace };
}

function createCopySandbox({ input, safeRoot, sourcePath, git: gitInfo }: {
  input: IsolatedWorkspaceRequest;
  safeRoot: string;
  sourcePath: string;
  git?: { root: string; head: string; dirty: boolean } | null;
}): IsolatedWorkspace {
  const id = newWorkspaceId(input.idPrefix, input.jobId);
  const workspacePath = path.join(safeRoot, id, "workspace");
  assertInside(safeRoot, workspacePath);
  fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
  copyDirectory(sourcePath, workspacePath);
  const riskNotes = gitInfo?.root ? ["git worktree unavailable; used copy sandbox fallback"] : ["source is not a git repository; used copy sandbox"];
  const workspace = baseWorkspace({
    input,
    safeRoot,
    sourcePath,
    workspacePath,
    id,
    mode: "copy",
    gitRoot: gitInfo?.root,
    baseRef: gitInfo?.head,
    dirtySource: gitInfo?.dirty,
    riskNotes,
    logs: [`created copy sandbox at ${workspacePath}`],
  });
  writeManifest(workspace);
  return workspace;
}

function dryRunWorkspace({ input, safeRoot, sourcePath }: { input: IsolatedWorkspaceRequest; safeRoot: string; sourcePath: string }): IsolatedWorkspace {
  return baseWorkspace({
    input,
    safeRoot,
    sourcePath,
    workspacePath: sourcePath,
    id: newWorkspaceId(input.idPrefix, input.jobId),
    mode: "dry-run",
    riskNotes: ["dry-run mode does not modify files"],
    logs: ["dry-run workspace planned"],
  });
}

function directWorkspace({ input, safeRoot, sourcePath }: { input: IsolatedWorkspaceRequest; safeRoot: string; sourcePath: string }): IsolatedWorkspace {
  return baseWorkspace({
    input,
    safeRoot,
    sourcePath,
    workspacePath: sourcePath,
    id: newWorkspaceId(input.idPrefix, input.jobId),
    mode: "direct",
    riskNotes: ["direct mode writes to the main workspace and must be explicitly selected"],
    logs: ["direct workspace selected"],
  });
}

function baseWorkspace(input: {
  input: IsolatedWorkspaceRequest;
  safeRoot: string;
  sourcePath: string;
  workspacePath: string;
  id: string;
  mode: WorkspaceActualMode;
  gitRoot?: string;
  baseRef?: string;
  dirtySource?: boolean;
  logs: string[];
  riskNotes: string[];
}): IsolatedWorkspace {
  return {
    schemaVersion: WORKTREE_RUNNER_SCHEMA_VERSION,
    id: input.id,
    mode: input.mode,
    sourcePath: input.sourcePath,
    workspacePath: input.workspacePath,
    safeRoot: input.safeRoot,
    createdAt: safeNow(input.input.now),
    createdBy: "hicode-worktree-runner",
    jobId: clean(input.input.jobId),
    providerId: clean(input.input.providerId),
    providerRunId: clean(input.input.providerRunId),
    gitRoot: input.gitRoot,
    baseRef: input.baseRef,
    dirtySource: input.dirtySource,
    dryRun: input.mode === "dry-run",
    preserveOnFailure: input.input.preserveOnFailure !== false,
    logs: input.logs,
    riskNotes: input.riskNotes,
  };
}

function generateGitPatch(workspace: IsolatedWorkspace): string {
  const addIntent = git(workspace.workspacePath, ["add", "-N", "--", "."]);
  void addIntent;
  git(workspace.workspacePath, ["reset", "-q", "--", WORKTREE_MANIFEST]);
  const diff = git(workspace.workspacePath, ["--no-pager", "diff", "--binary", "HEAD", "--", ".", `:(exclude)${WORKTREE_MANIFEST}`]);
  if (!diff.ok) throw new Error(diff.err || "git diff failed");
  return diff.out;
}

function generateCopyPatch(workspace: IsolatedWorkspace): string {
  const sourceFiles = snapshotFiles(workspace.sourcePath);
  const sandboxFiles = snapshotFiles(workspace.workspacePath);
  const files = new Map<string, { before?: FileSnapshot; after?: FileSnapshot }>();
  for (const file of sourceFiles) files.set(file.rel, { before: file });
  for (const file of sandboxFiles) files.set(file.rel, { ...(files.get(file.rel) || {}), after: file });
  const patches: string[] = [];
  for (const [rel, pair] of Array.from(files.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    validateRelativePath(rel);
    const beforeText = pair.before?.exists ? readTextFile(pair.before.abs) : "";
    const afterText = pair.after?.exists ? readTextFile(pair.after.abs) : "";
    if (beforeText === null || afterText === null || beforeText === afterText) continue;
    patches.push(createTwoFilesPatch(`a/${rel}`, `b/${rel}`, beforeText, afterText, "", "", { context: 3 }));
  }
  return patches.join("\n");
}

function snapshotFiles(root: string): FileSnapshot[] {
  const out: FileSnapshot[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldSkip(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) {
        const stat = fs.statSync(abs);
        out.push({ rel, abs, exists: true, size: stat.size });
      }
    }
  }
  return out;
}

function writePatchArtifact(workspace: IsolatedWorkspace, patch: string): CollectedChanges["artifacts"][number] | null {
  if (!patch) return null;
  const artifactDir = path.join(workspace.safeRoot, workspace.id, "artifacts");
  assertInside(workspace.safeRoot, artifactDir);
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const file = path.join(artifactDir, "changes.patch");
  fs.writeFileSync(file, patch, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return { type: "patch", path: file, name: "changes.patch", size: fs.statSync(file).size };
}

function changedFilesFromPatch(patch: string): string[] {
  const files = new Set<string>();
  for (const line of String(patch || "").split("\n")) {
    if (!line.startsWith("+++ ")) continue;
    const file = line.slice(4).trim().replace(/^"|"$/g, "");
    if (!file || file === "/dev/null") continue;
    const rel = file.replace(/^b\//, "");
    validateRelativePath(rel);
    files.add(rel);
  }
  return Array.from(files).sort();
}

function copyDirectory(source: string, target: string): void {
  fs.cpSync(source, target, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: (src) => !shouldSkip(path.basename(src)),
  });
}

function shouldSkip(name: string): boolean {
  return name === ".git"
    || name === "node_modules"
    || name === ".DS_Store"
    || name === WORKTREE_MANIFEST
    || name === ".hicode-runner-artifacts";
}

function assertManagedWorkspace(workspace: IsolatedWorkspace): void {
  if (workspace.createdBy !== "hicode-worktree-runner") throw new Error("workspace was not created by Hi Code");
  if (!isInside(workspace.safeRoot, workspace.workspacePath)) throw new Error("workspace path escapes safe root");
  const manifestPath = path.join(workspace.workspacePath, WORKTREE_MANIFEST);
  if (!fs.existsSync(manifestPath)) throw new Error("workspace manifest missing; refusing unsafe operation");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== workspace.id || manifest.createdBy !== "hicode-worktree-runner") {
    throw new Error("workspace manifest does not match request");
  }
}

function writeManifest(workspace: IsolatedWorkspace): void {
  const manifestPath = path.join(workspace.workspacePath, WORKTREE_MANIFEST);
  fs.writeFileSync(manifestPath, JSON.stringify(workspace, null, 2), { mode: 0o600 });
  try { fs.chmodSync(manifestPath, 0o600); } catch {}
}

function normalizeWorkspace(workspace: IsolatedWorkspace): IsolatedWorkspace {
  if (!workspace || typeof workspace !== "object") throw new Error("workspace is required");
  return {
    ...workspace,
    sourcePath: path.resolve(workspace.sourcePath),
    workspacePath: path.resolve(workspace.workspacePath),
    safeRoot: path.resolve(workspace.safeRoot),
    logs: Array.isArray(workspace.logs) ? workspace.logs : [],
    riskNotes: Array.isArray(workspace.riskNotes) ? workspace.riskNotes : [],
  };
}

function detectGit(cwd: string): { root: string; head: string; dirty: boolean } | null {
  const rootResult = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!rootResult.ok || !rootResult.out) return null;
  const head = git(rootResult.out, ["rev-parse", "HEAD"]);
  const status = git(rootResult.out, ["status", "--porcelain=v1"]);
  return {
    root: rootResult.out,
    head: head.ok && head.out ? head.out : "HEAD",
    dirty: !!status.out.trim(),
  };
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string; status: number | null } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trimEnd(),
    err: (result.stderr || "").trim(),
    status: result.status,
  };
}

function readTextFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 1_000_000) return null;
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function sanitizeCommandEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = ["PATH", "HOME", "SHELL", "TMPDIR", "LANG", "LC_ALL"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of base) if (process.env[key]) env[key] = process.env[key];
  for (const [key, value] of Object.entries(extra || {})) {
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && typeof value === "string") env[key] = value;
  }
  return env;
}

function assertInside(root: string, target: string): void {
  if (!isInside(root, target)) throw new Error("path escapes safe root");
}

function isInside(root: string, target: string): boolean {
  const safeRoot = path.resolve(root);
  const resolved = path.resolve(target);
  const rel = path.relative(safeRoot, resolved);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function validateRelativePath(rel: string): void {
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]+/).includes("..")) {
    throw new Error(`patch path escapes workspace: ${rel}`);
  }
}

function newWorkspaceId(prefix = "hicode", jobId?: string): string {
  const safeJob = clean(jobId)?.replace(/[^a-z0-9._-]/gi, "-").slice(0, 40);
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  return `${prefix}-${safeJob ? `${safeJob}-` : ""}${suffix}`;
}

function safeNow(now?: number): number {
  return Number.isFinite(now) ? Number(now) : Date.now();
}

function clean(value?: string): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function realOrResolve(value: string): string {
  const resolved = path.resolve(String(value || ""));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "operation failed");
}
