import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Workspace memory store + helpers for run change rollback metadata (clean-room Wave1).
 */

export function createMemoryService({ rootDir, getCwd, rejectPendingDiffs } = {}) {
  if (!rootDir) throw new Error("createMemoryService requires rootDir");

  function workspaceKey(cwd) {
    const abs = path.resolve(cwd || (typeof getCwd === "function" ? getCwd() : "") || process.cwd());
    const hash = crypto.createHash("sha1").update(abs).digest("hex").slice(0, 16);
    return { abs, hash, file: path.join(rootDir, `${hash}.json`) };
  }

  function emptyDoc(cwd) {
    return {
      version: 1,
      workspace: cwd,
      updatedAt: Date.now(),
      notes: [],
    };
  }

  function read(cwd) {
    const { abs, file } = workspaceKey(cwd);
    try {
      if (!fs.existsSync(file)) return { ok: true, memory: emptyDoc(abs), path: file };
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const notes = Array.isArray(raw?.notes) ? raw.notes.map(normalizeNote).filter(Boolean) : [];
      return {
        ok: true,
        memory: {
          version: 1,
          workspace: abs,
          updatedAt: Number(raw?.updatedAt) || Date.now(),
          notes,
        },
        path: file,
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  function write(doc, file) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* ignore */ }
  }

  function normalizeNote(note) {
    if (!note || typeof note !== "object") return null;
    const text = String(note.text || "").trim();
    if (!text) return null;
    return {
      id: String(note.id || `mem-${crypto.randomBytes(4).toString("hex")}`),
      text,
      tags: Array.isArray(note.tags) ? note.tags.map(String).filter(Boolean).slice(0, 12) : [],
      createdAt: Number(note.createdAt) || Date.now(),
      pinned: !!note.pinned,
    };
  }

  function list(cwd) {
    return read(cwd);
  }

  function add(cwd, input = {}) {
    const loaded = read(cwd);
    if (!loaded.ok) return loaded;
    const note = normalizeNote({
      id: `mem-${crypto.randomBytes(5).toString("hex")}`,
      text: input.text,
      tags: input.tags,
      pinned: input.pinned,
      createdAt: Date.now(),
    });
    if (!note) return { ok: false, error: "text is required" };
    const memory = loaded.memory;
    memory.notes.unshift(note);
    memory.updatedAt = Date.now();
    write(memory, loaded.path);
    return { ok: true, note, memory };
  }

  function remove(cwd, id) {
    const loaded = read(cwd);
    if (!loaded.ok) return loaded;
    const before = loaded.memory.notes.length;
    loaded.memory.notes = loaded.memory.notes.filter((note) => note.id !== id);
    if (loaded.memory.notes.length === before) return { ok: false, error: "note not found" };
    loaded.memory.updatedAt = Date.now();
    write(loaded.memory, loaded.path);
    return { ok: true, memory: loaded.memory };
  }

  function pin(cwd, id, pinned = true) {
    const loaded = read(cwd);
    if (!loaded.ok) return loaded;
    const note = loaded.memory.notes.find((entry) => entry.id === id);
    if (!note) return { ok: false, error: "note not found" };
    note.pinned = !!pinned;
    loaded.memory.updatedAt = Date.now();
    write(loaded.memory, loaded.path);
    return { ok: true, note, memory: loaded.memory };
  }

  function rollbackRunChanges() {
    if (typeof rejectPendingDiffs !== "function") {
      return { ok: false, error: "rollback unavailable" };
    }
    return rejectPendingDiffs();
  }

  return { list, add, remove, pin, rollbackRunChanges, workspaceKey };
}

export function registerMemoryIpc({ register, memory }) {
  if (!register || !memory) throw new Error("registerMemoryIpc requires register + memory");
  register("memory:list", async (_e, payload = {}) => memory.list(payload?.cwd));
  register("memory:add", async (_e, payload = {}) => memory.add(payload?.cwd, payload || {}));
  register("memory:remove", async (_e, payload = {}) => memory.remove(payload?.cwd, String(payload?.id || "")));
  register("memory:pin", async (_e, payload = {}) =>
    memory.pin(payload?.cwd, String(payload?.id || ""), payload?.pinned !== false));
  register("memory:rollback-run", async () => memory.rollbackRunChanges());
}
