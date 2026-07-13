import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";

export function buildReleaseGitEnv(env = process.env) {
  const output = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) {
    if (typeof env[key] === "string") output[key] = env[key];
  }
  output.GIT_CONFIG_NOSYSTEM = "1";
  output.GIT_CONFIG_GLOBAL = os.devNull;
  output.GIT_OPTIONAL_LOCKS = "0";
  output.GIT_TERMINAL_PROMPT = "0";
  return output;
}

function runGit(root, args, env) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: buildReleaseGitEnv(env),
  });
}

export function inspectReleaseSource(root, env = process.env) {
  const revision = runGit(root, ["rev-parse", "HEAD"], env);
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=normal"], env);
  const commit = revision.status === 0 ? revision.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/i.test(commit) || status.status !== 0) {
    return { ok: false, clean: false, commit: "", changedPaths: 0, reason: "git_source_state_unavailable" };
  }
  const changedPaths = status.stdout.split(/\r?\n/).filter(Boolean).length;
  return { ok: true, clean: changedPaths === 0, commit, changedPaths, reason: changedPaths ? "dirty_source_tree" : "" };
}
