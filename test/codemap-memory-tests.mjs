import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodemapService } from "../electron/services/codemap-service.mjs";
import { createMemoryService } from "../electron/services/memory-service.mjs";
import { sanitizeUrl } from "../electron/services/browser-service.mjs";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-map-"));
fs.mkdirSync(path.join(workspace, "src"));
fs.writeFileSync(path.join(workspace, "src", "app.ts"), "export function hello() {}\nexport class App {}\n");
fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n");

const codemap = createCodemapService({ getCwd: () => workspace });
const map = codemap.scan();
assert.equal(map.ok, true);
assert.ok(map.summary.fileCount >= 2);
assert.ok(map.symbols.some((s) => s.name === "hello"));
assert.equal(map.tree.type, "dir");

const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-mem-"));
let rollbackCount = 0;
const memory = createMemoryService({
  rootDir: memoryDir,
  getCwd: () => workspace,
  rejectPendingDiffs: () => {
    rollbackCount = 2;
    return { ok: true, count: 2 };
  },
});
const added = memory.add(workspace, { text: "Prefer ESM imports", tags: ["style"] });
assert.equal(added.ok, true);
const listed = memory.list(workspace);
assert.equal(listed.memory.notes.length, 1);
assert.equal(listed.memory.notes[0].tags[0], "style");
const pinned = memory.pin(workspace, added.note.id, true);
assert.equal(pinned.note.pinned, true);
const rolled = memory.rollbackRunChanges();
assert.equal(rolled.count, 2);
assert.equal(rollbackCount, 2);

assert.equal(sanitizeUrl("example.com"), "https://example.com");
assert.equal(sanitizeUrl("http://localhost:3000"), "http://localhost:3000");
assert.match(sanitizeUrl("hi code"), /^https:\/\/www\.google\.com\/search\?/);

console.log("codemap-memory-tests: ok");
