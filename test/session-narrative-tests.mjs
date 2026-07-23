import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// Point HICODE_DIR-like sessions into a temp dir via monkeypatch of the built module path is hard;
// instead exercise append/format by temporarily writing through the exported API after setting HOME.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-narr-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const require = createRequire(import.meta.url);
// Ensure fresh module resolution after HOME change by dynamic import of dist.
const {
  appendSessionNarrative,
  formatSessionDisplayMessages,
  loadSession,
} = await import("../dist/session-store.js");

const id = "test-session-narr-1";
const user = appendSessionNarrative(id, { role: "user", text: "请检查登录页" }, { cwd: "/tmp/demo", model: "demo" });
assert.equal(user.ok, true);
const assistant = appendSessionNarrative(id, {
  role: "assistant",
  text: "已检查",
  assistantTurn: {
    id: "turn-1",
    status: "done",
    items: [{ type: "thinking", content: "分析中" }, { type: "text", content: "已检查" }],
    toolCallCount: 0,
  },
});
assert.equal(assistant.ok, true);

const stored = loadSession(id);
assert.ok(stored);
assert.equal(stored.narratives.length, 2);
const display = formatSessionDisplayMessages(stored);
assert.equal(display.length, 2);
assert.equal(display[1].assistantTurn.id, "turn-1");
assert.equal(display[1].assistantTurn.items[0].type, "thinking");

console.log("session-narrative-tests: ok");
