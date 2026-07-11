# HC-PROV-211 Task Manifest

Status: In progress

Owner: Runtime Engine

Release: `0.6.0-alpha.9`

Branch: `codex/runtime-engine/hc-prov-211`

Parent commit: `06dd676`

Started: `2026-07-11T00:51:02Z`

## Problem

Hi Code currently reaches OpenAI-compatible Chat Completions through the Model Provider v2 compatibility adapter. It cannot deliberately select the OpenAI Responses protocol, preserve Responses-native streamed tool-call identities, or normalize Responses usage and terminal states without relying on Chat Completions assumptions.

## Outcome

Add a production OpenAI Responses adapter behind Model Provider v2 while retaining the existing Chat Completions adapter as the default for all current profiles. Protocol choice is explicit, capability negotiation remains preflight-only, and both transports emit the same validated provider and Runtime Protocol semantics.

## Scope

- Explicit `responses` versus `chat_completions` transport selection in model profile configuration.
- OpenAI Responses request conversion for system, user, assistant, image, tool-call, and tool-result content.
- Responses SSE conversion for text, tool lifecycle, usage, completion, interruption, incomplete responses, and errors.
- Legacy Chat Completions compatibility with no persisted-profile rewrite.
- Real local HTTP stream fixtures and a shared Runtime tool-loop acceptance test.
- Documentation for configuration, compatibility, security, migration, and rollback.

## Out Of Scope

- Anthropic Messages, Ollama-native, or external Codex/Claude task-provider transports.
- Hosted API credentials, billing, pricing, model discovery, or cloud-side state management.
- Renderer settings redesign, attachment persistence, or a new command registry.
- Background responses, remote tool execution, computer use, or provider-hosted file lifecycle.

## Interfaces

- `OpenAIResponsesAdapter`: implements `ModelProviderAdapter` over HTTPS or explicitly permitted local HTTP.
- `ModelTransportProtocol`: persisted optional protocol selector with `chat_completions` as the compatibility default.
- Responses request and stream decoders: provider-specific wire types kept behind the adapter boundary.
- Existing `ModelProviderEvent` and Runtime Protocol records remain the application-facing contract.

## Migration And Compatibility

Existing profiles omit the protocol selector and continue to use Chat Completions. Choosing Responses changes only that profile's transport. No existing session, event, job, project, or artifact file is rewritten. Configuration validation rejects unknown protocols.

## Security

The adapter reuses existing URL validation, request cancellation, bounded metadata, and error redaction. Authorization headers and API keys never enter provider events, Runtime Protocol records, command evidence, or user-visible logs. Tests use loopback-only servers and synthetic credentials.

## Tests

- Stream text deltas and final usage from a real local Responses SSE server.
- Preserve one tool call from item creation through argument deltas to exactly one completion.
- Convert image input and tool results into the Responses request schema.
- Abort an active request and emit interruption without completion.
- Normalize failed and incomplete responses without false success.
- Keep current Chat Completions profiles and transport behavior unchanged.
- Run full build, verify, release, feature, security, DoD, production audit, and Electron E2E gates.

## Baseline

On the unmodified HC-PROV-210 parent, `npm run build`, `npm run verify`, `npm run release:check`, and `node test/feature-tests.mjs` passed. Feature tests reported 80 passes and zero failures. The external shell-profile warning remains non-blocking and outside this repository.

## Failure-First Checkpoint

`npm run test:openai-responses` initially failed because `createModelProfileAdapter` did not exist in the production build. The new test already describes real loopback HTTP requests, Responses SSE events, image and prior tool context conversion, usage, cancellation, incomplete and failed terminal states, credential redaction, and the unchanged Chat Completions route. No production behavior was added before this failure was observed.

## Rollback

Revert HC-PROV-211 commits. Profiles without the optional selector remain unchanged; profiles that explicitly selected Responses can be reset to `chat_completions` without migrating user data.

## Commit Plan

1. Record task boundary, baseline, dependency, risk, and worktree state.
2. Add failure-first wire-contract tests for Responses streaming and requests.
3. Implement the adapter and explicit configuration selection.
4. Integrate through Model Provider v2 and prove Runtime compatibility.
5. Run all gates, capture evidence, complete program state, and commit.
