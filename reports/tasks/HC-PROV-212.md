# HC-PROV-212 Task Manifest

Status: In progress

Owner: Runtime Engine

Release: `0.6.0-alpha.9`

Branch: `codex/runtime-engine/hc-prov-212`

Parent commit: `7f91c76`

Started: `2026-07-11T02:40:19Z`

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

## Commit Plan

1. Record task boundary, dependency, baseline, and risk.
2. Add failure-first Anthropic and Ollama wire-contract tests.
3. Implement dedicated adapters and explicit protocol selection.
4. Prove shared Runtime compatibility and unchanged legacy paths.
5. Capture all evidence, complete program state, commit, push, and open a draft review.
