import type { ModelProfile } from "./config.js";

// ---- Wire types (OpenAI Chat Completions, the stable lingua franca) ----

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A multimodal content part (OpenAI vision format). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  /** Fired once the model commits to calling tools (after stream ends). */
  onToolCallStart?: (name: string) => void;
  onToolCallDelta?: (delta: ToolCallStreamDelta) => void;
}

export interface ToolCallStreamDelta {
  index: number;
  id?: string;
  nameDelta?: string;
  argumentsDelta?: string;
}

export interface AssistantTurn {
  content: string;
  tool_calls: ToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** True if the caller aborted the request mid-flight. */
  aborted?: boolean;
}

const STREAM_IDLE_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_IDLE_MS", 120_000);
const STREAM_TOTAL_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_TOTAL_MS", 900_000);

/**
 * Stream one assistant turn. Returns the fully-assembled assistant message,
 * including any tool calls accumulated from the streamed deltas.
 */
export async function streamChat(
  p: ModelProfile,
  messages: ChatMessage[],
  tools: ToolSchema[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
): Promise<AssistantTurn> {
  const url = p.baseURL.replace(/\/$/, "") + "/chat/completions";
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (!shouldOmitTemperature(p)) body.temperature = p.temperature;

  let timeoutReason: "idle" | "total" | null = null;
  const requestController = new AbortController();
  const onCallerAbort = () => requestController.abort();
  if (signal?.aborted) requestController.abort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const totalTimer = setTimeout(() => {
    timeoutReason = "total";
    requestController.abort();
  }, STREAM_TOTAL_TIMEOUT_MS);
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutReason = "idle";
      requestController.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  const cleanupRequest = () => {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", onCallerAbort);
  };
  resetIdleTimer();

  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: requestController.signal,
      },
      3,
    );
  } catch (e) {
    cleanupRequest();
    if (signal?.aborted) return { content: "", tool_calls: [], aborted: true };
    if (timeoutReason) throw new Error(streamTimeoutError(timeoutReason, url));
    throw new Error(networkError(e, url));
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    cleanupRequest();
    throw new Error(modelResponseError(res.status, res.statusText, text, messages));
  }

  let content = "";
  const toolCalls: ToolCall[] = [];
  let usage: AssistantTurn["usage"];
  const startedToolIndexes = new Set<number>();

  const decoder = new TextDecoder();
  let buf = "";
  let aborted = false;
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdleTimer();
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      // SSE events are separated by a blank line.
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.usage) usage = json.usage;
          const choice = json.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          if (typeof delta.content === "string" && delta.content.length) {
            content += delta.content;
            handlers.onText?.(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i: number = tc.index ?? 0;
              if (!toolCalls[i]) {
                toolCalls[i] = {
                  id: tc.id ?? `call_${i}`,
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }
              const slot = toolCalls[i];
              if (tc.id) slot.id = tc.id;
              const nameDelta = typeof tc.function?.name === "string" ? tc.function.name : "";
              const argumentsDelta = typeof tc.function?.arguments === "string" ? tc.function.arguments : "";
              handlers.onToolCallDelta?.({
                index: i,
                ...(tc.id ? { id: tc.id } : {}),
                ...(nameDelta ? { nameDelta } : {}),
                ...(argumentsDelta ? { argumentsDelta } : {}),
              });
              if (tc.function?.name) {
                slot.function.name += tc.function.name;
                if (!startedToolIndexes.has(i)) {
                  startedToolIndexes.add(i);
                  handlers.onToolCallStart?.(slot.function.name);
                }
              }
              if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
            }
          }
        }
      }
    }
  } catch (e) {
    // An abort surfaces here as the reader rejects; treat it as a clean stop.
    if (signal?.aborted) aborted = true;
    else if (timeoutReason) throw new Error(streamTimeoutError(timeoutReason, url));
    else throw e;
  } finally {
    cleanupRequest();
  }

  return {
    content,
    tool_calls: aborted ? [] : toolCalls.filter(Boolean),
    usage,
    aborted,
  };
}

/** Retry transient failures (network errors, 429, 5xx) with exponential backoff. */
async function fetchWithRetry(url: string, init: RequestInit, attempts: number): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) {
          await sleep(400 * 2 ** i);
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if ((init.signal as AbortSignal | undefined)?.aborted) throw e;
      if (i < attempts - 1) await sleep(400 * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 1000 ? raw : fallback;
}

function streamTimeoutError(reason: "idle" | "total", url: string): string {
  const host = url.replace(/\/chat\/completions$/, "");
  const limit = reason === "idle" ? STREAM_IDLE_TIMEOUT_MS : STREAM_TOTAL_TIMEOUT_MS;
  const label = reason === "idle" ? "no streaming data arrived" : "the request did not finish";
  return `model stream timed out at ${host}: ${label} within ${Math.round(limit / 1000)}s. Try again, lower reasoning, or check the provider connection in Settings.`;
}

function hasImageContent(messages: ChatMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
}

function modelResponseError(status: number, statusText: string, text: string, messages: ChatMessage[]): string {
  const raw = String(text || "").slice(0, 400);
  if (hasImageContent(messages) && (status === 400 || status === 415 || status === 422)) {
    return `当前模型或服务商接口拒绝了图片输入。请切换到支持视觉/多模态的模型，或把图片内容改成文字描述后重试。原始错误：HTTP ${status} ${statusText}: ${raw}`;
  }
  return `model server returned ${status} ${statusText}: ${raw}`;
}

/** Turn an opaque "fetch failed" into an actionable message naming the endpoint. */
function networkError(e: unknown, url: string): string {
  const err = e as { message?: string; cause?: { code?: string } };
  const code = err?.cause?.code ? ` [${err.cause.code}]` : "";
  const host = url.replace(/\/chat\/completions$/, "");
  return `couldn't reach the model server at ${host}${code}. Is it running and on the same network? Check Settings (the gear icon).`;
}

/** Non-streaming one-shot completion, used for summarization/compaction. */
export async function complete(
  p: ModelProfile,
  messages: ChatMessage[],
  temperature = 0.3,
): Promise<string> {
  const url = p.baseURL.replace(/\/$/, "") + "/chat/completions";
  const body: Record<string, unknown> = { model: p.model, messages, stream: false };
  if (!shouldOmitTemperature(p)) body.temperature = temperature;
  let res: Response;
  try {
    res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      3,
    );
  } catch (e) {
    throw new Error(networkError(e, url));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`model server returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

function shouldOmitTemperature(p: ModelProfile): boolean {
  const baseURL = p.baseURL.toLowerCase();
  return baseURL.includes("moonshot.") || baseURL.includes("api.kimi.com");
}
