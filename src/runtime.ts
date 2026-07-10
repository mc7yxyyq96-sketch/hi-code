import fs from "node:fs";
import path from "node:path";
import type { VibeConfig } from "./config.js";
import { defaultProfile } from "./config.js";
import { type Session, newSession, contentText } from "./context.js";
import { newPermissionState, requestPermission, type PermissionMode, type AskFn } from "./permissions.js";
import { type ExecEnv } from "./tools/index.js";
import { runBash, type BashOutputStream } from "./tools/bash.js";
import { resolveWorkspacePath } from "./tools/fs.js";
import { runTurn } from "./agent.js";
import type { ContentPart } from "./llm.js";
import { handleCommand, type CommandEnv } from "./commands.js";
import { saveSession, loadSession, newSessionId, type StoredSession } from "./session-store.js";
import { shutdownMcp } from "./mcp.js";
import { gitInfo } from "./git.js";
import type {
  RuntimeEventDraft,
  RuntimeEventEnvelope,
  RuntimeEventSink,
  ToolEventStatus,
} from "./events.js";
import { createRuntimeProtocolEvent } from "./runtime-protocol.js";
import { appendRuntimeProtocolEvent, readRuntimeProtocolEvents } from "./runtime-event-store.js";

/** System prompt for the agent, including project notes and git status. */
export function buildSystemPrompt(cwd: string, model?: string, reasoningLevel: VibeConfig["reasoningLevel"] = "medium"): string {
  let projectNotes = "";
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      projectNotes += `\n\n# ${name}\n` + fs.readFileSync(p, "utf8").slice(0, 4000);
      break;
    }
  }
  const git = gitInfo(cwd);
  const gitLine = git ? `\nGit: branch ${git.branch}, ${git.dirty} uncommitted change(s)` : "";
  const modelLine = model
    ? `\nYou are Hi Code, and your underlying model is "${model}" (served via an OpenAI-compatible endpoint). If the user asks what model you are, answer truthfully that you are Hi Code running on ${model} — do NOT claim to be Claude, GPT, or any other model.`
    : "";
  const reasoningLine = reasoningInstruction(reasoningLevel);
  return `You are Hi Code, an interactive software-engineering agent. You help the user with coding tasks, in the spirit of a pair programmer.${modelLine}

Working directory: ${cwd}
Platform: ${process.platform}${gitLine}

# How you work
- You have tools: read_file, write_file, edit_file, ls, glob, grep, bash. Use them to actually inspect and change the codebase — never guess at file contents.
- On macOS, if the user asks to open or launch a local app, use bash with open -a "<App Name>" when appropriate instead of refusing.
- You can also delegate with spawn_agent(role, task) to a specialist teammate (architect/coder/reviewer/tester/explorer) that runs autonomously and reports back.
- Prefer edit_file for small changes and write_file for new files. Always read a file before editing it.
- Run tests/builds with bash to verify your work when relevant.
- Be concise. Explain what you're doing in a sentence, not paragraphs. Let the tool calls and diffs speak.
- When a task is done, stop. Match the existing code style.
${reasoningLine}

# Safety
- write_file, edit_file and bash require user confirmation; that's handled by the app. Just call them.
- Never run destructive commands (rm -rf, force pushes) without the user clearly asking.${projectNotes}`;
}

function reasoningInstruction(level: VibeConfig["reasoningLevel"]): string {
  if (level === "low") return "- Reasoning level: low. Favor speed and direct edits for simple tasks.";
  if (level === "high") return "- Reasoning level: high. Inspect more context, compare alternatives, and verify carefully before finishing.";
  if (level === "ultra") return "- Reasoning level: ultra. Use the deepest planning and verification appropriate for complex, multi-file tasks.";
  return "- Reasoning level: medium. Balance speed with enough investigation to avoid avoidable mistakes.";
}

export interface RuntimeOpts {
  cfg: VibeConfig;
  cwd: string;
  mode: PermissionMode;
  systemPrompt: string;
  ask: AskFn;
  restored?: StoredSession;
  /** Primary structured event destination for desktop, CLI, TUI, and SDK clients. */
  eventSink?: RuntimeEventSink;
  /** @deprecated Compatibility callback; migrate clients to eventSink. */
  emitEvent?: (event: RuntimeEventDraft & { sessionId: string; turnId: string }) => string | void;
  /** Keep direct terminal assistant rendering while clients migrate to eventSink. */
  legacyAssistantOutput?: boolean;
  allowProcessExit?: boolean;
  persistRuntimeEvents?: boolean;
}

export interface Runtime {
  cfg: VibeConfig;
  session: Session;
  execEnv: ExecEnv;
  cmdEnv: CommandEnv;
  sessionId: string;
  /** Run one line of input: `!shell`, `/command`, or a model turn. */
  handleInput: (input: string) => Promise<void>;
  /** Cancel an in-flight turn. Returns true if something was aborted. */
  abort: () => boolean;
  isBusy: () => boolean;
  /** Apply a new model config without discarding the active conversation. */
  updateConfig: (cfg: VibeConfig, systemPrompt: string) => void;
  shutdown: () => void;
  /** Start a fresh empty conversation without reusing the previous session id. */
  startNewSession: () => { sessionId: string };
  /** Load a saved session into the runtime (no output) and return its messages for display. */
  resume: (id: string) => { role: string; text: string }[];
}

/** Build the shared session runtime used by both the readline and Ink frontends. */
export function createRuntime(opts: RuntimeOpts): Runtime {
  const { cfg, cwd, mode, systemPrompt, ask, restored } = opts;

  const session = newSession(systemPrompt);
  const perms = newPermissionState(mode);
  let sessionId = restored?.id ?? newSessionId();
  if (restored) {
    session.messages = restored.messages;
    session.totalPromptTokens = restored.totalPromptTokens;
    session.totalCompletionTokens = restored.totalCompletionTokens;
  }

  // Undo journal: each turn's file mutations are captured so /undo can revert them.
  type Change = { file: string; before: string | null; diffId?: string };
  const undoStack: Change[][] = [];
  let turnChanges: Change[] = [];
  let protocolSequence = lastProtocolSequenceForSession(sessionId);
  let turnSeq = protocolSequence;
  let currentTurnId = `${sessionId}-turn-${turnSeq}`;

  const emitRuntimeEvent = (event: RuntimeEventDraft): string | void => {
    const turnId = event.turnId ?? currentTurnId;
    const protocolPayload = {
      ...(event.payload || {}),
      runtimeContext: {
        cwd,
        model: defaultProfile(cfg).model,
      },
    };
    const runtimeProtocol = createRuntimeProtocolEvent(
      {
        ...event,
        payload: protocolPayload,
        sessionId,
        turnId,
      },
      { sequence: ++protocolSequence },
    );
    if (opts.persistRuntimeEvents !== false) {
      const stored = appendRuntimeProtocolEvent(runtimeProtocol);
      if (!stored.ok && process.env.VIBE_DEBUG) console.error(`[hicode] runtime event persistence failed: ${stored.error}`);
    }
    const envelope: RuntimeEventEnvelope = {
      ...event,
      id: runtimeProtocol.id,
      createdAt: runtimeProtocol.createdAt,
      payload: {
        ...(event.payload || {}),
        runtimeProtocol,
      },
      sessionId,
      turnId,
    };
    const sinkResult = safelyDispatchRuntimeEvent(() => opts.eventSink?.emit(envelope));
    const legacyResult = safelyDispatchRuntimeEvent(() => opts.emitEvent?.(envelope));
    return sinkResult ?? legacyResult ?? envelope.id;
  };

  const execEnv: ExecEnv = {
    cfg,
    ctx: { cwd, sandbox: cfg.sandbox },
    perms,
    ask,
    depth: 0,
    sessionId,
    turnId: currentTurnId,
    legacyAssistantOutput: opts.legacyAssistantOutput !== false,
    emitEvent: emitRuntimeEvent,
    recordChange: (file, before, diffId) => turnChanges.push({ file, before, diffId }),
  };

  const persist = () => saveSession(sessionId, cwd, defaultProfile(cfg).model, session);

  const undo = (): string => {
    const batch = undoStack.pop();
    if (!batch) return "nothing to undo";
    let restoredCount = 0;
    for (const c of batch) {
      try {
        if (c.before === null) {
          if (fs.existsSync(c.file)) fs.unlinkSync(c.file);
        } else {
          fs.writeFileSync(c.file, c.before);
        }
        restoredCount++;
        if (c.diffId) {
          emitRuntimeEvent({
            type: "diff:updated",
            tool: "undo",
            title: `Undid ${path.basename(c.file)}`,
            summary: c.file,
            status: "done",
            path: c.file,
            diffId: c.diffId,
            payload: { diffId: c.diffId, status: "undone" },
          });
        }
      } catch {
        /* skip files that can't be restored */
      }
    }
    return `reverted ${restoredCount} file change${restoredCount === 1 ? "" : "s"} from the last turn`;
  };

  let cmdEnv: CommandEnv;

  function loadStoredSessionIntoRuntime(id: string): StoredSession | undefined {
    const stored = loadSession(id);
    if (!stored) return undefined;
    session.messages = stored.messages;
    session.totalPromptTokens = stored.totalPromptTokens;
    session.totalCompletionTokens = stored.totalCompletionTokens;
    sessionId = id;
    protocolSequence = lastProtocolSequenceForSession(sessionId);
    turnSeq = protocolSequence;
    currentTurnId = `${sessionId}-turn-${turnSeq}`;
    execEnv.sessionId = sessionId;
    execEnv.turnId = currentTurnId;
    if (cmdEnv) cmdEnv.sessionId = sessionId;
    return stored;
  }

  cmdEnv = {
    cfg,
    session,
    perms,
    systemPrompt,
    cwd,
    execEnv,
    sessionId,
    allowProcessExit: opts.allowProcessExit !== false,
    resumeStoredSession: loadStoredSessionIntoRuntime,
    undo,
  };

  let busy = false;
  let currentAbort: AbortController | null = null;

  function startAbortableWork(): AbortController {
    const controller = new AbortController();
    currentAbort = controller;
    execEnv.signal = controller.signal;
    busy = true;
    return controller;
  }

  function finishAbortableWork(controller: AbortController): void {
    if (currentAbort === controller) currentAbort = null;
    if (execEnv.signal === controller.signal) execEnv.signal = undefined;
    busy = false;
  }

  function beginTurn(): void {
    currentTurnId = `${sessionId}-turn-${++turnSeq}`;
    execEnv.sessionId = sessionId;
    execEnv.turnId = currentTurnId;
    cmdEnv.sessionId = sessionId;
  }

  function turnTitle(input: string): string {
    if (input.startsWith("!")) return "Shell command";
    if (input.startsWith("/")) return "Command";
    return "Agent turn";
  }

  function summarizeInput(input: string): string {
    const text = input.replace(/\s+/g, " ").trim();
    return text.length > 180 ? text.slice(0, 177) + "..." : text || "(empty)";
  }

  function retryInput(input: string): string {
    return input.length > 5000 ? input.slice(0, 5000) : input;
  }

  function emitBashOutput(parentId: string | void, title: string): (chunk: string, stream: BashOutputStream) => void {
    let sequence = 0;
    return (chunk, stream) => {
      const summary = summarizeOutputChunk(chunk);
      if (!summary) return;
      emitRuntimeEvent({
        type: "tool:output",
        tool: "bash",
        title,
        summary,
        status: "running",
        payload: {
          parentId,
          stream,
          chunk: chunk.length > 2000 ? chunk.slice(-2000) : chunk,
          sequence: ++sequence,
        },
      });
    };
  }

  function summarizeOutputChunk(chunk: string): string {
    const lines = chunk.replace(/\r/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
    const text = lines.at(-1) ?? chunk.trim();
    return text.length > 120 ? text.slice(0, 117) + "..." : text;
  }

  async function handleInput(input: string): Promise<void> {
    beginTurn();
    turnChanges = [];
    const turnStartedAt = Date.now();
    const turnStartId = emitRuntimeEvent({
      type: "turn:start",
      tool: "agent",
      title: turnTitle(input),
      summary: summarizeInput(input),
      status: "running",
      payload: { input: summarizeInput(input), retryInput: retryInput(input), startedAt: turnStartedAt },
    });
    let finalStatus: ToolEventStatus = "done";
    let finalSummary = "done";

    try {
      if (input.startsWith("!")) {
        const command = input.slice(1);
        const title = `Run ${command.slice(0, 80) || "bash"}`;
        const startId = emitRuntimeEvent({
          type: "tool:start",
          tool: "bash",
          title,
          summary: command,
          status: "running",
          payload: { command, startedAt: Date.now() },
        });
        emitRuntimeEvent({
          type: "permission:requested",
          tool: "bash",
          title: "Permission required",
          summary: `bash: ${command}`,
          status: "waiting",
          payload: { action: `bash: ${command}` },
        });
        const decision = await requestPermission(
          perms,
          { tool: "bash", action: `bash: ${command}`, mutating: true },
          ask,
        );
        if (decision === "deny") {
          finalStatus = "denied";
          finalSummary = "permission denied";
          emitRuntimeEvent({
            type: "tool:done",
            tool: "bash",
            title,
            summary: "denied",
            status: "denied",
            payload: { parentId: startId, durationMs: Date.now() - turnStartedAt },
          });
          console.log("Denied by user.");
          return;
        }
        const controller = startAbortableWork();
        let res: Awaited<ReturnType<typeof runBash>>;
        try {
          res = await runBash(
            { cwd, sandbox: cfg.sandbox },
            { command },
            controller.signal,
            emitBashOutput(startId, title),
          );
        } finally {
          finishAbortableWork(controller);
        }
        if (controller.signal.aborted || res.exitCode === 130) {
          finalStatus = "interrupted";
          finalSummary = "interrupted";
        } else if (res.exitCode !== 0) {
          finalStatus = "error";
          finalSummary = `exit ${res.exitCode}`;
        }
        emitRuntimeEvent({
          type: "tool:done",
          tool: "bash",
          title,
          summary: res.exitCode === 0 ? "ok" : `exit ${res.exitCode}`,
          status: res.exitCode === 0 ? "done" : res.exitCode === 130 ? "interrupted" : "error",
          payload: { parentId: startId, exitCode: res.exitCode, durationMs: Date.now() - turnStartedAt },
        });
        console.log(res.output);
        return;
      }

      const handled = await handleCommand(input, cmdEnv);
      if (handled) {
        finalSummary = "command handled";
        return;
      }

      const content = buildUserContent(input, cwd);
      const controller = startAbortableWork();
      try {
        await runTurn(cfg, session, execEnv, content, controller.signal, persist);
      } finally {
        finishAbortableWork(controller);
      }
      if (controller.signal.aborted) {
        finalStatus = "interrupted";
        finalSummary = "interrupted";
      } else {
        finalSummary = turnChanges.length ? `${turnChanges.length} file change${turnChanges.length === 1 ? "" : "s"}` : "done";
      }
      if (turnChanges.length) undoStack.push(turnChanges);
      persist();
    } catch (err) {
      finalStatus = "error";
      finalSummary = (err as Error).message || "error";
      throw err;
    } finally {
      emitRuntimeEvent({
        type: "turn:done",
        tool: "agent",
        title: finalStatus === "done" ? "Turn completed" : finalStatus === "interrupted" ? "Turn interrupted" : "Turn failed",
        summary: finalSummary,
        status: finalStatus,
        payload: {
          parentId: turnStartId,
          durationMs: Date.now() - turnStartedAt,
          changeCount: turnChanges.length,
        },
      });
    }
  }

  return {
    cfg,
    session,
    execEnv,
    cmdEnv,
    get sessionId() {
      return sessionId;
    },
    handleInput,
    abort: () => {
      if (currentAbort && !currentAbort.signal.aborted) {
        currentAbort.abort();
        busy = false;
        return true;
      }
      return false;
    },
    isBusy: () => busy,
    updateConfig: (nextCfg, nextSystemPrompt) => {
      Object.assign(cfg, nextCfg);
      session.system.content = nextSystemPrompt;
      execEnv.cfg = cfg;
      // ctx holds a sandbox snapshot; refresh it so a settings change applies
      // to the next tool call without rebuilding the runtime.
      execEnv.ctx.sandbox = cfg.sandbox;
      cmdEnv.cfg = cfg;
      cmdEnv.systemPrompt = nextSystemPrompt;
    },
    shutdown: shutdownMcp,
    startNewSession: () => {
      const fresh = newSession(cmdEnv.systemPrompt);
      session.messages = fresh.messages;
      session.totalPromptTokens = 0;
      session.totalCompletionTokens = 0;
      sessionId = newSessionId();
      turnSeq = 0;
      protocolSequence = 0;
      currentTurnId = `${sessionId}-turn-0`;
      execEnv.sessionId = sessionId;
      execEnv.turnId = currentTurnId;
      cmdEnv.sessionId = sessionId;
      return { sessionId };
    },
    resume: (id: string) => {
      const stored = loadStoredSessionIntoRuntime(id);
      if (!stored) return [];
      return stored.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, text: contentText(m.content).trim() }))
        .filter((m) => m.text.length > 0 && !m.text.startsWith("[Earlier conversation summary]"));
    },
  };
}

function safelyDispatchRuntimeEvent(deliver: () => string | void | undefined): string | void {
  try {
    return deliver();
  } catch (error) {
    if (process.env.VIBE_DEBUG) {
      console.error(`[hicode] runtime event delivery failed: ${(error as Error).message}`);
    }
  }
}

function lastProtocolSequenceForSession(sessionId: string): number {
  try {
    const last = readRuntimeProtocolEvents(sessionId).at(-1)?.sequence;
    return Number.isInteger(last) && Number(last) > 0 ? Number(last) : 0;
  } catch {
    return 0;
  }
}

const IMAGE_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Build the user message: inline text @files, and attach any @image refs as
 * multimodal image parts (for vision-capable models). Returns a plain string
 * when there are no images, or a content-part array when there are.
 */
export function buildUserContent(input: string, cwd: string): string | ContentPart[] {
  const images: ContentPart[] = [];
  const refs = input.match(/(?:^|\s)@([^\s]+)/g) ?? [];
  for (const raw of refs) {
    const rel = raw.trim().slice(1);
    const ext = path.extname(rel).toLowerCase();
    const mime = IMAGE_EXT[ext];
    if (!mime) continue;
    const resolved = resolveWorkspacePath({ cwd }, rel, { mustExist: true });
    if ("error" in resolved) continue;
    const abs = resolved.abs;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const b64 = fs.readFileSync(abs).toString("base64");
        images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
      }
    } catch {
      /* ignore */
    }
  }

  const text = expandFileRefs(input, cwd); // text @files still get inlined
  if (!images.length) return text;
  return [{ type: "text", text }, ...images];
}

/** Inline the contents of any @path references found in the input. */
export function expandFileRefs(input: string, cwd: string): string {
  const refs = input.match(/(?:^|\s)@([^\s]+)/g);
  if (!refs) return input;
  let extra = "";
  for (const raw of refs) {
    const rel = raw.trim().slice(1);
    if (IMAGE_EXT[path.extname(rel).toLowerCase()]) continue; // images go through buildUserContent
    const resolved = resolveWorkspacePath({ cwd }, rel, { mustExist: true });
    if ("error" in resolved) continue;
    const abs = resolved.abs;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const body = fs.readFileSync(abs, "utf8").slice(0, 20000);
        extra += `\n\nContents of ${rel}:\n\`\`\`\n${body}\n\`\`\``;
      }
    } catch {
      /* ignore */
    }
  }
  return extra ? input + extra : input;
}
