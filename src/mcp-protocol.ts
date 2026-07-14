export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

export const MCP_LATEST_PROTOCOL_VERSION: McpProtocolVersion = MCP_PROTOCOL_VERSIONS[0];
export const MCP_MAX_MESSAGE_BYTES = 1024 * 1024;

export type McpConnectionState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "closing"
  | "failed";

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface McpJsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export type McpJsonRpcMessage = McpJsonRpcRequest | McpJsonRpcNotification | McpJsonRpcResponse;

export type McpErrorKind =
  | "configuration"
  | "authentication"
  | "authorization"
  | "transport"
  | "timeout"
  | "cancelled"
  | "session_expired"
  | "protocol"
  | "server"
  | "shutdown";

export interface McpNormalizedError {
  kind: McpErrorKind;
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  rpcCode?: number;
}

export class McpError extends Error {
  readonly normalized: McpNormalizedError;

  constructor(error: McpNormalizedError) {
    super(redactMcpText(error.message));
    this.name = "McpError";
    this.normalized = { ...error, message: redactMcpText(error.message) };
  }
}

export interface McpContentPart {
  type: string;
  text?: string;
  uri?: string;
  mimeType?: string;
  data?: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpContentPart[];
  structuredContent?: unknown;
  isError: boolean;
  text: string;
}

export interface McpInitializeResult {
  protocolVersion: McpProtocolVersion;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string; [key: string]: unknown };
  instructions?: string;
}

const SECRET_TEXT = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+|\b(?:sk-[A-Za-z0-9._-]{8,}|gh[opsu]_[A-Za-z0-9._-]{8,}|github_pat_[A-Za-z0-9._-]{8,}|xox[baprs]-[A-Za-z0-9._-]{8,})\b/gi;
const INLINE_SECRET = /\b([A-Za-z0-9_]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passcode|secret|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)\s*[:=]\s*['"]?[^\s,'"}]+/gi;

export function redactMcpText(value: unknown): string {
  return String(value ?? "")
    .replace(SECRET_TEXT, (match, prefix) => prefix ? `${prefix}[REDACTED]` : "[REDACTED]")
    .replace(INLINE_SECRET, (_match, key) => `${key}=[REDACTED]`)
    .slice(0, 8192);
}

export function normalizeMcpError(error: unknown, fallbackCode = "MCP_FAILED"): McpNormalizedError {
  if (error instanceof McpError) return { ...error.normalized };
  if (isAbortError(error)) {
    return { kind: "cancelled", code: "MCP_CANCELLED", message: "MCP request was cancelled", retryable: false };
  }
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = redactMcpText(candidate.message || error || "MCP operation failed");
  const code = typeof candidate.code === "string" ? candidate.code : fallbackCode;
  if (code === "MCP_TIMEOUT") return { kind: "timeout", code, message, retryable: true };
  if (code === "MCP_SESSION_EXPIRED") return { kind: "session_expired", code, message, retryable: true };
  return { kind: "transport", code, message, retryable: false };
}

export function assertMcpProtocolVersion(value: unknown): McpProtocolVersion {
  if (typeof value !== "string" || !MCP_PROTOCOL_VERSIONS.includes(value as McpProtocolVersion)) {
    throw new McpError({
      kind: "protocol",
      code: "MCP_PROTOCOL_UNSUPPORTED",
      message: `MCP server selected unsupported protocol version ${String(value || "(missing)")}`,
      retryable: false,
    });
  }
  return value as McpProtocolVersion;
}

export function parseMcpInitializeResult(value: unknown): McpInitializeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("MCP initialize result must be an object");
  }
  const raw = value as Record<string, unknown>;
  const serverInfo = raw.serverInfo;
  if (!serverInfo || typeof serverInfo !== "object" || Array.isArray(serverInfo)) {
    throw protocolError("MCP initialize result is missing serverInfo");
  }
  const info = serverInfo as Record<string, unknown>;
  if (typeof info.name !== "string" || !info.name || typeof info.version !== "string" || !info.version) {
    throw protocolError("MCP serverInfo name and version are required");
  }
  const capabilities = raw.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw protocolError("MCP initialize result is missing capabilities");
  }
  return {
    protocolVersion: assertMcpProtocolVersion(raw.protocolVersion),
    capabilities: { ...(capabilities as Record<string, unknown>) },
    serverInfo: { ...info, name: info.name, version: info.version },
    ...(typeof raw.instructions === "string" ? { instructions: raw.instructions.slice(0, 16384) } : {}),
  };
}

export function parseMcpToolResult(value: unknown): McpToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("MCP tool result must be an object");
  }
  const raw = value as Record<string, unknown>;
  const content = Array.isArray(raw.content)
    ? raw.content.filter((part): part is McpContentPart => Boolean(part && typeof part === "object" && !Array.isArray(part)))
    : [];
  const text = content.map((part) => {
    if (part.type === "text" && typeof part.text === "string") return part.text;
    if (typeof part.uri === "string") return `[${part.type || "resource"}: ${part.uri}]`;
    return `[${part.type || "content"}]`;
  }).join("\n").trim();
  return {
    content,
    ...(Object.prototype.hasOwnProperty.call(raw, "structuredContent") ? { structuredContent: raw.structuredContent } : {}),
    isError: raw.isError === true,
    text: text || "(no output)",
  };
}

export function parseJsonRpcMessage(value: unknown): McpJsonRpcMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("MCP message must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.jsonrpc !== "2.0") throw protocolError("MCP message must use JSON-RPC 2.0");
  if (typeof raw.method === "string" && raw.method) return raw as unknown as McpJsonRpcRequest | McpJsonRpcNotification;
  if ((typeof raw.id === "number" || typeof raw.id === "string") && ("result" in raw || "error" in raw)) {
    return raw as unknown as McpJsonRpcResponse;
  }
  throw protocolError("MCP message is neither a request, notification, nor response");
}

export function protocolError(message: string): McpError {
  return new McpError({ kind: "protocol", code: "MCP_PROTOCOL_INVALID", message, retryable: false });
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && ((error as { name?: string }).name === "AbortError" || (error as { code?: string }).code === "ABORT_ERR"));
}
