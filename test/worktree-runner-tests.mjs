import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../dist/job-center.js";
import { WorktreeRunner, validatePatchPaths } from "../dist/worktree-runner.js";
import { createWorktreeService } from "../electron/services/worktree-service.mjs";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false, "expected throw");
  } catch (error) {
    const message = error?.message || String(error);
    check(name, pattern ? pattern.test(message) : true, message);
  }
}

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

console.log("\n[worktree-runner] git worktree mode");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-worktree-runner-"));
const safeRoot = path.join(tmp, "safe");
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
git(repo, ["init"]);
git(repo, ["config", "user.email", "test@example.com"]);
git(repo, ["config", "user.name", "Hi Code Test"]);
write(path.join(repo, "a.txt"), "one\n");
git(repo, ["add", "a.txt"]);
git(repo, ["commit", "-m", "initial"]);

const runner = new WorktreeRunner({ safeRoot, idPrefix: "test" });
const workspace = runner.createIsolatedWorkspace({ sourcePath: repo, mode: "auto", jobId: "job-1" });
const workspaceRel = path.relative(workspace.safeRoot, workspace.workspacePath);
check("git repo creates worktree", workspace.mode === "worktree" && workspaceRel && !workspaceRel.startsWith("..") && !path.isAbsolute(workspaceRel));
check("worktree manifest exists", fs.existsSync(path.join(workspace.workspacePath, ".hicode-worktree-runner.json")));
const run = runner.runInIsolatedWorkspace({ workspace, command: "printf 'two\\n' > a.txt", userApproved: true });
check("runInIsolatedWorkspace executes command", run.ok === true);
const changes = runner.collectChanges(workspace);
check("collectChanges reports changed file", changes.ok && changes.changedFiles.includes("a.txt"));
check("collectChanges writes patch", /\+two/.test(changes.patch) && !changes.patch.includes(".hicode-worktree-runner.json"));
const cleanup = runner.cleanupWorkspace(workspace);
check("cleanup removes managed workspace", cleanup.ok && cleanup.removed && !fs.existsSync(workspace.workspacePath));

write(path.join(repo, "dirty.txt"), "dirty\n");
throws("dirty workspace is rejected by default", () => runner.createIsolatedWorkspace({ sourcePath: repo, mode: "auto" }), /uncommitted changes/);
fs.rmSync(path.join(repo, "dirty.txt"), { force: true });

console.log("\n[worktree-runner] copy sandbox fallback");
const plain = path.join(tmp, "plain project");
fs.mkdirSync(plain, { recursive: true });
write(path.join(plain, "src", "main.txt"), "alpha\n");
const copyWorkspace = runner.createIsolatedWorkspace({ sourcePath: plain, mode: "auto", jobId: "copy-job" });
check("non-git source falls back to copy sandbox", copyWorkspace.mode === "copy");
runner.runInIsolatedWorkspace({ workspace: copyWorkspace, command: "printf 'beta\\n' > 'src/main.txt'\nprintf 'new\\n' > 'src/new.txt'", userApproved: true });
const copyChanges = runner.collectChanges(copyWorkspace);
check("copy sandbox patch includes modified file", copyChanges.patch.includes("src/main.txt") && copyChanges.patch.includes("+beta"));
check("copy sandbox patch includes new file", copyChanges.patch.includes("src/new.txt") && copyChanges.patch.includes("+new"));

console.log("\n[worktree-runner] safety");
const fakeWorkspace = { ...copyWorkspace, id: "fake", workspacePath: path.join(copyWorkspace.safeRoot, "fake", "workspace") };
fs.mkdirSync(fakeWorkspace.workspacePath, { recursive: true });
const fakeCleanup = runner.cleanupWorkspace(fakeWorkspace);
check("cleanup refuses unmanaged path", fakeCleanup.ok === false && /manifest/.test(fakeCleanup.error || ""));
throws("patch path escape is rejected", () => validatePatchPaths("diff --git a/../evil b/../evil\n--- a/../evil\n+++ b/../evil\n"), /escapes workspace/);
const copyCleanup = runner.cleanupWorkspace(copyWorkspace);
check("copy sandbox cleanup removes only managed workspace", copyCleanup.ok && !fs.existsSync(copyWorkspace.workspacePath) && fs.existsSync(plain));

console.log("\n[worktree-runner] service and Job Center");
const serviceStore = new JobStore({
  storePath: path.join(tmp, "jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "worktree-job",
});
const service = createWorktreeService({
  runner,
  jobStore: serviceStore,
  getCwd: () => plain,
  authorize: async () => "allow",
});
const serviceRun = await service.run({
  sourcePath: plain,
  mode: "copy",
  command: "printf 'gamma\\n' > 'src/main.txt'",
  cleanup: true,
  title: "Service worktree run",
});
const serviceJob = serviceStore.getJob(serviceRun.jobId);
check("worktree service creates Job", serviceRun.ok && serviceJob?.source === "worktree-runner");
check("worktree service writes create event", serviceJob?.events.some((event) => event.type === "worktree.created"));
check("worktree service writes command event", serviceJob?.events.some((event) => event.type === "worktree.command.finished"));
check("worktree service writes patch event", serviceJob?.events.some((event) => event.type === "worktree.patch.collected"));
check("worktree service writes cleanup event", serviceJob?.events.some((event) => event.type === "worktree.cleaned"));
check("worktree service records patch artifact", serviceJob?.artifacts.some((artifact) => artifact.type === "patch" && fs.existsSync(artifact.path)));
check("worktree service records metadata-only execution policy", serviceJob?.events.some((event) => event.type === "worktree.command.finished" && event.data?.executionPolicy?.audit && !JSON.stringify(event.data).includes("gamma")));

const deniedService = createWorktreeService({
  runner,
  jobStore: serviceStore,
  getCwd: () => plain,
  authorize: async () => "deny",
});
const deniedRun = await deniedService.run({ sourcePath: plain, mode: "copy", command: "touch should-not-run.txt" });
check("worktree IPC cannot bypass main-process approval", deniedRun.denied === true && !fs.existsSync(path.join(plain, "should-not-run.txt")));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
