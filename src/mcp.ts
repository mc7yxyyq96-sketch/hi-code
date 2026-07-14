import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "./config.js";
import type { ToolSchema } from "./llm.js";
import { createMcpAuthProvider, type McpOAuthTokenUpdate } from "./mcp-auth.js";
import {
  MCP_LATEST_PROTOCOL_VERSION,
  McpError,
  normalizeMcpError,
  parseMcpInitializeResult,
  parseMcpToolResult,
  redactMcpText,
  type McpConnectionState,
  type McpInitializeResult,
  type McpNormalizedError,
  type McpToolResult,
} from "./mcp-protocol.js";
import {
  StdioMcpTransport,
  StreamableHttpMcpTransport,
  type McpTransport,
  type McpTransportKind,
} from "./mcp-transport.js";
import type { ExecutionPolicyAudit } from "./execution-policy.js";
import type { SecretWrite } from "./secret-references.js";

interface McpTool {
  name: string;
  rawName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  client: McpClient;
}

export interface McpManagerOptions {
  fetchImpl?: typeof fetch;
  persistOAuthUpdate?: (server: string, update: McpOAuthTokenUpdate) => Promise<void> | void;
  persistSecretWrites?: (writes: SecretWrite[]) => Promise<void> | void;
  now?: () => number;
}

export interface McpConnectResult {
  server: string;
  ok: boolean;
  toolCount: number;
  transport: McpTransportKind;
  protocolVersion?: string;
  sessionId?: string;
  error?: string;
  normalizedError?: McpNormalizedError;
  executionPolicy?: { audit?: ExecutionPolicyAudit; warnings: string[] };
}

export interface McpLifecycleStatus {
  server: string;
  transport: McpTransportKind;
  state: McpConnectionState;
  protocolVersion?: string;
  sessionId?: string;
  serverInfo?: McpInitializeResult["serverInfo"];
  capabilities: Record<string, unknown>;
  auth: ReturnType<ReturnType<typeof createMcpAuthProvider>["status"]>;
  tools: string[];
  activeCalls: string[];
  reconnectCount: number;
  connectedAt?: string;
  lastError?: McpNormalizedError;
  executionPolicy: { audit?: ExecutionPolicyAudit; warnings: string[] };
}

export interface McpDetailedToolResult extends McpToolResult {
  callId: string;
  progress: unknown[];
}

class McpClient {
  readonly name: string;
  readonly transportKind: McpTransportKind;
  tools: McpTool[] = [];

  private transport: McpTransport;
  private auth: ReturnType<typeof createMcpAuthProvider>;
  private state: McpConnectionState = "disconnected";
  private initializeResult?: McpInitializeResult;
  private activeCalls = new Map<string, AbortController>();
  private lastError?: McpNormalizedError;
  private reconnectCount = 0;
  private connectedAt?: string;
  private callSequence = 0;

  constructor(name: string, private readonly config: McpServerConfig, private readonly options: McpManagerOptions = {}) {
    this.name = name;
    this.transportKind = config.transport === "streamable-http" ? "streamable-http" : "stdio";
    this.auth = this.createAuth();
    this.transport = this.createTransport();
  }

  async connect(): Promise<void> {
    this.state = this.reconnectCount ? "reconnecting" : "connecting";
    this.lastError = undefined;
    const attempts = this.config.reconnect?.maxAttempts ?? (this.transportKind === "streamable-http" ? 2 : 0);
    const baseDelay = this.config.reconnect?.baseDelayMs ?? 250;
    let lastError: unknown;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      try {
        await this.transport.open();
        const initialized = parseMcpInitializeResult(await this.transport.request("initialize", {
          protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "hi-code", version: "0.6.0" },
        }, { timeoutMs: this.timeoutMs() }));
        this.initializeResult = initialized;
        this.transport.setProtocolVersion(initialized.protocolVersion);
        await this.transport.notify("notifications/initialized");
        this.transport.startServerStream();
        await this.discoverTools();
        this.state = "ready";
        this.connectedAt = new Date().toISOString();
        return;
      } catch (error) {
        lastError = error;
        this.lastError = normalizeMcpError(error, "MCP_CONNECT_FAILED");
        await this.transport.close("connection attempt failed");
        if (attempt >= attempts || !this.lastError.retryable) break;
        this.reconnectCount++;
        await delay(Math.min(5000, baseDelay * 2 ** attempt));
        this.auth = this.createAuth();
        this.transport = this.createTransport();
      }
    }
    this.state = "failed";
    throw lastError;
  }

  async reconnect(): Promise<void> {
    this.reconnectCount++;
    await this.close("explicit reconnect");
    this.auth = this.createAuth();
    this.transport = this.createTransport();
    await this.connect();
  }

  async call(rawName: string, args: Record<string, unknown>, options: { signal?: AbortSignal; onProgress?: (value: unknown) => void } = {}): Promise<McpDetailedToolResult> {
    if (this.state !== "ready") throw new McpError({ kind: "transport", code: "MCP_NOT_READY", message: `MCP server '${this.name}' is not ready`, retryable: true });
    const callId = `${safeId(this.name)}:${++this.callSequence}:${Date.now().toString(36)}`;
    const controller = new AbortController();
    const externalAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    this.activeCalls.set(callId, controller);
    const progress: unknown[] = [];
    try {
      const result = parseMcpToolResult(await this.transport.request("tools/call", { name: rawName, arguments: args }, {
        timeoutMs: this.timeoutMs(),
        signal: controller.signal,
        onProgress: (value) => {
          if (progress.length < 256) progress.push(value);
          options.onProgress?.(value);
        },
      }));
      return { ...result, callId, progress };
    } catch (error) {
      this.lastError = normalizeMcpError(error, "MCP_TOOL_FAILED");
      if (this.lastError.kind === "session_expired") this.state = "degraded";
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", externalAbort);
      this.activeCalls.delete(callId);
    }
  }

  cancel(callId?: string): number {
    if (callId) {
      const controller = this.activeCalls.get(callId);
      if (!controller) return 0;
      controller.abort("cancelled by user");
      return 1;
    }
    for (const controller of this.activeCalls.values()) controller.abort("cancelled by user");
    return this.activeCalls.size;
  }

  async close(reason = "client shutdown"): Promise<void> {
    this.state = "closing";
    this.cancel();
    await this.transport.close(reason);
    this.state = "disconnected";
    this.tools = [];
  }

  lifecycle(): McpLifecycleStatus {
    const session = this.transport.session();
    return {
      server: this.name,
      transport: this.transportKind,
      state: this.state,
      ...(session.protocolVersion ? { protocolVersion: session.protocolVersion } : {}),
      ...(session.id ? { sessionId: session.id } : {}),
      ...(this.initializeResult ? { serverInfo: { ...this.initializeResult.serverInfo } } : {}),
      capabilities: { ...(this.initializeResult?.capabilities || {}) },
      auth: this.auth.status(),
      tools: this.tools.map((tool) => tool.rawName),
      activeCalls: [...this.activeCalls.keys()],
      reconnectCount: this.reconnectCount,
      ...(this.connectedAt ? { connectedAt: this.connectedAt } : {}),
      ...(this.lastError ? { lastError: { ...this.lastError } } : {}),
      executionPolicy: this.transport.executionBoundary(),
    };
  }

  private async discoverTools(): Promise<void> {
    const listed = await this.transport.request("tools/list", {}, { timeoutMs: this.timeoutMs() });
    if (!listed || typeof listed !== "object" || Array.isArray(listed)) throw protocolConfigurationError("MCP tools/list result must be an object");
    const rawTools = Array.isArray((listed as Record<string, unknown>).tools) ? (listed as { tools: unknown[] }).tools : [];
    const discovered: McpTool[] = [];
    for (const raw of rawTools) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const tool = raw as Record<string, unknown>;
      if (typeof tool.name !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(tool.name)) continue;
      const inputSchema = tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
        ? tool.inputSchema as Record<string, unknown>
        : { type: "object", properties: {} };
      discovered.push({
        name: `mcp__${safeToolSegment(this.name)}__${safeToolSegment(tool.name)}`,
        rawName: tool.name,
        description: typeof tool.description === "string" ? tool.description.slice(0, 16384) : "",
        inputSchema,
        client: this,
      });
    }
    this.tools = discovered;
  }

  private createAuth(): ReturnType<typeof createMcpAuthProvider> {
    const authConfig = this.config.transport === "streamable-http" ? this.config.auth : undefined;
    return createMcpAuthProvider(authConfig, {
      fetchImpl: this.options.fetchImpl,
      now: this.options.now,
      onTokenUpdate: (update) => this.persistOAuthUpdate(update),
    });
  }

  private createTransport(): McpTransport {
    const callbacks = {
      onStateChange: (state: "connected" | "degraded" | "disconnected", error?: string) => {
        if (state === "degraded" && this.state === "ready") this.state = "degraded";
        if (error) this.lastError = normalizeMcpError(new Error(error), "MCP_TRANSPORT_DEGRADED");
      },
    };
    if (this.config.transport === "streamable-http") {
      return new StreamableHttpMcpTransport(this.name, this.config, this.auth, callbacks, this.options.fetchImpl);
    }
    return new StdioMcpTransport(this.name, this.config as McpStdioServerConfig, callbacks);
  }

  private async persistOAuthUpdate(update: McpOAuthTokenUpdate): Promise<void> {
    if (this.config.transport !== "streamable-http" || this.config.auth?.type !== "oauth") return;
    if (this.options.persistOAuthUpdate) {
      await this.options.persistOAuthUpdate(this.name, update);
      return;
    }
    if (!this.options.persistSecretWrites) return;
    const writes: SecretWrite[] = [];
    if (this.config.auth.accessTokenRef) writes.push({
      ref: this.config.auth.accessTokenRef,
      value: update.accessToken,
      location: `mcpServers.${this.name}.auth.accessToken`,
      scope: "mcp",
    });
    if (update.refreshToken && this.config.auth.refreshTokenRef) writes.push({
      ref: this.config.auth.refreshTokenRef,
      value: update.refreshToken,
      location: `mcpServers.${this.name}.auth.refreshToken`,
      scope: "mcp",
    });
    if (writes.length) await this.options.persistSecretWrites(writes);
  }

  private timeoutMs(): number { return this.config.timeoutMs ?? 30_000; }
}

const clients = new Map<string, McpClient>();
const configurations = new Map<string, McpServerConfig>();
const toolIndex = new Map<string, McpTool>();
let managerOptions: McpManagerOptions = {};

export async function initMcp(servers: Record<string, McpServerConfig>, options: McpManagerOptions = {}): Promise<McpConnectResult[]> {
  managerOptions = { ...managerOptions, ...options };
  const configuredNames = new Set(Object.keys(servers));
  for (const [name, client] of clients) {
    if (!configuredNames.has(name)) {
      await client.close("configuration removed");
      clients.delete(name);
      configurations.delete(name);
    }
  }
  rebuildToolIndex();

  const results: McpConnectResult[] = [];
  for (const [name, config] of Object.entries(servers)) {
    const previous = clients.get(name);
    if (previous) await previous.close("configuration reload");
    configurations.set(name, config);
    let client: McpClient | undefined;
    try {
      client = new McpClient(name, config, managerOptions);
      clients.set(name, client);
      await client.connect();
      rebuildToolIndex();
      const lifecycle = client.lifecycle();
      results.push({
        server: name,
        ok: true,
        toolCount: client.tools.length,
        transport: lifecycle.transport,
        ...(lifecycle.protocolVersion ? { protocolVersion: lifecycle.protocolVersion } : {}),
        ...(lifecycle.sessionId ? { sessionId: lifecycle.sessionId } : {}),
        executionPolicy: lifecycle.executionPolicy,
      });
    } catch (error) {
      rebuildToolIndex();
      const normalizedError = normalizeMcpError(error, "MCP_CONNECT_FAILED");
      results.push({
        server: name,
        ok: false,
        toolCount: 0,
        transport: client?.transportKind ?? transportKind(config),
        error: normalizedError.message,
        normalizedError,
      });
    }
  }
  return results;
}

export async function connectMcpServer(name: string): Promise<McpConnectResult> {
  const config = configurations.get(name);
  if (!config) return failedConnect(name, "MCP_NOT_CONFIGURED", `MCP server '${name}' is not configured`);
  let client = clients.get(name);
  try {
    if (!client) {
      client = new McpClient(name, config, managerOptions);
      clients.set(name, client);
    }
    if (client.lifecycle().state === "ready") return lifecycleConnectResult(client);
    await client.connect();
    rebuildToolIndex();
    return lifecycleConnectResult(client);
  } catch (error) {
    const normalizedError = normalizeMcpError(error, "MCP_CONNECT_FAILED");
    return { server: name, ok: false, toolCount: 0, transport: client?.transportKind ?? transportKind(config), error: normalizedError.message, normalizedError };
  }
}

export async function reconnectMcpServer(name: string): Promise<McpConnectResult> {
  const client = clients.get(name);
  if (!client) return connectMcpServer(name);
  try {
    await client.reconnect();
    rebuildToolIndex();
    return lifecycleConnectResult(client);
  } catch (error) {
    const normalizedError = normalizeMcpError(error, "MCP_RECONNECT_FAILED");
    return { server: name, ok: false, toolCount: 0, transport: client.transportKind, error: normalizedError.message, normalizedError };
  }
}

export async function disconnectMcpServer(name: string): Promise<{ ok: boolean; server: string; error?: string }> {
  const client = clients.get(name);
  if (!client) return { ok: true, server: name };
  try {
    await client.close("explicit disconnect");
    rebuildToolIndex();
    return { ok: true, server: name };
  } catch (error) {
    return { ok: false, server: name, error: normalizeMcpError(error, "MCP_DISCONNECT_FAILED").message };
  }
}

export function cancelMcpRequest(server: string, callId?: string): { ok: boolean; server: string; cancelled: number } {
  const client = clients.get(server);
  if (!client) return { ok: false, server, cancelled: 0 };
  return { ok: true, server, cancelled: client.cancel(callId) };
}

export function mcpToolSchemas(): ToolSchema[] {
  return [...toolIndex.values()].map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: `[MCP:${tool.client.name}] ${tool.description}`,
      parameters: tool.inputSchema,
    },
  }));
}

export function isMcpTool(name: string): boolean { return toolIndex.has(name); }

export async function callMcpToolDetailed(
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal; onProgress?: (value: unknown) => void } = {},
): Promise<McpDetailedToolResult> {
  const tool = toolIndex.get(name);
  if (!tool) throw new McpError({ kind: "configuration", code: "MCP_TOOL_UNKNOWN", message: `Unknown MCP tool '${name}'`, retryable: false });
  return tool.client.call(tool.rawName, args, options);
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const result = await callMcpToolDetailed(name, args);
    return result.isError ? `Error from MCP tool: ${result.text}` : result.text;
  } catch (error) {
    const normalized = normalizeMcpError(error, "MCP_TOOL_FAILED");
    return `Error calling MCP tool '${name}': ${redactMcpText(normalized.message)}`;
  }
}

export function mcpStatus(): { server: string; tools: string[] }[] {
  return [...clients.values()].filter((client) => client.lifecycle().state === "ready").map((client) => ({ server: client.name, tools: client.tools.map((tool) => tool.rawName) }));
}

export function mcpLifecycleStatus(): McpLifecycleStatus[] {
  return [...clients.values()].map((client) => client.lifecycle());
}

export async function shutdownMcp(): Promise<void> {
  await Promise.allSettled([...clients.values()].map((client) => client.close("application shutdown")));
  clients.clear();
  configurations.clear();
  toolIndex.clear();
  managerOptions = {};
}

function rebuildToolIndex(): void {
  toolIndex.clear();
  for (const client of clients.values()) {
    if (client.lifecycle().state !== "ready") continue;
    for (const tool of client.tools) toolIndex.set(tool.name, tool);
  }
}

function lifecycleConnectResult(client: McpClient): McpConnectResult {
  const lifecycle = client.lifecycle();
  return {
    server: client.name,
    ok: lifecycle.state === "ready",
    toolCount: lifecycle.tools.length,
    transport: lifecycle.transport,
    ...(lifecycle.protocolVersion ? { protocolVersion: lifecycle.protocolVersion } : {}),
    ...(lifecycle.sessionId ? { sessionId: lifecycle.sessionId } : {}),
    executionPolicy: lifecycle.executionPolicy,
  };
}

function transportKind(config: McpServerConfig): McpTransportKind {
  return config.transport === "streamable-http" ? "streamable-http" : "stdio";
}

function failedConnect(server: string, code: string, message: string): McpConnectResult {
  const normalizedError: McpNormalizedError = { kind: "configuration", code, message, retryable: false };
  return { server, ok: false, toolCount: 0, transport: "stdio", error: message, normalizedError };
}

function protocolConfigurationError(message: string): McpError {
  return new McpError({ kind: "protocol", code: "MCP_PROTOCOL_INVALID", message, retryable: false });
}

function safeToolSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 128) || "unnamed";
}

function safeId(value: string): string {
  return String(value || "server").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 120) || "server";
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
