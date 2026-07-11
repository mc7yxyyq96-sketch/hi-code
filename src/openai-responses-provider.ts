import type { ModelProfile } from "./config.js";
import type { ChatMessage, ContentPart, ToolCall, ToolSchema } from "./llm.js";
import type {
  ModelProviderAdapter,
  ModelProviderAdapterRequest,
  ModelProviderAdapterResult,
  ModelProviderErrorCategory,
  ModelProviderEventSink,
  ModelProviderUsage,
} from "./model-provider.js";

const OPENAI_RESPONSES_ADAPTER_ID = "openai-responses";
const STREAM_IDLE_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_IDLE_MS", 120_000);
const STREAM_TOTAL_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_TOTAL_MS", 900_000);

interface OpenAIResponsesDependencies {
  fetch?: typeof fetch;
}

type ResponseInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: ResponseContentPart[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type ResponseContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

interface ToolStreamState {
  itemId: string;
  index: number;
  callId: string;
  name: string;
  arguments: string;
  started: boolean;
  completed: boolean;
}

interface ResponsesUsageWire {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export function createOpenAIResponsesAdapter(
  profile: ModelProfile,
  dependencies: OpenAIResponsesDependencies = {},
): ModelProviderAdapter {
  const endpoint = responsesEndpoint(profile.baseURL);
  const fetchImpl = dependencies.fetch || fetch;
  return {
    descriptor: {
      schemaVersion: 2,
      id: OPENAI_RESPONSES_ADAPTER_ID,
      name: "OpenAI Responses",
      version: "1.0.0",
      protocol: "openai.responses",
      model: requiredText(profile.model, "profile.model"),
      capabilities: {
        "input.text": { support: "supported" },
        "input.image": { support: "supported" },
        "input.file": { support: "unsupported", reason: "file lifecycle is outside the HC-PROV-211 adapter boundary" },
        "input.pdf": { support: "unsupported", reason: "PDF attachment persistence is assigned to the attachment-store slice" },
        "tool.calling": { support: "supported" },
        "tool.streaming": { support: "supported" },
        "reasoning.summary": { support: "unsupported", reason: "reasoning summaries require a separately reviewed event contract" },
        "output.structured": { support: "unsupported", reason: "structured output negotiation is not enabled by this adapter" },
        usage: { support: "supported" },
        interruption: { support: "supported" },
      },
      limits: {
        ...(positiveInteger(profile.contextWindow) ? { contextTokens: profile.contextWindow } : {}),
      },
      metadata: {
        transport: "server-sent-events",
        persistence: "store-disabled",
        credentialStorage: "model-profile",
      },
    },
    async run(request, sink, signal) {
      const body = buildResponsesBody(profile, request);
      if (request.mode === "complete") {
        return runComplete(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal);
      }
      return runStream(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal);
    },
  };
}

function buildResponsesBody(profile: ModelProfile, request: ModelProviderAdapterRequest): Record<string, unknown> {
  const tools = request.tools.map(toResponsesTool);
  const body: Record<string, unknown> = {
    model: requiredText(profile.model, "profile.model"),
    input: toResponsesInput(request.messages),
    tools: tools.length ? tools : undefined,
    tool_choice: tools.length ? "auto" : undefined,
    stream: request.mode !== "complete",
    store: false,
    max_output_tokens: request.requirements.outputTokens,
  };
  const temperature = finiteNumber(request.temperature) ? request.temperature : profile.temperature;
  if (finiteNumber(temperature)) body.temperature = temperature;
  return body;
}

function toResponsesTool(tool: ToolSchema): Record<string, unknown> {
  if (tool?.type !== "function") throw wireError("provider_tool_invalid", "tool must be a function schema", "validation");
  return {
    type: "function",
    name: requiredText(tool.function?.name, "tool name"),
    description: typeof tool.function?.description === "string" ? tool.function.description : "",
    parameters: isObject(tool.function?.parameters) ? tool.function.parameters : {},
  };
}

function toResponsesInput(messages: ChatMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: requiredText(message.tool_call_id, "tool result call_id"),
        output: contentAsText(message.content),
      });
      continue;
    }

    const content = toResponsesContent(message.role, message.content);
    if (content.length) input.push({ type: "message", role: message.role, content });
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        input.push({
          type: "function_call",
          call_id: requiredText(call.id, "assistant tool call id"),
          name: requiredText(call.function?.name, "assistant tool call name"),
          arguments: typeof call.function?.arguments === "string" ? call.function.arguments : "",
        });
      }
    }
  }
  if (!input.length) throw wireError("provider_messages_required", "Responses request requires at least one input item", "validation");
  return input;
}

function toResponsesContent(role: "system" | "user" | "assistant", content: ChatMessage["content"]): ResponseContentPart[] {
  if (typeof content === "string") {
    return content ? [{ type: role === "assistant" ? "output_text" : "input_text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const output: ResponseContentPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) output.push({ type: role === "assistant" ? "output_text" : "input_text", text: part.text });
      continue;
    }
    if (part.type === "image_url") {
      if (role !== "user") throw wireError("provider_image_role_invalid", "Responses image input must use the user role", "validation");
      output.push({ type: "input_image", image_url: requiredText(part.image_url?.url, "image_url"), detail: "auto" });
      continue;
    }
    throw wireError("provider_attachment_unmaterialized", "Attachment references must be materialized before Responses transport", "validation");
  }
  return output;
}

function contentAsText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((part) => part.type !== "text")) {
    throw wireError("provider_tool_output_invalid", "tool results must be text before they can be sent to Responses", "validation");
  }
  return content.filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n");
}

async function runComplete(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  request: ModelProviderAdapterRequest,
  sink: ModelProviderEventSink,
  signal?: AbortSignal,
): Promise<ModelProviderAdapterResult> {
  const control = createRequestControl(signal);
  try {
    const response = await fetchWithRetry(fetchImpl, endpoint, requestInit(apiKey, body, control.signal), 3);
    if (!response.ok) throw await httpError(response, request.messages);
    const payload = await response.json().catch(() => {
      throw wireError("provider_response_invalid", "Responses endpoint returned invalid JSON", "provider");
    });
    const accumulator = new ResponsesAccumulator(request.runId, sink);
    accumulator.finishResponse(payload);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return interruptedResult();
    if (control.timeoutReason) throw timeoutError(control.timeoutReason, endpoint);
    throw error;
  } finally {
    control.cleanup();
  }
}

async function runStream(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  request: ModelProviderAdapterRequest,
  sink: ModelProviderEventSink,
  signal?: AbortSignal,
): Promise<ModelProviderAdapterResult> {
  const control = createRequestControl(signal);
  const accumulator = new ResponsesAccumulator(request.runId, sink);
  try {
    const response = await fetchWithRetry(fetchImpl, endpoint, requestInit(apiKey, body, control.signal), 3);
    if (!response.ok) throw await httpError(response, request.messages);
    if (!response.body) throw wireError("provider_stream_missing", "Responses endpoint returned no stream body", "provider");
    await readSse(response.body, (event) => {
      accumulator.consume(event);
      control.activity();
    }, control.signal);
    if (signal?.aborted) return accumulator.result(true);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return accumulator.result(true);
    if (control.timeoutReason) throw timeoutError(control.timeoutReason, endpoint);
    throw error;
  } finally {
    control.cleanup();
  }
}

class ResponsesAccumulator {
  private content = "";
  private usage?: ModelProviderUsage;
  private terminal = false;
  private readonly toolsByItem = new Map<string, ToolStreamState>();
  private readonly completedTools = new Map<string, ToolCall>();

  constructor(
    private readonly runId: string,
    private readonly sink: ModelProviderEventSink,
  ) {}

  consume(event: unknown): void {
    if (!isObject(event)) throw wireError("provider_sse_event_invalid", "Responses stream event must be an object", "provider");
    const type = typeof event.type === "string" ? event.type : "";
    if (this.terminal) throw wireError("provider_sse_event_invalid", "Responses stream emitted data after its terminal event", "provider");

    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
      this.appendText(event.delta);
      return;
    }
    if (type === "response.output_item.added") {
      if (isObject(event.item) && event.item.type === "function_call") this.startTool(event.item, event.output_index);
      return;
    }
    if (type === "response.function_call_arguments.delta") {
      const state = this.requireToolState(event.item_id, event.output_index);
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!delta) throw wireError("provider_tool_delta_invalid", "function-call argument delta is empty", "provider");
      state.arguments += delta;
      this.sink.emit({ type: "tool.call.delta", callId: state.callId, argumentsDelta: delta, index: state.index });
      return;
    }
    if (type === "response.function_call_arguments.done") {
      this.completeTool(event.item_id, event.output_index, event.name, event.arguments);
      return;
    }
    if (type === "response.output_item.done") {
      if (isObject(event.item) && event.item.type === "function_call") this.completeToolItem(event.item, event.output_index);
      return;
    }
    if (type === "response.completed") {
      this.finishResponse(event.response);
      return;
    }
    if (type === "response.incomplete") {
      const response = isObject(event.response) ? event.response : {};
      const reason = isObject(response.incomplete_details) && typeof response.incomplete_details.reason === "string"
        ? response.incomplete_details.reason
        : "unknown";
      throw wireError(
        "provider_response_incomplete",
        `Responses generation ended incomplete: ${reason}`,
        reason.includes("token") ? "context_length" : "provider",
        false,
        undefined,
        { reason, partialContentLength: this.content.length },
      );
    }
    if (type === "response.failed") {
      const response = isObject(event.response) ? event.response : {};
      throw responseFailure(response.error);
    }
    if (type === "error" || type === "response.error") throw responseFailure(event.error || event);
  }

  finishResponse(value: unknown): void {
    if (!isObject(value)) throw wireError("provider_response_invalid", "Responses completion payload is missing", "provider");
    if (value.status === "incomplete") {
      const reason = isObject(value.incomplete_details) && typeof value.incomplete_details.reason === "string"
        ? value.incomplete_details.reason
        : "unknown";
      throw wireError("provider_response_incomplete", `Responses generation ended incomplete: ${reason}`, "context_length", false, undefined, { reason });
    }
    if (value.status === "failed" || value.error) throw responseFailure(value.error);
    if (value.status !== "completed") throw wireError("provider_response_invalid", `unexpected Responses status: ${String(value.status || "missing")}`, "provider");

    const output = Array.isArray(value.output) ? value.output : [];
    this.reconcileText(extractOutputText(output));
    output.forEach((item, index) => {
      if (isObject(item) && item.type === "function_call") this.completeToolItem(item, index);
    });
    this.usage = normalizeResponsesUsage(value.usage);
    if (this.usage) this.sink.emit({ type: "usage.updated", usage: this.usage });
    this.terminal = true;
  }

  result(aborted: boolean): ModelProviderAdapterResult {
    if (!aborted && !this.terminal) throw wireError("provider_stream_incomplete", "Responses stream closed without a terminal event", "network", true);
    const toolCalls = Array.from(this.completedTools.values());
    return {
      content: this.content,
      toolCalls,
      usage: this.usage,
      finishReason: aborted ? "interrupted" : toolCalls.length ? "tool_calls" : "stop",
      aborted,
    };
  }

  private appendText(value: unknown): void {
    const delta = typeof value === "string" ? value : "";
    if (!delta) return;
    this.content += delta;
    this.sink.emit({ type: "text.delta", delta });
  }

  private reconcileText(finalText: string): void {
    if (!finalText) return;
    if (!this.content) {
      this.appendText(finalText);
      return;
    }
    if (finalText === this.content) return;
    if (finalText.startsWith(this.content)) {
      this.appendText(finalText.slice(this.content.length));
      return;
    }
    throw wireError("provider_text_mismatch", "Responses final text does not match streamed text", "provider");
  }

  private startTool(item: Record<string, unknown>, indexValue: unknown): ToolStreamState {
    const itemId = requiredText(item.id, "function-call item id");
    const existing = this.toolsByItem.get(itemId);
    if (existing) return existing;
    const index = nonNegativeInteger(indexValue) ? Number(indexValue) : this.toolsByItem.size;
    const state: ToolStreamState = {
      itemId,
      index,
      callId: requiredText(item.call_id, "function-call call_id"),
      name: typeof item.name === "string" ? item.name : "",
      arguments: typeof item.arguments === "string" ? item.arguments : "",
      started: true,
      completed: false,
    };
    this.toolsByItem.set(itemId, state);
    this.sink.emit({ type: "tool.call.started", callId: state.callId, name: state.name || undefined, index });
    return state;
  }

  private requireToolState(itemIdValue: unknown, indexValue: unknown): ToolStreamState {
    const itemId = requiredText(itemIdValue, "function-call item id");
    const state = this.toolsByItem.get(itemId);
    if (!state) throw wireError("provider_tool_sequence_invalid", `function-call item was not announced: ${itemId}`, "provider");
    return state;
  }

  private completeTool(itemIdValue: unknown, indexValue: unknown, nameValue: unknown, argumentsValue: unknown): void {
    const state = this.requireToolState(itemIdValue, indexValue);
    if (typeof nameValue === "string" && nameValue) state.name = nameValue;
    if (typeof argumentsValue === "string") state.arguments = argumentsValue;
    this.emitToolCompletion(state);
  }

  private completeToolItem(item: Record<string, unknown>, indexValue: unknown): void {
    const itemId = requiredText(item.id, "function-call item id");
    const state = this.toolsByItem.get(itemId) || this.startTool(item, indexValue);
    if (typeof item.name === "string" && item.name) state.name = item.name;
    if (typeof item.arguments === "string") state.arguments = item.arguments;
    this.emitToolCompletion(state);
  }

  private emitToolCompletion(state: ToolStreamState): void {
    const call: ToolCall = {
      id: requiredText(state.callId, "function-call call_id"),
      type: "function",
      function: {
        name: requiredText(state.name, "function-call name"),
        arguments: state.arguments,
      },
    };
    if (state.completed) {
      const existing = this.completedTools.get(call.id);
      if (JSON.stringify(existing) !== JSON.stringify(call)) throw wireError("provider_tool_mismatch", "Responses repeated a function call with different final data", "provider");
      return;
    }
    state.completed = true;
    this.completedTools.set(call.id, call);
    this.sink.emit({ type: "tool.call.completed", call, index: state.index });
  }
}

function interruptedResult(): ModelProviderAdapterResult {
  return { content: "", toolCalls: [], finishReason: "interrupted", aborted: true };
}

function extractOutputText(output: unknown[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isObject(part) && part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
      if (isObject(part) && part.type === "refusal" && typeof part.refusal === "string") parts.push(part.refusal);
    }
  }
  return parts.join("");
}

function normalizeResponsesUsage(value: unknown): ModelProviderUsage | undefined {
  if (!isObject(value)) return undefined;
  const usage = value as ResponsesUsageWire;
  const normalized: ModelProviderUsage = {
    ...(nonNegativeNumber(usage.input_tokens) ? { inputTokens: usage.input_tokens } : {}),
    ...(nonNegativeNumber(usage.output_tokens) ? { outputTokens: usage.output_tokens } : {}),
    ...(nonNegativeNumber(usage.total_tokens) ? { totalTokens: usage.total_tokens } : {}),
    ...(nonNegativeNumber(usage.input_tokens_details?.cached_tokens) ? { cachedInputTokens: usage.input_tokens_details?.cached_tokens } : {}),
    ...(nonNegativeNumber(usage.output_tokens_details?.reasoning_tokens) ? { reasoningTokens: usage.output_tokens_details?.reasoning_tokens } : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function requestInit(apiKey: string, body: Record<string, unknown>, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredText(apiKey, "profile.apiKey")}`,
    },
    body: JSON.stringify(body),
    signal,
  };
}

async function fetchWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit, attempts: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        await response.arrayBuffer().catch(() => undefined);
        await delay(300 * (2 ** attempt), init.signal as AbortSignal | undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if ((init.signal as AbortSignal | undefined)?.aborted) throw error;
      if (attempt < attempts - 1) await delay(300 * (2 ** attempt), init.signal as AbortSignal | undefined);
    }
  }
  throw lastError instanceof Error ? lastError : wireError("provider_network_error", "Responses request failed after retries", "network", true);
}

async function httpError(response: Response, messages: ChatMessage[]): Promise<Error> {
  const text = (await response.text().catch(() => "")).slice(0, 800);
  const hasImage = messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"));
  const message = hasImage && [400, 415, 422].includes(response.status)
    ? `Responses endpoint rejected image input (HTTP ${response.status}): ${text}`
    : `Responses endpoint returned HTTP ${response.status}: ${text}`;
  return wireError(
    response.status === 401 ? "provider_authentication_failed" : response.status === 429 ? "provider_rate_limited" : "provider_http_error",
    message,
    response.status === 401 ? "authentication" : response.status === 403 ? "authorization" : response.status === 429 ? "rate_limit" : "provider",
    response.status === 429 || response.status >= 500,
    response.status,
  );
}

function responseFailure(value: unknown): Error {
  const error = isObject(value) ? value : {};
  const rawCode = typeof error.code === "string" ? error.code.trim() : "";
  const code = /^[a-z0-9_.-]{1,80}$/i.test(rawCode) ? rawCode : "provider_response_failed";
  const message = typeof error.message === "string" && error.message ? error.message : "Responses generation failed";
  return wireError(code, message, "provider", false, undefined, { providerCode: code });
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, onEvent, false);
    }
    buffer += decoder.decode();
    drainSseBuffer(buffer, onEvent, true);
  } finally {
    reader.releaseLock();
  }
}

function drainSseBuffer(buffer: string, onEvent: (event: unknown) => void, flush: boolean): string {
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(buffer);
    if (!boundary || boundary.index === undefined) break;
    const block = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    decodeSseBlock(block, onEvent);
  }
  if (flush && buffer.trim()) {
    decodeSseBlock(buffer, onEvent);
    return "";
  }
  return buffer;
}

function decodeSseBlock(block: string, onEvent: (event: unknown) => void): void {
  const data = block.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return;
  try {
    onEvent(JSON.parse(data));
  } catch (error) {
    if (isObject(error) && typeof error.code === "string") throw error;
    throw wireError("provider_sse_event_invalid", "Responses stream contained invalid JSON", "provider");
  }
}

function createRequestControl(callerSignal?: AbortSignal): {
  signal: AbortSignal;
  activity(): void;
  cleanup(): void;
  readonly timeoutReason: "idle" | "total" | null;
} {
  const controller = new AbortController();
  let timeoutReason: "idle" | "total" | null = null;
  let idleTimer: ReturnType<typeof setTimeout>;
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const totalTimer = setTimeout(() => {
    timeoutReason = "total";
    controller.abort();
  }, STREAM_TOTAL_TIMEOUT_MS);
  const activity = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutReason = "idle";
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  activity();
  return {
    signal: controller.signal,
    activity,
    cleanup() {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
    get timeoutReason() { return timeoutReason; },
  };
}

function responsesEndpoint(baseURL: string): string {
  let url: URL;
  try {
    url = new URL(requiredText(baseURL, "profile.baseURL"));
  } catch {
    throw wireError("provider_endpoint_invalid", "Responses base URL is invalid", "validation");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw wireError("provider_endpoint_insecure", "Responses endpoint must use HTTPS or loopback HTTP", "validation");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw wireError("provider_endpoint_invalid", "Responses base URL cannot contain credentials, query parameters, or a fragment", "validation");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/responses`;
  return url.toString();
}

function timeoutError(reason: "idle" | "total", endpoint: string): Error {
  const seconds = Math.round((reason === "idle" ? STREAM_IDLE_TIMEOUT_MS : STREAM_TOTAL_TIMEOUT_MS) / 1000);
  return wireError(
    "provider_timeout",
    `Responses ${reason} timeout after ${seconds}s at ${new URL(endpoint).origin}`,
    "timeout",
    true,
  );
}

function wireError(
  code: string,
  message: string,
  category: ModelProviderErrorCategory,
  retriable = false,
  status?: number,
  details?: Record<string, unknown>,
): Error {
  const error = new Error(message);
  Object.assign(error, { code, category, retriable, ...(status ? { status } : {}), ...(details ? { details } : {}) });
  return error;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw wireError("provider_request_invalid", `${field} must be a non-empty string`, "validation");
  return value.trim();
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1000 ? value : fallback;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
