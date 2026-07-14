import type { ModelProviderErrorCategory } from "./model-provider.js";

const STREAM_IDLE_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_IDLE_MS", 120_000);
const STREAM_TOTAL_TIMEOUT_MS = readEnvMs("HI_CODE_STREAM_TOTAL_MS", 900_000);
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;
const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;

export interface ProviderRequestControl {
  signal: AbortSignal;
  activity(): void;
  cleanup(): void;
  readonly timeoutReason: "idle" | "total" | null;
}

export function secureProviderBaseUrl(baseURL: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(requiredProviderText(baseURL, "profile.baseURL"));
  } catch (error) {
    if (hasProviderCode(error)) throw error;
    throw providerWireError("provider_endpoint_invalid", `${label} base URL is invalid`, "validation");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw providerWireError("provider_endpoint_insecure", `${label} endpoint must use HTTPS or loopback HTTP`, "validation");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw providerWireError("provider_endpoint_invalid", `${label} base URL cannot contain credentials, query parameters, or a fragment`, "validation");
  }
  return url;
}

export function createProviderRequestControl(callerSignal?: AbortSignal): ProviderRequestControl {
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

export async function fetchProviderWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        await response.body?.cancel().catch(() => undefined);
        await providerDelay(300 * (2 ** attempt), init.signal as AbortSignal | undefined);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if ((init.signal as AbortSignal | undefined)?.aborted) throw error;
      if (attempt < attempts - 1) await providerDelay(300 * (2 ** attempt), init.signal as AbortSignal | undefined);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : providerWireError("provider_network_error", "provider request failed after retries", "network", true);
}

export async function readProviderJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const text = await readResponseText(response, MAX_JSON_BYTES, label);
  try {
    const parsed = JSON.parse(text);
    if (!isProviderRecord(parsed)) throw new Error("JSON root is not an object");
    return parsed;
  } catch (error) {
    if (hasProviderCode(error)) throw error;
    throw providerWireError("provider_response_invalid", `${label} returned invalid JSON`, "provider");
  }
}

export async function readProviderErrorText(response: Response, label: string): Promise<string> {
  return (await readResponseText(response, 64 * 1024, label)).slice(0, 4_000);
}

export async function readProviderSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventName: string, data: Record<string, unknown>) => void,
  control: ProviderRequestControl,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  try {
    while (true) {
      if (control.signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      enforceStreamBounds(totalBytes, buffer.length, "SSE");
      control.activity();
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSse(buffer, onEvent, false);
    }
    buffer += decoder.decode();
    drainSse(buffer, onEvent, true);
  } finally {
    reader.releaseLock();
  }
}

export async function readProviderNdjson(
  body: ReadableStream<Uint8Array>,
  onValue: (value: Record<string, unknown>) => void,
  control: ProviderRequestControl,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  try {
    while (true) {
      if (control.signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      enforceStreamBounds(totalBytes, buffer.length, "NDJSON");
      control.activity();
      buffer += decoder.decode(value, { stream: true });
      buffer = drainNdjson(buffer, onValue, false);
    }
    buffer += decoder.decode();
    drainNdjson(buffer, onValue, true);
  } finally {
    reader.releaseLock();
  }
}

export function providerTimeoutError(reason: "idle" | "total", endpoint: string, label: string): Error {
  const seconds = Math.round((reason === "idle" ? STREAM_IDLE_TIMEOUT_MS : STREAM_TOTAL_TIMEOUT_MS) / 1000);
  return providerWireError(
    "provider_timeout",
    `${label} ${reason} timeout after ${seconds}s at ${new URL(endpoint).origin}`,
    "timeout",
    true,
  );
}

export function providerWireError(
  code: string,
  message: string,
  category: ModelProviderErrorCategory,
  retriable = false,
  status?: number,
  details?: Record<string, unknown>,
): Error {
  const error = new Error(message);
  Object.assign(error, {
    code,
    category,
    retriable,
    ...(status !== undefined ? { status } : {}),
    ...(details ? { details } : {}),
  });
  return error;
}

export function requiredProviderText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw providerWireError("provider_request_invalid", `${field} must be a non-empty string`, "validation");
  }
  return value.trim();
}

export function isProviderRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function drainSse(
  input: string,
  onEvent: (eventName: string, data: Record<string, unknown>) => void,
  flush: boolean,
): string {
  let buffer = input;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(buffer);
    if (!boundary || boundary.index === undefined) break;
    decodeSseBlock(buffer.slice(0, boundary.index), onEvent);
    buffer = buffer.slice(boundary.index + boundary[0].length);
  }
  if (flush && buffer.trim()) {
    decodeSseBlock(buffer, onEvent);
    return "";
  }
  enforceStreamBounds(0, buffer.length, "SSE");
  return buffer;
}

function decodeSseBlock(
  block: string,
  onEvent: (eventName: string, data: Record<string, unknown>) => void,
): void {
  let eventName = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const payload = data.join("\n").trim();
  if (!payload || payload === "[DONE]") return;
  try {
    const parsed = JSON.parse(payload);
    if (!isProviderRecord(parsed)) throw new Error("SSE data is not an object");
    onEvent(eventName, parsed);
  } catch (error) {
    if (hasProviderCode(error)) throw error;
    throw providerWireError("provider_sse_event_invalid", "provider stream contained invalid SSE JSON", "provider");
  }
}

function drainNdjson(input: string, onValue: (value: Record<string, unknown>) => void, flush: boolean): string {
  let buffer = input;
  while (true) {
    const index = buffer.indexOf("\n");
    if (index < 0) break;
    decodeNdjsonLine(buffer.slice(0, index), onValue);
    buffer = buffer.slice(index + 1);
  }
  if (flush && buffer.trim()) {
    decodeNdjsonLine(buffer, onValue);
    return "";
  }
  enforceStreamBounds(0, buffer.length, "NDJSON");
  return buffer;
}

function decodeNdjsonLine(line: string, onValue: (value: Record<string, unknown>) => void): void {
  const value = line.trim();
  if (!value) return;
  try {
    const parsed = JSON.parse(value);
    if (!isProviderRecord(parsed)) throw new Error("NDJSON line is not an object");
    onValue(parsed);
  } catch (error) {
    if (hasProviderCode(error)) throw error;
    throw providerWireError("provider_ndjson_invalid", "provider stream contained invalid NDJSON", "provider");
  }
}

async function readResponseText(response: Response, maxBytes: number, label: string): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw providerWireError("provider_response_too_large", `${label} response exceeds the ${maxBytes}-byte limit`, "provider");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw providerWireError("provider_response_too_large", `${label} response exceeds the ${maxBytes}-byte limit`, "provider");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function enforceStreamBounds(totalBytes: number, bufferLength: number, label: string): void {
  if (totalBytes > MAX_STREAM_BYTES) {
    throw providerWireError("provider_stream_too_large", `${label} stream exceeds the ${MAX_STREAM_BYTES}-byte limit`, "provider");
  }
  if (bufferLength > MAX_STREAM_BUFFER_BYTES) {
    throw providerWireError("provider_stream_frame_too_large", `${label} stream frame exceeds the ${MAX_STREAM_BUFFER_BYTES}-byte limit`, "provider");
  }
}

function hasProviderCode(value: unknown): value is { code: string } {
  return !!value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string";
}

function readEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1_000 ? value : fallback;
}

function providerDelay(ms: number, signal?: AbortSignal): Promise<void> {
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
