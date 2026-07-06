import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../dist/job-center.js";
import { PatchArenaStore } from "../dist/patch-arena.js";
import { WorktreeRunner } from "../dist/worktree-runner.js";
import { createPatchArenaService } from "../electron/services/patch-arena-service.mjs";

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

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function firstCandidate(run) {
  return run?.candidates?.[0];
}

console.log("\n[patch-arena] setup");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-patch-arena-"));
const repo = path.join(tmp, "repo");
fs.mkdirSync(repo, { recursive: true });
git(repo, ["init"]);
git(repo, ["config", "user.email", "test@example.com"]);
git(repo, ["config", "user.name", "Hi Code Test"]);
write(path.join(repo, "a.txt"), "one\n");
write(path.join(repo, "index.js"), "export const value = 1;\n");
git(repo, ["add", "."]);
git(repo, ["commit", "-m", "initial"]);

const jobStore = new JobStore({
  storePath: path.join(tmp, "jobs.json"),
  allowedArtifactRoots: [tmp],
  idPrefix: "arena-job",
});
const arenaStore = new PatchArenaStore({
  storePath: path.join(tmp, "arena-runs.json"),
  idPrefix: "arena-test",
});
const worktreeRunner = new WorktreeRunner({ safeRoot: path.join(tmp, "worktrees"), idPrefix: "arena" });
const providerService = {
  listProviders: () => ({ ok: true, providers: [{ id: "hicode-internal", name: "Hi Code Internal", status: "enabled" }, { id: "codex-cli", name: "Codex CLI", status: "not_configured" }] }),
  getProvider: (id) => ({ ok: true, provider: { id, name: id === "hicode-internal" ? "Hi Code Internal" : id } }),
};
const service = createPatchArenaService({
  arenaStore,
  jobStore,
  worktreeRunner,
  getCwd: () => repo,
  artifactRoot: path.join(tmp, "arena-artifacts"),
  providerService,
});

console.log("\n[patch-arena] create and collect candidate");
const created = service.runArena({
  task: "create a candidate patch",
  providerIds: ["hicode-internal"],
  command: "printf 'candidate-one\\n' > arena-one.txt",
});
const run = arenaStore.getRun(created.run?.id || "");
const candidate = firstCandidate(run);
const job = jobStore.getJob(created.jobId || "");
check("creates arena run", created.ok && run?.status === "ready");
check("creates internal provider candidate", candidate?.providerId === "hicode-internal" && candidate.status === "ready");
check("collects patch artifact", fs.existsSync(candidate?.patch?.path || "") && candidate.patch.changedFiles.includes("arena-one.txt"));
check("writes gate results", candidate.gateResults.some((gate) => gate.gate === "changed files summary"));
check("writes skeleton detector gate", candidate.gateResults.some((gate) => gate.gate === "skeleton detector"));
check("writes candidate artifacts", candidate.artifacts.some((artifact) => artifact.name === "gate-results.json") && candidate.artifacts.some((artifact) => artifact.name === "logs.txt") && candidate.artifacts.some((artifact) => artifact.name === "definition-of-done.json"));
check("writes Job Center events", job?.events.some((event) => event.type === "arena.candidate.patch.collected"));
check("writes Job Center gate results", job?.gateResults.some((gate) => gate.metadata?.candidateId === candidate.id));

console.log("\n[patch-arena] reject candidate");
const rejected = service.rejectCandidate(run.id, candidate.id, { reason: "prefer another candidate" });
check("reject candidate records decision", rejected.ok && rejected.decision.decision === "rejected");
check("reject candidate updates status", arenaStore.getRun(run.id)?.candidates[0].status === "rejected");

console.log("\n[patch-arena] merge candidate");
const mergeRunResult = service.runArena({
  task: "change a.txt to two",
  providerIds: ["hicode-internal"],
  command: "printf 'two\\n' > a.txt",
});
const mergeRun = arenaStore.getRun(mergeRunResult.run.id);
const mergeCandidate = firstCandidate(mergeRun);
const merged = service.mergeCandidate(mergeRun.id, mergeCandidate.id, { reason: "test merge" });
check("merge candidate succeeds on clean workspace", merged.ok && fs.readFileSync(path.join(repo, "a.txt"), "utf8") === "two\n", merged.error || "");
check("merge records decision", arenaStore.getRun(mergeRun.id)?.decisions.some((decision) => decision.decision === "merged" && decision.result?.ok === true));
check("merge writes Job Center event", jobStore.getJob(mergeRun.jobId)?.events.some((event) => event.type === "arena.candidate.merged"));
git(repo, ["add", "a.txt"]);
git(repo, ["commit", "-m", "merge candidate"]);

console.log("\n[patch-arena] skeleton detector candidate risk");
const skeletonRunResult = service.runArena({
  task: "create a skeleton-only implementation",
  providerIds: ["hicode-internal"],
  command: "mkdir -p src && printf '// TODO\\n' > src/todo.js",
});
const skeletonRun = arenaStore.getRun(skeletonRunResult.run.id);
const skeletonCandidate = firstCandidate(skeletonRun);
check("skeleton candidate is not marked ready", skeletonRunResult.ok === false && skeletonCandidate?.status === "failed", JSON.stringify(skeletonRunResult));
check("skeleton detector gate fails candidate", skeletonCandidate?.gateResults.some((gate) => gate.gate === "skeleton detector" && gate.status === "failed"), JSON.stringify(skeletonCandidate?.gateResults));
check("skeleton risk is visible in metadata and score", skeletonCandidate?.metadata?.definitionOfDone?.skeleton?.summary?.blocking > 0 && skeletonCandidate?.score?.skeletonFindings > 0, JSON.stringify(skeletonCandidate?.metadata?.definitionOfDone));

console.log("\n[patch-arena] dirty merge protection");
const dirtyRunResult = service.runArena({
  task: "change a.txt to three",
  providerIds: ["hicode-internal"],
  command: "printf 'three\\n' > a.txt",
});
const dirtyRun = arenaStore.getRun(dirtyRunResult.run.id);
const dirtyCandidate = firstCandidate(dirtyRun);
write(path.join(repo, "dirty.txt"), "dirty\n");
const dirtyMerge = service.mergeCandidate(dirtyRun.id, dirtyCandidate.id, { reason: "should refuse dirty merge" });
check("dirty workspace merge is rejected", dirtyMerge.ok === false && /uncommitted changes/.test(dirtyMerge.error || ""), dirtyMerge.error || "");
check("failed merge preserves patch file", fs.existsSync(dirtyCandidate.patch.path));
check("failed merge records decision", arenaStore.getRun(dirtyRun.id)?.decisions.some((decision) => decision.result?.ok === false));

console.log("\n[patch-arena] provider safety");
const unavailable = service.runArena({ task: "try unavailable provider", providerIds: ["codex-cli"] });
check("not_configured provider cannot run", unavailable.ok === false && /not_configured/.test(unavailable.error || ""), unavailable.error || "");

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
