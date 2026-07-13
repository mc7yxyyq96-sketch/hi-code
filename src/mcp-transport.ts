import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  createExecutionLaunchPlan,
  detectExecutionCapabilities,
  evaluateExecutionPolicy,
  terminateExecutionProcessTree,
  type ExecutionPolicyAudit,
} from "./execution-policy.js";
import type { McpAuthProvider } from "./mcp-auth.js";
import {
  MCP_MAX_MESSAGE_BYTES,
  McpError,
  parseJsonRpcMessage,
  redactMcpText,
  type McpJsonRpcMessage,
  type McpJsonRpcNotification,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpProtocolVersion,
} from "./mcp-protocol.js";

export type McpTransportKind = "stdio" | "streamable-http";

export interface McpRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (value: unknown) => void;
}

export interface McpTransportSession {
  id?: string;
  protocolVersion?: McpProtocolVersion;
  lastEventId?: string;
}

export interface McpTransport {
  readonly kind: McpTransportKind;
  open(): Promise<void>;
  request(method: string, params?: unknown, options?: McpRequestOptions): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  setProtocolVersion(version: McpProtocolVersion): void;
  startServerStream(): void;
  session(): McpTransportSession;
  executionBoundary(): { audit?: ExecutionPolicyAudit; warnings: string[] };
  close(reason?: string): Promise<void>;
}

export interface StdioMcpTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpMcpTransportConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  reconnect?: { maxAttempts?: number; baseDelayMs?: number };
}

export interface McpTransportCallbacks {
  onNotification?: (notification: McpJsonRpcNotification) => void;
  onStateChange?: (state: "connected" | "degraded" | "disconnected", error?: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abort?: () => void;
  signal?: AbortSignal;
  onProgress?: (value: unknown) => void;
  progressToken?: string;
}

export class StdioMcpTransport implements McpTransport {
  readonly kind = "stdio" as const;
  private proc?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = "";
  private stderrBuffer = "";
  private protocolVersion?: McpProtocolVersion;
  private policyAudit?: ExecutionPolicyAudit;
  private policyWarnings: string[] = [];

  constructor(private readonly name: string, private readonly config: StdioMcpTransportConfig, private readonly callbacks: McpTransportCallbacks = {}) {}

  async open(): Promise<void> {
    if (this.proc && !this.proc.killed) return;
    const cwd = this.config.cwd || process.cwd();
    const capabilities = detectExecutionCapabilities();
    const decision = evaluateExecutionPolicy({
      id: `mcp:${safeId(this.name)}`,
      surface: "mcp-server",
      executable: this.config.command,
      args: this.config.args ?? [],
      cwd,
      allowedRoots: [cwd],
      filesystem: "unrestricted",
      network: "allow",
      environment: { extraEnv: this.config.env, allowSensitiveExtraEnv: true },
      limits: { timeoutMs: 0, outputBytes: MCP_MAX_MESSAGE_BYTES },
      approval: { required: false, granted: true },
      processTree: { required: true },
      interactive: true,
      enforcementMode: "report-only",
    }, capabilities);
    if (!decision.ok) throw transportError("MCP_EXECUTION_DENIED", `MCP execution policy denied startup: ${decision.error || decision.code}`, false);
    const plan = createExecutionLaunchPlan(decision, capabilities);
    this.policyAudit = decision.audit;
    this.policyWarnings = [...decision.warnings];
    this.proc = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      detached: plan.detached,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer = boundedTail(this.stderrBuffer + chunk.toString(), MCP_MAX_MESSAGE_BYTES);
    });
    this.proc.on("error", (error) => this.failAll(transportError("MCP_STDIO_ERROR", error.message, true)));
    this.proc.on("exit", (code, signal) => {
      const suffix = this.stderrBuffer.trim() ? `: ${redactMcpText(this.stderrBuffer.trim())}` : "";
      this.failAll(transportError("MCP_STDIO_EXITED", `MCP server '${this.name}' exited (${code ?? signal ?? "unknown"})${suffix}`, true));
      this.callbacks.onStateChange?.("disconnected");
    });
    this.callbacks.onStateChange?.("connected");
  }

  request(method: string, params: unknown = {}, options: McpRequestOptions = {}): Promise<unknown> {
    if (!this.proc || this.proc.killed) return Promise.reject(transportError("MCP_NOT_CONNECTED", "MCP stdio transport is not connected", true));
    const id = this.nextId++;
    const progressToken = options.onProgress ? `hicode-${safeId(this.name)}-${id}` : undefined;
    const requestParams = withProgressToken(params, progressToken);
    const payload: McpJsonRpcRequest = { jsonrpc: "2.0", id, method, params: requestParams };
    return new Promise((resolve, reject) => {
      const timeoutMs = boundedTimeout(options.timeoutMs);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.notify("notifications/cancelled", { requestId: id, reason: "request timeout" });
        reject(timeoutError(timeoutMs));
      }, timeoutMs);
      timer.unref?.();
      const abort = options.signal ? () => {
        clearTimeout(timer);
        this.pending.delete(id);
        void this.notify("notifications/cancelled", { requestId: id, reason: "client cancellation" });
        reject(cancelledError());
      } : undefined;
      if (options.signal?.aborted) return abort?.();
      options.signal?.addEventListener("abort", abort!, { once: true });
      this.pending.set(id, { resolve, reject, timer, abort, signal: options.signal, onProgress: options.onProgress, progressToken });
      this.proc!.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) this.rejectPending(id, transportError("MCP_STDIO_WRITE_FAILED", error.message, true));
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.proc || this.proc.killed) return;
    const payload: McpJsonRpcNotification = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    await new Promise<void>((resolve, reject) => this.proc!.stdin.write(`${JSON.stringify(payload)}\n`, (error) => error ? reject(error) : resolve()));
  }

  setProtocolVersion(version: McpProtocolVersion): void { this.protocolVersion = version; }
  startServerStream(): void {}
  session(): McpTransportSession { return { ...(this.protocolVersion ? { protocolVersion: this.protocolVersion } : {}) }; }

  executionBoundary(): { audit?: ExecutionPolicyAudit; warnings: string[] } {
    return {
      ...(this.policyAudit ? { audit: { ...this.policyAudit, envKeys: [...this.policyAudit.envKeys] } } : {}),
      warnings: [...this.policyWarnings],
    };
  }

  async close(reason = "client shutdown"): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc) return;
    this.failAll(shutdownError(reason));
    try { proc.stdin.end(); } catch {}
    const pid = proc.pid;
    if (pid) terminateExecutionProcessTree({ pid });
    this.callbacks.onStateChange?.("disconnected");
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    if (Buffer.byteLength(this.buffer) > MCP_MAX_MESSAGE_BYTES) {
      const error = transportError("MCP_MESSAGE_TOO_LARGE", "MCP server output exceeded the bounded protocol buffer", false);
      this.failAll(error);
      void this.close(error.message);
      return;
    }
    let newline = -1;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.dispatch(parseJsonRpcMessage(JSON.parse(line)));
      } catch (error) {
        this.callbacks.onStateChange?.("degraded", redactMcpText(error instanceof Error ? error.message : error));
      }
    }
  }

  private dispatch(message: McpJsonRpcMessage): void {
    if ("method" in message) {
      if (message.method === "notifications/progress") this.dispatchProgress(message);
      this.callbacks.onNotification?.(message as McpJsonRpcNotification);
      if ("id" in message) {
        void this.writeServerError(message.id, -32601, "Client request method is not supported");
      }
      return;
    }
    this.resolveResponse(message as McpJsonRpcResponse);
  }

  private dispatchProgress(message: McpJsonRpcNotification): void {
    const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
    for (const pending of this.pending.values()) {
      if (pending.progressToken && params.progressToken === pending.progressToken) pending.onProgress?.(params);
    }
  }

  private resolveResponse(message: McpJsonRpcResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.cleanupPending(message.id, pending);
    if (message.error) {
      pending.reject(new McpError({
        kind: "server",
        code: "MCP_SERVER_ERROR",
        message: message.error.message || "MCP server returned an error",
        retryable: false,
        ...(typeof message.error.code === "number" ? { rpcCode: message.error.code } : {}),
      }));
    } else pending.resolve(message.result);
  }

  private async writeServerError(id: string | number, code: number, message: string): Promise<void> {
    if (!this.proc || this.proc.killed) return;
    const payload = { jsonrpc: "2.0", id, error: { code, message } };
    await new Promise<void>((resolve) => this.proc!.stdin.write(`${JSON.stringify(payload)}\n`, () => resolve()));
  }

  private rejectPending(id: string | number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupPending(id, pending);
    pending.reject(error);
  }

  private cleanupPending(id: string | number, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    this.pending.delete(id);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.cleanupPending(id, pending);
      pending.reject(error);
    }
  }
}

export class StreamableHttpMcpTransport implements McpTransport {
  readonly kind = "streamable-http" as const;
  private readonly endpoint: string;
  private nextId = 1;
  private protocolVersion?: McpProtocolVersion;
  private sessionId?: string;
  private lastEventId?: string;
  private listenerAbort?: AbortController;
  private closed = false;
  private readonly pending = new Map<number | string, PendingRequest>();

  constructor(
    private readonly name: string,
    private readonly config: HttpMcpTransportConfig,
    private readonly auth: McpAuthProvider,
    private readonly callbacks: McpTransportCallbacks = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = validateMcpHttpEndpoint(config.url);
  }

  async open(): Promise<void> {
    this.closed = false;
    this.callbacks.onStateChange?.("connected");
  }

  async request(method: string, params: unknown = {}, options: McpRequestOptions = {}): Promise<unknown> {
    if (this.closed) throw transportError("MCP_NOT_CONNECTED", "MCP HTTP transport is closed", true);
    const id = this.nextId++;
    const progressToken = options.onProgress ? `hicode-${safeId(this.name)}-${id}` : undefined;
    const payload: McpJsonRpcRequest = { jsonrpc: "2.0", id, method, params: withProgressToken(params, progressToken) };
    const controller = new AbortController();
    const timeoutMs = boundedTimeout(options.timeoutMs ?? this.config.timeoutMs);
    let settle!: PendingRequest;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort({ code: "MCP_TIMEOUT" });
        this.rejectHttpPending(id, timeoutError(timeoutMs));
        void this.notify("notifications/cancelled", { requestId: id, reason: "request timeout" }).catch(() => {});
      }, timeoutMs);
      timer.unref?.();
      const abort = options.signal ? () => {
        controller.abort(options.signal?.reason);
        this.rejectHttpPending(id, cancelledError());
        void this.notify("notifications/cancelled", { requestId: id, reason: "client cancellation" }).catch(() => {});
      } : undefined;
      settle = { resolve, reject, timer, abort, signal: options.signal, onProgress: options.onProgress, progressToken };
      this.pending.set(id, settle);
      if (options.signal?.aborted) abort?.();
      else options.signal?.addEventListener("abort", abort!, { once: true });
    });
    try {
      const response = await this.post(payload, controller.signal, true);
      if ([202, 204].includes(response.status)) {
        await cancelResponseBody(response);
        this.startServerStream();
      } else {
        const consumed = consumeHttpMessages(
          response,
          (eventId) => { this.lastEventId = eventId; },
          (message) => this.dispatchHttpMessage(message),
        );
        void consumed.then(() => {
          if (this.pending.has(id)) {
            this.rejectHttpPending(id, transportError("MCP_RESPONSE_MISSING", "MCP response did not include the request id", true));
          }
        }).catch((error) => this.rejectHttpPending(id, asError(error)));
      }
      return await result;
    } catch (error) {
      if (this.pending.has(id)) this.rejectHttpPending(id, asError(error));
      return await result;
    } finally {
      controller.abort("request settled");
      this.cleanupHttpPending(id, settle);
      if (settle.abort) options.signal?.removeEventListener("abort", settle.abort);
    }
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) return;
    const payload: McpJsonRpcNotification = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    const response = await this.post(payload, undefined, false);
    if (![200, 202, 204].includes(response.status)) {
      await cancelResponseBody(response);
      throw httpStatusError(response.status);
    }
    await cancelResponseBody(response);
  }

  setProtocolVersion(version: McpProtocolVersion): void { this.protocolVersion = version; }

  startServerStream(): void {
    if (this.closed || this.listenerAbort) return;
    this.listenerAbort = new AbortController();
    void this.listen(this.listenerAbort.signal);
  }

  session(): McpTransportSession {
    return {
      ...(this.sessionId ? { id: this.sessionId } : {}),
      ...(this.protocolVersion ? { protocolVersion: this.protocolVersion } : {}),
      ...(this.lastEventId ? { lastEventId: this.lastEventId } : {}),
    };
  }

  executionBoundary(): { warnings: string[] } { return { warnings: [] }; }

  async close(reason = "client shutdown"): Promise<void> {
    this.closed = true;
    this.listenerAbort?.abort(reason);
    this.listenerAbort = undefined;
    this.failHttpPending(shutdownError(reason));
    if (this.sessionId) {
      try {
        const headers = await this.headers();
        const response = await this.fetchImpl(this.endpoint, { method: "DELETE", headers, redirect: "error" });
        await response.body?.cancel().catch(() => {});
      } catch {}
    }
    this.sessionId = undefined;
    this.callbacks.onStateChange?.("disconnected");
  }

  private async post(payload: McpJsonRpcMessage, signal: AbortSignal | undefined, retryAuth: boolean): Promise<Response> {
    const headers = await this.headers();
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json, text/event-stream");
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
      redirect: "error",
    });
    if (response.status === 401 && retryAuth) {
      try {
        if (await this.auth.handleUnauthorized(response, this.endpoint)) {
          await cancelResponseBody(response);
          return this.post(payload, signal, false);
        }
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
    }
    if (response.status === 404 && this.sessionId) {
      await cancelResponseBody(response);
      this.sessionId = undefined;
      throw new McpError({ kind: "session_expired", code: "MCP_SESSION_EXPIRED", message: "MCP HTTP session expired", retryable: true, status: 404 });
    }
    if (!response.ok) {
      await cancelResponseBody(response);
      throw httpStatusError(response.status);
    }
    validateResponseUrl(response.url || this.endpoint);
    try {
      this.captureSession(response);
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
    return response;
  }

  private async headers(): Promise<Headers> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(this.config.headers || {})) {
      if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key) || /authorization|cookie|proxy-authorization/i.test(key)) {
        throw transportError("MCP_HEADER_INVALID", `MCP custom header '${key}' is not allowed`, false);
      }
      if (typeof value !== "string" || value.length > 8192 || /[\0\r\n]/.test(value)) throw transportError("MCP_HEADER_INVALID", `MCP custom header '${key}' is invalid`, false);
      headers.set(key, value);
    }
    if (this.sessionId) headers.set("Mcp-Session-Id", this.sessionId);
    if (this.protocolVersion) headers.set("MCP-Protocol-Version", this.protocolVersion);
    if (this.lastEventId) headers.set("Last-Event-ID", this.lastEventId);
    await this.auth.authorize(headers, this.endpoint);
    return headers;
  }

  private captureSession(response: Response): void {
    const id = response.headers.get("mcp-session-id");
    if (!id) return;
    if (id.length > 512 || /[^\x21-\x7e]/.test(id)) throw transportError("MCP_SESSION_INVALID", "MCP session id is invalid", false);
    this.sessionId = id;
  }

  private async listen(signal: AbortSignal): Promise<void> {
    const maxAttempts = Math.max(0, Math.min(10, Number(this.config.reconnect?.maxAttempts ?? 3)));
    const baseDelay = Math.max(50, Math.min(5000, Number(this.config.reconnect?.baseDelayMs ?? 250)));
    for (let attempt = 0; !signal.aborted && !this.closed; attempt++) {
      try {
        const headers = await this.headers();
        headers.set("accept", "text/event-stream");
        const response = await this.fetchImpl(this.endpoint, { method: "GET", headers, signal, redirect: "error" });
        if (response.status === 405) {
          await cancelResponseBody(response);
          return;
        }
        if (response.status === 401) {
          try {
            if (await this.auth.handleUnauthorized(response, this.endpoint)) {
              await cancelResponseBody(response);
              continue;
            }
          } catch (error) {
            await cancelResponseBody(response);
            throw error;
          }
        }
        if (response.status === 404 && this.sessionId) {
          await cancelResponseBody(response);
          this.sessionId = undefined;
          throw new McpError({ kind: "session_expired", code: "MCP_SESSION_EXPIRED", message: "MCP HTTP session expired", retryable: true, status: 404 });
        }
        if (!response.ok) {
          await cancelResponseBody(response);
          throw httpStatusError(response.status);
        }
        await consumeHttpMessages(
          response,
          (eventId) => { this.lastEventId = eventId; },
          (message) => this.dispatchHttpMessage(message),
        );
        if (signal.aborted || this.closed) return;
        throw transportError("MCP_STREAM_ENDED", "MCP server event stream ended", true);
      } catch (error) {
        if (signal.aborted || this.closed) return;
        if (attempt >= maxAttempts) {
          this.callbacks.onStateChange?.("degraded", redactMcpText(error instanceof Error ? error.message : error));
          return;
        }
        await delay(baseDelay * 2 ** attempt, signal);
      }
    }
  }

  private dispatchHttpMessage(message: McpJsonRpcMessage): void {
    if ("method" in message) {
      if (message.method === "notifications/progress") {
        const progress = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
        for (const pending of this.pending.values()) {
          if (pending.progressToken && progress.progressToken === pending.progressToken) pending.onProgress?.(progress);
        }
      }
      this.callbacks.onNotification?.(message as McpJsonRpcNotification);
      if ("id" in message) void this.respondUnsupportedRequest(message.id);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.cleanupHttpPending(message.id, pending);
    if (message.error) {
      pending.reject(new McpError({
        kind: "server",
        code: "MCP_SERVER_ERROR",
        message: message.error.message || "MCP server returned an error",
        retryable: false,
        ...(typeof message.error.code === "number" ? { rpcCode: message.error.code } : {}),
      }));
    } else pending.resolve(message.result);
  }

  private rejectHttpPending(id: string | number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.cleanupHttpPending(id, pending);
    pending.reject(error);
  }

  private async respondUnsupportedRequest(id: string | number): Promise<void> {
    try {
      const response = await this.post({ jsonrpc: "2.0", id, error: { code: -32601, message: "Client request method is not supported" } }, undefined, false);
      await response.body?.cancel().catch(() => {});
    } catch {}
  }

  private cleanupHttpPending(id: string | number, pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    this.pending.delete(id);
  }

  private failHttpPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.cleanupHttpPending(id, pending);
      pending.reject(error);
    }
  }
}

export function validateMcpHttpEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw transportError("MCP_URL_INVALID", "MCP HTTP endpoint is invalid", false); }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw transportError("MCP_URL_INSECURE", "Remote MCP HTTP endpoints must use HTTPS", false);
  }
  if (url.username || url.password || url.hash || url.search) throw transportError("MCP_URL_INVALID", "MCP HTTP endpoint cannot contain credentials, query parameters, or fragments", false);
  return url.toString();
}

async function consumeHttpMessages(
  response: Response,
  onEventId: (id: string) => void,
  onMessage: (message: McpJsonRpcMessage) => void,
): Promise<number> {
  if ([202, 204].includes(response.status)) return 0;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const text = await boundedResponseText(response);
    const value = JSON.parse(text);
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) onMessage(parseJsonRpcMessage(item));
    return values.length;
  }
  if (!contentType.includes("text/event-stream")) {
    await cancelResponseBody(response);
    throw transportError("MCP_CONTENT_TYPE_INVALID", `MCP response content type is not supported: ${contentType || "missing"}`, false);
  }
  if (!response.body) throw transportError("MCP_RESPONSE_MISSING", "MCP event stream has no response body", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let count = 0;
  const consumeEvent = (event: string) => {
    if (!event.trim()) return;
    const data: string[] = [];
    for (const line of event.split(/\r?\n/)) {
      if (line.startsWith("id:")) {
        const id = line.slice(3).trim();
        if (id && id.length <= 512 && !/[\0\r\n]/.test(id)) onEventId(id);
      } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) {
      onMessage(parseJsonRpcMessage(JSON.parse(data.join("\n"))));
      count++;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer) > MCP_MAX_MESSAGE_BYTES) {
        await cancelReader(reader, "MCP event exceeded the size limit");
        throw transportError("MCP_MESSAGE_TOO_LARGE", "MCP event exceeded the size limit", false);
      }
      let boundary = findEventBoundary(buffer);
      while (boundary) {
        consumeEvent(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = findEventBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeEvent(buffer);
    return count;
  } catch (error) {
    await cancelReader(reader, "MCP event stream failed validation");
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(value: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(value);
  return match ? { index: match.index, length: match[0].length } : undefined;
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MCP_MAX_MESSAGE_BYTES) {
        await cancelReader(reader, "MCP response exceeded the size limit");
        throw transportError("MCP_MESSAGE_TOO_LARGE", "MCP response exceeded the size limit", false);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: string): Promise<void> {
  try { await reader.cancel(reason); } catch {}
}

async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch {}
}

function withProgressToken(params: unknown, progressToken?: string): unknown {
  if (!progressToken || !params || typeof params !== "object" || Array.isArray(params)) return params;
  const value = params as Record<string, unknown>;
  const meta = value._meta && typeof value._meta === "object" && !Array.isArray(value._meta) ? value._meta as Record<string, unknown> : {};
  return { ...value, _meta: { ...meta, progressToken } };
}

function boundedTimeout(value: number | undefined): number {
  const timeout = Number(value ?? 30_000);
  return Number.isFinite(timeout) ? Math.max(100, Math.min(10 * 60 * 1000, timeout)) : 30_000;
}

function timeoutError(timeoutMs: number): McpError {
  return new McpError({ kind: "timeout", code: "MCP_TIMEOUT", message: `MCP request timed out after ${timeoutMs}ms`, retryable: true });
}

function cancelledError(): McpError {
  return new McpError({ kind: "cancelled", code: "MCP_CANCELLED", message: "MCP request was cancelled", retryable: false });
}

function shutdownError(reason: string): McpError {
  return new McpError({ kind: "shutdown", code: "MCP_SHUTDOWN", message: reason || "MCP transport closed", retryable: false });
}

function transportError(code: string, message: string, retryable: boolean): McpError {
  return new McpError({ kind: "transport", code, message, retryable });
}

function httpStatusError(status: number): McpError {
  const kind = status === 401 ? "authentication" : status === 403 ? "authorization" : "transport";
  return new McpError({ kind, code: `MCP_HTTP_${status}`, message: `MCP HTTP transport returned ${status}`, retryable: status === 408 || status === 429 || status >= 500, status });
}

function validateResponseUrl(value: string): void { validateMcpHttpEndpoint(value); }

function safeId(value: string): string {
  return String(value || "server").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || "server";
}

function boundedTail(value: string, limit: number): string {
  const buffer = Buffer.from(value);
  return (buffer.length <= limit ? buffer : buffer.subarray(buffer.length - limit)).toString("utf8");
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : transportError("MCP_TRANSPORT_ERROR", redactMcpText(value), true);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(cancelledError()); }, { once: true });
  });
}
