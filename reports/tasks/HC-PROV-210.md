# HC-PROV-210 Task Manifest

Status: In Progress

Owner: Runtime Engine

Release: `0.6.0-alpha.9`

Branch: `codex/runtime-engine/hc-prov-210`

Parent commit: `80e6b83`

Started: `2026-07-10T23:40:52Z`

Evidence: `reports/evidence/HC-PROV-210/manifest.json` after acceptance

## Problem

The existing `AgentProviderRegistry` models external task executors, while model profiles call the OpenAI-compatible transport directly. There is no pre-request capability negotiation, no provider-neutral event contract for text/tool/usage/error semantics, and no explicit migration from legacy model profiles into a Model Provider Adapter.

## Outcome

Introduce a distinct, executable Model Provider Adapter v2 layer. Current model profiles continue to work through a real compatibility adapter, but every request is validated against declared capabilities before network I/O and every adapter result uses normalized events, usage, tool calls, finish state, and errors.

## Scope

- Model Provider Adapter, registry, descriptor, capability, request, event, result, usage, tool-call, and error types.
- Deterministic capability negotiation with requested inputs, tools, structured output, reasoning, interruption, context, and output constraints.
- Stable error normalization with retriable/rate-limit/auth/context/capability categories.
- Ordered event validation that preserves text deltas, tool argument deltas, completed tool calls, usage, and terminal semantics.
- A compatibility adapter over the existing OpenAI Chat Completions transport.
- Legacy `ModelProfile` migration into adapter configuration without changing the persisted config format.
- Runtime integration through the compatibility adapter with existing Electron, CLI, TUI, session, and Runtime Protocol behavior preserved.

## Out Of Scope

- OpenAI Responses API implementation (HC-PROV-211).
- Anthropic Messages or Ollama-specific transport implementation (HC-PROV-212).
- External Codex CLI or Claude Code Agent adapters.
- Attachment persistence, provider settings redesign, or renderer framework migration.
- Secret-store migration, provider pricing, billing, or automatic model discovery.

## Interfaces

- `ModelProviderAdapter`: descriptor plus `run(request, sink, signal)`.
- `ModelProviderRegistry`: register/list/get/negotiate/run with fail-fast checks.
- `ModelProviderRequirements`: explicit capability and token constraints.
- `ModelProviderEvent`: ordered text, tool, usage, completion, interruption, and error events.
- `migrateLegacyModelProfile`: compatibility conversion from current profile fields.
- `createLegacyOpenAICompatibleAdapter`: production adapter over `streamChat`.

## Migration And Compatibility

The existing config JSON remains readable and writable. No user data is rewritten. Each legacy profile is mapped in memory to an adapter ID and declared capability set; rollback removes the new adapter integration and restores direct `streamChat` calls.

## Security

Capability rejection happens before adapter execution. Events and normalized errors cannot include API keys or authorization headers. Adapter metadata is bounded and sanitized. Existing HTTPS/local endpoint behavior, abort signals, minimal child-process environment, workspace confinement, and approval policy remain unchanged.

## Tests

- Unsupported capabilities reject before the adapter receives a request.
- Supported text/image/tool/interrupt/context combinations negotiate deterministically.
- Text, tool argument, tool completion, usage, interruption, and error events preserve order and semantics.
- Invalid event sequences and credential-bearing errors are rejected or redacted.
- Legacy profile migration selects the compatibility adapter without rewriting config.
- A real local SSE fixture passes through the compatibility adapter and existing runtime.
- Full build, verify, release, feature, security, DoD, and Electron E2E gates pass.

## Baseline

On the unmodified alpha.8 parent, `npm run build`, `npm run verify`, `npm run release:check`, and `node test/feature-tests.mjs` passed. Feature tests reported 80 passes and zero failures. The external `~/.profile` ComfyUI warning remains non-blocking and outside this repository.

## Rollback

Revert the HC-PROV-210 commits. No persisted profile, session, runtime event, artifact, or project format changes, so rollback requires no data migration.

## Commit Plan

1. Record task boundary, baseline, risk, and program state.
2. Implement Model Provider v2 contracts, negotiation, normalized events, and focused tests.
3. Integrate the legacy compatibility adapter into runtime and prove local SSE compatibility.
4. Run global gates, capture evidence, complete program state, and commit.
