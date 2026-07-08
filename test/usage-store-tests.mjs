import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}  ${detail}`);
    fail++;
  }
}

console.log("\n[usage] ledger persistence");
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "hicode-usage-home-"));
const prevHome = process.env.HOME;
process.env.HOME = tmpHome;

const { formatTokenCount, formatDuration, recordUsage, getUsageStats } = await import("../dist/usage-store.js");

console.log("\n[usage] formatting");
check("formatTokenCount uses K suffix", formatTokenCount(12_400) === "12.4K");
check("formatTokenCount uses M suffix", formatTokenCount(2_500_000) === "2.5M");
check("formatTokenCount uses B suffix", formatTokenCount(3_000_000_000) === "3B");
check("formatDuration renders hours", formatDuration(41 * 60 * 60 * 1000 + 35 * 60 * 1000) === "41h 35m");
check("formatDuration renders minutes", formatDuration(90_000) === "1m 30s");

recordUsage({ promptTokens: 1200, completionTokens: 300, model: "deepseek-chat", reasoningLevel: "high" });
recordUsage({ promptTokens: 800, completionTokens: 200, model: "deepseek-chat", reasoningLevel: "medium" });
recordUsage({ durationMs: 5 * 60 * 1000 });

const stats = getUsageStats();
check("recordUsage aggregates lifetime tokens", stats.lifetimeTokens === 2500, String(stats.lifetimeTokens));
check("recordUsage tracks turns", stats.totalTurns === 2, String(stats.totalTurns));
check("recordUsage tracks longest task duration", stats.longestTaskMs === 5 * 60 * 1000, String(stats.longestTaskMs));
check("getUsageStats returns heatmap cells", Array.isArray(stats.heatmap) && stats.heatmap.length > 300, String(stats.heatmap?.length));
check("getUsageStats aggregates top models", stats.topModels[0]?.model === "deepseek-chat" && stats.topModels[0]?.tokens === 2500);
check("getUsageStats aggregates reasoning levels", stats.reasoningBreakdown.some((row) => row.level === "high"));

if (prevHome === undefined) delete process.env.HOME;
else process.env.HOME = prevHome;
fs.rmSync(tmpHome, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
