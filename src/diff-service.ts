import fs from "node:fs";
import path from "node:path";
import type { DiffEntry, DiffStatus } from "./events.js";

export type DiffServiceResult =
  | { ok: true; diff: DiffEntry }
  | { ok: false; error: string };

export class DiffService {
  private readonly diffs = new Map<string, DiffEntry>();

  constructor(private readonly cwdProvider: () => string) {}

  upsert(diff: DiffEntry): DiffEntry {
    const current = this.diffs.get(diff.id);
    const next = { ...current, ...diff };
    this.diffs.set(diff.id, next);
    return next;
  }

  list(): DiffEntry[] {
    return Array.from(this.diffs.values()).sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
    );
  }

  clearArchived(): number {
    let removed = 0;
    for (const [id, diff] of this.diffs) {
      if (diff.status !== "pending") {
        this.diffs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get(id: string): DiffEntry | undefined {
    return this.diffs.get(id);
  }

  updateStatus(id: string, status: DiffStatus): DiffServiceResult {
    const diff = this.diffs.get(id);
    if (!diff) return { ok: false, error: "diff 不存在" };
    const next = { ...diff, status, updatedAt: Date.now() };
    this.diffs.set(id, next);
    return { ok: true, diff: next };
  }

  accept(id: string): DiffServiceResult {
    const diff = this.diffs.get(id);
    if (!diff) return { ok: false, error: "diff 不存在" };
    if (diff.status !== "pending") return { ok: false, error: `diff 已经是 ${diff.status}` };
    return this.updateStatus(id, "accepted");
  }

  reject(id: string): DiffServiceResult {
    const diff = this.diffs.get(id);
    if (!diff) return { ok: false, error: "diff 不存在" };
    if (diff.status !== "pending") return { ok: false, error: `diff 已经是 ${diff.status}` };
    if (!isPathInsideWorkspace(this.cwdProvider(), diff.absPath)) {
      return { ok: false, error: "diff 路径不在当前项目内" };
    }

    try {
      if (diff.before === null) {
        if (fs.existsSync(diff.absPath)) {
          if (!fs.statSync(diff.absPath).isFile()) return { ok: false, error: "拒绝失败：目标不是文件" };
          fs.unlinkSync(diff.absPath);
        }
      } else {
        fs.mkdirSync(path.dirname(diff.absPath), { recursive: true });
        fs.writeFileSync(diff.absPath, diff.before);
      }
      return this.updateStatus(id, "rejected");
    } catch (err) {
      return { ok: false, error: (err as Error).message || "拒绝失败" };
    }
  }
}

export function isPathInsideWorkspace(cwd: string, absPath: string): boolean {
  try {
    const cwdReal = fs.realpathSync.native(cwd);
    const target = realPathForComparison(absPath);
    const rel = path.relative(cwdReal, target);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function realPathForComparison(target: string): string {
  const abs = path.resolve(target);
  if (fs.existsSync(abs)) return fs.realpathSync.native(abs);

  let parent = path.dirname(abs);
  const missing = [path.basename(abs)];
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) return abs;
    missing.unshift(path.basename(parent));
    parent = next;
  }

  return path.join(fs.realpathSync.native(parent), ...missing);
}
