import fs from "node:fs";
import path from "node:path";
import { HICODE_DIR } from "../../dist/config.js";
import { formatDuration, getUsageStats, recordUsage } from "../../dist/usage-store.js";

const REASONING_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  ultra: "超高",
};

export function createUsageService({ logDir }) {
  return {
    getStats() {
      const stats = getUsageStats();
      const logMeta = scanLogMeta(logDir);
      stats.topTools = logMeta.topTools;
      if (logMeta.longestTaskMs > stats.longestTaskMs) {
        stats.longestTaskMs = logMeta.longestTaskMs;
        stats.formatted.longestTask = formatDuration(logMeta.longestTaskMs);
      }
      if (!stats.reasoningBreakdown.length) {
        const level = readConfigReasoningLevel();
        if (level) stats.currentReasoningLabel = `${REASONING_LABELS[level] || level} · 当前配置`;
      }
      return stats;
    },

    recordTurn(input = {}) {
      recordUsage({
        promptTokens: Number(input.promptTokens) || 0,
        completionTokens: Number(input.completionTokens) || 0,
        model: typeof input.model === "string" ? input.model : undefined,
        reasoningLevel: typeof input.reasoningLevel === "string" ? input.reasoningLevel : undefined,
        durationMs: Number(input.durationMs) || 0,
      });
      return { ok: true };
    },
  };
}

export function registerUsageIpc({ register, usage }) {
  if (!register) throw new Error("registerUsageIpc requires register");
  if (!usage) throw new Error("registerUsageIpc requires usage service");
  register.handle("usage:stats", () => usage.getStats());
}

function readConfigReasoningLevel() {
  try {
    const raw = fs.readFileSync(path.join(HICODE_DIR, "config.json"), "utf8");
    const config = JSON.parse(raw);
    return typeof config?.reasoningLevel === "string" ? config.reasoningLevel : "";
  } catch {
    return "";
  }
}

function scanLogMeta(logDir) {
  const toolCounts = new Map();
  let longestTaskMs = 0;
  if (!logDir || !fs.existsSync(logDir)) {
    return { topTools: [], longestTaskMs: 0 };
  }

  let files = [];
  try {
    files = fs.readdirSync(logDir).filter((name) => name.startsWith("events-") && name.endsWith(".jsonl"));
  } catch {
    return { topTools: [], longestTaskMs: 0 };
  }
  files.sort();
  files = files.slice(-120);

  for (const name of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(logDir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event?.type === "tool:start" && event.tool) {
          const tool = String(event.tool);
          toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
        }
        if (event?.type === "turn:done") {
          const durationMs = Number(event.payload?.durationMs) || 0;
          if (durationMs > longestTaskMs) longestTaskMs = durationMs;
        }
      } catch {
        /* ignore bad log lines */
      }
    }
  }

  const topTools = [...toolCounts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { topTools, longestTaskMs };
}
