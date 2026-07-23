#!/usr/bin/env node
/**
 * Headless / script entry (Grok Build direction, clean-room Wave2).
 * Runs a single prompt non-interactively and prints the final assistant text.
 *
 * Usage:
 *   node dist/headless.js --cwd /path/to/project "fix the flaky test"
 *   hicode-headless --yolo "summarize README"
 */

import { loadConfig, defaultProfile } from "./config.js";
import { createRuntime, buildSystemPrompt } from "./runtime.js";
import { contentText } from "./context.js";

function parseArgs(argv: string[]) {
  let cwd = process.cwd();
  let yolo = false;
  let agentMode: "build" | "plan" | "ask" = "build";
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
      continue;
    }
    if (arg === "--yolo") {
      yolo = true;
      continue;
    }
    if ((arg === "--mode" || arg === "--agent-mode") && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === "build" || mode === "plan" || mode === "ask") agentMode = mode;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positionals.push(arg);
  }
  return { cwd, yolo, agentMode, prompt: positionals.join(" ").trim() };
}

async function main() {
  const { cwd, yolo, agentMode, prompt } = parseArgs(process.argv.slice(2));
  if (!prompt) {
    console.error("usage: headless [--cwd dir] [--yolo] [--agent-mode build|plan|ask] <prompt>");
    process.exit(2);
  }
  const cfg = loadConfig();
  const profile = defaultProfile(cfg);
  const runtime = createRuntime({
    cfg,
    cwd,
    mode: yolo ? "yolo" : "default",
    systemPrompt: buildSystemPrompt(cwd, profile.model, cfg.reasoningLevel, agentMode),
    ask: async () => "n",
    allowProcessExit: false,
  });
  runtime.execEnv.perms.agentMode = agentMode;

  await runtime.handleInput(prompt);
  const messages = runtime.session.messages || [];
  let lastAssistant = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = contentText(messages[i].content);
      break;
    }
  }
  if (lastAssistant) process.stdout.write(`${lastAssistant}\n`);
  runtime.shutdown();
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
