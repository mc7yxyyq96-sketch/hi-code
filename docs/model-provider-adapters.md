# Model Provider Adapter v2

Status: Implemented compatibility foundation in HC-PROV-210; OpenAI Responses transport in HC-PROV-211

## Purpose

The Model Provider Adapter is the model-transport boundary used by the shared Hi Code runtime. It is intentionally separate from `AgentProviderRegistry`, which represents external task executors such as a future Codex CLI or Claude Code process.

`src/model-provider.ts` owns:

- provider descriptors and capability declarations
- fail-fast capability and token-limit negotiation
- ordered provider-neutral text, tool, usage, terminal, and error events
- normalized result and error contracts
- in-memory migration of the existing `ModelProfile`
- the production compatibility adapter over the current OpenAI Chat Completions transport

`src/llm.ts` remains the low-level Chat Completions HTTP/SSE transport. `src/openai-responses-provider.ts` owns the Responses-specific wire contract. Runtime, context compaction, manager planning, and council synthesis call the provider facade instead of either transport directly.

## Descriptor

Every adapter publishes a schema-v2 descriptor:

```ts
interface ModelProviderDescriptor {
  schemaVersion: 2;
  id: string;
  name: string;
  version: string;
  protocol?: string;
  model?: string;
  capabilities: ModelProviderCapabilities;
  limits: { contextTokens?: number; outputTokens?: number };
  metadata?: Record<string, unknown>;
}
```

Supported capability identifiers are:

- `input.text`
- `input.image`
- `input.file`
- `input.pdf`
- `tool.calling`
- `tool.streaming`
- `reasoning.summary`
- `output.structured`
- `usage`
- `interruption`

Support is `supported`, `conditional`, or `unsupported`. Conditional support creates a negotiation warning; unsupported requirements fail before adapter execution or network I/O.

## Request Lifecycle

1. Derive requirements from messages, tools, interruption, and caller token estimates.
2. Merge explicit caller requirements.
3. Negotiate requirements against the immutable descriptor.
4. Reject unsupported input before invoking `adapter.run(...)`.
5. Emit `request.started`.
6. Validate and sequence adapter text, tool, and usage events.
7. Emit exactly one terminal event: completed, interrupted, or failed.
8. Return a normalized result or throw a normalized provider error.

Invalid ordering, such as a tool delta without a corresponding start, fails with `provider_event_invalid`. Listener failures cannot abort model transport.

## Runtime Protocol Mapping

The Agent keeps assistant text on the established `assistant.delta` and `assistant.completed` path. Provider operational semantics are projected separately:

| Provider event | Runtime Protocol kind | Visibility |
| --- | --- | --- |
| `request.started` | `model.requested` | timeline, job, SDK |
| `tool.call.started` | `model.tool_call.started` | hidden, job, SDK |
| `tool.call.delta` | `model.tool_call.delta` | hidden, SDK |
| `tool.call.completed` | `model.tool_call.completed` | hidden, job, SDK |
| `usage.updated` | `usage.updated` | hidden, job, SDK |
| `response.failed` | `model.failed` | timeline, job, SDK |

Tool argument deltas are not chat-visible. Existing execution events (`tool.started`, approvals, output, and completion) remain authoritative for actual tool execution.

## Legacy Profile Migration

`migrateLegacyModelProfile(profile)` maps the current profile in memory to `legacy-openai-compatible`. It does not rewrite config or session data. Endpoint, model, temperature, context window, and credential behavior remain compatible.

The compatibility descriptor never includes the API key. Image input is conditional because OpenAI-compatible endpoints differ. File/PDF input, reasoning summaries, and structured-output negotiation remain explicitly unsupported until dedicated adapters deliver them.

## Explicit Transport Selection

`ModelProfile.protocol` accepts `chat_completions` or `responses`. Omission deliberately remains `chat_completions`; Hi Code does not infer protocol support from the endpoint or model name. The renderer preserves an existing explicit selector, the Electron connection test follows it, and unknown selectors are rejected before persistence.

The Responses adapter uses real HTTPS/SSE transport, sets `store: false`, preserves Responses `call_id` across local tool execution, and maps native terminal and usage fields into the provider-neutral contract. See `docs/openai-responses-adapter.md` and ADR-0007.

## Error Contract

Provider failures expose stable authentication, authorization, rate-limit, timeout, network, context-length, capability, validation, cancelled, or provider categories. Each error contains a stable code, redacted message, retriable flag, optional HTTP status, and sanitized details. Authorization headers and key/token/secret/password-like values are removed before events or evidence are persisted.

## Adding An Adapter

1. Implement `ModelProviderAdapter` with a complete descriptor and `run` method.
2. Declare unsupported capabilities rather than silently degrading them.
3. Emit tool starts before deltas and completion.
4. Return exact assembled tool calls and truthful usage.
5. Honor abort signals and report interruption instead of completion.
6. Add real transport fixtures, capability rejection, error redaction, event-order, and Runtime Protocol tests.
7. Add an ADR if the adapter introduces a new wire protocol or persisted configuration.

## Current Limits

The current adapters do not implement Anthropic Messages, Ollama-native APIs, external Codex/Claude agents, provider-hosted files, background Responses, remote provider tools, or structured-output negotiation. Responses selection currently uses the existing Advanced JSON editor rather than a new settings redesign. Both Chat Completions and Responses are real production paths, not mocks.
