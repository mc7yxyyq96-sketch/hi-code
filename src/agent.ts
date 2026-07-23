import type { VibeConfig, ModelProfile } from "./config.js";
import { defaultProfile } from "./config.js";
import { streamChat, type ChatMessage, type ToolSchema, type ContentPart } from "./llm.js";
import { TOOL_SCHEMAS, executeTool, type ExecEnv } from "./tools/index.js";
import { mcpToolSchemas } from "./mcp.js";
import { ui, startSpinner, stopSpinner } from "./ui.js";
import { type Session, fullHistory, estimateTokens, compact } from "./context.js";
import { recordUsage } from "./usage-store.js";

export interface LoopOpts {
  /** Restrict the toolset (e.g. read-only tools for an architect subagent). */
  tools?: ToolSchema[];
  /** Label shown on the assistant prefix, e.g. a role name. */
  label?: string;
  maxSteps?: number;
  /** Auto-compact when nearing the context window (default true). */
  autoCompact?: boolean;
  /** Which model runs this loop. Defaults to the config's default profile. */
  profile?: ModelProfile;
  /** Abort signal to cancel an in-flight turn (Esc / Ctrl-C). */
  signal?: AbortSignal;
}

/**
 * Drive a session to completion: stream the model, execute tool calls, feed
 * results back, repeat until the model answers with no further tool calls.
 * Returns the model's final text (used as a subagent's report).
 */
export async function runLoop(
  cfg: VibeConfig,
  session: Session,
  env: ExecEnv,
  opts: LoopOpts = {},
): Promise<string> {
  // The lead agent (default toolset) also gets any connected MCP tools.
  const tools = opts.tools ?? [...TOOL_SCHEMAS, ...mcpToolSchemas()];
  const maxSteps = opts.maxSteps ?? 50;
  const p = opts.profile ?? defaultProfile(cfg);
  const quiet = env.quiet === true;
  let finalText = "";

  for (let step = 0; step < maxSteps; step++) {
    if (opts.autoCompact !== false) {
      const est = estimateTokens(fullHistory(session));
      if (est > p.contextWindow * cfg.compactThreshold) {
        env.emitEvent?.({
          type: "turn:update",
          tool: "agent",
          title: "Compacting context",
          summary: `${est}/${p.contextWindow} estimated tokens`,
          status: "running",
          payload: { phase: "compacting", estimatedTokens: est, contextWindow: p.contextWindow },
        });
        if (!quiet) startSpinner("compacting context");
        const removed = await compact(p, session).catch(() => 0);
        if (!quiet) stopSpinner();
        if (removed > 0) {
          env.emitEvent?.({
            type: "turn:update",
            tool: "agent",
            title: "Context compacted",
            summary: `已压缩 ${removed} 条历史消息（${est}/${p.contextWindow} tokens）`,
            status: "done",
            payload: {
              phase: "compacted",
              removed,
              estimatedTokens: est,
              contextWindow: p.contextWindow,
            },
          });
          if (!quiet) ui.info(`  ↳ compacted ${removed} messages to stay within context`);
        }
      }
    }

    if (!quiet) startSpinner(opts.label ? `${opts.label} thinking` : "thinking");
    env.emitEvent?.({
      type: "turn:update",
      tool: "agent",
      title: opts.label ? `${opts.label} thinking` : "Thinking",
      summary: p.model,
      status: "running",
      payload: { phase: "thinking", step, model: p.model },
    });
    let started = false;
    const ensurePrefix = () => {
      if (!started) {
        stopSpinner();
        ui.assistantPrefix(opts.label);
        started = true;
      }
    };

    let turn;
    try {
      turn = await streamChat(
        p,
        fullHistory(session),
        tools,
        {
          onText: quiet
            ? undefined
            : (delta) => {
                ensurePrefix();
                process.stdout.write(delta);
              },
          onToolCallStart: quiet ? undefined : () => stopSpinner(),
        },
        opts.signal,
      );
    } catch (e) {
      if (!quiet) stopSpinner();
      const msg = `error: ${(e as Error).message}`;
      if (!quiet) ui.error(msg);
      throw e;
    }
    if (!quiet) stopSpinner();
    if (started) ui.newline();

    if (turn.usage) {
      session.totalPromptTokens += turn.usage.prompt_tokens ?? 0;
      session.totalCompletionTokens += turn.usage.completion_tokens ?? 0;
      recordUsage({
        promptTokens: turn.usage.prompt_tokens ?? 0,
        completionTokens: turn.usage.completion_tokens ?? 0,
        model: p.model,
        reasoningLevel: cfg.reasoningLevel,
      });
    }

    // Cancelled mid-turn: record whatever streamed and stop cleanly.
    if (turn.aborted) {
      session.messages.push({ role: "assistant", content: turn.content || "[interrupted]" });
      env.emitEvent?.({
        type: "turn:update",
        tool: "agent",
        title: "Interrupted",
        summary: "generation stopped",
        status: "interrupted",
        payload: { phase: "interrupted", step },
      });
      if (!quiet) ui.warn("  ⏹ interrupted");
      return turn.content || finalText;
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.tool_calls.length ? turn.tool_calls : undefined,
    };
    session.messages.push(assistantMsg);
    if (turn.content) finalText = turn.content;

    if (!turn.tool_calls.length) return finalText;

    env.emitEvent?.({
      type: "turn:update",
      tool: "agent",
      title: "Calling tools",
      summary: turn.tool_calls.map((call) => call.function.name).join(", "),
      status: "running",
      payload: {
        phase: "tool_running",
        step,
        tools: turn.tool_calls.map((call) => call.function.name),
      },
    });

    for (const call of turn.tool_calls) {
      if (opts.signal?.aborted) {
        session.messages.push({ role: "assistant", content: "[interrupted]" });
        env.emitEvent?.({
          type: "turn:update",
          tool: "agent",
          title: "Interrupted",
          summary: "tool loop stopped",
          status: "interrupted",
          payload: { phase: "interrupted", step },
        });
        if (!quiet) ui.warn("  ⏹ interrupted");
        return finalText;
      }
      const outcome = await executeTool(env, call.function.name, call.function.arguments);
      session.messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: outcome.content,
      });
    }
  }

  ui.warn(`  ↳ stopped after ${maxSteps} tool steps (possible loop)`);
  return finalText;
}

/** Interactive single user turn (the REPL entry point). */
export async function runTurn(
  cfg: VibeConfig,
  session: Session,
  env: ExecEnv,
  userInput: string | ContentPart[],
  signal?: AbortSignal,
  onUserMessageSaved?: () => void,
): Promise<void> {
  session.messages.push({ role: "user", content: userInput });
  onUserMessageSaved?.();
  const finalText = await runLoop(cfg, session, env, { signal });
  if (!signal?.aborted && !finalText.trim()) {
    throw new Error(`模型 ${defaultProfile(cfg).model} 返回了空内容。请重试，或在“接入 API”里切换到稳定的对话/视觉模型并测试连接。`);
  }
}
