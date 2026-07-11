import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseAnsiSegments } from "../renderer/app-shell/workspace/ansi.ts";
import {
  MAX_TRANSCRIPT_ROWS,
  filterWorkspaceSessions,
  type ConversationMessage,
  type WorkspaceActions,
  type WorkspaceSession,
} from "../renderer/app-shell/workspace/contracts.ts";
import { WorkspaceActionUnavailableError, WorkspaceController } from "../renderer/app-shell/workspace/controller.ts";
import { buildUnifiedDiffLines } from "../renderer/app-shell/workspace/diff.ts";
import { createWorkspaceStore } from "../renderer/app-shell/workspace/store.ts";
import { computeTranscriptWindow, moveSessionFocusIndex } from "../renderer/app-shell/workspace/windowing.ts";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => unknown | Promise<unknown>) {
  try {
    await run();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.stack || error.message : String(error)}`);
    failed += 1;
  }
}

function session(id: string, prompt = `Prompt ${id}`): WorkspaceSession {
  return { id, firstPrompt: prompt, updatedAt: 1_700_000_000_000, messageCount: 2 };
}

function messages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    text: `Message ${index}`,
    status: "complete",
    attachments: [],
  }));
}

console.log("\n[workspace-shell] immutable workspace state");

await check("session and conversation updates publish immutable snapshots", () => {
  const store = createWorkspaceStore();
  const first = store.getSnapshot();
  store.setSessions([session("one"), session("two")], "two");
  const second = store.getSnapshot();
  store.setConversation(messages(3), "two");
  const third = store.getSnapshot();
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.deepEqual(first.sessions, []);
  assert.equal(second.activeSessionId, "two");
  assert.equal(third.messages.length, 3);
});

await check("assistant streaming replaces one active message instead of duplicating rows", () => {
  const store = createWorkspaceStore();
  const id = store.startAssistantMessage();
  store.appendAssistantDelta("hello");
  store.appendAssistantDelta(" world");
  store.finishAssistantMessage("complete");
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0]?.id, id);
  assert.equal(snapshot.messages[0]?.text, "hello world");
  assert.equal(snapshot.messages[0]?.status, "complete");
  assert.equal(snapshot.activeAssistantMessageId, null);
});

await check("only one responsive workbench drawer can be open", () => {
  const store = createWorkspaceStore();
  store.setDrawer("timeline");
  assert.equal(store.getSnapshot().drawer, "timeline");
  store.setDrawer("inspector");
  assert.equal(store.getSnapshot().drawer, "inspector");
  store.setDrawer("none");
  assert.equal(store.getSnapshot().drawer, "none");
});

console.log("\n[workspace-shell] bounded long-session rendering");

await check("a 10,000-message transcript mounts at most the product limit", () => {
  const window = computeTranscriptWindow(10_000, 10_000);
  assert.equal(window.end, 10_000);
  assert.equal(window.end - window.start, MAX_TRANSCRIPT_ROWS);
  assert.equal(window.hasOlder, true);
  assert.equal(window.hasNewer, false);
});

await check("transcript windows can move through all history without mounting it all", () => {
  const latest = computeTranscriptWindow(1_000, 1_000);
  const previous = computeTranscriptWindow(1_000, latest.start);
  const next = computeTranscriptWindow(1_000, previous.end + MAX_TRANSCRIPT_ROWS);
  assert.ok(previous.start < latest.start);
  assert.ok(previous.end - previous.start <= MAX_TRANSCRIPT_ROWS);
  assert.ok(next.end <= 1_000);
});

await check("session keyboard navigation wraps predictably", () => {
  assert.equal(moveSessionFocusIndex(0, 4, "next"), 1);
  assert.equal(moveSessionFocusIndex(3, 4, "next"), 0);
  assert.equal(moveSessionFocusIndex(0, 4, "previous"), 3);
  assert.equal(moveSessionFocusIndex(2, 4, "first"), 0);
  assert.equal(moveSessionFocusIndex(2, 4, "last"), 3);
});

console.log("\n[workspace-shell] safe presentation and real actions");

await check("ANSI parsing preserves hostile text as text segments", () => {
  const source = "\u001b[31m<script>alert(1)</script>\u001b[0m plain";
  const segments = parseAnsiSegments(source);
  assert.equal(segments.map((segment) => segment.text).join(""), "<script>alert(1)</script> plain");
  assert.ok(segments.some((segment) => segment.className === "c-red"));
  assert.equal(JSON.stringify(segments).includes("dangerouslySetInnerHTML"), false);
});

await check("diff preview is typed and bounded", () => {
  const before = Array.from({ length: 1_000 }, (_, index) => `old ${index}`).join("\n");
  const after = Array.from({ length: 1_000 }, (_, index) => `new ${index}`).join("\n");
  const lines = buildUnifiedDiffLines({ id: "diff-1", path: "src/a.ts", before, after, status: "pending" });
  assert.ok(lines.length <= 803);
  assert.equal(lines[0]?.kind, "meta");
  assert.ok(lines.some((line) => line.text.includes("truncated")));
  assert.ok(lines.some((line) => line.kind === "del" && line.side === "before" && line.line === 1));
  assert.ok(lines.some((line) => line.kind === "add" && line.side === "after" && line.line === 1));
});

await check("missing production handlers fail closed with an actionable error", async () => {
  const store = createWorkspaceStore();
  const controller = new WorkspaceController(store);
  await assert.rejects(() => controller.run("openSession", "one"), (error: unknown) => {
    assert.ok(error instanceof WorkspaceActionUnavailableError);
    assert.match(error.message, /openSession/);
    return true;
  });
  assert.match(store.getSnapshot().actionError, /openSession/);
});

await check("registered workspace actions call the existing concrete handler", async () => {
  const store = createWorkspaceStore();
  const controller = new WorkspaceController(store);
  const calls: string[] = [];
  controller.configureActions({ openSession: async (id) => calls.push(id) } as Partial<WorkspaceActions>);
  await controller.run("openSession", "saved-session");
  assert.deepEqual(calls, ["saved-session"]);
  assert.equal(controller.hasAction("openSession"), true);
  assert.equal(store.getSnapshot().actionError, "");
});

await check("session filtering covers prompt, model, and workspace", () => {
  const source: WorkspaceSession[] = [
    { ...session("a", "Build renderer"), model: "kimi", cwd: "/workspace/alpha" },
    { ...session("b", "Review PLC"), model: "deepseek", cwd: "/workspace/beta" },
  ];
  assert.deepEqual(filterWorkspaceSessions(source, "renderer").map((item) => item.id), ["a"]);
  assert.deepEqual(filterWorkspaceSessions(source, "deepseek").map((item) => item.id), ["b"]);
  assert.deepEqual(filterWorkspaceSessions(source, "alpha").map((item) => item.id), ["a"]);
});

console.log("\n[workspace-shell] production integration contract");

await check("App Shell source declares the workspace migration bridge", () => {
  const source = fs.readFileSync(path.resolve("renderer/app-shell/main.tsx"), "utf8");
  assert.match(source, /workspace/);
  assert.match(source, /WorkspacePortals/);
});

await check("production HTML provides dedicated React workbench mounts", () => {
  const source = fs.readFileSync(path.resolve("renderer/index.html"), "utf8");
  for (const id of ["sessions", "chat", "workbenchControlsMount", "timelineWorkspaceMount", "inspectorWorkspaceMount"]) {
    assert.match(source, new RegExp(`id=["']${id}["']`));
  }
});

await check("legacy bootstrap delegates migrated surfaces instead of rebuilding their children", () => {
  const source = fs.readFileSync(path.resolve("renderer/app/bootstrap.js"), "utf8");
  assert.match(source, /workspace\.setSessions/);
  assert.match(source, /workspace\.setConversation/);
  assert.match(source, /workspace\.setTimeline/);
  assert.match(source, /workspace\.setDiffs/);
  assert.doesNotMatch(source, /sessionsEl\.innerHTML/);
  assert.doesNotMatch(source, /chat\.innerHTML/);
  assert.doesNotMatch(source, /timelineList\.innerHTML/);
  assert.doesNotMatch(source, /diffList\.innerHTML/);
});

await check("real Electron acceptance covers long transcripts and workspace keyboard behavior", () => {
  const source = fs.readFileSync(path.resolve("tests/electron-e2e/run.mjs"), "utf8");
  assert.match(source, /10_000|10000/);
  assert.match(source, /mountedMessages/);
  assert.match(source, /session.*keyboard|keyboard.*session/i);
});

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
