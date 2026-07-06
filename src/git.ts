import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitInfo {
  branch: string;
  /** Number of changed (staged + unstaged + untracked) entries. */
  dirty: number;
}

export interface GitFileChange {
  path: string;
  oldPath?: string;
  status: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitWorkflowStatus {
  ok: boolean;
  error?: string;
  root?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  dirty: number;
  staged: number;
  unstaged: number;
  untracked: number;
  files: GitFileChange[];
}

export interface GitActionResult {
  ok: boolean;
  error?: string;
  output?: string;
}

export interface GitDiffResult extends GitActionResult {
  diff?: string;
}

export interface GitCommitMessageResult extends GitActionResult {
  message?: string;
}

export interface GitCommitResult extends GitActionResult {
  hash?: string;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string; status: number | null } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "").replace(/\s+$/, ""),
    err: (r.stderr ?? "").trim(),
    status: r.status,
  };
}

/** Branch + dirty count for the repo at cwd, or null if not a git repo. */
export function gitInfo(cwd: string): GitInfo | null {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") return null;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).out || "(detached)";
  const status = git(cwd, ["status", "--porcelain"]).out;
  const dirty = status ? status.split("\n").filter(Boolean).length : 0;
  return { branch, dirty };
}

export function gitWorkflowStatus(cwd: string): GitWorkflowStatus {
  const root = gitRoot(cwd);
  if (!root) {
    return {
      ok: false,
      error: "当前项目不是 Git 仓库",
      dirty: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      files: [],
    };
  }

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).out || "(detached)";
  const upstreamResult = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const upstream = upstreamResult.ok ? upstreamResult.out : undefined;
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = git(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]).out.split(/\s+/).map(Number);
    ahead = Number.isFinite(counts[0]) ? counts[0] : 0;
    behind = Number.isFinite(counts[1]) ? counts[1] : 0;
  }

  const status = git(root, ["status", "--porcelain=v1"]);
  const files = status.out ? status.out.split("\n").filter(Boolean).map(parsePorcelainLine) : [];
  return {
    ok: true,
    root,
    branch,
    upstream,
    ahead,
    behind,
    dirty: files.length,
    staged: files.filter((file) => file.staged).length,
    unstaged: files.filter((file) => file.unstaged).length,
    untracked: files.filter((file) => file.untracked).length,
    files,
  };
}

/** Working-tree diff (staged + unstaged), capped for readability. */
export function gitDiff(cwd: string, staged = false): string {
  const args = ["--no-pager", "diff", "--stat", ...(staged ? ["--staged"] : [])];
  const stat = git(cwd, args);
  if (!stat.ok) return "not a git repository";
  const full = git(cwd, ["--no-pager", "diff", ...(staged ? ["--staged"] : [])]).out;
  if (!stat.out && !full) return "no changes";
  const body = full.length > 8000 ? full.slice(0, 8000) + "\n… (diff truncated)" : full;
  return stat.out + "\n\n" + body;
}

export function gitFileDiff(cwd: string, filePath: string, staged = false): GitDiffResult {
  const root = gitRoot(cwd);
  if (!root) return { ok: false, error: "当前项目不是 Git 仓库" };
  const safe = validateGitPaths([filePath]);
  if (!safe.ok) return safe;
  const args = ["--no-pager", "diff", ...(staged ? ["--cached"] : []), "--", safe.paths[0]];
  const diff = git(root, args);
  if (!diff.ok) return { ok: false, error: diff.err || "读取 diff 失败" };
  if (diff.out) return { ok: true, diff: capDiff(diff.out) };

  const file = gitWorkflowStatus(root).files.find((item) => item.path === safe.paths[0]);
  if (file?.untracked && !staged) return { ok: true, diff: pseudoNewFileDiff(root, safe.paths[0]) };
  return { ok: true, diff: "no diff" };
}

export function gitStage(cwd: string, paths: string[]): GitActionResult {
  const root = gitRoot(cwd);
  if (!root) return { ok: false, error: "当前项目不是 Git 仓库" };
  const safe = validateGitPaths(paths);
  if (!safe.ok) return safe;
  const r = git(root, ["add", "--", ...safe.paths]);
  return r.ok ? { ok: true, output: r.out } : { ok: false, error: r.err || "stage 失败" };
}

export function gitUnstage(cwd: string, paths: string[]): GitActionResult {
  const root = gitRoot(cwd);
  if (!root) return { ok: false, error: "当前项目不是 Git 仓库" };
  const safe = validateGitPaths(paths);
  if (!safe.ok) return safe;
  const r = git(root, ["restore", "--staged", "--", ...safe.paths]);
  return r.ok ? { ok: true, output: r.out } : { ok: false, error: r.err || "unstage 失败" };
}

export function gitGenerateCommitMessage(cwd: string): GitCommitMessageResult {
  const status = gitWorkflowStatus(cwd);
  if (!status.ok) return { ok: false, error: status.error };
  const staged = status.files.filter((file) => file.staged);
  if (!staged.length) return { ok: false, error: "没有 staged 文件，先 stage 要提交的改动" };

  const action = staged.every((file) => file.index === "A")
    ? "Add"
    : staged.every((file) => file.index === "D")
      ? "Remove"
      : "Update";
  const dirs = new Set(staged.map((file) => path.dirname(file.path)).filter((dir) => dir && dir !== "."));
  const target = staged.length === 1
    ? path.basename(staged[0].path)
    : dirs.size === 1
      ? `${[...dirs][0]} changes`
      : `${staged.length} files`;
  return { ok: true, message: `${action} ${target}` };
}

export function gitCommit(cwd: string, message: string): GitCommitResult {
  const root = gitRoot(cwd);
  if (!root) return { ok: false, error: "当前项目不是 Git 仓库" };
  const cleanMessage = message.trim();
  if (!cleanMessage) return { ok: false, error: "Commit message 不能为空" };
  const staged = git(root, ["diff", "--cached", "--name-only"]);
  if (!staged.out) return { ok: false, error: "没有 staged 文件可提交" };
  const r = git(root, ["commit", "-m", cleanMessage]);
  if (!r.ok) return { ok: false, error: r.err || r.out || "commit 失败" };
  const hash = git(root, ["rev-parse", "--short", "HEAD"]).out;
  return { ok: true, output: r.out, hash };
}

function gitRoot(cwd: string): string | null {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") return null;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return root.ok && root.out ? root.out : cwd;
}

function parsePorcelainLine(line: string): GitFileChange {
  const index = line[0] || " ";
  const worktree = line[1] || " ";
  const raw = line.slice(3);
  const renamed = raw.includes(" -> ");
  const [oldPath, nextPath] = renamed ? raw.split(" -> ") : ["", raw];
  const filePath = nextPath || raw;
  const untracked = index === "?" && worktree === "?";
  const staged = !untracked && index !== " ";
  const unstaged = untracked || worktree !== " ";
  return {
    path: filePath,
    oldPath: renamed ? oldPath : undefined,
    status: untracked ? "??" : `${index === " " ? "" : index}${worktree === " " ? "" : worktree}`,
    index,
    worktree,
    staged,
    unstaged,
    untracked,
  };
}

function validateGitPaths(paths: string[]): { ok: true; paths: string[] } | { ok: false; error: string } {
  if (!Array.isArray(paths) || !paths.length) return { ok: false, error: "请选择文件" };
  const clean = [];
  for (const item of paths) {
    const file = String(item || "").trim();
    if (!file) return { ok: false, error: "文件路径不能为空" };
    if (file.includes("\0")) return { ok: false, error: "文件路径非法" };
    if (path.isAbsolute(file)) return { ok: false, error: "只允许 Git 仓库内的相对路径" };
    const parts = file.split(/[\\/]+/);
    if (parts.includes("..")) return { ok: false, error: "文件路径不能跳出 Git 仓库" };
    clean.push(file);
  }
  return { ok: true, paths: clean };
}

function capDiff(text: string): string {
  return text.length > 20000 ? `${text.slice(0, 20000)}\n… (diff truncated)` : text;
}

function pseudoNewFileDiff(root: string, relPath: string): string {
  const abs = path.join(root, relPath);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return "untracked path is not a file";
    if (stat.size > 200_000) return "untracked file is too large to preview";
    const body = fs.readFileSync(abs, "utf8");
    const lines = body.split("\n").slice(0, 4000).map((line) => `+${line}`).join("\n");
    const truncated = body.split("\n").length > 4000 ? "\n… (diff truncated)" : "";
    return `--- /dev/null\n+++ b/${relPath}\n${lines}${truncated}`;
  } catch (err) {
    return `cannot preview untracked file: ${(err as Error).message}`;
  }
}
