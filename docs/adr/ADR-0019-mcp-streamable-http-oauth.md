# ADR-0019: MCP Streamable HTTP And OAuth Lifecycle

Status: Accepted

Date: 2026-07-13

## Context

Hi Code's production MCP path supported stdio but did not have one transport-neutral lifecycle, remote session recovery, or an OAuth token lifecycle. Replacing the manager would risk Desktop, CLI, TUI, Store-installed servers, and existing tool names.

## Decision

1. Preserve `src/mcp.ts` as the compatibility manager and keep omitted `transport` equivalent to `stdio`.
2. Separate JSON-RPC/protocol, transport, and authentication into `mcp-protocol.ts`, `mcp-transport.ts`, and `mcp-auth.ts`.
3. Add Streamable HTTP with POST JSON/SSE, optional GET SSE, session headers, protocol headers, cancellation, timeout, reconnect, resumption, and DELETE shutdown.
4. Negotiate the current supported protocol while accepting known MCP versions down to `2024-11-05`.
5. Keep bearer and OAuth token values outside persisted config through versioned secret references and Electron `safeStorage`; commit rotated token values and their expiry metadata as one configuration transaction.
6. Require HTTPS except loopback development endpoints; reject URL credentials, query strings, fragments, and authentication-bearing custom headers.
7. Provide OAuth discovery, PKCE, state, code exchange, expiry, refresh, and token-rotation primitives without silently claiming an interactive authorization completed.
8. Normalize errors and redact sensitive audit data at both protocol and Electron service boundaries.

## Consequences

- Existing stdio MCP installations remain compatible.
- Desktop can expose connection lifecycle without giving the renderer raw transport or credential access.
- CLI/TUI gain the same transport behavior through the existing manager API.
- Interactive OAuth browser/callback UX remains a separate host concern; the core lifecycle is real and testable without a mock-only production path.
- Remote servers must migrate insecure non-loopback HTTP and URL-embedded authentication before they can connect.

## Rejected Alternatives

- Replacing the stdio manager in one migration was rejected because it would break installed servers and existing client APIs.
- Persisting access or refresh tokens in `config.json` was rejected because MCP credentials share the desktop secret boundary.
- Treating a generated authorization URL as completed OAuth was rejected because the host still owns browser navigation, callback binding, and user consent.
- Accepting arbitrary authentication headers from configuration was rejected because it bypasses secret references and log redaction.

## Verification And Rollout Gates

- Real stdio compatibility and real loopback HTTP/SSE fixtures must pass.
- Initialize, capability negotiation, discovery, invocation, streaming, timeout, cancellation, reconnect, and graceful shutdown must be covered.
- OAuth metadata, PKCE/state, expiry, refresh, rotation, HTTPS enforcement, and redaction tests must pass.
- Existing Desktop, CLI, TUI, feature, security, release, and DoD gates must remain green.
