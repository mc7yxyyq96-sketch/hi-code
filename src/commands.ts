import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { VibeConfig } from "./config.js";
import { saveModel, defaultProfile, getProfile } from "./config.js";
import { ui } from "./ui.js";
import { type Session, newSession, fullHistory, estimateTokens, compact } from "./context.js";
import type { PermissionState } from "./permissions.js";
import { TOOL_SCHEMAS, type ExecEnv } from "./tools/index.js";
import { roleList } from "./agents/roles.js";
import { runTeam, spawnAgent } from "./agents/subagent.js";
import { runCouncil, runDebate } from "./agents/council.js";
import { runBuild } from "./agents/manager.js";
import { gitDiff } from "./git.js";
import { listSessions, loadSession, replaySessionMessages, type StoredSession, type SessionDisplayMessage } from "./session-store.js";
import { mcpStatus } from "./mcp.js";

/** All user-facing slash commands, for tab-completion. */
export const COMMAND_NAMES = [
  "help", "clear", "compact", "undo", "diff",
  "team", "build", "agent", "agents", "council", "debate",
  "models", "model", "mode", "yolo",
  "sessions", "resume", "mcp", "sandbox",
  "cost", "tools", "init", "cwd", "exit",
].map((c) => "/" + c);

export interface CommandEnv {
  cfg: VibeConfig;
  session: Session;
  perms: PermissionState;
  systemPrompt: string;
  cwd: string;
  execEnv: ExecEnv;
  sessionId: string;
  /** Whether slash commands may terminate the current Node process. Disabled for Electron. */
  allowProcessExit?: boolean;
  /** Load a saved session into the active runtime, updating the runtime session id as well as messages. */
  resumeStoredSession?: (id: string) => StoredSession | undefined;
  /** Revert the file changes made during the last turn. */
  undo: () => string;
}

/** Returns true if input was a slash command (and was handled). */
export async function handleCommand(input: string, env: CommandEnv): Promise<boolean> {
  if (!input.startsWith("/")) return false;
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd) {
    case "help":
      printHelp();
      return true;

    case "clear":
    case "reset": {
      const fresh = newSession(env.systemPrompt);
      env.session.messages = fresh.messages;
      env.session.totalPromptTokens = 0;
      env.session.totalCompletionTokens = 0;
      ui.info("  cleared conversation history");
      return true;
    }

    case "compact": {
      const removed = await compact(defaultProfile(env.cfg), env.session).catch((e) => {
        ui.error((e as Error).message);
        return 0;
      });
      ui.info(`  compacted ${removed} messages`);
      return true;
    }

    case "model": {
      const def = defaultProfile(env.cfg);
      if (!arg) {
        ui.info(`  current model: ${chalk.bold(def.model)}`);
        ui.info(`  endpoint: ${def.baseURL}`);
        ui.info("  usage: /model <name>  (changes the default profile)");
      } else {
        def.model = arg;
        saveModel(arg, env.cfg.defaultProfile);
        ui.info(`  switched default model to ${chalk.bold(arg)} (saved)`);
      }
      return true;
    }

    case "models": {
      ui.info("  model profiles:");
      for (const [k, p] of Object.entries(env.cfg.profiles)) {
        const star = k === env.cfg.defaultProfile ? chalk.green(" ★default") : "";
        console.log(`    ${chalk.cyan(k.padEnd(12))} ${chalk.bold(p.model)} ${chalk.gray("@ " + p.baseURL)}${star}`);
      }
      ui.info("  role → model:");
      const roles = ["architect", "coder", "reviewer", "tester", "explorer"];
      for (const r of roles) {
        const key = env.cfg.roleModels[r] ?? env.cfg.defaultProfile;
        console.log(`    ${chalk.cyan(r.padEnd(12))} ${chalk.bold(getProfile(env.cfg, key).model)} ${chalk.gray("(" + key + ")")}`);
      }
      ui.info(`  council: ${env.cfg.councilMembers.join(", ")}  →  synth: ${env.cfg.councilSynthesizer}`);
      return true;
    }

    case "council": {
      if (!arg) {
        ui.warn("  usage: /council <question>   (all member models answer, then one synthesizes)");
        return true;
      }
      await runCouncil(env.cfg, arg).catch((e) => ui.error((e as Error).message));
      return true;
    }

    case "cost": {
      const s = env.session;
      ui.info(`  prompt tokens:     ${s.totalPromptTokens}`);
      ui.info(`  completion tokens: ${s.totalCompletionTokens}`);
      ui.info(
        `  context now:       ~${estimateTokens(fullHistory(s))} / ${defaultProfile(env.cfg).contextWindow}`,
      );
      return true;
    }

    case "tools": {
      ui.info("  available tools:");
      for (const t of TOOL_SCHEMAS) {
        console.log("    " + chalk.cyan(t.function.name.padEnd(12)) + chalk.gray(t.function.description));
      }
      return true;
    }

    case "mode": {
      if (arg === "default" || arg === "acceptEdits" || arg === "yolo") {
        env.perms.mode = arg;
        ui.info(`  permission mode → ${chalk.bold(arg)}`);
      } else {
        ui.info(`  current mode: ${chalk.bold(env.perms.mode)}  (default | acceptEdits | yolo)`);
      }
      return true;
    }

    case "yolo": {
      env.perms.mode = env.perms.mode === "yolo" ? "default" : "yolo";
      ui.info(`  permission mode → ${chalk.bold(env.perms.mode)}`);
      return true;
    }

    case "team": {
      if (!arg) {
        ui.warn("  usage: /team <goal>   e.g. /team add a --json flag to the CLI and test it");
        return true;
      }
      await runTeam(env.cfg, env.execEnv, arg).catch((e) => ui.error((e as Error).message));
      return true;
    }

    case "build": {
      if (!arg) {
        ui.warn("  usage: /build <goal>   (manager decomposes into a task graph; runs in parallel under /yolo)");
        return true;
      }
      await runBuild(env.cfg, env.execEnv, arg).catch((e) => ui.error((e as Error).message));
      return true;
    }

    case "debate": {
      if (!arg) {
        ui.warn("  usage: /debate <question> [rounds]   (models critique each other, then a verdict)");
        return true;
      }
      // Allow a trailing integer to set the number of rounds.
      const m = arg.match(/\s+(\d)\s*$/);
      const rounds = m ? Math.min(4, Math.max(1, Number(m[1]))) : 2;
      const question = m ? arg.slice(0, m.index).trim() : arg;
      await runDebate(env.cfg, env.execEnv, question, rounds).catch((e) => ui.error((e as Error).message));
      return true;
    }

    case "agent": {
      const role = rest[0];
      const task = rest.slice(1).join(" ");
      if (!role || !task) {
        ui.warn("  usage: /agent <role> <task>   roles: architect coder reviewer tester explorer");
        return true;
      }
      await spawnAgent(env.execEnv, role, task).catch((e) => ui.error((e as Error).message));
      return true;
    }

    case "agents": {
      ui.info("  team roles:");
      for (const line of roleList().split("\n")) console.log("    " + chalk.cyan(line));
      return true;
    }

    case "sandbox": {
      if (arg === "on") env.execEnv.ctx.sandbox = true;
      else if (arg === "off") env.execEnv.ctx.sandbox = false;
      else env.execEnv.ctx.sandbox = !env.execEnv.ctx.sandbox;
      ui.info(`  bash sandbox → ${chalk.bold(env.execEnv.ctx.sandbox ? "on" : "off")}`);
      if (env.execEnv.ctx.sandbox && process.platform !== "darwin")
        ui.warn("  (sandbox only enforced on macOS; ignored on this platform)");
      return true;
    }

    case "mcp": {
      const servers = mcpStatus();
      if (!servers.length) {
        ui.info("  no MCP servers connected (configure mcpServers in ~/.hicode/config.json)");
        return true;
      }
      for (const s of servers) {
        ui.info(`  ${chalk.bold(s.server)} — ${s.tools.length} tools`);
        console.log("    " + chalk.gray(s.tools.join(", ")));
      }
      return true;
    }

    case "sessions": {
      const list = listSessions(env.cwd).slice(0, 12);
      if (!list.length) {
        ui.info("  no saved sessions for this directory");
        return true;
      }
      ui.info("  recent sessions (this directory):");
      for (const s of list) {
        const when = new Date(s.updatedAt).toLocaleString();
        const cur = s.id === env.sessionId ? chalk.green(" ←current") : "";
        const count = s.replayOnly ? `${s.eventCount ?? 0}evt` : `${s.messageCount}msg`;
        const mode = s.replayOnly ? chalk.magenta(" replay") : "";
        console.log(
          `    ${chalk.yellow(s.id)}  ${chalk.gray(when)}  ${chalk.gray(count)}${mode}  ${s.firstPrompt}${cur}`,
        );
      }
      ui.info("  resume with: /resume <id>   (event-only sessions open as read-only replay)");
      return true;
    }

    case "resume": {
      if (!arg) {
        // No id → just list.
        return handleCommand("/sessions", env);
      }
      const stored = env.resumeStoredSession ? env.resumeStoredSession(arg) : loadSession(arg);
      if (stored) {
        if (!env.resumeStoredSession) {
          env.session.messages = stored.messages;
          env.session.totalPromptTokens = stored.totalPromptTokens;
          env.session.totalCompletionTokens = stored.totalCompletionTokens;
        }
        ui.info(`  resumed ${chalk.bold(stored.id)} (${stored.messages.length} messages)`);
        return true;
      }
      const replayMeta = listSessions(env.cwd).find((session) => session.id === arg && session.replayOnly);
      if (replayMeta) {
        const messages = replaySessionMessages(arg);
        ui.warn(`  ${arg} is event-only; opening read-only replay instead of continuing context.`);
        printReplayTranscript(messages);
        ui.info("  To continue, copy the relevant replay summary into a new prompt.");
        return true;
      }
      ui.warn(`  no session found with id ${arg}`);
      return true;
    }

    case "undo": {
      ui.info("  " + env.undo());
      return true;
    }

    case "diff": {
      const out = gitDiff(env.cwd, arg === "staged" || arg === "--staged");
      console.log(out);
      return true;
    }

    case "init": {
      writeAgentsMd(env.cwd);
      return true;
    }

    case "cwd":
      ui.info(`  ${env.cwd}`);
      return true;

    case "exit":
    case "quit":
      ui.info("  bye 👋");
      if (env.allowProcessExit === false) {
        ui.info("  桌面端已忽略 /exit。请关闭窗口或使用系统菜单退出 Hi Code。");
        return true;
      }
      process.exit(0);

    default:
      ui.warn(`  unknown command: /${cmd} (try /help)`);
      return true;
  }
}

function printReplayTranscript(messages: SessionDisplayMessage[]): void {
  if (!messages.length) {
    ui.warn("  replay is empty");
    return;
  }
  for (const message of messages) {
    const label = message.role === "user" ? chalk.cyan("user") : chalk.green("assistant");
    const text = message.text.split(/\r?\n/).map((line) => `      ${line}`).join("\n");
    console.log(`    ${label}`);
    console.log(text);
  }
}

function printHelp() {
  const rows: [string, string][] = [
    ["/help", "show this help"],
    ["/clear", "clear conversation history"],
    ["/compact", "summarize & shrink the context now"],
    ["/team <goal>", "run the fixed AI team (architect→coder→reviewer)"],
    ["/build <goal>", "manager decomposes into a task graph, runs in parallel"],
    ["/agent <role> <task>", "delegate one task to a single teammate"],
    ["/agents", "list the available team roles"],
    ["/council <question>", "multiple models answer + one synthesizes (fusion)"],
    ["/debate <q> [rounds]", "models critique each other across rounds, then verdict"],
    ["/models", "show model profiles & role→model assignments"],
    ["/model [name]", "show or switch the default model"],
    ["/undo", "revert file changes from the last turn"],
    ["/diff [staged]", "show the git working-tree diff"],
    ["/sessions", "list saved sessions for this directory"],
    ["/resume [id]", "resume a saved session (list if no id)"],
    ["/mcp", "list connected MCP servers & their tools"],
    ["/sandbox [on|off]", "toggle bash sandbox (macOS write-confinement)"],
    ["/mode [m]", "permission mode: default | acceptEdits | yolo"],
    ["/yolo", "toggle yolo (auto-approve everything)"],
    ["/cost", "token usage this session"],
    ["/tools", "list available tools"],
    ["/init", "scan repo & write AGENTS.md"],
    ["/cwd", "print working directory"],
    ["/exit", "quit"],
  ];
  console.log();
  for (const [c, d] of rows) console.log("  " + chalk.cyan(c.padEnd(16)) + chalk.gray(d));
  console.log("  " + chalk.gray("Esc/Ctrl-C during a run cancels; type normally to chat."));
}

function writeAgentsMd(cwd: string) {
  const p = path.join(cwd, "AGENTS.md");
  if (fs.existsSync(p)) {
    ui.warn("  AGENTS.md already exists — leaving it untouched");
    return;
  }
  const files = fs.readdirSync(cwd).filter((f) => !f.startsWith(".")).slice(0, 40);
  const content = `# AGENTS.md

Project notes for the vibe coding agent.

## Overview
(describe what this project does)

## Layout
${files.map((f) => `- ${f}`).join("\n")}

## Conventions
- (build/test commands, style notes, gotchas)
`;
  fs.writeFileSync(p, content);
  ui.info("  wrote AGENTS.md — edit it to teach the agent about this repo");
}
