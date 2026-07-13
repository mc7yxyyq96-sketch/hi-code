# MCP Connection Layer

Date: 2026-07-13

Hi Code supports existing MCP stdio servers and MCP Streamable HTTP without changing the tool names exposed to the Runtime. The connection manager owns protocol initialization, capability negotiation, session state, reconnect, timeout, cancellation, and graceful shutdown.

## Architecture

- `src/mcp-protocol.ts` defines the supported protocol versions, JSON-RPC envelopes, lifecycle states, normalized errors, bounded parsing, and log redaction.
- `src/mcp-transport.ts` implements the stdio and Streamable HTTP transports.
- `src/mcp-auth.ts` implements no-auth, bearer, and OAuth providers plus OAuth metadata discovery, PKCE authorization requests, state validation, token exchange, refresh, and expiry handling.
- `src/mcp.ts` is the compatibility manager used by the Runtime, CLI, TUI, and Electron main process.
- `electron/services/mcp-service.mjs` exposes validated lifecycle operations and redacted audit events.

The manager initializes with protocol version `2025-11-25` and accepts supported negotiated versions down to `2024-11-05`. Existing stdio entries that omit `transport` continue to work.

## Configuration

Local stdio example:

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "timeoutMs": 30000
    }
  }
}
```

Streamable HTTP with OAuth example:

```json
{
  "mcpServers": {
    "remote-tools": {
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "timeoutMs": 30000,
      "reconnect": {
        "maxAttempts": 3,
        "baseDelayMs": 250
      },
      "auth": {
        "type": "oauth",
        "clientId": "hicode-desktop",
        "scopes": ["mcp:tools"],
        "accessTokenRef": "hicode-secret:v1:mcp:cmVtb3RlLXRvb2xz:YXV0aC1hY2Nlc3NUb2tlbg",
        "refreshTokenRef": "hicode-secret:v1:mcp:cmVtb3RlLXRvb2xz:YXV0aC1yZWZyZXNoVG9rZW4",
        "expiresAt": "2026-07-13T12:00:00.000Z"
      }
    }
  }
}
```

Bearer tokens and OAuth access/refresh tokens entered through desktop config are migrated to Electron `safeStorage`. Sanitized config retains only opaque `*Ref` values. The renderer has no API for reading token values.

Remote endpoints and OAuth metadata/token endpoints require HTTPS. Loopback HTTP is allowed for local development. Endpoint credentials, query strings, fragments, and custom `Authorization`, `Cookie`, or `Proxy-Authorization` headers are rejected.

## Lifecycle

Each connection moves through these visible states:

```text
disconnected -> connecting -> negotiating -> ready
                     |             |          |
                     +---------- failed       +-> degraded -> reconnecting
ready/degraded -> closing -> disconnected
```

Initialization sends `initialize`, validates the negotiated protocol and server capabilities, sends `notifications/initialized`, then discovers tools through `tools/list`. Tool calls use `tools/call` and preserve structured content, text content, progress notifications, and normalized failures.

Streamable HTTP captures `Mcp-Session-Id`, sends `MCP-Protocol-Version`, supports POST JSON and SSE responses, listens through GET SSE when the server defers a response, and sends `Last-Event-ID` while reconnecting. HTTP 404 invalidates a session. Explicit disconnect sends DELETE when a session exists.

Timeout and user cancellation use `AbortSignal`. The client sends `notifications/cancelled` when possible and rejects the local call with a normalized cancellation error. Electron app shutdown awaits MCP transport close alongside terminal and preview cleanup.

## OAuth Lifecycle

The OAuth provider can:

1. Discover Protected Resource Metadata.
2. Discover Authorization Server Metadata.
3. Build a PKCE authorization URL with state and resource binding.
4. Validate callback state and exchange an authorization code.
5. Refresh an expired access token with the resource indicator.
6. Persist rotated access/refresh tokens and the matching `expiresAt` metadata through one secret-store configuration transaction. The sanitized config keeps references and expiry only; token values remain encrypted in the vault.

Hi Code does not silently launch a browser or claim an authorization succeeded. The current connection runtime consumes an existing bearer/token reference and refreshes it when possible. An interactive host must explicitly invoke the authorization-request and callback helpers before persisting tokens.

## Errors And Logging

Errors are normalized into a bounded structure containing `kind`, `code`, `message`, `retryable`, optional HTTP status, and optional details. Authentication, authorization, timeout, cancellation, session expiry, protocol, transport, and server failures remain distinguishable.

Audit logging records lifecycle action, server name, result, and error code. Bearer values, common provider tokens, and key/token/secret/password fields are redacted recursively. Raw OAuth responses, token values, stdio environment values, and full child environments are never logged.

## Compatibility

- Desktop keeps the existing `list-capabilities` behavior and adds validated lifecycle channels.
- CLI and TUI keep using `initMcp`, `mcpToolSchemas`, `callMcpTool`, and `mcpStatus`.
- Existing stdio config remains the default and uses the shared execution policy plus minimal child environment.
- Runtime tool names remain `mcp__<server>__<tool>`.

## Validation

```bash
npm run build
npm run test:mcp
npm run test:services
npm run test:renderer
npm run test:security
node test/feature-tests.mjs
npm run verify
npm run release:check
npm run scan:dod
```
