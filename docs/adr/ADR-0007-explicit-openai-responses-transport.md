# ADR-0007: Select OpenAI Responses Explicitly Per Model Profile

Status: Accepted

Date: 2026-07-10

## Context

Model Provider Adapter v2 established one provider-neutral runtime contract while retaining OpenAI-compatible Chat Completions as the production transport. The OpenAI Responses protocol has different request items, streaming events, tool-call correlation, usage fields, and terminal states. Inferring that protocol from an OpenAI hostname or model name would silently change existing user behavior and would break compatible providers that only implement Chat Completions.

## Decision

Add an optional `protocol` field to each model profile.

- Omitted or `chat_completions` selects the existing compatibility adapter.
- `responses` selects the dedicated OpenAI Responses adapter.
- Unknown values fail validation before network I/O or config persistence.
- The adapter maps Responses wire events into the existing Model Provider v2 and Runtime Protocol contracts.
- `call_id` is preserved across the assistant function call, local tool execution, and next-request `function_call_output`.
- Remote Responses endpoints require HTTPS; only loopback HTTP is allowed for local development and tests.
- Requests set `store: false` and do not enable provider-hosted background execution.

## Consequences

Positive:

- Existing model profiles and compatible endpoints do not change behavior.
- Responses-native streaming, tool calls, usage, interruption, and errors can run through the shared Runtime.
- Electron connection testing and renderer config saves use the same explicit protocol contract.
- Rollback is a one-field profile change and requires no data migration.

Tradeoffs:

- Users must select Responses in Advanced JSON until a later settings design is approved.
- Capability support remains deliberately narrower than the full hosted Responses product surface.
- The adapter owns a second wire decoder that requires focused conformance tests.

## Rejected Alternatives

- Infer Responses for `api.openai.com`: rejected because endpoint identity is not a stable capability contract.
- Migrate all profiles to Responses: rejected because it would break third-party OpenAI-compatible services.
- Add Responses branches directly to `src/llm.ts`: rejected because provider-specific wire semantics belong behind Model Provider Adapter v2.
- Reuse streamed `item_id` as the tool `call_id`: rejected because the protocol assigns different lifecycle roles to those identifiers.

## Verification And Rollback

The loopback conformance test exercises request conversion, ordered SSE decoding, exact tool correlation, Runtime execution, usage, interruption, errors, endpoint security, and the legacy route. Full verify and release gates protect Electron, CLI, TUI, Store, industrial, and release behavior.

Revert HC-PROV-211 or remove `protocol: "responses"` from affected profiles. No session, event, job, project, or artifact migration is required.
