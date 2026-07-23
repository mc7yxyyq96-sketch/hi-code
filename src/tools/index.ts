import type { ToolSchema } from "../llm.js";
import type { VibeConfig } from "../config.js";
import { ui } from "../ui.js";
import { requestPermission, type PermissionState, type AskFn } from "../permissions.js";
import { type ToolContext, readFile, writeFile, editFile, planEdit, ls, glob, resolveWorkspacePath } from "./fs.js";
import { applyPatch, findSymbol, getFileOutline } from "./code-intel.js";
import { runBash, grep, type BashOutputStream } from "./bash.js";
import { newDiffId, type DiffEntry, type RuntimeEventDraft } from "../events.js";
import {
  createReadBeforeEditState,
  recordFileRead,
  requireReadBeforeEdit,
  type ReadBeforeEditState,
} from "../policies/read-before-edit.js";
import {
  gitCommit,
  gitFileDiff,
  gitInfo,
  gitWorkflowStatus,
} from "../git.js";

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
  /** Emits structured runtime events for desktop/UI surfaces. */
  emitEvent?: (event: RuntimeEventDraft) => string | void;
  /** Records a file's prior content before a mutation, for /undo. null = file didn't exist. */
  recordChange?: (absPath: string, before: string | null, diffId?: string) => void;
  /** Per-turn read-before-edit enforcement state. */
  readPolicy?: ReadBeforeEditState;
  /** Optional todo board updated by todo_write. */
  todos?: Array<{ text: string; status: "pending" | "in_progress" | "done" }>;
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
          limit: { type: "integer", description: "Max matches to return (default 200)." },
          max_depth: { type: "integer", description: "Max directory depth to walk (default 16)." },
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
          limit: { type: "integer", description: "Max matching lines (default 100)." },
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
  {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Read a specific inclusive line range from a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          start_line: { type: "integer", description: "1-based start line" },
          end_line: { type: "integer", description: "1-based end line" },
        },
        required: ["path", "start_line", "end_line"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "Apply a precise old_string→new_string patch to a file (alias of edit with patch semantics).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_file_outline",
      description: "Return a lightweight symbol outline for a source file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_symbol",
      description: "Find definitions of a symbol name across the workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string", description: "Optional subdirectory to search" },
          limit: { type: "integer" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_symbols",
      description: "Alias of find_symbol for OpenCode-style symbol search.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "todo_write",
      description: "Update the turn todo board with planned steps and progress.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "done"] },
              },
              required: ["text"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Show git workflow status for the workspace.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show git diff for a path or the whole workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          staged: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Show recent git commits.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description: "Create a git commit with the given message (requires staged changes).",
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  },
];

export function ensureExecEnvPolicy(env: ExecEnv): ReadBeforeEditState {
  if (!env.readPolicy) env.readPolicy = createReadBeforeEditState();
  return env.readPolicy;
}

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

  ensureExecEnvPolicy(env);

  switch (name) {
    case "read_file": {
      out.toolCall("read_file", args.path ?? "");
      const res = readFile(env.ctx, args);
      if (!String(res).startsWith("Error:")) recordFileRead(env.readPolicy, args.path ?? "");
      out.toolResult(res);
      return { content: res, summary: args.path };
    }
    case "read_file_range": {
      const start = Math.max(1, Number(args.start_line ?? 1));
      const end = Math.max(start, Number(args.end_line ?? start));
      out.toolCall("read_file_range", `${args.path}:${start}-${end}`);
      const res = readFile(env.ctx, {
        path: args.path,
        offset: start,
        limit: end - start + 1,
      });
      if (!String(res).startsWith("Error:")) recordFileRead(env.readPolicy, args.path ?? "");
      out.toolResult(res);
      return { content: res, summary: `${args.path}:${start}-${end}` };
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
    case "get_file_outline": {
      out.toolCall("get_file_outline", args.path ?? "");
      const res = getFileOutline(env.ctx, args);
      if (!String(res).startsWith("Error:")) recordFileRead(env.readPolicy, args.path ?? "");
      out.toolResult(res);
      return { content: res, summary: args.path };
    }
    case "find_symbol":
    case "search_symbols": {
      out.toolCall(name, args.name ?? "");
      const res = findSymbol(env.ctx, args);
      out.toolResult(res);
      return { content: res, summary: args.name };
    }
    case "todo_write": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      const nextTodos = todos.map((todo: any) => ({
        text: String(todo?.text || ""),
        status: (["pending", "in_progress", "done"].includes(todo?.status) ? todo.status : "pending") as
          | "pending"
          | "in_progress"
          | "done",
      }));
      env.todos = nextTodos;
      const summary = `${nextTodos.filter((t: { status: string }) => t.status === "done").length}/${nextTodos.length} done`;
      env.emitEvent?.({
        type: "turn:update",
        tool: "todo_write",
        title: "Todos updated",
        summary,
        status: "done",
        payload: { todos: nextTodos },
      });
      out.toolResult(summary);
      return { content: JSON.stringify({ ok: true, todos: nextTodos }, null, 2), summary };
    }
    case "git_status": {
      out.toolCall("git_status", "");
      const status = gitWorkflowStatus(env.ctx.cwd);
      const info = gitInfo(env.ctx.cwd);
      const content = JSON.stringify({ ...status, info }, null, 2);
      out.toolResult(content);
      return { content, summary: status.ok ? `${status.dirty} dirty` : status.error || "git error" };
    }
    case "git_diff": {
      out.toolCall("git_diff", args.path ?? ".");
      if (!args.path) {
        const res = await runBash(
          env.ctx,
          { command: args.staged ? "git diff --cached" : "git diff", timeout: 30_000 },
          env.signal,
        );
        out.toolResult(res.output || "(empty diff)");
        return { content: res.output || "(empty diff)", summary: "diff", exitCode: res.exitCode };
      }
      const result = gitFileDiff(env.ctx.cwd, String(args.path), !!args.staged);
      const content = result.ok ? result.diff || "(empty diff)" : `Error: ${result.error}`;
      out.toolResult(content);
      return { content, summary: result.ok ? "diff" : "error" };
    }
    case "git_log": {
      out.toolCall("git_log", "");
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10)));
      const res = await runBash(
        env.ctx,
        { command: `git log -n ${limit} --oneline --decorate`, timeout: 30_000 },
        env.signal,
      );
      out.toolResult(res.output);
      return { content: res.output || "(no commits)", summary: `${limit} commits`, exitCode: res.exitCode };
    }
    case "git_commit": {
      out.toolCall("git_commit", String(args.message ?? "").slice(0, 60));
      emitPermissionRequested(env, "git_commit", `git commit: ${args.message}`);
      const decision = await requestPermission(
        env.perms,
        { tool: "git_commit", action: `git commit: ${args.message}`, mutating: true },
        env.ask,
      );
      if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
      const result = gitCommit(env.ctx.cwd, String(args.message ?? ""));
      const content = result.ok ? `Committed ${result.hash || ""}`.trim() : `Error: ${result.error}`;
      out.toolResult(content);
      return { content, summary: result.ok ? "committed" : "error" };
    }
    case "write_file": {
      out.toolCall("write_file", args.path ?? "");
      return await previewAndWrite(env, args);
    }
    case "edit_file":
    case "apply_patch": {
      out.toolCall(name, args.path ?? "");
      return await previewAndEdit(env, args, name);
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
  ensureExecEnvPolicy(env);
  const fs = await import("node:fs");
  const resolved = resolveWorkspacePath(env.ctx, args.path, { forWrite: true });
  if ("error" in resolved) {
    const msg = `Error: ${resolved.error}`;
    out.error(msg);
    return { content: msg, summary: "bad path" };
  }
  const abs = resolved.abs;
  const existed = fs.existsSync(abs);
  if (existed) {
    const policy = requireReadBeforeEdit(env.readPolicy, args.path);
    if (!policy.ok) {
      out.error(policy.error);
      return { content: policy.error, summary: "policy" };
    }
  }
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
  toolName: "edit_file" | "apply_patch" = "edit_file",
): Promise<ToolOutcome> {
  const out = reporter(env);
  ensureExecEnvPolicy(env);
  const policy = requireReadBeforeEdit(env.readPolicy, args.path);
  if (!policy.ok) {
    out.error(policy.error);
    return { content: policy.error, summary: "policy" };
  }
  const plan = planEdit(env.ctx, args);
  if ("error" in plan) {
    const msg = `Error: ${plan.error}`;
    out.error(msg);
    return { content: msg, summary: "no match" };
  }
  out.diff(plan.oldContent, plan.newContent, args.path);
  emitPermissionRequested(env, toolName, `edit ${args.path}`, args.path);
  const decision = await requestPermission(
    env.perms,
    { tool: toolName, action: `edit ${args.path}`, mutating: true },
    env.ask,
  );
  if (decision === "deny") return { content: "Denied by user.", summary: "denied" };
  const r = toolName === "apply_patch" ? applyPatch(env.ctx, args) : editFile(env.ctx, args);
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
    tool: toolName,
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
  if (name === "read_file_range") return `Read ${args.path ?? "file"}:${args.start_line ?? "?"}-${args.end_line ?? "?"}`;
  if (name === "write_file") return `Write ${args.path ?? "file"}`;
  if (name === "edit_file" || name === "apply_patch") return `Edit ${args.path ?? "file"}`;
  if (name === "get_file_outline") return `Outline ${args.path ?? "file"}`;
  if (name === "find_symbol" || name === "search_symbols") return `Find ${args.name ?? "symbol"}`;
  if (name === "todo_write") return "Update todos";
  if (name === "git_status") return "Git status";
  if (name === "git_diff") return `Git diff ${args.path ?? ""}`.trim();
  if (name === "git_log") return "Git log";
  if (name === "git_commit") return "Git commit";
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
