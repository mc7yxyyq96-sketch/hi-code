# HC-PROV-212 Task Manifest

Status: Completed

Owner: Runtime Engine

Release: `0.6.0-alpha.9`

Branch: `codex/runtime-engine/hc-prov-212`

Parent commit: `7f91c76`

Started: `2026-07-11T02:40:19Z`

Completed: `2026-07-11T04:18:59Z`

## Problem

Hi Code now has provider-neutral contracts plus Chat Completions and OpenAI Responses transports. Anthropic Messages and Ollama native chat have different message, image, tool, stream, usage, stop, and error semantics; sending them through Chat Completions assumptions would silently flatten provider behavior.

## Outcome

Add dedicated production adapters for Anthropic Messages and Ollama native chat behind Model Provider Adapter v2. Selection is explicit per profile, current profiles remain unchanged, unsupported capabilities fail before network I/O, and provider-specific streams normalize into the existing Runtime and Runtime Protocol contracts.

## Scope

- Explicit `anthropic_messages` and `ollama_chat` profile protocol values.
- Anthropic Messages request conversion, SSE event conversion, tool-use/result correlation, image blocks, usage, interruption, errors, and stop reasons.
- Ollama native `/api/chat` request conversion, NDJSON streaming, tools, images, usage, interruption, errors, and done reasons.
- Existing OpenAI Responses and Chat Completions paths remain unchanged.
- Real loopback transport fixtures and shared Runtime tool-loop tests.
- Typed declaration and truthful capability handling for optional reasoning summaries; raw hidden reasoning is not relabeled as a summary.

## Out Of Scope

- Gemini, hosted files, prompt caching billing policy, provider model discovery, or account management.
- Attachment persistence, PDF/file lifecycle, Command Registry, renderer framework migration, or new industrial modules.
- External Claude Code/Codex task executors; those remain Agent Provider work.
- Persisting or displaying raw chain-of-thought.

## Interfaces

- `AnthropicMessagesAdapter`: `ModelProviderAdapter` over `/v1/messages`.
- `OllamaChatAdapter`: `ModelProviderAdapter` over `/api/chat`.
- `ModelTransportProtocol`: explicit protocol selector extended without changing its default.
- Existing `ModelProviderEvent`, `AssistantTurn`, and Runtime Protocol remain client-facing.

## Migration And Compatibility

Profiles that omit `protocol` continue to use Chat Completions. Existing `responses` profiles remain on OpenAI Responses. No profile, session, event, job, project, or artifact file is rewritten. Unknown protocol values are rejected.

## Security

Remote endpoints require HTTPS; loopback HTTP is allowed for local Ollama and tests. Credentials do not enter descriptors, events, errors, logs, or evidence. Provider responses are bounded and normalized before persistence. Cancellation and terminal-state rules must not report interrupted work as complete.

## Tests

- Failure-first real loopback fixtures for both protocols.
- Text, image, tool, tool-result, usage, stop, interruption, and error mapping.
- Strict tool lifecycle and exact correlation across a two-request Runtime loop.
- Unsupported capabilities reject before transport.
- Legacy and OpenAI Responses routes remain unchanged.
- Full build, verify, release, feature, security, DoD, production audit, and Electron E2E gates.

## Baseline

On the unmodified HC-PROV-211 parent, `npm run build`, `npm run verify`, `npm run release:check`, and `node test/feature-tests.mjs` passed. Feature tests reported 80 passes and zero failures. The external shell-profile warning remains non-blocking and outside this repository.

## Rollback

Revert HC-PROV-212 commits. Reset profiles that explicitly selected the new protocols to their prior value. No user-data migration is required.

## Delivered Implementation

- `src/anthropic-messages-provider.ts` implements production JSON and named-SSE Messages transport, image conversion, `tool_use` correlation, usage, cancellation, and strict terminal validation.
- `src/ollama-chat-provider.ts` implements production `/api/chat` JSON and NDJSON transport, native image/tool mapping, deterministic run-local tool identities, usage, cancellation, and `done: true` validation.
- `src/provider-http-transport.ts` centralizes secure endpoint parsing, loopback-only HTTP, retry/timeout behavior, bounded JSON/SSE/NDJSON reads, and normalized transport failures.
- Model profiles, Electron connection tests, and renderer presets select `anthropic_messages` or `ollama_chat` explicitly. Existing profiles keep their original protocol.
- `test/anthropic-ollama-provider-tests.mjs` covers both real loopback wire formats and completes a two-request Runtime tool loop for each provider.

## Acceptance Result

- Provider-specific tool streaming is normalized without duplicate or incomplete tool completion.
- Reasoning summaries remain typed as unsupported; raw `thinking` is never presented or persisted as a summary.
- Unsupported capabilities, insecure remote endpoints, malformed streams, and missing terminal records fail closed without silent downgrade.
- Chat Completions and OpenAI Responses regression suites remain green.

## Evidence

`reports/evidence/HC-PROV-212/manifest.json` records 20 of 20 commands passing from implementation commit `e40f45d29a1a964fc4b50b1f8ec3e476809e149a`. The set includes build, verify, release check, feature tests, all provider/runtime/renderer/security/DoD checks, production audit, real Electron E2E, program control, and diff validation. Logs are content-hashed in the manifest.

## Remaining Limits

Provider-hosted files, structured-output negotiation, model discovery/pull, external Claude Code/Codex execution, and persisted reasoning summaries remain out of scope and are not claimed by this task.
