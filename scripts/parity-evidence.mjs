#!/usr/bin/env node
/**
 * Wave4 parity evidence pack: summarize backlog completion + key surface probes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backlog = JSON.parse(fs.readFileSync(path.join(root, "planning/parity-backlog.json"), "utf8"));
const items = backlog.items || [];
const complete = items.filter((i) => i.status === "complete");
const pending = items.filter((i) => i.status !== "complete");

const probes = [
  ["assistant-turn", "renderer/app/assistant-turn.js"],
  ["chat-process", "renderer/components/chat-process.js"],
  ["browser-service", "electron/services/browser-service.mjs"],
  ["automation-service", "electron/services/automation-service.mjs"],
  ["gateway-server", "services/gateway/server.mjs"],
  ["agent-modes", "src/agent-modes.ts"],
  ["headless", "src/headless.ts"],
  ["parity-theme", "renderer/parity-theme.css"],
];

const probeResults = probes.map(([name, rel]) => ({
  name,
  path: rel,
  present: fs.existsSync(path.join(root, rel)),
}));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const report = {
  generatedAt: new Date().toISOString(),
  version: pkg.version,
  backlog: {
    total: items.length,
    complete: complete.length,
    pending: pending.length,
    pendingIds: pending.map((i) => i.id),
    completionPct: items.length ? Math.round((complete.length / items.length) * 100) : 0,
  },
  probes: probeResults,
  packaging: {
    distMac: Boolean(pkg.scripts?.["dist:mac"]),
    distWin: Boolean(pkg.scripts?.["dist:win"]),
    electronBuilder: Boolean(pkg.devDependencies?.["electron-builder"] || pkg.dependencies?.["electron-builder"]),
  },
  advancedDemoted: fs.readFileSync(path.join(root, "renderer/index.html"), "utf8").includes('nav-advanced" id="industrialBtn"'),
};

const outDir = path.join(root, "reports/parity");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `evidence-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nwrote ${outFile}`);
if (probeResults.some((p) => !p.present)) process.exitCode = 1;
