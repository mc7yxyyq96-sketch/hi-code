import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { ipcObject, ipcString } from "../ipc/ipc-utils.mjs";

export const MAX_EDITOR_BYTES = 2 * 1024 * 1024;
const MAX_EDITOR_PATH_CHARS = 4096;
const REVISION_RE = /^sha256:[a-f0-9]{64}$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function createEditorService({ getCwd, resolveInCwd, fsImpl = fs }) {
  if (typeof getCwd !== "function") throw new Error("editor-service requires getCwd");
  if (typeof resolveInCwd !== "function") throw new Error("editor-service requires resolveInCwd");

  const resolveTarget = (value) => {
    const requestedPath = ipcString(value).trim();
    if (!requestedPath || requestedPath.length > MAX_EDITOR_PATH_CHARS || requestedPath.includes("\0")) {
      return failure("invalid_path", "请选择工作区内的有效文件");
    }
    const target = resolveInCwd(requestedPath);
    if (!target) return failure("path_outside_workspace", "文件不存在或路径超出当前工作区");
    return { ok: true, target };
  };

  const snapshot = (requestedPath) => {
    const resolved = resolveTarget(requestedPath);
    if (!resolved.ok) return resolved;
    try {
      const stat = fsImpl.statSync(resolved.target);
      if (!stat.isFile()) return failure("not_regular_file", "只能编辑普通文件");
      if (stat.size > MAX_EDITOR_BYTES) return failure("file_too_large", "文件超过 2MB，不能在集成编辑器中打开");
      const buffer = fsImpl.readFileSync(resolved.target);
      if (buffer.length > MAX_EDITOR_BYTES) return failure("file_too_large", "文件超过 2MB，不能在集成编辑器中打开");
      if (buffer.includes(0)) return failure("binary_file", "检测到二进制内容，集成编辑器仅支持 UTF-8 文本");
      let content;
      try {
        content = utf8Decoder.decode(buffer);
      } catch {
        return failure("invalid_utf8", "文件不是有效的 UTF-8 文本");
      }
      return {
        ok: true,
        target: resolved.target,
        buffer,
        stat,
        file: {
          path: resolved.target,
          relativePath: relativeWorkspacePath(getCwd(), resolved.target),
          content,
          encoding: "utf8",
          size: buffer.length,
          mtimeMs: stat.mtimeMs,
          revision: revisionFor(buffer),
        },
      };
    } catch (error) {
      return failure("file_read_failed", error?.message || "文件读取失败");
    }
  };

  return Object.freeze({
    openFile(payload = {}) {
      const data = ipcObject(payload);
      const result = snapshot(data.path);
      return result.ok ? { ok: true, file: result.file } : result;
    },

    saveFile(payload = {}) {
      const data = ipcObject(payload);
      const content = data.content;
      const expectedRevision = ipcString(data.expectedRevision).trim();
      if (typeof content !== "string") return failure("invalid_content", "编辑内容必须是字符串");
      if (content.includes("\0")) return failure("binary_content", "编辑内容包含二进制空字节");
      const buffer = Buffer.from(content, "utf8");
      if (buffer.length > MAX_EDITOR_BYTES) return failure("file_too_large", "编辑内容超过 2MB，无法保存");
      if (!REVISION_RE.test(expectedRevision)) return failure("invalid_revision", "缺少有效的文件版本，重新加载后再保存");

      const current = snapshot(data.path);
      if (!current.ok) return current;
      const force = data.force === true;
      if (!force && current.file.revision !== expectedRevision) return conflict(current.file);

      const mode = current.stat.mode & 0o777;
      const tempPath = path.join(
        path.dirname(current.target),
        `.${path.basename(current.target)}.hicode-editor-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`,
      );
      let descriptor = null;
      try {
        descriptor = fsImpl.openSync(tempPath, "wx", mode || 0o600);
        fsImpl.writeFileSync(descriptor, buffer);
        if (typeof fsImpl.fsyncSync === "function") fsImpl.fsyncSync(descriptor);
        fsImpl.closeSync(descriptor);
        descriptor = null;

        if (!force) {
          const beforeReplace = snapshot(data.path);
          if (!beforeReplace.ok) return beforeReplace;
          if (beforeReplace.file.revision !== expectedRevision) return conflict(beforeReplace.file);
        }

        fsImpl.renameSync(tempPath, current.target);
        try { fsImpl.chmodSync(current.target, mode); } catch {}
        const saved = snapshot(current.target);
        return saved.ok ? { ok: true, file: saved.file, forced: force } : saved;
      } catch (error) {
        return failure("file_save_failed", error?.message || "文件保存失败");
      } finally {
        if (descriptor !== null) {
          try { fsImpl.closeSync(descriptor); } catch {}
        }
        try { fsImpl.rmSync(tempPath, { force: true }); } catch {}
      }
    },
  });
}

export function registerEditorIpc({ register, editor }) {
  if (!register) throw new Error("registerEditorIpc requires register");
  if (!editor) throw new Error("registerEditorIpc requires editor service");
  register.handle("editor:file:open", (_event, payload) => editor.openFile(payload));
  register.handle("editor:file:save", (_event, payload) => editor.saveFile(payload));
}

function relativeWorkspacePath(workspace, target) {
  try {
    return path.relative(fs.realpathSync.native(workspace), target) || path.basename(target);
  } catch {
    return path.relative(path.resolve(workspace), target) || path.basename(target);
  }
}

function revisionFor(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function conflict(file) {
  return {
    ok: false,
    code: "file_conflict",
    error: "文件已在磁盘上更改。请重新加载，或确认后强制覆盖。",
    currentRevision: file.revision,
    currentSize: file.size,
    currentMtimeMs: file.mtimeMs,
  };
}

function failure(code, error) {
  return { ok: false, code, error: String(error || code) };
}
