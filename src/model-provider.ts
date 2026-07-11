import crypto from "node:crypto";

import type { ModelProfile } from "./config.js";
import {
  complete,
  streamChat,
  type AssistantTurn,
  type ChatMessage,
  type StreamHandlers,
  type ToolCall,
  type ToolCallStreamDelta,
  type ToolSchema,
} from "./llm.js";

export const MODEL_PROVIDER_SCHEMA_VERSION = 2;

export const MODEL_PROVIDER_CAPABILITY_IDS = [
  "input.text",
  "input.image",
  "input.file",
  "input.pdf",
  "tool.calling",
  "tool.streaming",
  "reasoning.summary",
  "output.structured",
  "usage",
  "interruption",
] as const;

export type ModelProviderCapabilityId = (typeof MODEL_PROVIDER_CAPABILITY_IDS)[number];
export type ModelProviderSupport = "supported" | "conditional" | "unsupported";

export interface ModelProviderCapability {
  support: ModelProviderSupport;
  reason?: string;
}

export type ModelProviderCapabilities = Partial<Record<ModelProviderCapabilityId, ModelProviderCapability>>;

export interface ModelProviderLimits {
  contextTokens?: number;
  outputTokens?: number;
}

export interface ModelProviderDescriptor {
  schemaVersion: typeof MODEL_PROVIDER_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  protocol?: string;
  model?: string;
  capabilities: ModelProviderCapabilities;
  limits: ModelProviderLimits;
  metadata?: Record<string, unknown>;
}

export interface ModelProviderRequirements {
  capabilities: ModelProviderCapabilityId[];
  contextTokens?: number;
  outputTokens?: number;
}

export interface ModelProviderNegotiationIssue {
  capability?: ModelProviderCapabilityId;
  code: string;
  message: string;
}

export interface ModelProviderNegotiation {
  ok: boolean;
  providerId: string;
  requirements: ModelProviderRequirements;
  unsupported: ModelProviderNegotiationIssue[];
  warnings: ModelProviderNegotiationIssue[];
}

export type ModelProviderErrorCategory =
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "timeout"
  | "network"
  | "context_length"
  | "capability"
  | "validation"
  | "cancelled"
  | "provider";

export interface ModelProviderError {
  code: string;
  category: ModelProviderErrorCategory;
  message: string;
  retriable: boolean;
  status?: number;
  details?: Record<string, unknown>;
}

export interface ModelProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export type ModelProviderFinishReason = "stop" | "tool_calls" | "length" | "interrupted" | "error" | "unknown";

export interface ModelProviderRunRequest {
  messages: ChatMessage[];
  tools: ToolSchema[];
  requirements?: Partial<ModelProviderRequirements>;
  mode?: "stream" | "complete";
  temperature?: number;
  runId?: string;
}

export interface ModelProviderAdapterRequest extends ModelProviderRunRequest {
  runId: string;
  requirements: ModelProviderRequirements;
}

export interface ModelProviderAdapterResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: ModelProviderUsage;
  finishReason: ModelProviderFinishReason;
  aborted: boolean;
}

export interface ModelProviderRunResult extends ModelProviderAdapterResult {
  providerId: string;
  runId: string;
  events: ModelProviderEvent[];
  warnings: ModelProviderNegotiationIssue[];
}

export type ModelProviderEventDraft =
  | { type: "text.delta"; delta: string }
  | { type: "tool.call.started"; callId: string; name?: string; index: number }
  | { type: "tool.call.delta"; callId: string; nameDelta?: string; argumentsDelta?: string; index: number }
  | { type: "tool.call.completed"; call: ToolCall; index: number }
  | { type: "usage.updated"; usage: ModelProviderUsage };

export type ModelProviderEvent =
  | ModelProviderBaseEvent<"request.started"> & { model?: string; requirements: ModelProviderRequirements }
  | ModelProviderBaseEvent<"text.delta"> & { delta: string }
  | ModelProviderBaseEvent<"tool.call.started"> & { callId: string; name?: string; index: number }
  | ModelProviderBaseEvent<"tool.call.delta"> & { callId: string; nameDelta?: string; argumentsDelta?: string; index: number }
  | ModelProviderBaseEvent<"tool.call.completed"> & { call: ToolCall; index: number }
  | ModelProviderBaseEvent<"usage.updated"> & { usage: ModelProviderUsage }
  | ModelProviderBaseEvent<"response.completed"> & { finishReason: ModelProviderFinishReason; contentLength: number; toolCallCount: number }
  | ModelProviderBaseEvent<"response.interrupted"> & { contentLength: number }
  | ModelProviderBaseEvent<"response.failed"> & { error: ModelProviderError };

interface ModelProviderBaseEvent<T extends string> {
  schemaVersion: typeof MODEL_PROVIDER_SCHEMA_VERSION;
  id: string;
  providerId: string;
  runId: string;
  sequence: number;
  createdAt: number;
  type: T;
}

export interface ModelProviderEventSink {
  emit(event: ModelProviderEventDraft): void;
}

export interface ModelProviderAdapter {
  descriptor: ModelProviderDescriptor;
  run(request: ModelProviderAdapterRequest, sink: ModelProviderEventSink, signal?: AbortSignal): Promise<ModelProviderAdapterResult>;
}

type FlatModelProviderAdapter = Omit<ModelProviderDescriptor, "schemaVersion" | "limits"> & {
  schemaVersion?: typeof MODEL_PROVIDER_SCHEMA_VERSION;
  limits?: ModelProviderLimits;
  run(request: ModelProviderAdapterRequest, sink: ModelProviderEventSink, signal?: AbortSignal): Promise<ModelProviderAdapterResult>;
};

export type ModelProviderRegistration = ModelProviderAdapter | FlatModelProviderAdapter;
export type ModelProviderEventListener = (event: ModelProviderEvent) => void;

export class ModelProviderRegistry {
  private readonly adapters = new Map<string, ModelProviderAdapter>();

  register(input: ModelProviderRegistration): ModelProviderDescriptor {
    const adapter = normalizeAdapter(input);
    if (this.adapters.has(adapter.descriptor.id)) throw providerException({
      code: "provider_already_registered",
      category: "validation",
      message: `model provider already registered: ${adapter.descriptor.id}`,
      retriable: false,
    });
    this.adapters.set(adapter.descriptor.id, adapter);
    return cloneDescriptor(adapter.descriptor);
  }

  list(): ModelProviderDescriptor[] {
    return Array.from(this.adapters.values())
      .map((adapter) => cloneDescriptor(adapter.descriptor))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ModelProviderDescriptor | null {
    const adapter = this.adapters.get(requiredProviderId(id));
    return adapter ? cloneDescriptor(adapter.descriptor) : null;
  }

  negotiate(id: string, requirements: Partial<ModelProviderRequirements> = {}): ModelProviderNegotiation {
    const adapter = this.requireAdapter(id);
    return negotiateModelProviderCapabilities(adapter.descriptor, normalizeRequirements(requirements));
  }

  async run(
    id: string,
    request: ModelProviderRunRequest,
    listener?: ModelProviderEventListener,
    signal?: AbortSignal,
  ): Promise<ModelProviderRunResult> {
    const adapter = this.requireAdapter(id);
    const derived = deriveModelProviderRequirements(request.messages, request.tools, { requireInterruption: !!signal });
    const requirements = mergeRequirements(derived, request.requirements);
    const negotiation = negotiateModelProviderCapabilities(adapter.descriptor, requirements);
    if (!negotiation.ok) throw negotiationException(negotiation);

    const runId = normalizeRunId(request.runId) || `model-run-${crypto.randomUUID()}`;
    const controller = new ModelProviderEventController(adapter.descriptor, runId, listener);
    controller.emitInternal({
      type: "request.started",
      model: adapter.descriptor.model,
      requirements,
    });

    try {
      const result = normalizeAdapterResult(await adapter.run({
        ...request,
        runId,
        requirements,
        messages: normalizeMessages(request.messages),
        tools: normalizeTools(request.tools),
      }, controller, signal));

      if (result.usage && !controller.hasUsage) controller.emit({ type: "usage.updated", usage: result.usage });
      if (result.aborted) {
        controller.emitInternal({ type: "response.interrupted", contentLength: result.content.length });
      } else {
        controller.emitInternal({
          type: "response.completed",
          finishReason: result.finishReason,
          contentLength: result.content.length,
          toolCallCount: result.toolCalls.length,
        });
      }
      return {
        ...result,
        providerId: adapter.descriptor.id,
        runId,
        events: controller.snapshot(),
        warnings: negotiation.warnings,
      };
    } catch (error) {
      const normalized = normalizeModelProviderError(error);
      if (!controller.terminal) controller.emitInternal({ type: "response.failed", error: normalized });
      throw providerException(normalized, controller.snapshot());
    }
  }

  private requireAdapter(id: string): ModelProviderAdapter {
    const key = requiredProviderId(id);
    const adapter = this.adapters.get(key);
    if (!adapter) throw providerException({
      code: "provider_not_found",
      category: "validation",
      message: `model provider not found: ${key}`,
      retriable: false,
    });
    return adapter;
  }
}

class ModelProviderEventController implements ModelProviderEventSink {
  private readonly events: ModelProviderEvent[] = [];
  private readonly toolStates = new Map<string, "started" | "completed">();
  private sequence = 0;
  terminal = false;
  hasUsage = false;

  constructor(
    private readonly descriptor: ModelProviderDescriptor,
    private readonly runId: string,
    private readonly listener?: ModelProviderEventListener,
  ) {}

  emit(draft: ModelProviderEventDraft): void {
    this.emitInternal(draft);
  }

  emitInternal(draft: ModelProviderEventDraft | ModelProviderTerminalDraft | ModelProviderRequestDraft): void {
    this.validateLifecycle(draft);
    const sequence = ++this.sequence;
    const event = Object.freeze({
      ...draft,
      schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
      id: `mpe-${this.runId}-${sequence}`,
      providerId: this.descriptor.id,
      runId: this.runId,
      sequence,
      createdAt: Date.now(),
    }) as ModelProviderEvent;
    this.events.push(event);
    try {
      this.listener?.(event);
    } catch {
      // Observers cannot abort the provider transport.
    }
  }

  snapshot(): ModelProviderEvent[] {
    return this.events.map((event) => ({ ...event })) as ModelProviderEvent[];
  }

  private validateLifecycle(draft: ModelProviderEventDraft | ModelProviderTerminalDraft | ModelProviderRequestDraft): void {
    if (this.terminal) throw invalidEvent("provider emitted an event after the terminal response");
    if (draft.type === "request.started") {
      if (this.sequence !== 0) throw invalidEvent("request.started must be the first provider event");
      return;
    }
    if (this.sequence === 0) throw invalidEvent("request.started is required before provider output");

    if (draft.type === "text.delta") {
      if (typeof draft.delta !== "string" || !draft.delta.length) throw invalidEvent("text.delta requires non-empty delta");
      return;
    }
    if (draft.type === "tool.call.started") {
      requiredCallId(draft.callId);
      if (this.toolStates.has(draft.callId)) throw invalidEvent(`tool call already started: ${draft.callId}`);
      this.toolStates.set(draft.callId, "started");
      return;
    }
    if (draft.type === "tool.call.delta") {
      requiredCallId(draft.callId);
      if (this.toolStates.get(draft.callId) !== "started") throw invalidEvent(`tool delta has no active call: ${draft.callId}`);
      if (!draft.nameDelta && !draft.argumentsDelta) throw invalidEvent("tool.call.delta requires nameDelta or argumentsDelta");
      return;
    }
    if (draft.type === "tool.call.completed") {
      const callId = requiredToolCall(draft.call).id;
      if (this.toolStates.get(callId) !== "started") throw invalidEvent(`tool completion has no active call: ${callId}`);
      this.toolStates.set(callId, "completed");
      return;
    }
    if (draft.type === "usage.updated") {
      normalizeUsage(draft.usage);
      this.hasUsage = true;
      return;
    }
    if (draft.type === "response.failed") draft.error = normalizeModelProviderError(draft.error);
    this.terminal = true;
  }
}

type ModelProviderRequestDraft = {
  type: "request.started";
  model?: string;
  requirements: ModelProviderRequirements;
};

type ModelProviderTerminalDraft =
  | { type: "response.completed"; finishReason: ModelProviderFinishReason; contentLength: number; toolCallCount: number }
  | { type: "response.interrupted"; contentLength: number }
  | { type: "response.failed"; error: ModelProviderError };

export function negotiateModelProviderCapabilities(
  descriptor: ModelProviderDescriptor,
  requirements: ModelProviderRequirements,
): ModelProviderNegotiation {
  const unsupported: ModelProviderNegotiationIssue[] = [];
  const warnings: ModelProviderNegotiationIssue[] = [];

  for (const id of requirements.capabilities) {
    const capability = descriptor.capabilities[id] || { support: "unsupported" as const, reason: "capability is not declared" };
    if (capability.support === "unsupported") {
      unsupported.push({ capability: id, code: "provider_capability_unsupported", message: `${id}: ${capability.reason || "unsupported"}` });
    } else if (capability.support === "conditional") {
      warnings.push({ capability: id, code: "provider_capability_conditional", message: `${id}: ${capability.reason || "provider or model support must be confirmed"}` });
    }
  }

  if (requirements.contextTokens && descriptor.limits.contextTokens && requirements.contextTokens > descriptor.limits.contextTokens) {
    unsupported.push({
      code: "provider_context_limit_exceeded",
      message: `requested context ${requirements.contextTokens} exceeds provider limit ${descriptor.limits.contextTokens}`,
    });
  }
  if (requirements.outputTokens && descriptor.limits.outputTokens && requirements.outputTokens > descriptor.limits.outputTokens) {
    unsupported.push({
      code: "provider_output_limit_exceeded",
      message: `requested output ${requirements.outputTokens} exceeds provider limit ${descriptor.limits.outputTokens}`,
    });
  }

  return { ok: unsupported.length === 0, providerId: descriptor.id, requirements, unsupported, warnings };
}

export function deriveModelProviderRequirements(
  messages: ChatMessage[],
  tools: ToolSchema[],
  options: { requireInterruption?: boolean; contextTokens?: number; outputTokens?: number } = {},
): ModelProviderRequirements {
  const capabilities = new Set<ModelProviderCapabilityId>(["input.text"]);
  for (const message of messages || []) {
    if (!Array.isArray(message.content)) continue;
    if (message.content.some((part) => part.type === "image_url")) capabilities.add("input.image");
  }
  if (tools?.length) {
    capabilities.add("tool.calling");
    capabilities.add("tool.streaming");
  }
  if (options.requireInterruption) capabilities.add("interruption");
  return {
    capabilities: [...capabilities],
    ...(positiveInteger(options.contextTokens) ? { contextTokens: options.contextTokens } : {}),
    ...(positiveInteger(options.outputTokens) ? { outputTokens: options.outputTokens } : {}),
  };
}

export interface LegacyModelProfileMigration {
  schemaVersion: typeof MODEL_PROVIDER_SCHEMA_VERSION;
  source: "legacy-model-profile";
  adapterId: "legacy-openai-compatible";
  profile: ModelProfile;
  descriptor: ModelProviderDescriptor;
}

export function migrateLegacyModelProfile(profile: ModelProfile): LegacyModelProfileMigration {
  const adapter = createLegacyOpenAICompatibleAdapter(profile);
  return {
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
    source: "legacy-model-profile",
    adapterId: "legacy-openai-compatible",
    profile,
    descriptor: adapter.descriptor,
  };
}

interface LegacyTransportDependencies {
  stream?: typeof streamChat;
  complete?: typeof complete;
}

export function createLegacyOpenAICompatibleAdapter(
  profile: ModelProfile,
  dependencies: LegacyTransportDependencies = {},
): ModelProviderAdapter {
  const streamTransport = dependencies.stream || streamChat;
  const completeTransport = dependencies.complete || complete;
  const descriptor: ModelProviderDescriptor = {
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
    id: "legacy-openai-compatible",
    name: "OpenAI-compatible Chat Completions",
    version: "2.0.0",
    protocol: "openai.chat.completions",
    model: requiredString(profile.model, "profile.model"),
    capabilities: {
      "input.text": { support: "supported" },
      "input.image": { support: "conditional", reason: "the configured endpoint and model must accept image_url content" },
      "input.file": { support: "unsupported", reason: "file upload is not part of Chat Completions compatibility" },
      "input.pdf": { support: "unsupported", reason: "PDF input requires a provider-specific adapter" },
      "tool.calling": { support: "supported" },
      "tool.streaming": { support: "supported" },
      "reasoning.summary": { support: "unsupported", reason: "reasoning summaries require a provider-specific adapter" },
      "output.structured": { support: "unsupported", reason: "structured output negotiation is not implemented by the compatibility transport" },
      usage: { support: "conditional", reason: "the endpoint may omit stream usage" },
      interruption: { support: "supported" },
    },
    limits: { contextTokens: positiveInteger(profile.contextWindow) ? profile.contextWindow : undefined },
    metadata: { migrationSource: "ModelProfile", credentialStorage: "legacy-config" },
  };

  return {
    descriptor,
    async run(request, sink, signal) {
      if (request.mode === "complete") {
        const content = await completeTransport(profile, request.messages, request.temperature ?? 0.3);
        if (content) sink.emit({ type: "text.delta", delta: content });
        return { content, toolCalls: [], finishReason: "stop", aborted: false };
      }

      const toolIds = new Map<number, string>();
      const started = new Set<number>();
      const turn = await streamTransport(profile, request.messages, request.tools, {
        onText(delta) {
          sink.emit({ type: "text.delta", delta });
        },
        onToolCallDelta(delta: ToolCallStreamDelta) {
          const callId = delta.id || toolIds.get(delta.index) || `call_${delta.index}`;
          toolIds.set(delta.index, callId);
          if (!started.has(delta.index)) {
            started.add(delta.index);
            sink.emit({ type: "tool.call.started", callId, name: delta.nameDelta, index: delta.index });
          }
          if (delta.nameDelta || delta.argumentsDelta) {
            sink.emit({
              type: "tool.call.delta",
              callId,
              index: delta.index,
              ...(delta.nameDelta ? { nameDelta: delta.nameDelta } : {}),
              ...(delta.argumentsDelta ? { argumentsDelta: delta.argumentsDelta } : {}),
            });
          }
        },
      }, signal);

      if (!turn.aborted) {
        turn.tool_calls.forEach((call, index) => {
          const callId = call.id || toolIds.get(index) || `call_${index}`;
          if (!started.has(index)) sink.emit({ type: "tool.call.started", callId, name: call.function.name, index });
          sink.emit({ type: "tool.call.completed", call, index });
        });
      }
      const usage = legacyUsage(turn.usage);
      if (usage) sink.emit({ type: "usage.updated", usage });
      return {
        content: turn.content,
        toolCalls: turn.tool_calls,
        usage,
        finishReason: turn.aborted ? "interrupted" : turn.tool_calls.length ? "tool_calls" : "stop",
        aborted: !!turn.aborted,
      };
    },
  };
}

export interface ModelStreamHandlers extends StreamHandlers {
  onProviderEvent?: ModelProviderEventListener;
  requirements?: Partial<ModelProviderRequirements>;
}

export async function streamModelProfile(
  profile: ModelProfile,
  messages: ChatMessage[],
  tools: ToolSchema[],
  handlers: ModelStreamHandlers = {},
  signal?: AbortSignal,
): Promise<AssistantTurn> {
  const registry = new ModelProviderRegistry();
  const adapter = createLegacyOpenAICompatibleAdapter(profile);
  registry.register(adapter);
  const result = await registry.run(adapter.descriptor.id, {
    messages,
    tools,
    requirements: handlers.requirements,
    mode: "stream",
  }, (event) => {
    handlers.onProviderEvent?.(event);
    if (event.type === "text.delta") handlers.onText?.(event.delta);
    if (event.type === "tool.call.started") handlers.onToolCallStart?.(event.name || "tool");
    if (event.type === "tool.call.delta") handlers.onToolCallDelta?.({
      index: event.index,
      id: event.callId,
      nameDelta: event.nameDelta,
      argumentsDelta: event.argumentsDelta,
    });
  }, signal);
  return {
    content: result.content,
    tool_calls: result.toolCalls,
    usage: result.usage ? {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
    } : undefined,
    aborted: result.aborted,
  };
}

export async function completeModelProfile(
  profile: ModelProfile,
  messages: ChatMessage[],
  temperature = 0.3,
  listener?: ModelProviderEventListener,
): Promise<string> {
  const registry = new ModelProviderRegistry();
  const adapter = createLegacyOpenAICompatibleAdapter(profile);
  registry.register(adapter);
  const result = await registry.run(adapter.descriptor.id, {
    messages,
    tools: [],
    mode: "complete",
    temperature,
  }, listener);
  return result.content;
}

export function normalizeModelProviderError(error: unknown): ModelProviderError {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const original = error instanceof Error ? error.message : typeof error === "string" ? error : String(source.message || "model provider request failed");
  const message = redactSensitiveText(original || "model provider request failed");
  const status = finiteStatus(source.status);
  const existingCode = typeof source.code === "string" && source.code.trim() ? source.code.trim() : "";
  const lower = original.toLowerCase();

  let category: ModelProviderErrorCategory = "provider";
  let code = existingCode || "provider_request_failed";
  let retriable = false;

  if (existingCode.startsWith("provider_capability_") || existingCode.includes("limit_exceeded")) {
    category = existingCode.includes("context") ? "context_length" : "capability";
  } else if (existingCode === "provider_event_invalid" || existingCode === "provider_not_found" || existingCode === "provider_already_registered") {
    category = "validation";
  } else if (source.name === "AbortError" || lower.includes("aborted") || lower.includes("cancelled")) {
    category = "cancelled";
    code = existingCode || "provider_cancelled";
  } else if (status === 401 || lower.includes("unauthorized") || lower.includes("api key")) {
    category = "authentication";
    code = existingCode || "provider_authentication_failed";
  } else if (status === 403 || lower.includes("forbidden")) {
    category = "authorization";
    code = existingCode || "provider_authorization_failed";
  } else if (status === 429 || lower.includes("rate limit")) {
    category = "rate_limit";
    code = existingCode || "provider_rate_limited";
    retriable = true;
  } else if (lower.includes("context") && (lower.includes("length") || lower.includes("token"))) {
    category = "context_length";
    code = existingCode || "provider_context_length_exceeded";
  } else if (lower.includes("timed out") || lower.includes("timeout")) {
    category = "timeout";
    code = existingCode || "provider_timeout";
    retriable = true;
  } else if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("couldn't reach") || lower.includes("econn")) {
    category = "network";
    code = existingCode || "provider_network_error";
    retriable = true;
  } else if (status !== undefined && status >= 500) {
    retriable = true;
  }

  if (typeof source.retriable === "boolean") retriable = source.retriable;
  return {
    code,
    category,
    message,
    retriable,
    ...(status !== undefined ? { status } : {}),
    ...(source.details && typeof source.details === "object" && !Array.isArray(source.details)
      ? { details: sanitizeDetails(source.details as Record<string, unknown>) }
      : {}),
  };
}

function normalizeAdapter(input: ModelProviderRegistration): ModelProviderAdapter {
  if ("descriptor" in input) {
    return { descriptor: normalizeDescriptor(input.descriptor), run: input.run.bind(input) };
  }
  const { run, ...descriptor } = input;
  return {
    descriptor: normalizeDescriptor({ ...descriptor, schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION, limits: input.limits || {} }),
    run: run.bind(input),
  };
}

function normalizeDescriptor(input: ModelProviderDescriptor): ModelProviderDescriptor {
  const capabilities: ModelProviderCapabilities = {};
  for (const id of MODEL_PROVIDER_CAPABILITY_IDS) {
    const value = input.capabilities?.[id];
    if (!value) continue;
    if (!(["supported", "conditional", "unsupported"] as const).includes(value.support)) throw invalidEvent(`invalid capability support for ${id}`);
    capabilities[id] = { support: value.support, ...(value.reason ? { reason: redactSensitiveText(value.reason) } : {}) };
  }
  return {
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
    id: requiredProviderId(input.id),
    name: requiredString(input.name, "provider name"),
    version: requiredString(input.version, "provider version"),
    protocol: optionalString(input.protocol),
    model: optionalString(input.model),
    capabilities,
    limits: {
      ...(positiveInteger(input.limits?.contextTokens) ? { contextTokens: input.limits.contextTokens } : {}),
      ...(positiveInteger(input.limits?.outputTokens) ? { outputTokens: input.limits.outputTokens } : {}),
    },
    metadata: sanitizeDetails(input.metadata || {}),
  };
}

function cloneDescriptor(descriptor: ModelProviderDescriptor): ModelProviderDescriptor {
  return JSON.parse(JSON.stringify(descriptor)) as ModelProviderDescriptor;
}

function normalizeRequirements(input: Partial<ModelProviderRequirements>): ModelProviderRequirements {
  const capabilities = Array.from(new Set((input.capabilities || []).filter((id): id is ModelProviderCapabilityId => MODEL_PROVIDER_CAPABILITY_IDS.includes(id as ModelProviderCapabilityId))));
  return {
    capabilities,
    ...(positiveInteger(input.contextTokens) ? { contextTokens: input.contextTokens } : {}),
    ...(positiveInteger(input.outputTokens) ? { outputTokens: input.outputTokens } : {}),
  };
}

function mergeRequirements(derived: ModelProviderRequirements, explicit?: Partial<ModelProviderRequirements>): ModelProviderRequirements {
  const normalized = normalizeRequirements(explicit || {});
  return {
    capabilities: Array.from(new Set([...derived.capabilities, ...normalized.capabilities])),
    contextTokens: normalized.contextTokens ?? derived.contextTokens,
    outputTokens: normalized.outputTokens ?? derived.outputTokens,
  };
}

function normalizeAdapterResult(input: ModelProviderAdapterResult): ModelProviderAdapterResult {
  if (!input || typeof input !== "object") throw invalidEvent("provider result must be an object");
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls.map(requiredToolCall) : [];
  const usage = input.usage ? normalizeUsage(input.usage) : undefined;
  const finishReason = (["stop", "tool_calls", "length", "interrupted", "error", "unknown"] as const).includes(input.finishReason)
    ? input.finishReason
    : "unknown";
  return {
    content: typeof input.content === "string" ? input.content : "",
    toolCalls,
    usage,
    finishReason,
    aborted: input.aborted === true,
  };
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(messages) || !messages.length) throw providerException({
    code: "provider_messages_required",
    category: "validation",
    message: "model provider request requires messages",
    retriable: false,
  });
  return messages.map((message) => ({ ...message }));
}

function normalizeTools(tools: ToolSchema[]): ToolSchema[] {
  return Array.isArray(tools) ? tools.map((tool) => ({ ...tool, function: { ...tool.function } })) : [];
}

function normalizeUsage(input: ModelProviderUsage): ModelProviderUsage {
  const usage: ModelProviderUsage = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || Number(value) < 0) throw invalidEvent(`usage.${key} must be non-negative`);
    usage[key] = Math.round(Number(value));
  }
  if (usage.totalTokens === undefined && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) {
    usage.totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
  }
  return usage;
}

function legacyUsage(input: AssistantTurn["usage"]): ModelProviderUsage | undefined {
  if (!input) return undefined;
  return normalizeUsage({ inputTokens: input.prompt_tokens, outputTokens: input.completion_tokens });
}

function requiredToolCall(input: ToolCall): ToolCall {
  if (!input || input.type !== "function") throw invalidEvent("tool call must be a function call");
  const id = requiredCallId(input.id);
  const name = requiredString(input.function?.name, "tool call name");
  const args = typeof input.function?.arguments === "string" ? input.function.arguments : "";
  return { id, type: "function", function: { name, arguments: args } };
}

function requiredCallId(value: unknown): string {
  return requiredString(value, "tool call id");
}

function requiredProviderId(value: unknown): string {
  const id = requiredString(value, "provider id");
  if (!/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)) throw providerException({
    code: "provider_id_invalid",
    category: "validation",
    message: `invalid model provider id: ${redactSensitiveText(id)}`,
    retriable: false,
  });
  return id;
}

function normalizeRunId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = requiredString(value, "provider run id");
  if (!/^[a-z0-9][a-z0-9._-]{1,120}$/i.test(id)) throw invalidEvent("invalid provider run id");
  return id;
}

function negotiationException(result: ModelProviderNegotiation): Error {
  const first = result.unsupported[0];
  const code = first?.code || "provider_capability_unsupported";
  const category: ModelProviderErrorCategory = code.includes("context") ? "context_length" : "capability";
  return providerException({
    code,
    category,
    message: result.unsupported.map((issue) => issue.message).join("; ") || "model provider requirements are unsupported",
    retriable: false,
    details: { providerId: result.providerId, unsupported: result.unsupported },
  });
}

function invalidEvent(message: string): Error {
  return providerException({ code: "provider_event_invalid", category: "validation", message, retriable: false });
}

function providerException(error: ModelProviderError, events?: ModelProviderEvent[]): Error {
  const exception = new Error(error.message);
  Object.assign(exception, error, events ? { events } : {});
  return exception;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalidEvent(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function finiteStatus(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
}

function redactSensitiveText(value: string): string {
  return String(value || "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[a-z0-9._-]{6,}\b/gi, "[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/api.?key|authorization|token|secret|password|private.?key/i.test(key)) {
      output[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      output[key] = redactSensitiveText(value).slice(0, 1000);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.slice(0, 100).map((item) => typeof item === "string" ? redactSensitiveText(item).slice(0, 1000) : item);
    } else if (value && typeof value === "object") {
      output[key] = sanitizeDetails(value as Record<string, unknown>);
    }
  }
  return output;
}
