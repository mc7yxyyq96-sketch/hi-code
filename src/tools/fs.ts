import fs from "node:fs";
import path from "node:path";

export interface ToolContext {
  cwd: string;
  /** Confine bash file-writes to the workspace via macOS sandbox-exec. */
  sandbox?: boolean;
  /** Run bash without filesystem writes. Used by read-only reviewer agents. */
  bashMode?: "normal" | "read-only";
  /** Extra environment variable names allowed through to bash tools. */
  envAllowlist?: string[];
}

export interface ResolvedWorkspacePath {
  abs: string;
  rel: string;
}

export function resolveWorkspacePath(
  ctx: ToolContext,
  p: string,
  opts: { mustExist?: boolean; forWrite?: boolean } = {},
): ResolvedWorkspacePath | { error: string } {
  if (typeof p !== "string" || p.trim() === "") return { error: "path is required" };

  let cwdReal: string;
  try {
    cwdReal = fs.realpathSync.native(ctx.cwd);
  } catch {
    cwdReal = path.resolve(ctx.cwd);
  }

  const cwdAbs = path.resolve(ctx.cwd);
  const abs = path.resolve(path.isAbsolute(p) ? p : path.join(ctx.cwd, p));
  if (!isInside(cwdAbs, abs)) return { error: `path escapes workspace: ${p}` };

  if (fs.existsSync(abs)) {
    const real = fs.realpathSync.native(abs);
    if (!isInside(cwdReal, real)) return { error: `path escapes workspace: ${p}` };
    return { abs: real, rel: relativeDisplay(cwdReal, real) };
  }

  if (opts.mustExist) return { error: `file not found: ${p}` };
  if (!opts.forWrite) return { error: `path not found: ${p}` };

  const parent = nearestExistingParent(abs);
  if (!parent) return { error: `parent directory not found: ${p}` };
  const parentReal = fs.realpathSync.native(parent);
  if (!isInside(cwdReal, parentReal)) return { error: `path escapes workspace: ${p}` };
  return { abs, rel: relativeDisplay(cwdAbs, abs) };
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function nearestExistingParent(abs: string): string | undefined {
  let cur = path.dirname(abs);
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(cur)) return cur;
    cur = path.dirname(cur);
  }
  return fs.existsSync(cur) ? cur : undefined;
}

function relativeDisplay(root: string, p: string): string {
  return path.relative(root, p) || ".";
}

// ---------------- read_file ----------------
export function readFile(ctx: ToolContext, args: { path: string; offset?: number; limit?: number }): string {
  const resolved = resolveWorkspacePath(ctx, args.path, { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const abs = resolved.abs;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) return `Error: ${args.path} is a directory (use ls)`;
  const content = fs.readFileSync(abs, "utf8");
  const lines = content.split("\n");
  const offset = Math.max(0, (args.offset ?? 1) - 1);
  const limit = args.limit ?? 2000;
  const slice = lines.slice(offset, offset + limit);
  return slice.map((l, i) => `${String(offset + i + 1).padStart(5)}\t${l}`).join("\n");
}

// ---------------- write_file ----------------
export function writeFile(ctx: ToolContext, args: { path: string; content: string }): {
  message: string;
  oldContent: string;
  newContent: string;
  filename: string;
} | { error: string } {
  const resolved = resolveWorkspacePath(ctx, args.path, { forWrite: true });
  if ("error" in resolved) return resolved;
  const abs = resolved.abs;
  const existed = fs.existsSync(abs);
  const oldContent = existed ? fs.readFileSync(abs, "utf8") : "";
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, args.content);
  return {
    message: `${existed ? "Updated" : "Created"} ${resolved.rel} (${args.content.split("\n").length} lines)`,
    oldContent,
    newContent: args.content,
    filename: resolved.rel,
  };
}

// ---------------- edit_file ----------------
export interface EditPlan {
  absPath: string;
  oldContent: string;
  newContent: string;
  message: string;
  filename: string;
}

/** Compute an edit (exact, then fuzzy) WITHOUT writing. Used for diff preview. */
export function planEdit(
  ctx: ToolContext,
  args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): EditPlan | { error: string } {
  const resolved = resolveWorkspacePath(ctx, args.path, { mustExist: true });
  if ("error" in resolved) return resolved;
  const abs = resolved.abs;
  const oldContent = fs.readFileSync(abs, "utf8");
  if (args.old_string === args.new_string) return { error: "old_string and new_string are identical" };

  // 1. Exact match (fast path).
  if (oldContent.includes(args.old_string)) {
    const occurrences = oldContent.split(args.old_string).length - 1;
    if (occurrences > 1 && !args.replace_all) {
      return { error: `old_string is not unique (${occurrences} matches). Pass replace_all:true or add more context.` };
    }
    const newContent = args.replace_all
      ? oldContent.split(args.old_string).join(args.new_string)
      : oldContent.replace(args.old_string, args.new_string);
    return {
      absPath: abs,
      oldContent,
      newContent,
      message: `Edited ${resolved.rel} (${occurrences} replacement${occurrences > 1 ? "s" : ""})`,
      filename: resolved.rel,
    };
  }

  // 2. Fuzzy fallback: match line-by-line ignoring leading/trailing whitespace.
  //    Handles the common case where the model gets indentation slightly wrong.
  const fuzzy = fuzzyReplace(oldContent, args.old_string, args.new_string, args.replace_all === true);
  if ("error" in fuzzy) return { error: `${fuzzy.error} in ${args.path}` };
  return {
    absPath: abs,
    oldContent,
    newContent: fuzzy.newContent,
    message: `Edited ${resolved.rel} (${fuzzy.count} replacement${fuzzy.count > 1 ? "s" : ""}, fuzzy match)`,
    filename: resolved.rel,
  };
}

/** Plan + write. */
export function editFile(
  ctx: ToolContext,
  args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): EditPlan | { error: string } {
  const plan = planEdit(ctx, args);
  if ("error" in plan) return plan;
  fs.writeFileSync(plan.absPath, plan.newContent);
  return plan;
}

/**
 * Replace an indentation-insensitive block. Finds windows of file lines that
 * equal old_string's lines after trimming each line. Re-indents new_string to
 * match the indentation found at the match site.
 */
function fuzzyReplace(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { newContent: string; count: number } | { error: string } {
  const fileLines = content.split("\n");
  const oldLines = oldStr.replace(/\n$/, "").split("\n");
  const norm = (s: string) => s.trim();
  const oldNorm = oldLines.map(norm);

  const matches: number[] = [];
  for (let i = 0; i + oldLines.length <= fileLines.length; i++) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (norm(fileLines[i + j]) !== oldNorm[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }

  if (matches.length === 0) return { error: "old_string not found (even with fuzzy matching)" };
  if (matches.length > 1 && !replaceAll) {
    return { error: `old_string matches ${matches.length} places (fuzzy). Add more context or set replace_all` };
  }

  // Apply from the bottom up so earlier indices stay valid.
  const targets = (replaceAll ? matches : [matches[0]]).slice().sort((a, b) => b - a);
  let lines = fileLines;
  for (const start of targets) {
    const indent = (lines[start].match(/^\s*/) ?? [""])[0];
    const newBlock = newStr.replace(/\n$/, "").split("\n").map((l) => (l ? indent + l.replace(/^\s*/, "") : l));
    lines = [...lines.slice(0, start), ...newBlock, ...lines.slice(start + oldLines.length)];
  }
  return { newContent: lines.join("\n"), count: targets.length };
}

// ---------------- ls ----------------
export function ls(ctx: ToolContext, args: { path?: string }): string {
  const resolved = resolveWorkspacePath(ctx, args.path ?? ".", { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const abs = resolved.abs;
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const out = entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".env")
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
  return out.length ? out.join("\n") : "(empty)";
}

// ---------------- glob ----------------
export function glob(ctx: ToolContext, args: { pattern: string; path?: string }): string {
  const resolved = resolveWorkspacePath(ctx, args.path ?? ".", { mustExist: true });
  if ("error" in resolved) return `Error: ${resolved.error}`;
  const root = resolved.abs;
  const re = globToRegExp(args.pattern);
  const matches: { p: string; mtime: number }[] = [];
  const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__"]);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE.has(e.name)) continue;
        walk(full);
      } else {
        const r = path.relative(root, full);
        if (re.test(r)) {
          try {
            matches.push({ p: r, mtime: fs.statSync(full).mtimeMs });
          } catch {
            matches.push({ p: r, mtime: 0 });
          }
        }
      }
    }
  }
  walk(root);
  matches.sort((a, b) => b.mtime - a.mtime);
  if (!matches.length) return "(no matches)";
  return matches.slice(0, 200).map((m) => m.p).join("\n");
}

function globToRegExp(pattern: string): RegExp {
  // Supports **, *, ?, and {a,b} alternation — enough for everyday use.
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else if (c === ".") re += "\\.";
    else if (c === "{") re += "(";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else if ("+()|^$\\[]".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}
