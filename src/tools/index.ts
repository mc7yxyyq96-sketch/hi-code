import type { ToolSchema } from "../llm.js";
import type { VibeConfig } from "../config.js";
import { ui } from "../ui.js";
import { requestPermission, type PermissionState, type AskFn } from "../permissions.js";
import { type ToolContext, readFile, writeFile, editFile, planEdit, ls, glob, resolveWorkspacePath } from "./fs.js";
import { runBash, grep, type BashOutputStream } from "./bash.js";
import { newDiffId, type DiffEntry, type RuntimeEventDraft } from "../events.js";

export interface ExecEnv {
  cfg: VibeConfig;
  ctx: ToolContext;
  perms: PermissionState;
  /** Prompt the user (for permission confirmations); supplied by the frontend. */
  ask: AskFn;
  /** Delegation depth: 0 = lead agent, 1+ = subagents. */
  depth: number;
  /** Suppress live streaming/tool output (used when agents run in parallel). */
  quiet?: boolean;
  /** When set, tool names are appended here instead of being printed live. */
  toolLog?: string[];
  /** Current session id for structured events. */
  sessionId?: string;
  /** Current turn id for structured events. */
  turnId?: string;
  /** Abort signal for the active turn; long-running tools should stop when it fires. */
  signal?: AbortSignal;
  /** Temporary terminal renderer used while clients migrate to structured assistant events. */
  legacyAssistantOutput?: boolean;
  /** Emits structured runtime events for desktop/UI surfaces. */
  emitEvent?: (event: RuntimeEventDraft) => string | void;
  /** Records a file's prior content before a mutation, for /undo. null = file didn't exist. */
  recordChange?: (absPath: string, before: string | null, diffId?: string) => void;
}

/** Result of running a tool: text goes back to the model. */
export interface ToolOutcome {
  content: string;
  /** Short summary printed in the tool-call header. */
  summary: string;
  /** Optional process exit code or tool-specific numeric result. */
  exitCode?: number;
  /** Extra structured details for UI timelines and logs. */
  metadata?: Record<string, unknown>;
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a file from the workspace. Returns line-numbered content. Use offset/limit for large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to cwd or absolute." },
          offset: { type: "integer", description: "1-based start line." },
          limit: { type: "integer", description: "Max lines to read." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing one. Shows a diff and asks for confirmation before writing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "Full file content." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace an exact string in a file. old_string must match exactly and be unique unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean", description: "Replace all occurrences (default false)." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ls",
      description: "List the entries of a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory (default cwd)." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find files by glob pattern (supports ** and *), newest first. e.g. '**/*.ts'.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Root to search from (default cwd)." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search file contents with a regex (ripgrep). Returns file:line:match.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string", description: "Restrict to files matching this glob." },
          ignore_case: { type: "boolean" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command in the workspace via bash. Asks for confirmation. Use for git, tests, builds, installs.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout: { type: "integer", description: "ms, max 600000." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_agent",
      description:
        "Delegate a self-contained subtask to a specialist teammate that runs autonomously and reports back. Roles: architect (plan, read-only), coder (implement), reviewer (review, read-only+tests), tester (write/run tests), explorer (research, read-only). Use this to parallelize or to get a focused review.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            enum: ["architect", "coder", "reviewer", "tester", "explorer"],
          },
          task: {
            type: "string",
            description: "A complete, standalone task description. The teammate has no memory of this conversation.",
          },
        },
        required: ["role", "task"],
      },
    },
  },
];

// No-op reporter used when an agent runs quietly (e.g. in a parallel batch),
// so several concurrent agents don't garble the terminal.
const NOOP = () => {};
const QUIET = {
  toolCall: NOOP,
  toolResult: NOOP,
  diff: NOOP,
  info: NOOP,
  error: NOOP,
  warn: NOOP,
} as unknown as typeof ui;

function reporter(env: ExecEnv): typeof ui {
  return env.quiet ? QUIET : ui;
}

function createToolOutputEmitter(
  env: ExecEnv,
  tool: string,
  title: string,
  parentId?: string | void,
): (chunk: string, stream: BashOutputStream) => void {
  let sequence = 0;
  return (chunk, stream) => {
    const summary = summarizeOutputChunk(chunk);
    if (!summary) return;
    env.emitEvent?.({
      type: "tool:output",
      tool,
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

/** Dispatch one tool call. Returns the text result fed back to the model. */
export async function executeTool(
  env: ExecEnv,
  name: string,
  rawArgs: string,
): Promise<ToolOutcome> {
  let args: any;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { content: `Error: invalid JSON arguments: ${rawArgs.slice(0, 200)}`, summary: "bad args" };
  }

  env.toolLog?.push(name);
  const title = toolTitle(name, args);
  const startedAt = Date.now();
  const startId = env.emitEvent?.({
    type: "tool:start",
    tool: name,
    title,
    summary: summarizeArgs(args),
    status: "running",
    payload: { args: safeArgs(args), startedAt },
  });

  try {
    const outcome = await executeToolInner(env, name, args, { startId, title, startedAt });
    const durationMs = Date.now() - startedAt;
    env.emitEvent?.({
      type: "tool:done",
      tool: name,
      title,
      summary: outcome.summary,
      status: outcome.summary === "denied" ? "denied" : "done",
      payload: {
        parentId: startId,
        durationMs,
        exitCode: outcome.exitCode,
        ...(outcome.metadata ?? {}),
      },
    });
    return outcome;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    env.emitEvent?.({
      type: "tool:done",
      tool: name,
      title,
      summary: (err as Error).message || "error",
      status: "error",
      payload: { parentId: startId, durationMs },
    });
    throw err;
  }
}

async function executeToolInner(
  env: ExecEnv,
  name: string,
  args: any,
  eventMeta?: { startId?: string | void; title: string; startedAt: number },
): Promise<ToolOutcome> {
  const out = reporter(env);

  switch (name) {
    case "read_file": {
      out.toolCall("read_file", args.path ?? "");
      const res = readFile(env.ctx, args);
      out.toolResult(res);
      return { content: res, summary: args.path };
    }
    case "ls": {
      out.toolCall("ls", args.path ?? ".");
      const res = ls(env.ctx, args);
      out.toolResult(res);
      return { content: res, summary: args.path ?? "." };
    }
    case "glob": {
      out.toolCall("glob", args.pattern ?? "");
      const res = glob(env.ctx, args);
      out.toolResult(res);
      return { content: res, summary: args.pattern };
    }
    case "grep": {
      out.toolCall("grep", args.pattern ?? "");
      const res = await grep(env.ctx, args, env.signal);
      out.toolResult(res);
      return { content: res, summary: args.pattern };
    }
    case "write_file": {
      out.toolCall("write_file", args.path ?? "");
      return await previewAndWrite(env, args);
    }
    case "edit_file": {
      out.toolCall("edit_file", args.path ?? "");
      return await previewAndEdit(env, args);
    }
    case "bash": {
      out.toolCall("bash", String(args.command ?? "").slice(0, 80));
      emitPermissionRequested(env, "bash", `bash: ${args.command}`);
      const decision = await requestPermission(
        env.perms,
        { tool: "bash", action: `bash: ${args.command}`, mutating: true },
        env.ask,
      );
      if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
      const res = await runBash(
        env.ctx,
        args,
        env.signal,
        createToolOutputEmitter(env, "bash", eventMeta?.title ?? "Run bash", eventMeta?.startId),
      );
      out.toolResult(res.output, { dim: true });
      const tag = res.exitCode === 0 ? "ok" : `exit ${res.exitCode}`;
      return { content: `exit code ${res.exitCode}\n${res.output}`, summary: tag, exitCode: res.exitCode };
    }
    case "spawn_agent": {
      // Dynamic import breaks the tools ↔ agents module cycle.
      const { spawnAgent } = await import("../agents/subagent.js");
      const report = await spawnAgent(env, String(args.role ?? "coder"), String(args.task ?? ""));
      return { content: report, summary: `@${args.role}` };
    }
    default: {
      // MCP tools are namespaced mcp__<server>__<tool>.
      const { isMcpTool, callMcpTool } = await import("../mcp.js");
      if (isMcpTool(name)) {
        out.toolCall(name, "");
        emitPermissionRequested(env, name, `mcp: ${name} ${summarizeArgs(args)}`);
        const decision = await requestPermission(
          env.perms,
          { tool: name, action: `mcp: ${name} ${summarizeArgs(args)}`, mutating: true },
          env.ask,
        );
        if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
        const res = await callMcpTool(name, args);
        out.toolResult(res);
        return { content: res, summary: name };
      }
      return { content: `Error: unknown tool '${name}'`, summary: "unknown" };
    }
  }
}

async function previewAndWrite(env: ExecEnv, args: { path: string; content: string }): Promise<ToolOutcome> {
  const out = reporter(env);
  const fs = await import("node:fs");
  const resolved = resolveWorkspacePath(env.ctx, args.path, { forWrite: true });
  if ("error" in resolved) {
    const msg = `Error: ${resolved.error}`;
    out.error(msg);
    return { content: msg, summary: "bad path" };
  }
  const abs = resolved.abs;
  const existed = fs.existsSync(abs);
  const old = existed ? fs.readFileSync(abs, "utf8") : "";
  out.diff(old, args.content, args.path);
  emitPermissionRequested(env, "write_file", `write ${args.path}`, args.path);
  const decision = await requestPermission(
    env.perms,
    { tool: "write_file", action: `write ${args.path}`, mutating: true },
    env.ask,
  );
  if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
  const r = writeFile(env.ctx, args);
  if ("error" in r) {
    out.error(r.error);
    return { content: "Error: " + r.error, summary: "error" };
  }
  const diffId = newDiffId();
  env.recordChange?.(abs, existed ? old : null, diffId);
  emitDiffCreated(env, {
    id: diffId,
    sessionId: env.sessionId ?? "",
    turnId: env.turnId ?? "",
    path: args.path,
    absPath: abs,
    before: existed ? old : null,
    after: args.content,
    status: "pending",
    tool: "write_file",
    createdAt: Date.now(),
  });
  out.info("  " + r.message);
  return { content: r.message, summary: r.filename };
}

async function previewAndEdit(
  env: ExecEnv,
  args: { path: string; old_string: string; new_string: string; replace_all?: boolean },
): Promise<ToolOutcome> {
  const out = reporter(env);
  const plan = planEdit(env.ctx, args);
  if ("error" in plan) {
    const msg = `Error: ${plan.error}`;
    out.error(msg);
    return { content: msg, summary: "no match" };
  }
  out.diff(plan.oldContent, plan.newContent, args.path);
  emitPermissionRequested(env, "edit_file", `edit ${args.path}`, args.path);
  const decision = await requestPermission(
    env.perms,
    { tool: "edit_file", action: `edit ${args.path}`, mutating: true },
    env.ask,
  );
  if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
  const r = editFile(env.ctx, args);
  if ("error" in r) {
    out.error(r.error);
    return { content: "Error: " + r.error, summary: "error" };
  }
  const diffId = newDiffId();
  env.recordChange?.(plan.absPath, plan.oldContent, diffId);
  emitDiffCreated(env, {
    id: diffId,
    sessionId: env.sessionId ?? "",
    turnId: env.turnId ?? "",
    path: args.path,
    absPath: plan.absPath,
    before: plan.oldContent,
    after: plan.newContent,
    status: "pending",
    tool: "edit_file",
    createdAt: Date.now(),
  });
  out.info("  " + r.message);
  return { content: r.message, summary: r.filename };
}

function emitPermissionRequested(env: ExecEnv, tool: string, action: string, path?: string): void {
  env.emitEvent?.({
    type: "permission:requested",
    tool,
    title: "Permission required",
    summary: action,
    status: "waiting",
    path,
    payload: { action },
  });
}

function emitDiffCreated(env: ExecEnv, diff: DiffEntry): void {
  env.emitEvent?.({
    type: "diff:created",
    tool: diff.tool,
    title: `Changed ${diff.path}`,
    summary: diff.path,
    status: "done",
    path: diff.path,
    diffId: diff.id,
    payload: { diff },
  });
}

function toolTitle(name: string, args: any): string {
  if (name === "read_file") return `Read ${args.path ?? "file"}`;
  if (name === "write_file") return `Write ${args.path ?? "file"}`;
  if (name === "edit_file") return `Edit ${args.path ?? "file"}`;
  if (name === "ls") return `List ${args.path ?? "."}`;
  if (name === "glob") return `Glob ${args.pattern ?? ""}`;
  if (name === "grep") return `Grep ${args.pattern ?? ""}`;
  if (name === "bash") return `Run ${String(args.command ?? "bash").slice(0, 80)}`;
  if (name === "spawn_agent") return `Spawn ${args.role ?? "agent"}`;
  return name;
}

function safeArgs(args: any): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/key|token|secret|password/i.test(key)) copy[key] = "••••";
    else if (typeof value === "string" && value.length > 500) copy[key] = value.slice(0, 500) + "...";
    else copy[key] = value;
  }
  return copy;
}

function summarizeArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return "";
  }
}
