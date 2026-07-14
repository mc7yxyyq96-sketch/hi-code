import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const detectorPath = path.join(root, "dist", "definition-of-done.js");

if (!fs.existsSync(detectorPath)) {
  console.error("[scan:dod] dist/definition-of-done.js is missing. Run `npm run build` first.");
  process.exit(1);
}

const { detectSkeleton } = await import(`file://${detectorPath}`);

const includeRoots = ["package.json", "electron", "renderer", "src", "docs", "reports", "scripts", "test"];
const skipDirs = new Set(["node_modules", "dist", ".git", "release", "releases", "coverage", ".next", ".turbo"]);
// Vite's ignored output contains bundled third-party code. First-party renderer
// sources remain in scope; build/package gates validate the derived bundle.
const derivedRoots = new Set(["renderer/generated"]);

function walk(relative) {
  const normalized = relative.split(path.sep).join("/");
  if ([...derivedRoots].some((root) => normalized === root || normalized.startsWith(`${root}/`))) return [];
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(absolute)
    .filter((name) => !skipDirs.has(name))
    .flatMap((name) => walk(path.join(relative, name)));
}

const changedFiles = includeRoots.flatMap(walk);
const result = detectSkeleton({
  workspacePath: root,
  changedFiles,
  persistEvidence: false,
  source: "full-tree-scan",
});

console.log(JSON.stringify({
  ok: result.ok,
  checkedAt: result.checkedAt,
  summary: result.summary,
  findings: result.findings.map((finding) => ({
    type: finding.type,
    severity: finding.severity,
    path: finding.path,
    relatedId: finding.relatedId,
    message: finding.message,
  })),
}, null, 2));

if (!result.ok) {
  process.exit(1);
}
