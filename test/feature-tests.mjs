// Direct (no-LLM) tests for the production features: fuzzy patch, sandbox, MCP.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editFile, readFile, writeFile } from "../dist/tools/fs.js";
import { grep, runBash } from "../dist/tools/bash.js";
import { initMcp, callMcpTool, mcpToolSchemas } from "../dist/mcp.js";
import { executeTool } from "../dist/tools/index.js";
import { newPermissionState } from "../dist/permissions.js";
import { streamChat } from "../dist/llm.js";
import { makeCompleter } from "../dist/completer.js";
import {
  gitInfo,
  gitDiff,
  gitWorkflowStatus,
  gitFileDiff,
  gitStage,
  gitUnstage,
  gitGenerateCommitMessage,
  gitCommit,
} from "../dist/git.js";
import { buildUserContent, createRuntime } from "../dist/runtime.js";
import { DiffService } from "../dist/diff-service.js";
import { recoverableTasksFromEvents, readRecoverableTasksFromLogs } from "../dist/recovery.js";
import { RuntimeJobQueue } from "../dist/job-queue.js";
import { buildSafeChildEnv, redactEnvForLogs, validateAllowedEnvKeys } from "../dist/process-env.js";
import { spawnSync } from "node:child_process";

let pass = 0,
  fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-test-"));

// --- 1. Fuzzy patch (indentation mismatch: file uses a TAB, model used spaces) ---
console.log("\n[1] fuzzy patch");
const f = path.join(tmp, "code.js");
fs.writeFileSync(f, "function add(a, b) {\n\treturn a + b;\n}\n");
// old_string uses 4 spaces; file uses a tab → not a substring, so exact match fails.
const r = editFile(
  { cwd: tmp },
  { path: "code.js", old_string: "    return a + b;", new_string: "return a - b;" },
);
check("fuzzy edit succeeded", !("error" in r), JSON.stringify(r));
const after = fs.readFileSync(f, "utf8");
check("content updated", after.includes("return a - b;"), after);
check("original indentation (tab) preserved", after.includes("\treturn a - b;"), JSON.stringify(after));

// --- 1b. Workspace path confinement ---
console.log("\n[1b] workspace path confinement");
const outside = path.join(os.tmpdir(), `vibe-outside-${Date.now()}.txt`);
fs.writeFileSync(outside, "secret outside workspace");
const deniedRead = readFile({ cwd: tmp }, { path: outside });
check("absolute read outside cwd denied", deniedRead.includes("path escapes workspace"), deniedRead);
const deniedWrite = writeFile({ cwd: tmp }, { path: outside, content: "overwrite" });
check("absolute write outside cwd denied", "error" in deniedWrite && deniedWrite.error.includes("path escapes workspace"), JSON.stringify(deniedWrite));
const deniedGrep = await grep({ cwd: tmp }, { pattern: "secret", path: outside });
check("grep outside cwd denied", deniedGrep.includes("path escapes workspace"), deniedGrep);
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-outside-dir-"));
fs.writeFileSync(path.join(outsideDir, "secret.txt"), "symlink secret");
try {
  fs.symlinkSync(outsideDir, path.join(tmp, "link-out"));
  const deniedSymlink = readFile({ cwd: tmp }, { path: "link-out/secret.txt" });
  check("symlink escape denied", deniedSymlink.includes("path escapes workspace"), deniedSymlink);
} catch (e) {
  console.log(`  (symlink test skipped — ${(e && e.message) || e})`);
}
const outsideRef = buildUserContent(`read @${outside}`, tmp);
check("@absolute outside cwd not inlined", typeof outsideRef === "string" && !outsideRef.includes("secret outside workspace"), String(outsideRef));
fs.unlinkSync(outside);
fs.rmSync(outsideDir, { recursive: true, force: true });

// --- 2. Sandbox (macOS only) ---
console.log("\n[2] bash sandbox");
if (process.platform === "darwin") {
  const inside = await runBash({ cwd: tmp, sandbox: true }, { command: "echo hi > inside.txt && echo ok" });
  check("write inside cwd allowed", fs.existsSync(path.join(tmp, "inside.txt")), JSON.stringify(inside));
  const outside = path.join(os.homedir(), `vibe-sandbox-escape-${Date.now()}.txt`);
  const esc = await runBash({ cwd: tmp, sandbox: true }, { command: `echo hi > ${outside}; echo done` });
  check("write outside cwd blocked", !fs.existsSync(outside), `file unexpectedly created: ${outside}`);
  if (fs.existsSync(outside)) fs.unlinkSync(outside);
  void esc;
  const reviewerWrite = await runBash(
    { cwd: tmp, bashMode: "read-only" },
    { command: "echo reviewer > reviewer-write.txt; echo done" },
  );
  check(
    "read-only bash blocks workspace writes",
    !fs.existsSync(path.join(tmp, "reviewer-write.txt")),
    JSON.stringify(reviewerWrite),
  );
} else {
  const reviewerWrite = await runBash(
    { cwd: tmp, bashMode: "read-only" },
    { command: "echo reviewer > reviewer-write.txt; echo done" },
  );
  check(
    "read-only bash unavailable without macOS sandbox",
    reviewerWrite.exitCode === 126 && !fs.existsSync(path.join(tmp, "reviewer-write.txt")),
    JSON.stringify(reviewerWrite),
  );
}

// --- 2a. Bash can be interrupted ---
console.log("\n[2a] bash interrupt");
const bashAbort = new AbortController();
const bashStart = Date.now();
const slowBash = runBash(
  { cwd: tmp, sandbox: false },
  { command: "node -e \"setTimeout(() => console.log('late'), 5000)\"", timeout: 10000 },
  bashAbort.signal,
);
setTimeout(() => bashAbort.abort(), 75);
const abortedBash = await slowBash;
check("bash abort returns interrupt code", abortedBash.exitCode === 130, JSON.stringify(abortedBash));
check("bash abort returns quickly", Date.now() - bashStart < 3000, `${Date.now() - bashStart}ms`);

// --- 2b. Raw !cmd shell shortcut still asks permission ---
console.log("\n[2b] !cmd permission");
const cfg = {
  profiles: {
    default: {
      name: "default",
      baseURL: "http://127.0.0.1:9",
      apiKey: "x",
      model: "mock",
      contextWindow: 8192,
      temperature: 0,
    },
  },
  defaultProfile: "default",
  roleModels: {},
  councilMembers: [],
  councilSynthesizer: "default",
  compactThreshold: 0.75,
  sandbox: false,
  mcpServers: {},
};
let shellPrompted = false;
const runtimeEvents = [];
const rt = createRuntime({
  cfg,
  cwd: tmp,
  mode: "default",
  systemPrompt: "test",
  ask: async (q) => {
    shellPrompted = q.includes("[y] allow");
    return "n";
  },
  emitEvent: (event) => {
    const id = `runtime-evt-${runtimeEvents.length + 1}`;
    runtimeEvents.push({ ...event, id });
    return id;
  },
});
await rt.handleInput("!touch raw-shell-denied.txt");
check(
  "!cmd prompts and respects deny",
  shellPrompted && !fs.existsSync(path.join(tmp, "raw-shell-denied.txt")),
  "raw shell ran despite deny",
);
check("runtime emits turn start", runtimeEvents.some((event) => event.type === "turn:start" && event.status === "running"), JSON.stringify(runtimeEvents));
const runtimeTurnStart = runtimeEvents.find((event) => event.type === "turn:start");
check("runtime turn start keeps retry input", runtimeTurnStart?.payload?.retryInput === "!touch raw-shell-denied.txt", JSON.stringify(runtimeTurnStart));
const deniedTurn = runtimeEvents.find((event) => event.type === "turn:done");
check("runtime emits denied turn done", deniedTurn?.status === "denied" && Number.isFinite(deniedTurn.payload?.durationMs), JSON.stringify(runtimeEvents));

// --- 2c. Recoverable task parser ---
console.log("\n[2c] recoverable tasks");
const recoverable = recoverableTasksFromEvents([
  {
    id: "turn-a",
    sessionId: "session-a",
    turnId: "turn-a",
    type: "turn:start",
    title: "Run npm test",
    summary: "!npm test",
    status: "running",
    createdAt: 100,
    payload: { retryInput: "!npm test" },
  },
  {
    id: "done-a",
    sessionId: "session-a",
    turnId: "turn-a",
    type: "turn:done",
    title: "Turn failed",
    summary: "exit 1",
    status: "error",
    createdAt: 200,
    payload: { parentId: "turn-a", durationMs: 1234 },
  },
  {
    id: "turn-b",
    type: "turn:start",
    title: "Successful turn",
    status: "running",
    createdAt: 50,
    payload: { retryInput: "ok" },
  },
  {
    id: "done-b",
    type: "turn:done",
    title: "Turn completed",
    status: "done",
    createdAt: 60,
    payload: { parentId: "turn-b" },
  },
]);
check(
  "recoverableTasksFromEvents keeps failed retry input",
  recoverable.length === 1 &&
    recoverable[0].id === "turn-a" &&
    recoverable[0].status === "error" &&
    recoverable[0].retryInput === "!npm test" &&
    recoverable[0].durationMs === 1234,
  JSON.stringify(recoverable),
);
const recoveryLogDir = fs.mkdtempSync(path.join(tmp, "recovery-logs-"));
fs.writeFileSync(
  path.join(recoveryLogDir, "events-2026-07-01.jsonl"),
  [
    JSON.stringify({ id: "turn-log", type: "turn:start", title: "Run build", summary: "!npm run build", status: "running", createdAt: 300, payload: { retryInput: "!npm run build" } }),
    "not-json",
    JSON.stringify({ id: "done-log", type: "turn:done", title: "Turn interrupted", summary: "interrupted", status: "interrupted", createdAt: 400, payload: { parentId: "turn-log", durationMs: 42 } }),
  ].join("\n"),
);
const recoveredFromLog = readRecoverableTasksFromLogs(recoveryLogDir, 5);
check(
  "readRecoverableTasksFromLogs ignores bad lines and returns interrupted task",
  recoveredFromLog.length === 1 &&
    recoveredFromLog[0].id === "turn-log" &&
    recoveredFromLog[0].status === "interrupted" &&
    recoveredFromLog[0].retryInput === "!npm run build",
  JSON.stringify(recoveredFromLog),
);

// --- 2e. Safe child process env ---
console.log("\n[2e] safe child process env");
const oldEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
};
process.env.OPENAI_API_KEY = "sk-parent-secret";
process.env.ANTHROPIC_API_KEY = "anthropic-parent-secret";
process.env.GITHUB_TOKEN = "github-parent-secret";
try {
  const safeEnv = buildSafeChildEnv({ extraEnv: { MCP_TEST_TOKEN: "explicit-token" }, allowSensitiveExtraEnv: true });
  check("safe env keeps basic runtime paths", Boolean(safeEnv.PATH || safeEnv.HOME || safeEnv.TMPDIR || safeEnv.TEMP || safeEnv.TMP));
  check("safe env strips parent API keys and tokens", !safeEnv.OPENAI_API_KEY && !safeEnv.ANTHROPIC_API_KEY && !safeEnv.GITHUB_TOKEN, JSON.stringify(Object.keys(safeEnv).sort()));
  check("safe env allows explicit MCP server env", safeEnv.MCP_TEST_TOKEN === "explicit-token");
  const freeCadEnv = buildSafeChildEnv({ extraEnv: { HICODE_FREECAD_OUTPUT_DIR: path.join(tmp, "freecad") } });
  check("FreeCAD safe env allows output dir without parent secrets", freeCadEnv.HICODE_FREECAD_OUTPUT_DIR?.endsWith("freecad") && !freeCadEnv.OPENAI_API_KEY);
  let rejectedSensitive = false;
  try {
    buildSafeChildEnv({ extraEnv: { OPENAI_API_KEY: "not-allowed" } });
  } catch {
    rejectedSensitive = true;
  }
  check("sensitive extra env requires explicit allow", rejectedSensitive);
  const redacted = redactEnvForLogs({ PATH: "/bin", GITHUB_TOKEN: "secret", CUSTOM_PASSWORD: "secret" });
  check("env logging redacts tokens and passwords", redacted.PATH === "/bin" && redacted.GITHUB_TOKEN === "[REDACTED]" && redacted.CUSTOM_PASSWORD === "[REDACTED]");
  check("env key validator rejects sensitive names", validateAllowedEnvKeys(["PATH", "GITHUB_TOKEN", "CUSTOM_SECRET"]).rejected.length === 2);
} finally {
  for (const [key, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// --- 2d. Runtime job queue ---
console.log("\n[2d] runtime job queue");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const queueOrder = [];
const jobStates = [];
const q = new RuntimeJobQueue(
  async (job) => {
    queueOrder.push(`start:${job.input}`);
    if (job.input === "first") await wait(30);
    queueOrder.push(`done:${job.input}`);
  },
  (state) => jobStates.push({ running: state.running?.input || null, queued: state.queued.map((job) => job.input) }),
);
q.enqueue("first");
q.enqueue("second");
await q.idle();
check(
  "RuntimeJobQueue runs jobs serially",
  queueOrder.join(",") === "start:first,done:first,start:second,done:second",
  JSON.stringify(queueOrder),
);
check(
  "RuntimeJobQueue reports queued state",
  jobStates.some((state) => state.running === "first" && state.queued.includes("second")),
  JSON.stringify(jobStates),
);
const errorOrder = [];
let queuedError = "";
const q2 = new RuntimeJobQueue(
  async (job) => {
    errorOrder.push(`start:${job.input}`);
    if (job.input === "bad") throw new Error("boom");
    errorOrder.push(`done:${job.input}`);
  },
  undefined,
  (err) => {
    queuedError = err?.message || String(err);
  },
);
q2.enqueue("bad");
q2.enqueue("after");
await q2.idle();
check(
  "RuntimeJobQueue continues after failed job",
  queuedError === "boom" && errorOrder.join(",") === "start:bad,start:after,done:after",
  JSON.stringify({ queuedError, errorOrder }),
);
const queueStore = path.join(tmp, "jobs", "runtime-jobs.json");
const persistedQueue = new RuntimeJobQueue(
  async (job) => {
    if (job.input === "fail") throw new Error("persisted boom");
  },
  undefined,
  undefined,
  { storePath: queueStore, historyLimit: 3 },
);
persistedQueue.enqueue("ok");
persistedQueue.enqueue("fail");
await persistedQueue.idle();
const persistedHistory = persistedQueue.state().history;
check(
  "RuntimeJobQueue keeps recent history",
  persistedHistory.length === 2 && persistedHistory[0].status === "error" && persistedHistory[1].status === "done",
  JSON.stringify(persistedHistory),
);
const restoredQueue = new RuntimeJobQueue(async () => {}, undefined, undefined, { storePath: queueStore, historyLimit: 3 });
check(
  "RuntimeJobQueue restores persisted history",
  restoredQueue.state().history.length === 2 && restoredQueue.state().history[0].error === "persisted boom",
  JSON.stringify(restoredQueue.state().history),
);
const cancelQueue = new RuntimeJobQueue(
  async (job) => {
    if (job.input === "hold") await wait(30);
  },
  undefined,
  undefined,
  { historyLimit: 5 },
);
cancelQueue.enqueue("hold");
cancelQueue.enqueue("clear-me");
const canceledCount = cancelQueue.clearQueued();
await cancelQueue.idle();
check(
  "RuntimeJobQueue records canceled queued jobs",
  canceledCount === 1 && cancelQueue.state().history.some((job) => job.input === "clear-me" && job.status === "canceled"),
  JSON.stringify(cancelQueue.state().history),
);

// --- 3. MCP client ---
console.log("\n[3] MCP client");
const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(testDir, "mock-mcp-server.mjs");
const oldMcpEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
};
process.env.OPENAI_API_KEY = "sk-parent-secret";
process.env.ANTHROPIC_API_KEY = "anthropic-parent-secret";
process.env.GITHUB_TOKEN = "github-parent-secret";
const results = await initMcp({ demo: { command: "node", args: [serverPath], env: { MCP_TEST_TOKEN: "explicit-mcp-token" } } });
try {
  check("server connected", results[0]?.ok === true, JSON.stringify(results));
  check("tools discovered", results[0]?.toolCount === 2, JSON.stringify(results));
  const schemas = mcpToolSchemas();
  check("tool namespaced", schemas.some((s) => s.function.name === "mcp__demo__echo") && schemas.some((s) => s.function.name === "mcp__demo__env"), JSON.stringify(schemas.map((s) => s.function.name)));
  const callRes = await callMcpTool("mcp__demo__echo", { text: "hello" });
  check("tool call works", callRes === "echo: hello", callRes);
  const mcpEnvRes = JSON.parse(await callMcpTool("mcp__demo__env", {}));
  check("MCP server receives explicit env without parent secrets", mcpEnvRes.explicit === "explicit-mcp-token" && !mcpEnvRes.openai && !mcpEnvRes.anthropic && !mcpEnvRes.github, JSON.stringify(mcpEnvRes));
} finally {
  for (const [key, value] of Object.entries(oldMcpEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
let mcpPrompted = false;
const deniedMcp = await executeTool(
  {
    cfg: {},
    ctx: { cwd: tmp },
    perms: newPermissionState("default"),
    ask: async (q) => {
      mcpPrompted = q.includes("[y] allow");
      return "n";
    },
    depth: 0,
  },
  "mcp__demo__echo",
  JSON.stringify({ text: "blocked" }),
);
check("mcp tool prompts before execution", mcpPrompted && deniedMcp.content === "Denied by user.", JSON.stringify(deniedMcp));

// --- 3b. Structured tool events + diff payloads ---
console.log("\n[3b] structured tool events");
const eventDir = fs.mkdtempSync(path.join(tmp, "events-"));
const events = [];
const changes = [];
const eventEnv = {
  cfg,
  ctx: { cwd: eventDir },
  perms: newPermissionState("default"),
  ask: async () => "y",
  depth: 0,
  sessionId: "session-test",
  turnId: "turn-test",
  emitEvent: (event) => {
    const id = `evt-${events.length + 1}`;
    events.push({ ...event, id });
    return id;
  },
  recordChange: (absPath, before, diffId) => changes.push({ absPath, before, diffId }),
};
const writeOutcome = await executeTool(
  eventEnv,
  "write_file",
  JSON.stringify({ path: "hello.txt", content: "hello\n" }),
);
const writeDiff = events.find((event) => event.type === "diff:created" && event.tool === "write_file");
check("write_file emits tool start", events.some((event) => event.type === "tool:start" && event.tool === "write_file"), JSON.stringify(events));
check("write_file emits permission event", events.some((event) => event.type === "permission:requested" && event.tool === "write_file" && event.status === "waiting"), JSON.stringify(events));
check("write_file emits diff payload", writeDiff?.payload?.diff?.before === null && writeDiff.payload.diff.after === "hello\n", JSON.stringify(writeDiff));
check("write_file records diff id for undo", changes[0]?.diffId === writeDiff?.diffId && writeOutcome.summary === "hello.txt", JSON.stringify(changes));
const writeDone = events.find((event) => event.type === "tool:done" && event.tool === "write_file");
check("tool done includes duration", Number.isFinite(writeDone?.payload?.durationMs), JSON.stringify(writeDone));
events.length = 0;
const editOutcome = await executeTool(
  eventEnv,
  "edit_file",
  JSON.stringify({ path: "hello.txt", old_string: "hello", new_string: "hi" }),
);
const editDiff = events.find((event) => event.type === "diff:created" && event.tool === "edit_file");
check("edit_file emits before/after diff", editDiff?.payload?.diff?.before.includes("hello") && editDiff.payload.diff.after.includes("hi"), JSON.stringify(editDiff));
check("edit_file completes", editOutcome.summary === "hello.txt" && fs.readFileSync(path.join(eventDir, "hello.txt"), "utf8").includes("hi"), JSON.stringify(editOutcome));
events.length = 0;
const bashOutcome = await executeTool(
  eventEnv,
  "bash",
  JSON.stringify({ command: "printf 'one\\n'; printf 'err\\n' >&2" }),
);
const bashOutputs = events.filter((event) => event.type === "tool:output" && event.tool === "bash");
const bashDone = events.find((event) => event.type === "tool:done" && event.tool === "bash");
check("bash emits streaming output events", bashOutputs.some((event) => event.payload?.stream === "stdout" && event.summary.includes("one")) && bashOutputs.some((event) => event.payload?.stream === "stderr" && event.summary.includes("err")), JSON.stringify(events));
check("bash done includes exit code and duration", bashOutcome.exitCode === 0 && bashDone?.payload?.exitCode === 0 && Number.isFinite(bashDone?.payload?.durationMs), JSON.stringify(bashDone));

// --- 3c. Diff service accept/reject ---
console.log("\n[3c] diff service accept/reject");
const diffDir = fs.mkdtempSync(path.join(tmp, "diff-service-"));
const diffService = new DiffService(() => diffDir);
const tracked = path.join(diffDir, "tracked.txt");
fs.writeFileSync(tracked, "before\n");
diffService.upsert({
  id: "diff-existing",
  sessionId: "s",
  turnId: "t",
  path: "tracked.txt",
  absPath: tracked,
  before: "before\n",
  after: "after\n",
  status: "pending",
  tool: "edit_file",
  createdAt: Date.now(),
});
fs.writeFileSync(tracked, "after\n");
const rejectedExisting = diffService.reject("diff-existing");
check("reject restores existing file", rejectedExisting.ok && fs.readFileSync(tracked, "utf8") === "before\n", JSON.stringify(rejectedExisting));
const created = path.join(diffDir, "created.txt");
fs.writeFileSync(created, "created\n");
diffService.upsert({
  id: "diff-new",
  sessionId: "s",
  turnId: "t",
  path: "created.txt",
  absPath: created,
  before: null,
  after: "created\n",
  status: "pending",
  tool: "write_file",
  createdAt: Date.now(),
});
const rejectedNew = diffService.reject("diff-new");
check("reject deletes newly created file", rejectedNew.ok && !fs.existsSync(created), JSON.stringify(rejectedNew));
const outsideDiff = path.join(os.tmpdir(), `hicode-outside-diff-${Date.now()}.txt`);
fs.writeFileSync(outsideDiff, "outside\n");
diffService.upsert({
  id: "diff-outside",
  sessionId: "s",
  turnId: "t",
  path: "../outside.txt",
  absPath: outsideDiff,
  before: "outside\n",
  after: "changed\n",
  status: "pending",
  tool: "edit_file",
  createdAt: Date.now(),
});
const outsideReject = diffService.reject("diff-outside");
check("reject outside workspace denied", !outsideReject.ok && fs.readFileSync(outsideDiff, "utf8") === "outside\n", JSON.stringify(outsideReject));
diffService.upsert({
  id: "diff-accepted",
  sessionId: "s",
  turnId: "t",
  path: "tracked.txt",
  absPath: tracked,
  before: "before\n",
  after: "after\n",
  status: "pending",
  tool: "edit_file",
  createdAt: Date.now(),
});
const acceptedDiff = diffService.accept("diff-accepted");
check("accept marks diff archived", acceptedDiff.ok && acceptedDiff.diff.status === "accepted", JSON.stringify(acceptedDiff));
const removedArchived = diffService.clearArchived();
const remainingDiffs = diffService.list();
check("clear archived removes accepted/rejected only", removedArchived === 3 && remainingDiffs.length === 1 && remainingDiffs[0].id === "diff-outside", JSON.stringify(remainingDiffs));
fs.unlinkSync(outsideDiff);

// --- 4. Interruptible generation (pre-aborted signal) ---
console.log("\n[4] interruptible generation");
const ac = new AbortController();
ac.abort(); // already aborted before the call
const profile = { name: "x", baseURL: "http://127.0.0.1:9", apiKey: "x", model: "m", contextWindow: 8192, temperature: 0 };
const turn = await streamChat(profile, [{ role: "user", content: "hi" }], [], {}, ac.signal);
check("aborted request returns cleanly", turn.aborted === true, JSON.stringify(turn));
check("no tool calls on abort", Array.isArray(turn.tool_calls) && turn.tool_calls.length === 0, JSON.stringify(turn));

// --- 5. Tab completion ---
console.log("\n[5] tab completion");
// build a small dir tree to complete against
fs.mkdirSync(path.join(tmp, "src", "agents"), { recursive: true });
fs.writeFileSync(path.join(tmp, "src", "main.ts"), "");
const complete = makeCompleter(tmp);

const [cmds] = complete("/de");
check("slash command completes", cmds.includes("/debate"), JSON.stringify(cmds));

const [roles, sub] = complete("/agent arch");
check("role completes", roles.includes("architect") && sub === "arch", JSON.stringify([roles, sub]));

const [paths] = complete("look at @src/");
check("@dir lists entries", paths.includes("@src/agents/") && paths.includes("@src/main.ts"), JSON.stringify(paths));

const [paths2] = complete("@src/ma");
check("@path prefix filters", paths2.length === 1 && paths2[0] === "@src/main.ts", JSON.stringify(paths2));

// --- 6. Git awareness ---
console.log("\n[6] git awareness");
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-git-"));
const g = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
g(["init", "-q"]);
g(["config", "user.email", "t@t.t"]);
g(["config", "user.name", "t"]);
fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
g(["add", "."]);
g(["commit", "-qm", "init"]);
fs.writeFileSync(path.join(repo, "a.txt"), "hello world\n"); // dirty it
const info = gitInfo(repo);
check("gitInfo detects repo + branch", info !== null && typeof info.branch === "string", JSON.stringify(info));
check("gitInfo counts dirty files", info?.dirty === 1, JSON.stringify(info));
check("gitInfo null outside repo", gitInfo(os.tmpdir()) === null || gitInfo("/").dirty >= 0, "ok");
const diff = gitDiff(repo);
check("gitDiff shows the change", diff.includes("hello world") || diff.includes("a.txt"), diff.slice(0, 120));
let workflow = gitWorkflowStatus(repo);
check("gitWorkflowStatus lists dirty file", workflow.ok && workflow.unstaged === 1 && workflow.files[0]?.path === "a.txt", JSON.stringify(workflow));
const stageResult = gitStage(repo, ["a.txt"]);
check("gitStage stages file", stageResult.ok, JSON.stringify(stageResult));
workflow = gitWorkflowStatus(repo);
check("gitWorkflowStatus counts staged file", workflow.staged === 1 && workflow.unstaged === 0, JSON.stringify(workflow));
const stagedDiff = gitFileDiff(repo, "a.txt", true);
check("gitFileDiff shows staged diff", stagedDiff.ok && stagedDiff.diff.includes("hello world"), JSON.stringify(stagedDiff).slice(0, 160));
const generatedMessage = gitGenerateCommitMessage(repo);
check("gitGenerateCommitMessage uses staged files", generatedMessage.ok && generatedMessage.message.includes("a.txt"), JSON.stringify(generatedMessage));
const unstageResult = gitUnstage(repo, ["a.txt"]);
check("gitUnstage unstages file", unstageResult.ok && gitWorkflowStatus(repo).staged === 0, JSON.stringify(unstageResult));
gitStage(repo, ["a.txt"]);
const commitResult = gitCommit(repo, generatedMessage.message);
check("gitCommit commits staged files", commitResult.ok && typeof commitResult.hash === "string" && commitResult.hash.length > 0, JSON.stringify(commitResult));
check("gitWorkflowStatus clean after commit", gitWorkflowStatus(repo).dirty === 0, JSON.stringify(gitWorkflowStatus(repo)));
fs.rmSync(repo, { recursive: true, force: true });

// --- 7. Image input (multimodal) ---
console.log("\n[7] image input");
const idir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-img-"));
// a 1x1 PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);
fs.writeFileSync(path.join(idir, "pic.png"), png);
fs.writeFileSync(path.join(idir, "notes.txt"), "some text");
const plain = buildUserContent("just text here", idir);
check("no image → plain string", typeof plain === "string", typeof plain);
const multi = buildUserContent("look at @pic.png please", idir);
check("image → content array", Array.isArray(multi), typeof multi);
check("has text part", Array.isArray(multi) && multi[0].type === "text", JSON.stringify(multi?.[0]?.type));
check(
  "has image_url with data uri",
  Array.isArray(multi) && multi.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:image/png;base64,")),
  JSON.stringify(Array.isArray(multi) ? multi.map((p) => p.type) : multi),
);
const withText = buildUserContent("compare @notes.txt and @pic.png", idir);
check("text file still inlined alongside image", Array.isArray(withText) && withText[0].text.includes("some text"), "ok");
fs.rmSync(idir, { recursive: true, force: true });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
