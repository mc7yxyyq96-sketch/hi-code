import assert from "node:assert/strict";
import {
  appendTextDelta,
  applyChangeSummary,
  createAssistantTurn,
  finalizeTurn,
  projectRuntimeEvent,
} from "../renderer/app/assistant-turn.js";

function testProjectionPipeline() {
  let turn = createAssistantTurn();
  projectRuntimeEvent(turn, {
    type: "turn:update",
    title: "Thinking",
    summary: "分析需求",
    payload: { phase: "thinking" },
  });
  projectRuntimeEvent(turn, {
    type: "tool:start",
    id: "t1",
    tool: "read_file",
    summary: "src/app.ts",
    payload: { args: { path: "src/app.ts" } },
  });
  projectRuntimeEvent(turn, {
    type: "tool:done",
    id: "t1",
    tool: "read_file",
    status: "done",
    summary: "ok",
  });
  appendTextDelta(turn, "已读取文件。");
  applyChangeSummary(turn, [{ path: "src/app.ts", additions: 3, deletions: 1 }]);
  finalizeTurn(turn, "done");

  assert.equal(turn.status, "done");
  assert.equal(turn.items.some((item) => item.type === "thinking"), true);
  assert.equal(turn.items.some((item) => item.type === "tool" && item.name === "read_file" && item.ok === true), true);
  assert.equal(turn.items.some((item) => item.type === "text" && item.content.includes("已读取")), true);
  assert.equal(turn.changeSummary?.count, 1);
  assert.equal(turn.toolCallCount, 1);
}

function testPermissionWaiting() {
  const turn = createAssistantTurn();
  projectRuntimeEvent(turn, {
    type: "permission:requested",
    summary: "bash: rm -rf /tmp/x",
    payload: { id: "p1", action: "bash" },
  });
  assert.equal(turn.status, "waiting");
  assert.equal(turn.items.at(-1)?.type, "permission");
}

function testCompactProjection() {
  const turn = createAssistantTurn();
  projectRuntimeEvent(turn, {
    type: "turn:update",
    summary: "12000/16000",
    payload: { phase: "compacting" },
  });
  projectRuntimeEvent(turn, {
    type: "turn:update",
    summary: "已压缩 8 条历史消息",
    payload: { phase: "compacted", removed: 8 },
  });
  assert.equal(turn.items.filter((item) => item.type === "compact").length, 2);
  assert.equal(turn.items.at(-1)?.removed, 8);
}

testProjectionPipeline();
testPermissionWaiting();
testCompactProjection();
console.log("assistant-turn-tests: ok");
