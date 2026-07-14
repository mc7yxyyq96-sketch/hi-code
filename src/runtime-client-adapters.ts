import type { RuntimeEventEnvelope, ToolEventStatus } from "./events.js";
import type { RuntimeEventBus, RuntimeEventFilter } from "./runtime-event-sink.js";

export interface AssistantMessageStart {
  event: Readonly<RuntimeEventEnvelope>;
  messageId: string;
  label?: string;
  model?: string;
}

export interface AssistantDelta extends AssistantMessageStart {
  delta: string;
  sequence?: number;
}

export interface AssistantMessageCompleted extends AssistantMessageStart {
  content: string;
  status: ToolEventStatus;
  finishReason?: string;
  hadDeltas: boolean;
}

export interface AssistantOutputAdapter {
  onStart?: (message: AssistantMessageStart) => void;
  onDelta: (message: AssistantDelta) => void;
  onCompleted?: (message: AssistantMessageCompleted) => void;
}

export interface AssistantTextOutputOptions {
  write: (text: string) => void;
  prefix?: (message: AssistantMessageStart) => string;
  suffix?: (message: AssistantMessageCompleted) => string;
  filter?: RuntimeEventFilter;
}

interface ActiveMessage {
  started: boolean;
  hadDeltas: boolean;
}

/** Project assistant protocol events into a client without exposing runtime internals. */
export function connectAssistantOutput(
  bus: Pick<RuntimeEventBus, "subscribe">,
  adapter: AssistantOutputAdapter,
  filter: RuntimeEventFilter = {},
): () => void {
  if (!bus || typeof bus.subscribe !== "function") throw new TypeError("assistant output requires a runtime event bus");
  if (!adapter || typeof adapter.onDelta !== "function") throw new TypeError("assistant output adapter requires onDelta");

  const active = new Map<string, ActiveMessage>();
  const unsubscribe = bus.subscribe((event) => {
    if (event.type !== "assistant:delta" && event.type !== "assistant:completed") return;
    const payload = event.payload || {};
    const messageId = stringValue(payload.messageId);
    if (!messageId) return;
    const key = `${event.sessionId}\u0000${messageId}`;
    const state = active.get(key) || { started: false, hadDeltas: false };
    const base: AssistantMessageStart = {
      event,
      messageId,
      label: optionalString(payload.label),
      model: optionalString(payload.model),
    };

    if (event.type === "assistant:delta") {
      const delta = stringValue(payload.delta);
      if (!delta) return;
      if (!state.started) {
        state.started = true;
        adapter.onStart?.(base);
      }
      state.hadDeltas = true;
      active.set(key, state);
      adapter.onDelta({
        ...base,
        delta,
        sequence: optionalFiniteNumber(payload.sequence),
      });
      return;
    }

    const content = stringValue(payload.content);
    if (!state.started && content) {
      state.started = true;
      adapter.onStart?.(base);
    }
    adapter.onCompleted?.({
      ...base,
      content,
      status: event.status || "done",
      finishReason: optionalString(payload.finishReason),
      hadDeltas: state.hadDeltas,
    });
    active.delete(key);
  }, {
    ...filter,
    types: ["assistant:delta", "assistant:completed"],
  });

  return () => {
    active.clear();
    unsubscribe();
  };
}

/** Render assistant events to a text stream without repeating completed content. */
export function connectAssistantTextOutput(
  bus: Pick<RuntimeEventBus, "subscribe">,
  options: AssistantTextOutputOptions,
): () => void {
  if (!options || typeof options.write !== "function") throw new TypeError("assistant text output requires write");
  return connectAssistantOutput(bus, {
    onStart: (message) => {
      const prefix = options.prefix?.(message) || "";
      if (prefix) options.write(prefix);
    },
    onDelta: (message) => options.write(message.delta),
    onCompleted: (message) => {
      if (!message.hadDeltas && message.content) options.write(message.content);
      if (message.hadDeltas || message.content) {
        options.write(options.suffix?.(message) ?? "\n");
      }
    },
  }, options.filter);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}
