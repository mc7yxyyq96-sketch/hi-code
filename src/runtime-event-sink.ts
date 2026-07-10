import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEventEnvelope,
  type RuntimeEventSink,
  type ToolEventType,
} from "./events.js";

export type RuntimeEventListener = (event: Readonly<RuntimeEventEnvelope>) => void;

export interface RuntimeEventFilter {
  sessionId?: string;
  turnId?: string;
  types?: readonly ToolEventType[];
}

export interface RuntimeEventBusOptions {
  onListenerError?: (error: unknown, event: Readonly<RuntimeEventEnvelope>) => void;
}

interface ListenerRegistration {
  listener: RuntimeEventListener;
  sessionId?: string;
  turnId?: string;
  types?: ReadonlySet<ToolEventType>;
}

/**
 * Synchronous in-process fan-out for already-materialized runtime events.
 * Persistence remains the runtime's responsibility so subscribers cannot
 * accidentally make durable delivery depend on a presentation client.
 */
export class RuntimeEventBus implements RuntimeEventSink {
  readonly #listeners = new Map<number, ListenerRegistration>();
  readonly #onListenerError?: RuntimeEventBusOptions["onListenerError"];
  #nextListenerId = 1;

  constructor(options: RuntimeEventBusOptions = {}) {
    this.#onListenerError = options.onListenerError;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: RuntimeEventListener, filter: RuntimeEventFilter = {}): () => void {
    if (typeof listener !== "function") throw new TypeError("runtime event listener must be a function");
    validateOptionalId(filter.sessionId, "sessionId");
    validateOptionalId(filter.turnId, "turnId");
    const types = filter.types ? validateTypes(filter.types) : undefined;
    const listenerId = this.#nextListenerId++;
    this.#listeners.set(listenerId, {
      listener,
      sessionId: filter.sessionId,
      turnId: filter.turnId,
      types,
    });

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listenerId);
    };
  }

  emit(event: RuntimeEventEnvelope): string {
    const snapshot = snapshotEvent(event);
    for (const registration of this.#listeners.values()) {
      if (!matches(registration, snapshot)) continue;
      try {
        registration.listener(snapshot);
      } catch (error) {
        try {
          this.#onListenerError?.(error, snapshot);
        } catch {
          // A diagnostic hook must never interrupt runtime event delivery.
        }
      }
    }
    return snapshot.id;
  }
}

function matches(
  registration: ListenerRegistration,
  event: Readonly<RuntimeEventEnvelope>,
): boolean {
  if (registration.sessionId && registration.sessionId !== event.sessionId) return false;
  if (registration.turnId && registration.turnId !== event.turnId) return false;
  if (registration.types && !registration.types.has(event.type)) return false;
  return true;
}

function snapshotEvent(event: RuntimeEventEnvelope): Readonly<RuntimeEventEnvelope> {
  if (!event || typeof event !== "object") throw new TypeError("runtime event must be an object");
  validateRequiredId(event.id, "id");
  validateRequiredId(event.sessionId, "sessionId");
  validateRequiredId(event.turnId, "turnId");
  if (!RUNTIME_EVENT_TYPES.includes(event.type)) throw new TypeError("runtime event type is not supported");
  if (typeof event.title !== "string" || !event.title.trim()) {
    throw new TypeError("runtime event title must be a non-empty string");
  }
  if (!Number.isFinite(event.createdAt)) throw new TypeError("runtime event createdAt must be finite");
  if (event.payload !== undefined && (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload))) {
    throw new TypeError("runtime event payload must be an object");
  }

  const payload = event.payload ? Object.freeze({ ...event.payload }) : undefined;
  return Object.freeze({ ...event, ...(payload ? { payload } : {}) });
}

function validateRequiredId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`runtime event ${field} must be a non-empty string`);
  }
}

function validateOptionalId(value: unknown, field: string): void {
  if (value === undefined) return;
  validateRequiredId(value, field);
}

function validateTypes(types: readonly ToolEventType[]): ReadonlySet<ToolEventType> {
  if (!Array.isArray(types) || !types.length) throw new TypeError("runtime event type filter must not be empty");
  const values = new Set<ToolEventType>();
  for (const type of types) {
    if (!RUNTIME_EVENT_TYPES.includes(type)) throw new TypeError(`unsupported runtime event type: ${String(type)}`);
    values.add(type);
  }
  return values;
}
