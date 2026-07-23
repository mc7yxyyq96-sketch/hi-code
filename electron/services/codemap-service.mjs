import fs from "node:fs";
import path from "node:path";

const IGNORE = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage",
  ".hicode", ".vibe", ".cache", "out", "vendor", "__pycache__", ".venv",
]);

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|md|json)$/i;
const SYMBOL_RE =
  /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

/**
 * Project code map scanner (clean-room Wave1).
 */
export function createCodemapService({ getCwd, maxFiles = 800, maxDepth = 6 } = {}) {
  function scan(rootInput) {
    const root = path.resolve(rootInput || (typeof getCwd === "function" ? getCwd() : "") || process.cwd());
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { ok: false, error: "workspace not found", root };
    }

    const files = [];
    const dirs = [];
    const symbols = [];
    const extCounts = {};

    function walk(dir, depth) {
      if (depth > maxDepth || files.length >= maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".github") continue;
        if (IGNORE.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(root, abs) || entry.name;
        if (entry.isDirectory()) {
          dirs.push(rel);
          walk(abs, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        files.push(rel);
        const ext = path.extname(entry.name).toLowerCase() || "(none)";
        extCounts[ext] = (extCounts[ext] || 0) + 1;
        if (CODE_EXT.test(entry.name) && symbols.length < 200) {
          collectSymbols(abs, rel, symbols);
        }
        if (files.length >= maxFiles) return;
      }
    }

    walk(root, 0);
    return {
      ok: true,
      root,
      summary: {
        fileCount: files.length,
        dirCount: dirs.length,
        symbolCount: symbols.length,
        truncated: files.length >= maxFiles,
        topExtensions: Object.entries(extCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([ext, count]) => ({ ext, count })),
      },
      tree: buildTree(files),
      symbols: symbols.slice(0, 120),
      files: files.slice(0, 200),
    };
  }

  function collectSymbols(abs, rel, out) {
    let text = "";
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 400_000) return;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    let hit = 0;
    for (let i = 0; i < lines.length && hit < 12; i++) {
      const match = lines[i].match(SYMBOL_RE);
      if (!match) continue;
      out.push({ path: rel, line: i + 1, name: match[1], kind: guessKind(lines[i]) });
      hit += 1;
    }
  }

  function guessKind(line) {
    if (/\bclass\b/.test(line)) return "class";
    if (/\binterface\b|\btype\b|\benum\b/.test(line)) return "type";
    if (/\bfunction\b/.test(line)) return "function";
    return "value";
  }

  function buildTree(filePaths) {
    const root = { type: "dir", name: ".", children: [] };
    const dirMap = new Map([["", root]]);

    function ensureDir(relDir) {
      if (dirMap.has(relDir)) return dirMap.get(relDir);
      const parts = relDir.split(/[\\/]/).filter(Boolean);
      let parentRel = "";
      let node = root;
      for (const part of parts) {
        const nextRel = parentRel ? `${parentRel}/${part}` : part;
        if (!dirMap.has(nextRel)) {
          const child = { type: "dir", name: part, children: [] };
          node.children.push(child);
          dirMap.set(nextRel, child);
        }
        node = dirMap.get(nextRel);
        parentRel = nextRel;
      }
      return node;
    }

    for (const rel of filePaths) {
      const parts = rel.split(/[\\/]/).filter(Boolean);
      const fileName = parts.pop();
      const dirNode = ensureDir(parts.join("/"));
      dirNode.children.push({ type: "file", name: fileName, path: rel });
    }

    function sortNode(node) {
      if (!node.children) return node;
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const child of node.children) {
        if (child.type === "dir") sortNode(child);
      }
      return node;
    }

    return sortNode(root);
  }

  return { scan };
}

export function registerCodemapIpc({ register, codemap }) {
  if (!register || !codemap) throw new Error("registerCodemapIpc requires register + codemap");
  register("codemap:scan", async (_e, payload = {}) => codemap.scan(payload?.cwd));
}
