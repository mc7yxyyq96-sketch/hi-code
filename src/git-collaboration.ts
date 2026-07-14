import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildSafeChildEnv } from "./process-env.js";

export type GitCiStatus = "passed" | "failed" | "pending" | "skipped" | "unknown";

export interface GitCommandResult {
  ok: boolean;
  out: string;
  err: string;
  status: number | null;
}

export interface GitCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
}

export type GitCommandRunner = (command: string, args: string[], options: GitCommandOptions) => GitCommandResult;

export interface GitBranchRecord {
  name: string;
  current: boolean;
  upstream?: string;
}

interface GitFailure {
  ok: false;
  code: string;
  error: string;
}

interface RepositoryContext {
  ok: true;
  root: string;
  branch: string;
}

interface ValidBranch {
  ok: true;
  branch: string;
}

interface ValidPullRequest {
  ok: true;
  title: string;
  body: string;
  base: string;
  draft: boolean;
}

export interface GitCollaborationClientOptions {
  gitRunner?: GitCommandRunner;
  ghRunner?: GitCommandRunner;
  envSource?: NodeJS.ProcessEnv;
}

export function createGitCollaborationClient(options: GitCollaborationClientOptions = {}) {
  const gitRunner = options.gitRunner ?? defaultCommandRunner;
  const ghRunner = options.ghRunner ?? defaultCommandRunner;
  const childEnv = buildSafeChildEnv({
    source: options.envSource ?? process.env,
    extraEnv: {
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      NO_COLOR: "1",
    },
  });

  const runGit = (cwd: string, args: string[]) => runInRepository(gitRunner, "git", cwd, args, childEnv);
  const runGh = (cwd: string, args: string[]) => runInRepository(ghRunner, "gh", cwd, args, childEnv);

  const repository = (cwd: string) => repositoryContext(cwd, runGit);

  return {
    listBranches(cwd: string) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const result = runGit(repo.root, ["for-each-ref", "--format=%(HEAD)%09%(refname:short)%09%(upstream:short)", "refs/heads"]);
      if (!result.ok) return commandFailure("branch_list_failed", result, "读取本地分支失败");
      const branches = result.out.split("\n").filter(Boolean).map(parseBranchRecord).filter((branch): branch is GitBranchRecord => Boolean(branch));
      return { ok: true, root: repo.root, current: repo.branch, branches };
    },

    createBranch(cwd: string, name: string) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const clean = requireCleanWorktree(repo.root, runGit);
      if (!clean.ok) return clean;
      const branch = validateBranch(name, repo.root, runGit);
      if (!branch.ok) return branch;
      const exists = runGit(repo.root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch.branch}`]);
      if (exists.ok) return { ok: false, code: "branch_exists", error: "本地分支已存在" };
      const result = runGit(repo.root, ["switch", "-c", branch.branch]);
      return result.ok
        ? { ok: true, root: repo.root, branch: branch.branch, output: bounded(result.out, 4000) }
        : commandFailure("branch_create_failed", result, "创建分支失败");
    },

    switchBranch(cwd: string, name: string) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const clean = requireCleanWorktree(repo.root, runGit);
      if (!clean.ok) return clean;
      const branch = validateBranch(name, repo.root, runGit);
      if (!branch.ok) return branch;
      const exists = runGit(repo.root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch.branch}`]);
      if (!exists.ok) return { ok: false, code: "branch_not_found", error: "只允许切换到已存在的本地分支" };
      const result = runGit(repo.root, ["switch", branch.branch]);
      return result.ok
        ? { ok: true, root: repo.root, branch: branch.branch, output: bounded(result.out, 4000) }
        : commandFailure("branch_switch_failed", result, "切换分支失败");
    },

    capabilities(cwd: string) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const gh = runGh(repo.root, ["--version"]);
      return {
        ok: true,
        git: true,
        githubCli: gh.ok,
        branch: repo.branch,
        reason: gh.ok ? "" : collaborationStatusReason(gh.err || gh.out, "unavailable"),
      };
    },

    createPullRequest(cwd: string, request: unknown) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const clean = requireCleanWorktree(repo.root, runGit);
      if (!clean.ok) return clean;
      if (!repo.branch || repo.branch === "HEAD" || repo.branch === "(detached)") {
        return { ok: false, code: "detached_head", error: "Detached HEAD 不能创建 Pull Request" };
      }
      const input = validatePullRequest(request, repo.root, runGit);
      if (!input.ok) return input;
      const ghVersion = runGh(repo.root, ["--version"]);
      if (!ghVersion.ok) {
        return { ok: false, code: "github_cli_unavailable", error: collaborationStatusReason(ghVersion.err || ghVersion.out, "unavailable") };
      }

      const upstream = runGit(repo.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      if (!upstream.ok) {
        const origin = runGit(repo.root, ["remote", "get-url", "origin"]);
        if (!origin.ok || !origin.out) return { ok: false, code: "origin_missing", error: "当前仓库没有可发布的 origin remote" };
        const pushed = runGit(repo.root, ["push", "--set-upstream", "origin", "HEAD"]);
        if (!pushed.ok) return commandFailure("branch_publish_failed", pushed, "发布当前分支失败");
      }

      const args = [
        "pr", "create",
        "--base", input.base,
        "--head", repo.branch,
        "--title", input.title,
        "--body", input.body,
        ...(input.draft ? ["--draft"] : []),
      ];
      const result = runGh(repo.root, args);
      if (!result.ok) {
        return { ok: false, code: "pull_request_create_failed", error: collaborationStatusReason(result.err || result.out, "status") };
      }
      const url = result.out.split(/\s+/).find((item) => /^https:\/\/[^\s]+\/pull\/\d+$/i.test(item));
      if (!url) return { ok: false, code: "pull_request_url_missing", error: "Pull Request 已执行，但未返回可验证的 URL" };
      return { ok: true, url, branch: repo.branch, base: input.base, draft: input.draft };
    },

    getCollaborationStatus(cwd: string) {
      const repo = repository(cwd);
      if (!repo.ok) return repo;
      const ghVersion = runGh(repo.root, ["--version"]);
      if (!ghVersion.ok) {
        return {
          ok: true,
          available: false,
          reason: collaborationStatusReason(ghVersion.err || ghVersion.out, "unavailable"),
          pullRequest: null,
          checks: [],
          ci: emptyCi("unknown"),
        };
      }
      const result = runGh(repo.root, [
        "pr", "view",
        "--json", "number,url,title,state,isDraft,headRefName,baseRefName,statusCheckRollup",
      ]);
      if (!result.ok) {
        return {
          ok: true,
          available: true,
          reason: collaborationStatusReason(result.err || result.out, "status"),
          pullRequest: null,
          checks: [],
          ci: emptyCi("unknown"),
        };
      }
      try {
        const parsed = JSON.parse(result.out);
        const checks = normalizeChecks(parsed.statusCheckRollup);
        return {
          ok: true,
          available: true,
          reason: "",
          pullRequest: normalizePullRequest(parsed),
          checks,
          ci: summarizeChecks(checks),
        };
      } catch {
        return { ok: false, code: "github_response_invalid", error: "GitHub CLI 返回了无效的 PR 状态" };
      }
    },
  };
}

function defaultCommandRunner(command: string, args: string[], options: GitCommandOptions): GitCommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  return {
    ok: result.status === 0 && !result.error,
    out: String(result.stdout || "").replace(/\s+$/, ""),
    err: result.error?.message || String(result.stderr || "").trim(),
    status: result.status,
  };
}

function runInRepository(runner: GitCommandRunner, command: string, cwd: string, args: string[], env: NodeJS.ProcessEnv): GitCommandResult {
  const resolved = path.resolve(String(cwd || ""));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return { ok: false, out: "", err: "workspace directory does not exist", status: null };
  }
  return runner(command, [...args], { cwd: resolved, env: { ...env }, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
}

function repositoryContext(cwd: string, runGit: (cwd: string, args: string[]) => GitCommandResult): RepositoryContext | GitFailure {
  const resolved = path.resolve(String(cwd || ""));
  const inside = runGit(resolved, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") return { ok: false, code: "not_git_repository", error: "当前项目不是 Git 仓库" };
  const root = runGit(resolved, ["rev-parse", "--show-toplevel"]);
  const branch = runGit(resolved, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!root.ok || !root.out) return commandFailure("git_root_failed", root, "无法确定 Git 仓库根目录");
  return { ok: true, root: root.out, branch: branch.ok ? branch.out : "(detached)" };
}

function requireCleanWorktree(root: string, runGit: (cwd: string, args: string[]) => GitCommandResult): { ok: true } | GitFailure {
  const status = runGit(root, ["status", "--porcelain=v1"]);
  if (!status.ok) return commandFailure("git_status_failed", status, "读取 Git 状态失败");
  if (status.out) return { ok: false, code: "dirty_worktree", error: "工作区有未提交改动；为防止覆盖，不能切换分支或创建 PR" };
  return { ok: true };
}

function validateBranch(value: unknown, root: string, runGit: (cwd: string, args: string[]) => GitCommandResult): ValidBranch | GitFailure {
  const branch = typeof value === "string" ? value.trim() : "";
  if (!branch || branch.length > 160 || branch.startsWith("-") || /[\u0000-\u0020\u007f~^:?*\\\[]/.test(branch)) {
    return { ok: false, code: "invalid_branch", error: "分支名无效" };
  }
  const checked = runGit(root, ["check-ref-format", "--branch", branch]);
  return checked.ok ? { ok: true, branch } : { ok: false, code: "invalid_branch", error: "分支名不符合 Git 规则" };
}

function validatePullRequest(value: unknown, root: string, runGit: (cwd: string, args: string[]) => GitCommandResult): ValidPullRequest | GitFailure {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (!title || title.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title)) {
    return { ok: false, code: "invalid_pr_title", error: "PR 标题必须是 1-200 个可显示字符" };
  }
  if (body.length > 20_000 || body.includes("\0")) return { ok: false, code: "invalid_pr_body", error: "PR 内容过长或包含非法字符" };
  const base = validateBranch(data.base === undefined ? "main" : data.base, root, runGit);
  if (!base.ok) return { ok: false, code: "invalid_pr_base", error: "PR 目标分支无效" };
  return { ok: true, title, body, base: base.branch, draft: data.draft !== false };
}

function parseBranchRecord(line: string): GitBranchRecord | null {
  const [marker = "", name = "", upstream = ""] = line.split("\t");
  if (!name) return null;
  return { name, current: marker.trim() === "*", ...(upstream ? { upstream } : {}) };
}

function normalizePullRequest(value: Record<string, unknown>) {
  return {
    number: Number.isInteger(value.number) ? value.number : Number(value.number) || 0,
    url: typeof value.url === "string" ? value.url : "",
    title: bounded(String(value.title || ""), 200),
    state: bounded(String(value.state || "UNKNOWN").toLowerCase(), 32),
    draft: value.isDraft === true,
    head: bounded(String(value.headRefName || ""), 160),
    base: bounded(String(value.baseRefName || ""), 160),
  };
}

function normalizeChecks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((item, index) => {
    const check = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      id: `${index}-${bounded(String(check.name || check.context || "check"), 120)}`,
      name: bounded(String(check.name || check.context || "Unnamed check"), 120),
      workflow: bounded(String(check.workflowName || ""), 120),
      status: checkStatus(check.status, check.conclusion),
      detailsUrl: /^https:\/\//i.test(String(check.detailsUrl || "")) ? bounded(String(check.detailsUrl), 2048) : "",
    };
  });
}

function checkStatus(statusValue: unknown, conclusionValue: unknown): GitCiStatus {
  const status = String(statusValue || "").toLowerCase();
  const conclusion = String(conclusionValue || "").toLowerCase();
  if (["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(conclusion)) return "failed";
  if (["success", "neutral"].includes(conclusion)) return "passed";
  if (conclusion === "skipped") return "skipped";
  if (["queued", "pending", "in_progress", "waiting", "requested"].includes(status) || (!conclusion && status !== "completed")) return "pending";
  return "unknown";
}

function summarizeChecks(checks: Array<{ status: GitCiStatus }>) {
  const counts = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    pending: checks.filter((check) => check.status === "pending").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
    unknown: checks.filter((check) => check.status === "unknown").length,
  };
  const status: GitCiStatus = counts.failed ? "failed" : counts.pending ? "pending" : counts.total && counts.passed + counts.skipped === counts.total ? "passed" : "unknown";
  return { status, ...counts };
}

function emptyCi(status: GitCiStatus) {
  return { status, total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 };
}

function commandFailure(code: string, result: GitCommandResult, fallback: string): GitFailure {
  return { ok: false, code, error: redactCommandText(result.err || result.out || fallback) || fallback };
}

function redactCommandText(value: string): string {
  return bounded(String(value || ""), 4000)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/([?&](?:token|access_token|key)=)[^&\s]+/gi, "$1[REDACTED]");
}

function collaborationStatusReason(value: string, context: "unavailable" | "status"): string {
  const safe = redactCommandText(value);
  if (/\b(?:enoent|command not found|not recognized as an internal|executable file not found)\b/i.test(safe)) {
    return "GitHub CLI 未安装或不可用，请先安装 gh 后重试。";
  }
  if (/\b(?:auth login|not logged|not authenticated|authentication required|authentication token|http 401|bad credentials)\b/i.test(safe)) {
    return "GitHub CLI 尚未登录，请在终端运行 gh auth login。Hi Code 不会读取或保存你的 GitHub 凭据。";
  }
  if (/\b(?:no pull requests found|could not resolve to a pull request|no pull request)\b/i.test(safe)) {
    return "当前分支还没有 Pull Request。";
  }
  if (/\b(?:could not resolve host|network is unreachable|connection refused|connection timed out|operation timed out|tls handshake timeout)\b/i.test(safe)) {
    return "暂时无法连接 GitHub，请检查网络后重试。";
  }
  if (!safe) {
    return context === "unavailable" ? "GitHub CLI 未安装或不可用。" : "当前分支没有可读取的 Pull Request。";
  }
  return `GitHub 状态读取失败：${safe}`;
}

function bounded(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
