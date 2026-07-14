# ADR-0008: Explicit Anthropic Messages And Ollama Native Transports

Status: Accepted

Date: 2026-07-10

## Context

Anthropic Messages and Ollama native chat differ from OpenAI Chat Completions in message roles, image representation, tool-result correlation, stream framing, terminal fields, usage, authentication, and reasoning fields. Routing them through a compatibility shape would lose semantics and could report malformed or interrupted work as complete.

The existing profile schema must remain backward compatible. Runtime, CLI, TUI, Electron, replay, and Job Center already consume the provider-neutral Model Provider Adapter v2 contract and should not fork by vendor.

## Decision

1. Add explicit `anthropic_messages` and `ollama_chat` profile selectors. Never infer either protocol from a model name or endpoint. Omission remains Chat Completions.
2. Implement dedicated production adapters over `/v1/messages` and `/api/chat`.
3. Normalize native text, tool lifecycle, usage, interruption, error, and terminal semantics into Model Provider Adapter v2.
4. Preserve Anthropic `tool_use.id`. Generate a deterministic run-local Ollama call ID and resolve it back to native `tool_name` for results.
5. Keep raw reasoning outside the product data model. `reasoning.summary` remains explicitly unsupported until a versioned summary event and persistence policy exist. Ollama sends `think: false`.
6. Require HTTPS for remote endpoints while allowing loopback HTTP. Bound JSON and stream reads before normalized data can reach persistence.
7. Keep current profiles unchanged. Native presets create explicit new profiles; they do not rewrite existing profiles.

## Consequences

- Provider differences remain local to adapter modules while the shared Runtime tool loop stays unchanged.
- Capability negotiation can reject unsupported reasoning summaries before network I/O.
- Current Anthropic requests omit sampling temperature for compatibility with models that reject non-default sampling parameters.
- Ollama models that do not support images or tools produce conditional-capability warnings and real provider failures rather than fake success.
- Provider-hosted files, structured output, model discovery, and reasoning-summary UI remain separate tasks.

## Rejected Alternatives

- Treat Anthropic and Ollama as Chat Completions gateways: rejected because native tool, image, stream, and usage semantics would be flattened.
- Select protocols from URL patterns: rejected because gateways and custom deployments make inference unsafe.
- Put raw `thinking` into assistant text: rejected because it changes semantics and can expose hidden chain-of-thought.
- Report a closed stream as success without a native terminal event: rejected because cancellation and transport truncation would become false completion.

## Rollback

Revert HC-PROV-212 and reset profiles that explicitly selected the two new values. No config, session, event, job, project, or artifact migration is required.
