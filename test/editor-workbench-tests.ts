import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_EDITOR_BYTES,
  createEditorService,
  registerEditorIpc,
} from "../electron/services/editor-service.mjs";
import {
  buildRevisionRequest,
  normalizeDiffComment,
} from "../renderer/app-shell/workspace/review.ts";

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

function pathInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveExisting(root: string, candidate: string) {
  try {
    const rootReal = fs.realpathSync.native(root);
    const absolute = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(rootReal, candidate));
    const real = fs.realpathSync.native(absolute);
    return pathInside(rootReal, real) ? real : null;
  } catch {
    return null;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-editor-workbench-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-editor-outside-"));
const sourceFile = path.join(root, "src", "sample.ts");
fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
fs.writeFileSync(sourceFile, "export const value = 1;\n", { mode: 0o640 });
const editor = createEditorService({
  getCwd: () => root,
  resolveInCwd: (candidate: string) => resolveExisting(root, candidate),
});

console.log("\n[editor-workbench] conflict-safe file service");

await check("opens bounded UTF-8 text with a stable revision", () => {
  const result = editor.openFile({ path: sourceFile });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.file.content, "export const value = 1;\n");
  assert.equal(result.file.encoding, "utf8");
  assert.equal(result.file.relativePath, path.join("src", "sample.ts"));
  assert.match(result.file.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.file.size, Buffer.byteLength(result.file.content));
});

await check("saves atomically and returns the new revision", () => {
  const opened = editor.openFile({ path: sourceFile });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const initialMode = fs.statSync(sourceFile).mode & 0o777;
  const result = editor.saveFile({
    path: sourceFile,
    content: "export const value = 2;\n",
    expectedRevision: opened.file.revision,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(fs.readFileSync(sourceFile, "utf8"), "export const value = 2;\n");
  assert.notEqual(result.file.revision, opened.file.revision);
  assert.equal(fs.statSync(sourceFile).mode & 0o777, initialMode);
  assert.deepEqual(fs.readdirSync(path.dirname(sourceFile)).filter((name) => name.includes(".hicode-editor-")), []);
});

await check("refuses to overwrite an external disk change", () => {
  const opened = editor.openFile({ path: sourceFile });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  fs.writeFileSync(sourceFile, "export const external = true;\n");
  const result = editor.saveFile({
    path: sourceFile,
    content: "export const stale = true;\n",
    expectedRevision: opened.file.revision,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "file_conflict");
  assert.notEqual(result.currentRevision, opened.file.revision);
  assert.equal(fs.readFileSync(sourceFile, "utf8"), "export const external = true;\n");
});

await check("requires an explicit force flag after a visible conflict", () => {
  const opened = editor.openFile({ path: sourceFile });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  fs.writeFileSync(sourceFile, "export const externalAgain = true;\n");
  const result = editor.saveFile({
    path: sourceFile,
    content: "export const deliberate = true;\n",
    expectedRevision: opened.file.revision,
    force: true,
  });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(sourceFile, "utf8"), "export const deliberate = true;\n");
});

await check("rejects outside paths and symlink escapes", () => {
  const outsideFile = path.join(outside, "secret.txt");
  fs.writeFileSync(outsideFile, "secret\n");
  const direct = editor.openFile({ path: outsideFile });
  assert.equal(direct.ok, false);
  if (!direct.ok) assert.equal(direct.code, "path_outside_workspace");
  const link = path.join(root, "outside-link.txt");
  fs.symlinkSync(outsideFile, link);
  const linked = editor.openFile({ path: link });
  assert.equal(linked.ok, false);
  if (!linked.ok) assert.equal(linked.code, "path_outside_workspace");
});

await check("rejects binary invalid UTF-8 and oversized content", () => {
  const binary = path.join(root, "binary.bin");
  fs.writeFileSync(binary, Buffer.from([0x61, 0x00, 0x62]));
  const binaryResult = editor.openFile({ path: binary });
  assert.equal(binaryResult.ok, false);
  if (!binaryResult.ok) assert.equal(binaryResult.code, "binary_file");

  const invalid = path.join(root, "invalid.txt");
  fs.writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
  const invalidResult = editor.openFile({ path: invalid });
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) assert.equal(invalidResult.code, "invalid_utf8");

  const large = path.join(root, "large.txt");
  fs.writeFileSync(large, Buffer.alloc(MAX_EDITOR_BYTES + 1, 0x61));
  const largeResult = editor.openFile({ path: large });
  assert.equal(largeResult.ok, false);
  if (!largeResult.ok) assert.equal(largeResult.code, "file_too_large");

  const opened = editor.openFile({ path: sourceFile });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const invalidSave = editor.saveFile({
    path: sourceFile,
    content: "unsafe\u0000content",
    expectedRevision: opened.file.revision,
  });
  assert.equal(invalidSave.ok, false);
  if (!invalidSave.ok) assert.equal(invalidSave.code, "binary_content");
});

await check("registers validated editor IPC channels", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerEditorIpc({
    register: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
    editor,
  });
  assert.deepEqual([...handlers.keys()].sort(), ["editor:file:open", "editor:file:save"]);
  const opened = await handlers.get("editor:file:open")?.({}, { path: sourceFile }) as { ok?: boolean };
  assert.equal(opened?.ok, true);
});

console.log("\n[editor-workbench] typed diff review request");

await check("normalizes a bounded line-specific diff comment", () => {
  const comment = normalizeDiffComment({
    diffId: "diff-1",
    path: "src/sample.ts",
    line: 12,
    side: "after",
    body: "Please keep this branch explicit.",
  });
  assert.deepEqual(comment, {
    diffId: "diff-1",
    path: "src/sample.ts",
    line: 12,
    side: "after",
    body: "Please keep this branch explicit.",
  });
  assert.throws(() => normalizeDiffComment({ ...comment, body: "   " }), /comment/i);
  assert.throws(() => normalizeDiffComment({ ...comment, line: 0 }), /line/i);
});

await check("builds a bounded revision request with diff context", () => {
  const request = buildRevisionRequest({
    comment: {
      diffId: "diff-1",
      path: "src/sample.ts",
      line: 2,
      side: "after",
      body: "Use the validated value instead.",
    },
    diff: {
      id: "diff-1",
      path: "src/sample.ts",
      before: "const value = raw;\nconsole.log(value);\n",
      after: "const value = validate(raw);\nconsole.log(value);\n",
      status: "pending",
    },
  });
  assert.match(request.runtimeText, /src\/sample\.ts/);
  assert.match(request.runtimeText, /Use the validated value instead/);
  assert.match(request.runtimeText, /validate\(raw\)/);
  assert.equal(request.displayText, "审查 src/sample.ts:2 · Use the validated value instead.");
  assert.ok(Buffer.byteLength(request.runtimeText, "utf8") <= 24_000);
});

console.log("\n[editor-workbench] production integration contract");

await check("production sources expose the editor and real review action", () => {
  const preload = fs.readFileSync(path.resolve("electron/preload.cjs"), "utf8");
  const registrar = fs.readFileSync(path.resolve("electron/ipc/register-ipc-handlers.mjs"), "utf8");
  const api = fs.readFileSync(path.resolve("renderer/api/hicode-api.js"), "utf8");
  const fileTree = fs.readFileSync(path.resolve("renderer/components/file-tree.js"), "utf8");
  const codeEditor = fs.readFileSync(path.resolve("renderer/app-shell/editor/code-editor.ts"), "utf8");
  const inspector = fs.readFileSync(path.resolve("renderer/app-shell/workspace/Inspector.tsx"), "utf8");
  const bootstrap = fs.readFileSync(path.resolve("renderer/app/bootstrap.js"), "utf8");
  const e2e = fs.readFileSync(path.resolve("tests/electron-e2e/run.mjs"), "utf8");
  assert.match(preload, /openEditorFile/);
  assert.match(preload, /saveEditorFile/);
  assert.match(registrar, /registerEditorIpc/);
  assert.match(api, /openEditorFile/);
  assert.match(api, /saveEditorFile/);
  assert.match(fileTree, /hicodeAppShell.*editor/);
  assert.match(codeEditor, /EditorView/);
  assert.match(inspector, /requestDiffRevision/);
  assert.match(bootstrap, /buildRevisionRequest|requestDiffRevision/);
  assert.match(e2e, /file_conflict/);
  assert.match(e2e, /diff comment|review comment|revision request/i);
});

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
