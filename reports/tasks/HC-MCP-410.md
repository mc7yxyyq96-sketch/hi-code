# HC-MCP-410 Task Manifest

Status: Completed

Started: 2026-07-13T11:39:31Z

Completed: 2026-07-13T16:58:48Z

Branch: `codex/runtime-engine/hc-mcp-410`

Parent commit: `630b19d`

## Problem

Hi Code's production MCP path was stdio-only. It lacked a transport-neutral lifecycle for remote sessions, bounded Streamable HTTP, negotiated capabilities, reconnect/cancellation semantics, and a credential-safe bearer/OAuth lifecycle. A replacement could also break installed stdio servers and the shared Desktop, CLI, and TUI manager API.

## Outcome

Deliver one backward-compatible MCP connection layer that keeps managed stdio as the default and adds secure Streamable HTTP, explicit session lifecycle, normalized protocol behavior, scoped authentication, secret references, and validated Desktop controls without creating a second MCP authority.

## Scope

- Existing stdio compatibility through the managed execution policy.
- Streamable HTTP POST JSON/SSE, optional GET SSE, session/protocol headers, reconnect, resumption, timeout, cancellation, and DELETE shutdown.
- Initialize and capability negotiation, tool discovery, invocation, progress/streaming results, and normalized errors.
- Bearer and OAuth metadata, PKCE/state, code exchange, expiry, refresh, token rotation, and resource indicators.
- Electron lifecycle service, validated preload/API calls, and real Renderer status/actions.
- Scoped secret references and sensitive log redaction.

## Out Of Scope

- Silently opening a browser, binding a callback port, or claiming user OAuth consent completed without a host-owned interaction.
- Enterprise MCP gateways, SSO policy, fleet management, or remote industrial workers.
- Formal release, tag, publication, Apple notarization, or Windows/macOS signing.
- New industrial domain functionality.

## Interfaces

- `src/mcp.ts` remains the compatibility manager used by Desktop, CLI, and TUI.
- `src/mcp-protocol.ts` owns JSON-RPC validation, negotiation, normalized errors, and tool-result contracts.
- `src/mcp-transport.ts` owns managed stdio and Streamable HTTP wire lifecycles.
- `src/mcp-auth.ts` owns authentication state and OAuth primitives.
- `electron/services/mcp-service.mjs` owns lifecycle IPC and secret resolution.

## Migration And Compatibility

- Missing `transport` still means `stdio`; existing command, args, env, and Store-installed configurations remain valid.
- Existing `initializeMcp`, `listMcpTools`, `callMcpTool`, `reloadMcp`, and `shutdownMcp` callers remain valid.
- New remote/auth fields are additive and validated before network activity.
- No existing workspace or application-data location changes.

## Security

- Non-loopback remote endpoints require HTTPS and cannot contain credentials, query strings, or fragments.
- Custom Authorization, Cookie, and Proxy-Authorization headers are rejected.
- Response bodies, SSE events, stderr, and tool results are bounded.
- Bearer/OAuth values are externalized to scoped secret references and resolved only in the Electron main process.
- Token values, secret-like fields, headers, and protocol error data are redacted before audit logging.
- OAuth authorization requests use discovery, PKCE, state, and explicit expiry/refresh handling; generated requests are not recorded as completed approval.

## Tests

- Real local HTTP/SSE lifecycle tests for initialize, negotiation, discovery, invocation, streaming, reconnect, timeout, cancellation, shutdown, and normalized errors.
- Stdio compatibility through the existing feature suite.
- OAuth expiry/refresh/rotation, PKCE/state, HTTPS, secret-reference, and redaction tests.
- Electron service/IPC and Renderer lifecycle tests.
- Global build, verify, release check, feature, security, DoD, production audit, Program Control, and real Electron E2E gates.

## Rollback

- Revert the task commit to remove the remote transport and restore the previous stdio-only manager.
- Existing stdio configuration remains readable throughout the migration.
- Remote session state is in memory; graceful shutdown sends DELETE when supported and clears local clients without altering workspaces.
- Secret-reference migration is transactional and does not persist raw credentials in task evidence.

## Stop Conditions

- Any stdio regression, plaintext persisted token, insecure non-loopback HTTP, unbounded remote response, or false successful OAuth state blocks completion.
- Formal release/signing work remains blocked on explicit approval and `RISK-REL-001`; this task does not change that risk.

## Implemented

- Added transport-neutral protocol, stdio/Streamable HTTP transports, and authentication modules behind the existing MCP manager.
- Added negotiated protocol/session state, reconnect, timeout, cancellation, streaming progress, graceful close, and normalized failures.
- Added OAuth discovery, PKCE/state, code exchange, expiry, refresh, token rotation, resource indicators, and atomic persistence of rotated credentials with matching expiry metadata.
- Added validated Electron lifecycle IPC, Renderer connection controls, and sensitive audit sanitization.
- Added real local HTTP/SSE, service, security, Renderer, feature, and DoD coverage plus architecture and operator documentation.

## Focused Verification

- `test/mcp-connection-tests.mjs`: 20 passed.
- `test/main-process-services-tests.mjs`: 196 passed.
- `test/security-baseline.mjs`: 240 passed.
- `test/renderer-architecture-tests.mjs`: 191 passed.
- `test/feature-tests.mjs`: 80 passed.
- `test/program-control-tests.mjs`: 1263 passed.
- Evidence capture: 14 of 14 commands passed.
- Full-tree DoD scan: zero findings.

## Integration Review

- API compatibility: existing stdio and manager exports are preserved; omitted transport still resolves to stdio.
- Client compatibility: Desktop uses validated lifecycle IPC, while CLI/TUI continue through the shared manager and await the same graceful shutdown instead of using a client-specific transport.
- Security review: remote URL/header/body bounds, failed-response cancellation, OAuth state and issuer binding, secret references, atomic token/expiry rotation, and recursive audit redaction are fail closed and test covered.
- Release isolation: no HC-REL-420 source or evidence was rewritten, no formal release/tag/signing action occurred, and `RISK-REL-001` remains open.
- Product truth: OAuth core lifecycle is implemented; browser/callback consent UX is explicitly not claimed.

## Evidence

- Local acceptance: `reports/evidence/HC-MCP-410/manifest.json`
- Evidence captures exact command logs and artifact hashes before the independent task commit.
