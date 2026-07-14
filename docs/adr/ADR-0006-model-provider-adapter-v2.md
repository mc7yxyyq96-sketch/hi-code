# ADR-0006: Separate Model Provider Adapter v2 From Agent Providers

Status: Accepted

Date: 2026-07-10

## Context

Hi Code had two concepts under the word provider. `AgentProviderRegistry` describes an external executor for a whole engineering task, while `ModelProfile` called an OpenAI-compatible HTTP transport directly for each model turn. Direct calls could discover missing image, tool, interruption, or token-limit support only after network I/O, and provider-specific failures lacked stable event semantics.

The runtime also needs a provider-neutral stream for future OpenAI Responses, Anthropic Messages, and local-model transports without splitting Electron, CLI, TUI, replay, and Job Center behavior.

## Decision

Introduce `ModelProviderAdapter` as a distinct in-process model transport boundary.

- A descriptor declares capabilities and token limits.
- A registry negotiates all requirements before adapter execution.
- Adapter output is an ordered event stream with exactly one terminal state.
- Errors, usage, finish reasons, and tool calls are normalized.
- The existing `ModelProfile` maps in memory to a real OpenAI Chat Completions compatibility adapter.
- Runtime provider events map into the existing append-only Runtime Protocol while assistant text keeps its current client projection.
- `src/llm.ts` remains an internal transport and is no longer called directly by production orchestration modules.

## Consequences

Positive:

- Unsupported requirements fail before network I/O.
- Provider additions no longer require alternate runtime or UI paths.
- Runtime records tool-call construction, usage, and normalized failures with correlation IDs.
- Existing user configuration and sessions require no migration.

Tradeoffs:

- Conditional capabilities still require endpoint/model verification.
- The compatibility adapter creates a small registry per request until provider configuration becomes a long-lived service.
- Provider tool-call events and actual tool-execution events are distinct and must not be confused by clients.

## Security And Compatibility

Descriptors and Runtime Protocol events cannot carry profile credentials. Error text and details are sanitized before emission. Tool argument deltas are hidden from chat/timeline presentation. Existing workspace, approval, child-process, and endpoint rules remain unchanged. Current profile and session formats are unchanged.

## Rejected Alternatives

- Expanding `AgentProviderRegistry`: rejected because task executors and model transports have different lifecycle and isolation contracts.
- Replacing all model transports at once: rejected because it would break compatibility and make rollback unsafe.
- Inferring capability after a failed request: rejected because unsupported input must fail before network execution.

## Verification And Rollback

Capability rejection, event order, error redaction, migration identity, real local SSE, shared Runtime integration, and Runtime Protocol mapping are executable tests. Reverting HC-PROV-210 restores direct transport calls without converting config, session, runtime-store, Job, or project data.

OpenAI Responses, Anthropic Messages, Ollama-native transport, secure-store migration, external Codex/Claude task providers, and provider configuration UI are not decided or delivered here.

