#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import { loadConfig, defaultProfile, HICODE_DIR } from "./config.js";
import { ui } from "./ui.js";
import { type PermissionMode } from "./permissions.js";
import { makeCompleter } from "./completer.js";
import { initMcp } from "./mcp.js";
import { loadSession, latestSession } from "./session-store.js";
import type { StoredSession } from "./session-store.js";
import { createRuntime, buildSystemPrompt } from "./runtime.js";
import { gitInfo } from "./git.js";

async function main() {
  const cfg = loadConfig();
  const cwd = process.cwd();

  // CLI flags
  const argv = process.argv.slice(2);
  let mode: PermissionMode = "default";
  let resumeId: string | undefined;
  let resumeLatest = false;
  let forceTui = false;
  let noTui = false;
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yolo") mode = "yolo";
    else if (a === "--accept-edits") mode = "acceptEdits";
    else if (a === "--sandbox") cfg.sandbox = true;
    else if (a === "--no-sandbox") cfg.sandbox = false;
    else if (a === "--tui") forceTui = true;
    else if (a === "--no-tui") noTui = true;
    else if (a === "--continue" || a === "-c") resumeLatest = true;
    else if (a === "--resume") resumeId = argv[++i];
    else if (a === "--model" || a === "-m") defaultProfile(cfg).model = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: vibe [--yolo] [--accept-edits] [--sandbox] [-c|--continue] [--resume <id>] [-m model] [prompt...]",
      );
      process.exit(0);
    } else promptParts.push(a);
  }

  // Resume a prior session if requested.
  let restored: StoredSession | undefined;
  if (resumeId) restored = loadSession(resumeId);
  else if (resumeLatest) restored = latestSession(cwd);

  // Interactive TUI on a real TTY; readline for pipes/CI/dumb terms; neither for one-shot.
  const interactive = promptParts.length === 0;
  const useTui = interactive && (forceTui || (!noTui && Boolean(process.stdin.isTTY && process.stdout.isTTY)));

  // The TUI draws its own banner; everyone else prints it here.
  if (!useTui) {
    const def = defaultProfile(cfg);
    ui.banner();
    ui.info(`  cwd:   ${cwd}`);
    ui.info(`  model: ${chalk.bold(def.model)}  @ ${def.baseURL}`);
    const extra = Object.keys(cfg.profiles).filter((k) => k !== cfg.defaultProfile);
    if (extra.length) ui.info(`  fusion: ${extra.length + 1} model profiles loaded — /models to inspect`);
    if (cfg.sandbox) ui.info(`  sandbox: ${chalk.green("on")} (bash writes confined to workspace)`);
    if (mode !== "default") ui.warn(`  mode:  ${mode}`);
    const git = gitInfo(cwd);
    if (git) ui.info(`  git:   ${git.branch}${git.dirty ? chalk.yellow(` (${git.dirty} changed)`) : ""}`);
  }

  // Connect MCP servers (best-effort). Status is only printed outside the TUI.
  if (Object.keys(cfg.mcpServers).length) {
    const results = await initMcp(cfg.mcpServers);
    if (!useTui) {
      for (const r of results) {
        if (r.ok) ui.info(`  mcp:   ${chalk.green("✓")} ${r.server} (${r.toolCount} tools)`);
        else ui.warn(`  mcp:   ✗ ${r.server} — ${r.error}`);
      }
    }
  }

  const systemPrompt = buildSystemPrompt(cwd, defaultProfile(cfg).model, cfg.reasoningLevel);

  // One-shot mode: `vibe "do the thing"` runs once and exits. Prompts are
  // auto-denied (run with --yolo to allow mutations non-interactively).
  if (promptParts.length) {
    const rt = createRuntime({ cfg, cwd, mode, systemPrompt, restored, ask: async () => "n" });
    if (restored) ui.info(`  resumed session ${chalk.bold(restored.id)}`);
    console.log(chalk.gray("─".repeat(48)));
    await rt.handleInput(promptParts.join(" "));
    rt.shutdown();
    return;
  }

  if (useTui) {
    const { runTui } = await import("./tui.js");
    await runTui({ cfg, cwd, mode, systemPrompt, restored });
    return;
  }

  await runReadline({ cfg, cwd, mode, systemPrompt, restored });
}

/** The readline frontend (used for non-TTY input and `--no-tui`). */
async function runReadline(opts: {
  cfg: ReturnType<typeof loadConfig>;
  cwd: string;
  mode: PermissionMode;
  systemPrompt: string;
  restored?: StoredSession;
}) {
  const { cwd, restored } = opts;

  if (restored) ui.info(`  resumed session ${chalk.bold(restored.id)} (${restored.messages.length} messages)`);
  ui.info("  type /help for commands, /exit to quit");
  console.log(chalk.gray("─".repeat(48)));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.magenta("› "),
    completer: makeCompleter(cwd),
  });

  // Persistent command history (best-effort): seed readline's history newest-first.
  const historyFile = path.join(HICODE_DIR, "history");
  try {
    if (fs.existsSync(historyFile)) {
      const lines = fs.readFileSync(historyFile, "utf8").split("\n").filter(Boolean);
      (rl as any).history = lines.slice(-1000).reverse();
    }
  } catch {
    /* ignore */
  }
  const appendHistory = (line: string) => {
    try {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true, mode: 0o700 });
      fs.appendFileSync(historyFile, line + "\n", { mode: 0o600 });
    } catch {
      /* ignore */
    }
  };

  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  const rt = createRuntime({ ...opts, ask });

  rl.prompt();
  // Process input serially: readline can emit several buffered `line` events at once.
  const queue: string[] = [];
  let busy = false;
  let exitWhenIdle = false;

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      try {
        await rt.handleInput(queue.shift()!);
      } catch (e) {
        ui.error((e as Error).message);
      }
      console.log(chalk.gray("─".repeat(48)));
    }
    busy = false;
    if (exitWhenIdle) {
      rt.shutdown();
      process.exit(0);
    }
    rl.prompt();
  }

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) {
      if (!busy) rl.prompt();
      return;
    }
    appendHistory(input);
    queue.push(input);
    void pump();
  });

  rl.on("SIGINT", () => {
    if (rt.abort()) {
      ui.warn("\n  ⏹ interrupting…");
      return;
    }
    console.log();
    ui.info("  (Ctrl-C) — type /exit to quit");
    rl.prompt();
  });

  rl.on("close", () => {
    if (busy || queue.length) exitWhenIdle = true;
    else {
      rt.shutdown();
      process.exit(0);
    }
  });
}

main().catch((e) => {
  ui.error(e?.message ?? String(e));
  process.exit(1);
});
