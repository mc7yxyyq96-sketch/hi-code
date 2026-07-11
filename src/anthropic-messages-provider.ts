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
  isNonNegativeNumber,
  isPositiveInteger,
  isProviderRecord,
  providerTimeoutError,
  providerWireError,
  readProviderErrorText,
  readProviderJson,
  readProviderSse,
  requiredProviderText,
  secureProviderBaseUrl,
} from "./provider-http-transport.js";

const ANTHROPIC_ADAPTER_ID = "anthropic-messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8_192;

interface AnthropicDependencies {
  fetch?: typeof fetch;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: AnthropicToolResultContent };

type AnthropicToolResultContent = string | Array<
  { type: "text"; text: string } | { type: "image"; source: AnthropicImageSource }
>;

type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface TextBlockState {
  type: "text";
  stopped: boolean;
}

interface ToolBlockState {
  type: "tool";
  id: string;
  name: string;
  index: number;
  partialJson: string;
  initialInput?: Record<string, unknown>;
  stopped: boolean;
  completed: boolean;
}

interface IgnoredBlockState {
  type: "ignored";
  stopped: boolean;
}

type AnthropicBlockState = TextBlockState | ToolBlockState | IgnoredBlockState;

export function createAnthropicMessagesAdapter(
  profile: ModelProfile,
  dependencies: AnthropicDependencies = {},
): ModelProviderAdapter {
  const endpoint = anthropicMessagesEndpoint(profile.baseURL);
  const fetchImpl = dependencies.fetch || fetch;
  return {
    descriptor: {
      schemaVersion: 2,
      id: ANTHROPIC_ADAPTER_ID,
      name: "Anthropic Messages",
      version: "1.0.0",
      protocol: "anthropic.messages",
      model: requiredProviderText(profile.model, "profile.model"),
      capabilities: {
        "input.text": { support: "supported" },
        "input.image": { support: "supported" },
        "input.file": { support: "unsupported", reason: "Anthropic Files API lifecycle is outside HC-PROV-212" },
        "input.pdf": { support: "unsupported", reason: "PDF persistence and citation lifecycle require the attachment-store slice" },
        "tool.calling": { support: "supported" },
        "tool.streaming": { support: "supported" },
        "reasoning.summary": { support: "unsupported", reason: "raw thinking is never exposed; summarized-thinking events require a separately versioned Runtime contract" },
        "output.structured": { support: "unsupported", reason: "structured output negotiation is not enabled by this adapter" },
        usage: { support: "supported" },
        interruption: { support: "supported" },
      },
      limits: {
        ...(isPositiveInteger(profile.contextWindow) ? { contextTokens: profile.contextWindow } : {}),
      },
      metadata: {
        transport: "server-sent-events",
        anthropicVersion: ANTHROPIC_VERSION,
        reasoningPersistence: "disabled",
        credentialStorage: "model-profile",
      },
    },
    async run(request, sink, signal) {
      const body = buildAnthropicBody(profile, request);
      return request.mode === "complete"
        ? runAnthropicComplete(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal)
        : runAnthropicStream(fetchImpl, endpoint, profile.apiKey, body, request, sink, signal);
    },
  };
}

function buildAnthropicBody(profile: ModelProfile, request: ModelProviderAdapterRequest): Record<string, unknown> {
  const converted = toAnthropicMessages(request.messages);
  const tools = request.tools.map(toAnthropicTool);
  return {
    model: requiredProviderText(profile.model, "profile.model"),
    max_tokens: request.requirements.outputTokens || DEFAULT_MAX_TOKENS,
    messages: converted.messages,
    ...(converted.system ? { system: converted.system } : {}),
    ...(tools.length ? { tools, tool_choice: { type: "auto" } } : {}),
    stream: request.mode !== "complete",
  };
}

function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: AnthropicWireMessage[] } {
  const system: string[] = [];
  const output: AnthropicWireMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const value = messageTextOnly(message.content, "Anthropic system message");
      if (value) system.push(value);
      continue;
    }
    if (message.role === "tool") {
      appendAnthropicMessage(output, {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: requiredProviderText(message.tool_call_id, "tool result tool_use_id"),
          content: toAnthropicToolResultContent(message.content),
        }],
      });
      continue;
    }

    const role = message.role === "assistant" ? "assistant" : "user";
    const content = toAnthropicContent(role, message.content);
    if (role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        content.push({
          type: "tool_use",
          id: requiredProviderText(call.id, "assistant tool_use id"),
          name: requiredProviderText(call.function?.name, "assistant tool name"),
          input: parseToolArguments(call.function?.arguments, "assistant tool arguments"),
        });
      }
    }
    if (content.length) appendAnthropicMessage(output, { role, content });
  }
  if (!output.length) throw providerWireError("provider_messages_required", "Anthropic Messages requires at least one user or assistant message", "validation");
  return { system: system.join("\n\n"), messages: output };
}

function appendAnthropicMessage(output: AnthropicWireMessage[], message: AnthropicWireMessage): void {
  const previous = output.at(-1);
  if (previous?.role === message.role) {
    previous.content.push(...message.content);
    return;
  }
  output.push(message);
}

function toAnthropicContent(role: "user" | "assistant", content: ChatMessage["content"]): AnthropicContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const output: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) output.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "attachment_ref") {
      throw providerWireError("provider_attachment_unmaterialized", "Attachment references must be materialized before Anthropic transport", "validation");
    }
    if (role !== "user") {
      throw providerWireError("provider_image_role_invalid", "Anthropic image input must use the user role", "validation");
    }
    output.push({ type: "image", source: toAnthropicImage(part.image_url?.url) });
  }
  return output;
}

function toAnthropicToolResultContent(content: ChatMessage["content"]): AnthropicToolResultContent {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    if (part.type === "attachment_ref") {
      throw providerWireError("provider_attachment_unmaterialized", "Attachment references must be materialized before Anthropic transport", "validation");
    }
    return { type: "image" as const, source: toAnthropicImage(part.image_url?.url) };
  });
}

function toAnthropicImage(value: unknown): AnthropicImageSource {
  const image = requiredProviderText(value, "image_url");
  const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(image);
  if (data) return { type: "base64", media_type: data[1].toLowerCase(), data: data[2].replace(/\s+/g, "") };
  let url: URL;
  try {
    url = new URL(image);
  } catch {
    throw providerWireError("provider_image_invalid", "Anthropic image input must be a supported base64 data URL or HTTPS URL", "validation");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw providerWireError("provider_image_insecure", "Anthropic remote image input must use credential-free HTTPS", "validation");
  }
  return { type: "url", url: url.toString() };
}

function toAnthropicTool(tool: ToolSchema): Record<string, unknown> {
  if (tool?.type !== "function") throw providerWireError("provider_tool_invalid", "Anthropic tool must be a function schema", "validation");
  return {
    name: requiredProviderText(tool.function?.name, "tool name"),
    description: typeof tool.function?.description === "string" ? tool.function.description : "",
    input_schema: isProviderRecord(tool.function?.parameters) ? tool.function.parameters : {},
  };
}

async function runAnthropicComplete(
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
    const response = await fetchProviderWithRetry(fetchImpl, endpoint, anthropicRequestInit(apiKey, body, control.signal));
    if (!response.ok) throw await anthropicHttpError(response);
    const payload = await readProviderJson(response, "Anthropic Messages");
    const accumulator = new AnthropicAccumulator(request.runId, sink);
    accumulator.consumeComplete(payload);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return interruptedAnthropicResult();
    if (control.timeoutReason) throw providerTimeoutError(control.timeoutReason, endpoint, "Anthropic Messages");
    throw error;
  } finally {
    control.cleanup();
  }
}

async function runAnthropicStream(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  request: ModelProviderAdapterRequest,
  sink: ModelProviderEventSink,
  signal?: AbortSignal,
): Promise<ModelProviderAdapterResult> {
  const control = createProviderRequestControl(signal);
  const accumulator = new AnthropicAccumulator(request.runId, sink);
  try {
    const response = await fetchProviderWithRetry(fetchImpl, endpoint, anthropicRequestInit(apiKey, body, control.signal));
    if (!response.ok) throw await anthropicHttpError(response);
    if (!response.body) throw providerWireError("provider_stream_missing", "Anthropic Messages returned no stream body", "provider");
    await readProviderSse(response.body, (_name, event) => accumulator.consume(event), control);
    if (signal?.aborted) return accumulator.result(true);
    return accumulator.result(false);
  } catch (error) {
    if (signal?.aborted) return accumulator.result(true);
    if (control.timeoutReason) throw providerTimeoutError(control.timeoutReason, endpoint, "Anthropic Messages");
    throw error;
  } finally {
    control.cleanup();
  }
}

class AnthropicAccumulator {
  private content = "";
  private inputTokens?: number;
  private outputTokens?: number;
  private usage?: ModelProviderUsage;
  private stopReason = "";
  private started = false;
  private terminal = false;
  private readonly blocks = new Map<number, AnthropicBlockState>();
  private readonly completedTools = new Map<string, ToolCall>();

  constructor(
    private readonly runId: string,
    private readonly sink: ModelProviderEventSink,
  ) {}

  consume(event: Record<string, unknown>): void {
    const type = typeof event.type === "string" ? event.type : "";
    if (this.terminal) throw providerWireError("provider_sse_event_invalid", "Anthropic stream emitted data after message_stop", "provider");
    if (type === "ping") return;
    if (type === "error") throw anthropicStreamError(event.error);
    if (type === "message_start") {
      if (this.started) throw providerWireError("provider_sse_event_invalid", "Anthropic stream repeated message_start", "provider");
      const message = isProviderRecord(event.message) ? event.message : {};
      this.started = true;
      this.captureUsage(message.usage);
      return;
    }
    if (!this.started) throw providerWireError("provider_sse_event_invalid", "Anthropic stream output arrived before message_start", "provider");
    if (type === "content_block_start") {
      this.startBlock(event.index, event.content_block);
      return;
    }
    if (type === "content_block_delta") {
      this.updateBlock(event.index, event.delta);
      return;
    }
    if (type === "content_block_stop") {
      this.stopBlock(event.index);
      return;
    }
    if (type === "message_delta") {
      const delta = isProviderRecord(event.delta) ? event.delta : {};
      if (typeof delta.stop_reason === "string") this.stopReason = delta.stop_reason;
      this.captureUsage(event.usage);
      return;
    }
    if (type === "message_stop") {
      const active = Array.from(this.blocks.values()).find((block) => !block.stopped);
      if (active) throw providerWireError("provider_tool_sequence_invalid", "Anthropic message_stop arrived before content_block_stop", "provider");
      this.finishUsage();
      this.terminal = true;
      return;
    }
    // Anthropic may add event types. Unknown events are ignored by contract.
  }

  consumeComplete(payload: Record<string, unknown>): void {
    if (payload.type === "error" || payload.error) throw anthropicStreamError(payload.error || payload);
    if (payload.type !== "message" || payload.role !== "assistant" || !Array.isArray(payload.content)) {
      throw providerWireError("provider_response_invalid", "Anthropic completion payload is not an assistant Message", "provider");
    }
    this.started = true;
    for (const block of payload.content) {
      if (!isProviderRecord(block)) continue;
      if (block.type === "text") this.appendText(block.text);
      if (block.type === "tool_use") this.completeDirectTool(block);
      // thinking and redacted_thinking are intentionally neither persisted nor emitted.
    }
    this.stopReason = typeof payload.stop_reason === "string" ? payload.stop_reason : "";
    this.captureUsage(payload.usage);
    this.finishUsage();
    this.terminal = true;
  }

  result(aborted: boolean): ModelProviderAdapterResult {
    if (!aborted && !this.terminal) {
      throw providerWireError("provider_stream_incomplete", "Anthropic stream closed without message_stop", "network", true);
    }
    const toolCalls = Array.from(this.completedTools.values());
    return {
      content: this.content,
      toolCalls,
      usage: this.usage,
      finishReason: aborted ? "interrupted" : mapAnthropicStopReason(this.stopReason, toolCalls.length),
      aborted,
    };
  }

  private startBlock(indexValue: unknown, blockValue: unknown): void {
    const index = requiredBlockIndex(indexValue);
    if (this.blocks.has(index)) throw providerWireError("provider_tool_sequence_invalid", `Anthropic content block already started: ${index}`, "provider");
    const block = isProviderRecord(blockValue) ? blockValue : {};
    if (block.type === "text") {
      this.blocks.set(index, { type: "text", stopped: false });
      this.appendText(block.text);
      return;
    }
    if (block.type === "tool_use") {
      const id = requiredProviderText(block.id, "Anthropic tool_use id");
      const name = requiredProviderText(block.name, "Anthropic tool_use name");
      const initialInput = isProviderRecord(block.input) && Object.keys(block.input).length ? block.input : undefined;
      this.blocks.set(index, {
        type: "tool",
        id,
        name,
        index,
        partialJson: "",
        initialInput,
        stopped: false,
        completed: false,
      });
      this.sink.emit({ type: "tool.call.started", callId: id, name, index });
      return;
    }
    this.blocks.set(index, { type: "ignored", stopped: false });
  }

  private updateBlock(indexValue: unknown, deltaValue: unknown): void {
    const index = requiredBlockIndex(indexValue);
    const block = this.blocks.get(index);
    if (!block) throw providerWireError("provider_tool_sequence_invalid", `Anthropic delta has no announced content block: ${index}`, "provider");
    const delta = isProviderRecord(deltaValue) ? deltaValue : {};
    if (delta.type === "text_delta") {
      if (block.type !== "text") throw providerWireError("provider_tool_sequence_invalid", "Anthropic text delta targeted a non-text block", "provider");
      this.appendText(delta.text);
      return;
    }
    if (delta.type === "input_json_delta") {
      if (block.type !== "tool") throw providerWireError("provider_tool_sequence_invalid", "Anthropic tool delta targeted an unannounced tool block", "provider");
      const partial = typeof delta.partial_json === "string" ? delta.partial_json : "";
      if (!partial) return;
      block.partialJson += partial;
      this.sink.emit({ type: "tool.call.delta", callId: block.id, argumentsDelta: partial, index });
      return;
    }
    // thinking_delta and signature_delta are intentionally ignored. They are
    // not assistant text and this adapter does not advertise reasoning summary.
  }

  private stopBlock(indexValue: unknown): void {
    const index = requiredBlockIndex(indexValue);
    const block = this.blocks.get(index);
    if (!block) throw providerWireError("provider_tool_sequence_invalid", `Anthropic content_block_stop has no start: ${index}`, "provider");
    if (block.stopped) throw providerWireError("provider_tool_sequence_invalid", `Anthropic content block stopped twice: ${index}`, "provider");
    block.stopped = true;
    if (block.type !== "tool") return;
    const input = block.partialJson ? parseToolArguments(block.partialJson, "Anthropic streamed tool input") : (block.initialInput || {});
    const argumentsText = JSON.stringify(input);
    const call: ToolCall = { id: block.id, type: "function", function: { name: block.name, arguments: argumentsText } };
    block.completed = true;
    this.completedTools.set(call.id, call);
    this.sink.emit({ type: "tool.call.completed", call, index: block.index });
  }

  private completeDirectTool(block: Record<string, unknown>): void {
    const index = this.blocks.size;
    const call: ToolCall = {
      id: requiredProviderText(block.id, "Anthropic tool_use id"),
      type: "function",
      function: {
        name: requiredProviderText(block.name, "Anthropic tool_use name"),
        arguments: JSON.stringify(isProviderRecord(block.input) ? block.input : {}),
      },
    };
    this.sink.emit({ type: "tool.call.started", callId: call.id, name: call.function.name, index });
    if (call.function.arguments) this.sink.emit({ type: "tool.call.delta", callId: call.id, argumentsDelta: call.function.arguments, index });
    this.sink.emit({ type: "tool.call.completed", call, index });
    this.completedTools.set(call.id, call);
  }

  private appendText(value: unknown): void {
    const text = typeof value === "string" ? value : "";
    if (!text) return;
    this.content += text;
    this.sink.emit({ type: "text.delta", delta: text });
  }

  private captureUsage(value: unknown): void {
    if (!isProviderRecord(value)) return;
    if (isNonNegativeNumber(value.input_tokens)) this.inputTokens = value.input_tokens;
    if (isNonNegativeNumber(value.output_tokens)) this.outputTokens = value.output_tokens;
  }

  private finishUsage(): void {
    const usage: ModelProviderUsage = {
      ...(this.inputTokens !== undefined ? { inputTokens: this.inputTokens } : {}),
      ...(this.outputTokens !== undefined ? { outputTokens: this.outputTokens } : {}),
      ...(this.inputTokens !== undefined && this.outputTokens !== undefined ? { totalTokens: this.inputTokens + this.outputTokens } : {}),
    };
    if (!Object.keys(usage).length) return;
    this.usage = usage;
    this.sink.emit({ type: "usage.updated", usage });
  }
}

function anthropicRequestInit(apiKey: string, body: Record<string, unknown>, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requiredProviderText(apiKey, "profile.apiKey"),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  };
}

async function anthropicHttpError(response: Response): Promise<Error> {
  const text = await readProviderErrorText(response, "Anthropic Messages");
  let providerType = "";
  let providerMessage = text;
  try {
    const parsed = JSON.parse(text);
    if (isProviderRecord(parsed?.error)) {
      providerType = typeof parsed.error.type === "string" ? parsed.error.type : "";
      providerMessage = typeof parsed.error.message === "string" ? parsed.error.message : text;
    }
  } catch {
    // Keep the bounded response text for diagnostics.
  }
  const code = response.status === 401
    ? "provider_authentication_failed"
    : response.status === 403
      ? "provider_authorization_failed"
      : response.status === 429
        ? "provider_rate_limited"
        : response.status === 529
          ? "provider_overloaded"
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
    `Anthropic Messages returned HTTP ${response.status}: ${providerMessage}`,
    category,
    response.status === 429 || response.status === 529 || response.status >= 500,
    response.status,
    providerType ? { providerType } : undefined,
  );
}

function anthropicStreamError(value: unknown): Error {
  const error = isProviderRecord(value) ? value : {};
  const providerType = typeof error.type === "string" ? error.type : "provider_error";
  const message = typeof error.message === "string" ? error.message : "Anthropic stream failed";
  return providerWireError(
    providerType === "authentication_error" ? "provider_authentication_failed" : providerType,
    message,
    providerType === "authentication_error" ? "authentication" : providerType === "permission_error" ? "authorization" : providerType === "rate_limit_error" ? "rate_limit" : "provider",
    providerType === "overloaded_error" || providerType === "rate_limit_error",
    undefined,
    { providerType },
  );
}

function anthropicMessagesEndpoint(baseURL: string): string {
  const url = secureProviderBaseUrl(baseURL, "Anthropic Messages");
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/messages")) url.pathname = path;
  else if (!path) url.pathname = "/v1/messages";
  else url.pathname = `${path}/messages`;
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

function requiredBlockIndex(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw providerWireError("provider_sse_event_invalid", "Anthropic content block index must be a non-negative integer", "provider");
  }
  return Number(value);
}

function mapAnthropicStopReason(reason: string, toolCount: number): ModelProviderFinishReason {
  if (reason === "tool_use" || toolCount) return "tool_calls";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return "length";
  if (reason === "end_turn" || reason === "stop_sequence" || !reason) return "stop";
  return "unknown";
}

function interruptedAnthropicResult(): ModelProviderAdapterResult {
  return { content: "", toolCalls: [], finishReason: "interrupted", aborted: true };
}
