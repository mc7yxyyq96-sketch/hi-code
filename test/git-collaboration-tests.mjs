import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createGitCollaborationClient } from "../dist/git-collaboration.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ""}`);
    failed++;
  }
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return String(result.stdout || "").trim();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-git-loop-"));
const repo = path.join(root, "repo");
const remote = path.join(root, "remote.git");
fs.mkdirSync(repo);
git(repo, ["init", "-b", "main"]);
git(repo, ["config", "user.name", "Hi Code Test"]);
git(repo, ["config", "user.email", "hicode@example.invalid"]);
fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
git(repo, ["add", "README.md"]);
git(repo, ["commit", "-m", "initial"]);
git(root, ["init", "--bare", remote]);
git(repo, ["remote", "add", "origin", remote]);
git(repo, ["push", "-u", "origin", "main"]);

const ghCalls = [];
const ghRunner = (_command, args, options) => {
  ghCalls.push({ args: [...args], options });
  if (args[0] === "--version") return { ok: true, out: "gh version 2.80.0", err: "", status: 0 };
  if (args[0] === "pr" && args[1] === "create") return { ok: true, out: "https://github.com/example/repo/pull/42", err: "", status: 0 };
  if (args[0] === "pr" && args[1] === "view") {
    return {
      ok: true,
      out: JSON.stringify({
        number: 42,
        url: "https://github.com/example/repo/pull/42",
        title: "Protect the coding loop",
        state: "OPEN",
        isDraft: true,
        headRefName: "codex/fixture",
        baseRefName: "main",
        statusCheckRollup: [
          { name: "unit", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example/unit" },
          { name: "security", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci.example/security" },
          { name: "windows", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://ci.example/windows" },
        ],
      }),
      err: "",
      status: 0,
    };
  }
  return { ok: false, out: "", err: "unsupported fixture command", status: 1 };
};

const sourceEnv = {
  ...process.env,
  OPENAI_API_KEY: "sk-must-not-leak",
  GITHUB_TOKEN: "ghp-must-not-leak",
  SSH_AUTH_SOCK: "/tmp/must-not-leak.sock",
};
const client = createGitCollaborationClient({ ghRunner, envSource: sourceEnv });

console.log("\n[git-collaboration] dirty worktree protection");
fs.writeFileSync(path.join(repo, "dirty.txt"), "dirty\n");
const dirtySwitch = client.switchBranch(repo, "main");
check("branch switch refuses a dirty worktree", dirtySwitch.ok === false && dirtySwitch.code === "dirty_worktree", JSON.stringify(dirtySwitch));
fs.unlinkSync(path.join(repo, "dirty.txt"));

console.log("\n[git-collaboration] branch workflow");
const created = client.createBranch(repo, "codex/fixture");
check("branch creation switches to a validated branch", created.ok && created.branch === "codex/fixture", JSON.stringify(created));
const branches = client.listBranches(repo);
check("branch list marks the current branch", branches.ok && branches.branches.some((branch) => branch.name === "codex/fixture" && branch.current), JSON.stringify(branches));
check("branch names cannot become command arguments", client.createBranch(repo, "--upload-pack=bad").ok === false);
git(repo, ["push", "-u", "origin", "codex/fixture"]);

console.log("\n[git-collaboration] pull request and child environment");
const pr = client.createPullRequest(repo, {
  title: "Protect the coding loop",
  body: "Adds truthful queue and CI state.",
  base: "main",
  draft: true,
});
check("pull request creation uses explicit bounded arguments", pr.ok && pr.url.endsWith("/42") && ghCalls.some((call) => call.args.includes("--draft") && call.args.includes("--body")), JSON.stringify({ pr, ghCalls }));
const ghEnv = ghCalls.find((call) => call.args[0] === "pr" && call.args[1] === "create")?.options?.env || {};
check("GitHub CLI does not inherit model or GitHub tokens", !ghEnv.OPENAI_API_KEY && !ghEnv.GITHUB_TOKEN && !ghEnv.SSH_AUTH_SOCK, JSON.stringify(Object.keys(ghEnv)));
check("GitHub CLI keeps only required home and path environment", typeof ghEnv.PATH === "string" && (typeof ghEnv.HOME === "string" || typeof ghEnv.USERPROFILE === "string"));

console.log("\n[git-collaboration] CI truth");
const collaboration = client.getCollaborationStatus(repo);
check("failed CI remains failed", collaboration.ok && collaboration.ci.status === "failed" && collaboration.ci.failed === 1, JSON.stringify(collaboration));
check("pending CI remains visible beside failure", collaboration.ci.pending === 1 && collaboration.checks.some((item) => item.name === "windows" && item.status === "pending"), JSON.stringify(collaboration.checks));
check("PR metadata remains visible", collaboration.pullRequest?.number === 42 && collaboration.pullRequest?.draft === true, JSON.stringify(collaboration.pullRequest));

console.log("\n[git-collaboration] actionable status errors");
const unauthenticatedClient = createGitCollaborationClient({
  envSource: sourceEnv,
  ghRunner: (_command, args) => args[0] === "--version"
    ? { ok: true, out: "gh version 2.80.0", err: "", status: 0 }
    : {
        ok: false,
        out: "",
        err: "To get started with GitHub CLI, please run: gh auth login. Alternatively, populate the GH_TOKEN environment variable.",
        status: 4,
      },
});
const unauthenticated = unauthenticatedClient.getCollaborationStatus(repo);
const unauthenticatedCreate = unauthenticatedClient.createPullRequest(repo, {
  title: "Authentication must be actionable",
  body: "No credentials may be echoed.",
  base: "main",
  draft: true,
});
check(
  "GitHub authentication failures become actionable Chinese guidance",
  unauthenticated.ok && unauthenticated.available && unauthenticated.reason.includes("gh auth login") && unauthenticated.reason.includes("不会读取或保存"),
  JSON.stringify(unauthenticated),
);
check(
  "GitHub authentication guidance does not echo secret environment names",
  !unauthenticated.reason.includes("GH_TOKEN") && !unauthenticated.reason.includes("GITHUB_TOKEN"),
  unauthenticated.reason,
);
check(
  "Pull Request failures use the same redacted authentication guidance",
  unauthenticatedCreate.ok === false
    && unauthenticatedCreate.code === "pull_request_create_failed"
    && unauthenticatedCreate.error.includes("gh auth login")
    && !unauthenticatedCreate.error.includes("GH_TOKEN"),
  JSON.stringify(unauthenticatedCreate),
);

fs.rmSync(root, { recursive: true, force: true });

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
