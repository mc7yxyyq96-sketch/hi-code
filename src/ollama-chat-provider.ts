import type { ModelProfile } from "./config.js";
import type { ChatMessage, ContentPart, ToolCall, ToolSchema } from "./llm.js";
import type {
  ModelProviderAdapter,
  ModelProviderAdapterRequest,
  ModelProviderAdapterResult,
  ModelProviderEventSink,
  ModelProviderFinishReason,
  ModelProviderUsage,
} from "./model-provider.js";
import {
  createProviderRequestControl,
  fetchProviderWithRetry,
  isFiniteNumber,
  isNonNegativeNumber,
  isPositiveInteger,
  isProviderRecord,
  providerTimeoutError,
  providerWireError,
  readProviderErrorText,
  readProviderJson,
  readProviderNdjson,
  requiredProviderText,
  secureProviderBaseUrl,
} from "./provider-http-transport.js";

const OLLAMA_ADAPTER_ID = "ollama-chat";
const NO_KEY_PLACEHOLDER = "sk-no-key-required";

interface OllamaDependencies {
  fetch?: typeof fetch;
}

interface OllamaWireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: Array<{
    type: "function";
    function: { index: number; name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaToolState {
  index: number;
  id: string;
  name: string;
  argumentsText: string;
  completed: boolean;
}

export function createOllamaChatAdapter(
  profile: ModelProfile,
  dependencies: OllamaDependencies = {},
): ModelProviderAdapter {
  const endpoint = ollamaChatEndpoint(profile.baseURL);
  const fetchImpl = dependencies.fetch || fetch;
  return {
    descriptor: {
      schemaVersion: 2,
      id: OLLAMA_ADAPTER_ID,
      name: "Ollama Native Chat",
      version: "1.0.0",
      protocol: "ollama.chat",
      model: requiredProviderText(profile.model, "profile.model"),
      capabilities: {
        "input.text": { support: "supported" },
        "input.image": { support: "conditional", reason: "the selected Ollama model must support image input" },
        "input.file": { support: "unsupported", reason: "Ollama native chat accepts inline messages and images, not managed files" },
        "input.pdf": { support: "unsupported", reason: "PDF extraction belongs to the attachment-store slice" },
        "tool.calling": { support: "conditional", reason: "the selected Ollama model must support tool calling" },
        "tool.streaming": { support: "conditional", reason: "tool calls are normalized at NDJSON message boundaries" },
        "reasoning.summary": { support: "unsupported", reason: "Ollama thinking is a raw trace, not a reviewed reasoning summary" },
        "output.structured": { support: "unsupported", reason: "format/schema negotiation is not enabled by this adapter" },
        usage: { support: "supported" },
        interruption: { support: "supported" },
      },
      limits: {
        ...(isPositiveInteger(profile.contextWindow) ? { contextTokens: profile.contextWindow } : {}),
      },
      metadata: {
        transport: "application/x-ndjson",
        reasoningPersistence: "disabled",
        credentialStorage: "model-profile",
      },
    },
    async run(request, sink, signal) {
      const body = buildOllamaBody(profile, request);
      return request.mode === "complete"
        ? runOllamaComplete(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal)
        : runOllamaStream(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal);
    },
  };
}

function buildOllamaBody(profile: ModelProfile, request: ModelProviderAdapterRequest): Record<string, unknown> {
  const temperature = isFiniteNumber(request.temperature) ? request.temperature : profile.temperature;
  const options: Record<string, unknown> = {};
  if (isFiniteNumber(temperature)) options.temperature = temperature;
  if (request.requirements.outputTokens) options.num_predict = request.requirements.outputTokens;
  return {
    model: requiredProviderText(profile.model, "profile.model"),
    messages: toOllamaMessages(request.messages),
    ...(request.tools.length ? { tools: request.tools.map(toOllamaTool) } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    stream: request.mode !== "complete",
    // Ollama's message.thinking is raw reasoning, not a summary. Keep it off
    // unless a future version introduces a reviewed, typed summary contract.
    think: false,
  };
}

function toOllamaMessages(messages: ChatMessage[]): OllamaWireMessage[] {
  const output: OllamaWireMessage[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role === "tool") {
      output.push({
        role: "tool",
        content: messageTextOnly(message.content, "Ollama tool result"),
        tool_name: resolveOllamaToolName(messages, messageIndex, message),
      });
      return;
    }

    const converted = messageContent(message);
    const wire: OllamaWireMessage = {
      role: message.role,
      content: converted.content,
      ...(converted.images.length ? { images: converted.images } : {}),
    };
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      wire.tool_calls = message.tool_calls.map((call, index) => ({
        type: "function",
        function: {
          index,
          name: requiredProviderText(call.function?.name, "Ollama assistant tool name"),
          arguments: parseToolArguments(call.function?.arguments, "Ollama assistant tool arguments"),
        },
      }));
    }
    output.push(wire);
  });
  if (!output.length) throw providerWireError("provider_messages_required", "Ollama chat requires at least one message", "validation");
  return output;
}

function messageContent(message: ChatMessage): { content: string; images: string[] } {
  if (typeof message.content === "string") return { content: message.content, images: [] };
  if (!Array.isArray(message.content)) return { content: "", images: [] };
  const text: string[] = [];
  const images: string[] = [];
  for (const part of message.content) {
    if (part.type === "text") {
      text.push(part.text);
      continue;
    }
    if (part.type === "attachment_ref") {
      throw providerWireError("provider_attachment_unmaterialized", "Attachment references must be materialized before Ollama transport", "validation");
    }
    if (message.role !== "user") {
      throw providerWireError("provider_image_role_invalid", "Ollama image input must use the user role", "validation");
    }
    images.push(toOllamaImage(part.image_url?.url));
  }
  return { content: text.join("\n"), images };
}

function toOllamaImage(value: unknown): string {
  const image = requiredProviderText(value, "image_url");
  const data = /^data:image\/(?:png|jpeg|gif|webp);base64,([a-z0-9+/=\r\n]+)$/i.exec(image);
  if (!data) {
    throw providerWireError("provider_image_invalid", "Ollama native image input must be a supported base64 data URL", "validation");
  }
  return data[1].replace(/\s+/g, "");
}

function resolveOllamaToolName(messages: ChatMessage[], messageIndex: number, result: ChatMessage): string {
  if (typeof result.name === "string" && result.name.trim()) return result.name.trim();
  const callId = requiredProviderText(result.tool_call_id, "Ollama tool result call id");
  for (let index = messageIndex - 1; index >= 0; index--) {
    const calls = messages[index].tool_calls;
    const match = Array.isArray(calls) ? calls.find((call) => call.id === callId) : undefined;
    if (match) return requiredProviderText(match.function?.name, "Ollama tool result name");
  }
  throw providerWireError("provider_tool_result_unmatched", `Ollama tool result has no matching assistant call: ${callId}`, "validation");
}

function toOllamaTool(tool: ToolSchema): Record<string, unknown> {
  if (tool?.type !== "function") throw providerWireError("provider_tool_invalid", "Ollama tool must be a function schema", "validation");
  return {
    type: "function",
    function: {
      name: requiredProviderText(tool.function?.name, "Ollama tool name"),
      description: typeof tool.function?.description === "string" ? tool.function.description : "",
      parameters: isProviderRecord(tool.function?.parameters) ? tool.function.parameters : {},
    },
  };
}

async function runOllamaComplete(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  request: ModelProviderAdapterRequest,
  sink: ModelProviderEventSink,
  signal?: AbortSignal,
): Promise<ModelProviderAdapterResult> {
  const control = createProviderRequestControl(signal);
  try {
    const response = await fetchProviderWithRetry(fetchImpl, endpoint, ollamaRequestInit(apiKey, body, control.signal));
    if (!response.ok) throw await ollamaHttpError(response);
    const payload = await readProviderJson(response, "Ollama chat");
    const accumulator = new OllamaAccumulator(request.runId, sink);
    accumulator.consume(payload);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return interruptedOllamaResult();
    if (control.timeoutReason) throw providerTimeoutError(control.timeoutReason, endpoint, "Ollama chat");
    throw error;
  } finally {
    control.cleanup();
  }
}

async function runOllamaStream(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  request: ModelProviderAdapterRequest,
  sink: ModelProviderEventSink,
  signal?: AbortSignal,
): Promise<ModelProviderAdapterResult> {
  const control = createProviderRequestControl(signal);
  const accumulator = new OllamaAccumulator(request.runId, sink);
  try {
    const response = await fetchProviderWithRetry(fetchImpl, endpoint, ollamaRequestInit(apiKey, body, control.signal));
    if (!response.ok) throw await ollamaHttpError(response);
    if (!response.body) throw providerWireError("provider_stream_missing", "Ollama chat returned no stream body", "provider");
    await readProviderNdjson(response.body, (value) => accumulator.consume(value), control);
    if (signal?.aborted) return accumulator.result(true);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return accumulator.result(true);
    if (control.timeoutReason) throw providerTimeoutError(control.timeoutReason, endpoint, "Ollama chat");
    throw error;
  } finally {
    control.cleanup();
  }
}

class OllamaAccumulator {
  private content = "";
  private usage?: ModelProviderUsage;
  private doneReason = "";
  private terminal = false;
  private readonly tools = new Map<number, OllamaToolState>();

  constructor(
    private readonly runId: string,
    private readonly sink: ModelProviderEventSink,
  ) {}

  consume(value: Record<string, unknown>): void {
    if (this.terminal) throw providerWireError("provider_ndjson_invalid", "Ollama stream emitted data after done=true", "provider");
    if (typeof value.error === "string" && value.error) {
      throw providerWireError("provider_stream_error", value.error, "provider", false, undefined, { transport: "ollama" });
    }
    const message = isProviderRecord(value.message) ? value.message : {};
    this.appendText(message.content);
    // message.thinking is intentionally discarded. It is raw chain-of-thought,
    // not a reasoning summary and must not enter Runtime or persistence.
    if (Array.isArray(message.tool_calls)) this.captureTools(message.tool_calls);

    if (value.done === true) {
      this.doneReason = typeof value.done_reason === "string" ? value.done_reason : "";
      this.completeTools();
      this.usage = normalizeOllamaUsage(value);
      if (this.usage) this.sink.emit({ type: "usage.updated", usage: this.usage });
      this.terminal = true;
    }
  }

  result(aborted: boolean): ModelProviderAdapterResult {
    if (!aborted && !this.terminal) {
      throw providerWireError("provider_stream_incomplete", "Ollama stream closed without done=true", "network", true);
    }
    const toolCalls = Array.from(this.tools.values()).filter((state) => state.completed).map((state) => ({
      id: state.id,
      type: "function" as const,
      function: { name: state.name, arguments: state.argumentsText },
    }));
    return {
      content: this.content,
      toolCalls,
      usage: this.usage,
      finishReason: aborted ? "interrupted" : mapOllamaDoneReason(this.doneReason, toolCalls.length),
      aborted,
    };
  }

  private appendText(value: unknown): void {
    const text = typeof value === "string" ? value : "";
    if (!text) return;
    this.content += text;
    this.sink.emit({ type: "text.delta", delta: text });
  }

  private captureTools(calls: unknown[]): void {
    calls.forEach((value, fallbackIndex) => {
      const call = isProviderRecord(value) ? value : {};
      const fn = isProviderRecord(call.function) ? call.function : {};
      const index = Number.isInteger(fn.index) && Number(fn.index) >= 0 ? Number(fn.index) : fallbackIndex;
      const name = requiredProviderText(fn.name, "Ollama tool name");
      const argumentsText = normalizeOllamaArguments(fn.arguments);
      const existing = this.tools.get(index);
      if (existing) {
        if (existing.name !== name || existing.argumentsText !== argumentsText) {
          throw providerWireError("provider_tool_mismatch", `Ollama repeated tool index ${index} with different data`, "provider");
        }
        return;
      }
      const id = `ollama_${this.runId}_${index}`;
      const state: OllamaToolState = { index, id, name, argumentsText, completed: false };
      this.tools.set(index, state);
      this.sink.emit({ type: "tool.call.started", callId: id, name, index });
      if (argumentsText) this.sink.emit({ type: "tool.call.delta", callId: id, argumentsDelta: argumentsText, index });
    });
  }

  private completeTools(): void {
    for (const state of Array.from(this.tools.values()).sort((a, b) => a.index - b.index)) {
      if (state.completed) continue;
      const call: ToolCall = {
        id: state.id,
        type: "function",
        function: { name: state.name, arguments: state.argumentsText },
      };
      state.completed = true;
      this.sink.emit({ type: "tool.call.completed", call, index: state.index });
    }
  }
}

function ollamaRequestInit(apiKey: string, body: Record<string, unknown>, signal: AbortSignal): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key && key !== NO_KEY_PLACEHOLDER) headers.authorization = `Bearer ${key}`;
  return { method: "POST", headers, body: JSON.stringify(body), signal };
}

async function ollamaHttpError(response: Response): Promise<Error> {
  const text = await readProviderErrorText(response, "Ollama chat");
  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error === "string") message = parsed.error;
  } catch {
    // Keep the bounded response text for diagnostics.
  }
  const code = response.status === 401
    ? "provider_authentication_failed"
    : response.status === 403
      ? "provider_authorization_failed"
      : response.status === 429
        ? "provider_rate_limited"
        : "provider_http_error";
  const category = response.status === 401
    ? "authentication"
    : response.status === 403
      ? "authorization"
      : response.status === 429
        ? "rate_limit"
        : "provider";
  return providerWireError(
    code,
    `Ollama chat returned HTTP ${response.status}: ${message}`,
    category,
    response.status === 429 || response.status >= 500,
    response.status,
  );
}

function ollamaChatEndpoint(baseURL: string): string {
  const url = secureProviderBaseUrl(baseURL, "Ollama chat");
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api/chat")) url.pathname = path;
  else if (path.endsWith("/api")) url.pathname = `${path}/chat`;
  else url.pathname = `${path}/api/chat`.replace(/^\/\//, "/");
  return url.toString();
}

function messageTextOnly(content: ChatMessage["content"], label: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  if (content.some((part) => part.type !== "text")) {
    throw providerWireError("provider_message_invalid", `${label} accepts text only`, "validation");
  }
  return content.filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n");
}

function parseToolArguments(value: unknown, label: string): Record<string, unknown> {
  const source = typeof value === "string" && value.trim() ? value : "{}";
  try {
    const parsed = JSON.parse(source);
    if (!isProviderRecord(parsed)) throw new Error("tool arguments are not an object");
    return parsed;
  } catch {
    throw providerWireError("provider_tool_arguments_invalid", `${label} must be a JSON object`, "validation");
  }
}

function normalizeOllamaArguments(value: unknown): string {
  if (isProviderRecord(value)) return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(parseToolArguments(value, "Ollama streamed tool arguments"));
  if (value === undefined || value === null) return "{}";
  throw providerWireError("provider_tool_arguments_invalid", "Ollama tool arguments must be an object", "provider");
}

function normalizeOllamaUsage(value: Record<string, unknown>): ModelProviderUsage | undefined {
  const input = isNonNegativeNumber(value.prompt_eval_count) ? value.prompt_eval_count : undefined;
  const output = isNonNegativeNumber(value.eval_count) ? value.eval_count : undefined;
  const usage: ModelProviderUsage = {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(input !== undefined && output !== undefined ? { totalTokens: input + output } : {}),
  };
  return Object.keys(usage).length ? usage : undefined;
}

function mapOllamaDoneReason(reason: string, toolCount: number): ModelProviderFinishReason {
  if (toolCount) return "tool_calls";
  if (reason === "length" || reason === "max_tokens") return "length";
  if (reason === "stop" || !reason) return "stop";
  return "unknown";
}

function interruptedOllamaResult(): ModelProviderAdapterResult {
  return { content: "", toolCalls: [], finishReason: "interrupted", aborted: true };
}
