import type { VibeConfig, ModelProfile } from "./config.js";
import { defaultProfile } from "./config.js";
import { streamChat, type ChatMessage, type ToolSchema, type ContentPart } from "./llm.js";
import { TOOL_SCHEMAS, executeTool, type ExecEnv } from "./tools/index.js";
import { mcpToolSchemas } from "./mcp.js";
import { ui, startSpinner, stopSpinner } from "./ui.js";
import { type Session, fullHistory, estimateTokens, compact } from "./context.js";
import { recordUsage } from "./usage-store.js";
import {
  newEventId,
  type AssistantCompletedPayload,
  type AssistantDeltaPayload,
  type RuntimeMessageAppendedPayload,
} from "./events.js";

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
  const legacyOutput = !quiet && env.legacyAssistantOutput !== false;
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
        if (legacyOutput) startSpinner("compacting context");
        const removed = await compact(p, session).catch(() => 0);
        if (legacyOutput) stopSpinner();
        if (removed > 0 && legacyOutput) ui.info(`  ↳ compacted ${removed} messages to stay within context`);
      }
    }

    if (legacyOutput) startSpinner(opts.label ? `${opts.label} thinking` : "thinking");
    env.emitEvent?.({
      type: "turn:update",
      tool: "agent",
      title: opts.label ? `${opts.label} thinking` : "Thinking",
      summary: p.model,
      status: "running",
      payload: { phase: "thinking", step, model: p.model },
    });
    let started = false;
    const messageId = newEventId("msg");
    let deltaSequence = 0;
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
                const payload: AssistantDeltaPayload = {
                  messageId,
                  delta,
                  model: p.model,
                  step,
                  sequence: ++deltaSequence,
                  ...(opts.label ? { label: opts.label } : {}),
                };
                env.emitEvent?.({
                  type: "assistant:delta",
                  tool: "agent",
                  title: opts.label ? `${opts.label} response` : "Assistant response",
                  summary: summarizeAssistantText(delta),
                  status: "running",
                  payload,
                });
                if (legacyOutput) {
                  ensurePrefix();
                  process.stdout.write(delta);
                }
              },
          onToolCallStart: legacyOutput ? () => stopSpinner() : undefined,
        },
        opts.signal,
      );
    } catch (e) {
      if (legacyOutput) stopSpinner();
      const msg = `error: ${(e as Error).message}`;
      if (!quiet) {
        emitAssistantCompleted(env, {
          messageId,
          content: "",
          model: p.model,
          step,
          finishReason: "error",
          error: summarizeAssistantText((e as Error).message),
          ...(opts.label ? { label: opts.label } : {}),
        }, "error");
      }
      if (legacyOutput) ui.error(msg);
      throw e;
    }
    if (legacyOutput) stopSpinner();
    if (legacyOutput && started) ui.newline();

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
      const interruptedMessage: ChatMessage = { role: "assistant", content: turn.content || "[interrupted]" };
      session.messages.push(interruptedMessage);
      emitMessageAppended(env, messageId, interruptedMessage, { step, finishReason: "interrupted" });
      if (!quiet) {
        emitAssistantCompleted(env, {
          messageId,
          content: turn.content,
          model: p.model,
          step,
          finishReason: "interrupted",
          ...(opts.label ? { label: opts.label } : {}),
        }, "interrupted");
      }
      env.emitEvent?.({
        type: "turn:update",
        tool: "agent",
        title: "Interrupted",
        summary: "generation stopped",
        status: "interrupted",
        payload: { phase: "interrupted", step },
      });
      if (legacyOutput) ui.warn("  ⏹ interrupted");
      return turn.content || finalText;
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.tool_calls.length ? turn.tool_calls : undefined,
    };
    session.messages.push(assistantMsg);
    emitMessageAppended(env, messageId, assistantMsg, { step, finishReason: "completed" });
    if (turn.content) finalText = turn.content;

    if (!quiet) {
      emitAssistantCompleted(env, {
        messageId,
        content: turn.content,
        model: p.model,
        step,
        finishReason: turn.content || turn.tool_calls.length ? "completed" : "error",
        toolCallCount: turn.tool_calls.length,
        ...(opts.label ? { label: opts.label } : {}),
      }, turn.content || turn.tool_calls.length ? "done" : "error");
    }

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
        if (legacyOutput) ui.warn("  ⏹ interrupted");
        return finalText;
      }
      const outcome = await executeTool(env, call.function.name, call.function.arguments);
      const toolMessage: ChatMessage = {
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: outcome.content,
      };
      session.messages.push(toolMessage);
      emitMessageAppended(env, newEventId("msg-tool"), toolMessage, { step, sourceToolCallId: call.id });
    }
  }

  if (legacyOutput) ui.warn(`  ↳ stopped after ${maxSteps} tool steps (possible loop)`);
  return finalText;
}

function emitAssistantCompleted(
  env: ExecEnv,
  payload: AssistantCompletedPayload,
  status: "done" | "error" | "interrupted",
): void {
  env.emitEvent?.({
    type: "assistant:completed",
    tool: "agent",
    title: status === "error" ? "Assistant response failed" : status === "interrupted" ? "Assistant response interrupted" : "Assistant response complete",
    summary: summarizeAssistantText(payload.content) || (status === "error" ? "empty or failed response" : status),
    status,
    payload,
  });
}

function summarizeAssistantText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
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
  const userMessage: ChatMessage = { role: "user", content: userInput };
  session.messages.push(userMessage);
  emitMessageAppended(env, newEventId("msg-user"), userMessage);
  onUserMessageSaved?.();
  const finalText = await runLoop(cfg, session, env, { signal });
  if (!signal?.aborted && !finalText.trim()) {
    throw new Error(`模型 ${defaultProfile(cfg).model} 返回了空内容。请重试，或在“接入 API”里切换到稳定的对话/视觉模型并测试连接。`);
  }
}

function emitMessageAppended(
  env: ExecEnv,
  messageId: string,
  message: ChatMessage,
  metadata: Record<string, unknown> = {},
): void {
  const payload: RuntimeMessageAppendedPayload = {
    messageId,
    message,
    ...metadata,
  };
  env.emitEvent?.({
    type: "message:appended",
    tool: message.role === "tool" ? message.name : "agent",
    title: `${message.role} message persisted`,
    status: "done",
    payload,
  });
}
