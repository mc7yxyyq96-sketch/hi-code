import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function createStoreCatalogCache({ filePath, ttlMs = 15 * 60 * 1000, maxEntries = 48, now = () => Date.now(), fsImpl = fs } = {}) {
  if (!filePath || !path.isAbsolute(filePath)) throw new TypeError("store cache filePath must be absolute");
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000) throw new TypeError("store cache ttlMs is invalid");

  const read = () => {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
      if (parsed?.schemaVersion !== SCHEMA_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
        return { schemaVersion: SCHEMA_VERSION, entries: {} };
      }
      return parsed;
    } catch {
      return { schemaVersion: SCHEMA_VERSION, entries: {} };
    }
  };

  const write = (state) => {
    const directory = path.dirname(filePath);
    fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fsImpl.chmodSync(directory, 0o700); } catch {}
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tempPath, JSON.stringify(state), { mode: 0o600 });
    try {
      fsImpl.renameSync(tempPath, filePath);
    } catch (error) {
      // Windows does not consistently replace an existing destination with renameSync.
      try { fsImpl.rmSync(filePath, { force: true }); } catch {}
      try {
        fsImpl.renameSync(tempPath, filePath);
      } catch (retryError) {
        try { fsImpl.rmSync(tempPath, { force: true }); } catch {}
        throw new AggregateError([error, retryError], "store cache atomic replacement failed");
      }
    }
    try { fsImpl.chmodSync(filePath, 0o600); } catch {}
  };

  const get = (key) => {
    const record = read().entries[String(key || "")];
    if (!record || !record.value || !Number.isFinite(record.updatedAt)) return null;
    const ageMs = Math.max(0, now() - record.updatedAt);
    return {
      value: clone(record.value),
      updatedAt: record.updatedAt,
      ageMs,
      fresh: ageMs <= ttlMs,
    };
  };

  const set = (key, value) => {
    const normalizedKey = String(key || "");
    if (!normalizedKey) throw new TypeError("store cache key is required");
    const state = read();
    state.entries[normalizedKey] = { updatedAt: now(), value: clone(value) };
    const ordered = Object.entries(state.entries)
      .sort(([, left], [, right]) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
      .slice(0, maxEntries);
    state.entries = Object.fromEntries(ordered);
    write(state);
    return get(normalizedKey);
  };

  const clear = () => {
    try { fsImpl.rmSync(filePath, { force: true }); } catch {}
  };

  return { get, set, clear, filePath, ttlMs };
}
