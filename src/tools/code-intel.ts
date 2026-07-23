import fs from "node:fs";
import path from "node:path";
import { editFile, planEdit, resolveWorkspacePath, type ToolContext } from "./fs.js";

const SYMBOL_RE =
  /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

export function getFileOutline(ctx: ToolContext, args: { path: string; limit?: number }): string {
  const resolved = resolveWorkspacePath(ctx, args.path, { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const content = fs.readFileSync(resolved.abs, "utf8");
  const limit = Math.max(1, Math.min(500, Number(args.limit ?? 80)));
  const lines = content.split("\n");
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(SYMBOL_RE);
    if (!match) continue;
    hits.push(`${String(i + 1).padStart(5)}\t${match[1]}\t${lines[i].trim().slice(0, 120)}`);
    if (hits.length >= limit) break;
  }
  return hits.length ? hits.join("\n") : `(no outline symbols found in ${resolved.rel})`;
}

export function findSymbol(
  ctx: ToolContext,
  args: { name: string; path?: string; limit?: number },
): string {
  const name = String(args.name || "").trim();
  if (!name) return "Error: name is required";
  const rootResolved = resolveWorkspacePath(ctx, args.path ?? ".", { mustExist: true });
  if ("error" in rootResolved) return `Error: ${rootResolved.error}`;
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 40)));
  const needle = new RegExp(
    `(?:function|class|const|let|var|type|interface|enum)\\s+${escapeRegExp(name)}\\b`,
  );
  const hits: string[] = [];
  walk(rootResolved.abs, (file) => {
    if (hits.length >= limit) return false;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift)$/i.test(file)) return true;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return true;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!needle.test(lines[i])) continue;
      const rel = path.relative(ctx.cwd, file) || file;
      hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
      if (hits.length >= limit) break;
    }
    return hits.length < limit;
  });
  return hits.length ? hits.join("\n") : `(no symbol matches for ${name})`;
}

export function applyPatch(
  ctx: ToolContext,
  args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): { message: string; oldContent: string; newContent: string; absPath: string; filename: string } | { error: string } {
  const plan = planEdit(ctx, args);
  if ("error" in plan) return plan;
  const written = editFile(ctx, args);
  if ("error" in written) return written;
  return {
    message: written.message,
    oldContent: written.oldContent,
    newContent: written.newContent,
    absPath: written.absPath,
    filename: written.filename,
  };
}

function walk(root: string, visit: (file: string) => boolean): void {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        if (!visit(full)) return;
      }
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
