import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReadBeforeEditState, recordFileRead, requireReadBeforeEdit } from "../dist/policies/read-before-edit.js";
import { findSymbol, getFileOutline } from "../dist/tools/code-intel.js";
import { TOOL_SCHEMAS, executeTool } from "../dist/tools/index.js";

const names = new Set(TOOL_SCHEMAS.map((tool) => tool.function.name));
for (const required of [
  "read_file_range",
  "apply_patch",
  "get_file_outline",
  "find_symbol",
  "search_symbols",
  "todo_write",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
]) {
  assert.equal(names.has(required), true, `missing tool schema ${required}`);
}

const state = createReadBeforeEditState();
assert.equal(requireReadBeforeEdit(state, "a.ts").ok, false);
recordFileRead(state, "a.ts");
assert.equal(requireReadBeforeEdit(state, "a.ts").ok, true);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-parity-tools-"));
fs.writeFileSync(path.join(tmp, "sample.ts"), "export function hello() {\n  return 1;\n}\nexport const value = 2;\n");
const ctx = { cwd: tmp };
const outline = getFileOutline(ctx, { path: "sample.ts" });
assert.match(outline, /hello/);
const symbol = findSymbol(ctx, { name: "hello" });
assert.match(symbol, /sample\.ts/);

const env = {
  cfg: { compactThreshold: 0.8 },
  ctx,
  perms: { mode: "yolo", sessionAllow: new Set() },
  ask: async () => "allow",
  depth: 0,
  quiet: true,
  readPolicy: createReadBeforeEditState(),
  todos: [],
  emitEvent: () => "evt",
};

const denied = await executeTool(env, "edit_file", JSON.stringify({
  path: "sample.ts",
  old_string: "return 1;",
  new_string: "return 2;",
}));
assert.match(denied.content, /read_file/);

await executeTool(env, "read_file", JSON.stringify({ path: "sample.ts" }));
const edited = await executeTool(env, "apply_patch", JSON.stringify({
  path: "sample.ts",
  old_string: "return 1;",
  new_string: "return 2;",
}));
assert.match(edited.content, /Edited|replacement/i);

const todos = await executeTool(env, "todo_write", JSON.stringify({
  todos: [{ text: "ship parity", status: "in_progress" }],
}));
assert.match(todos.content, /ship parity/);

console.log("parity-tool-union-tests: ok");
