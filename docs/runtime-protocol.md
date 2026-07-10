# Runtime Protocol Foundation

Date: 2026-07-10

## Purpose

Hi Code needs a stable runtime protocol before it can grow to Codex / Claude Code scale. The protocol is the shared event envelope for desktop UI, CLI/TUI, future SDKs, Job Center, Patch Arena, and external agent adapters.

This document describes the compatible v0.6 runtime stream. A materialized event is persisted first, delivered through `RuntimeEventSink`, and also carries a versioned `payload.runtimeProtocol` envelope for consumers migrating from legacy event fields.

## Current Implementation

Core file:

- `src/runtime-protocol.ts`
- `src/events.ts`
- `src/runtime-event-sink.ts`
- `src/runtime-client-adapters.ts`

Runtime integration:

- `src/runtime.ts` calls `createRuntimeProtocolEvent(...)` for every emitted runtime event and sends the materialized event to an injected `RuntimeEventSink`.
- The generated envelope is attached as `event.payload.runtimeProtocol`.
- `src/agent.ts` emits first-class `assistant:delta` and `assistant:completed` events. Completion includes the full message; empty and failed responses use `error`, never a fake completed state.
- `src/runtime-event-store.ts` appends validated protocol events to `~/.hicode/runtime-events/<sessionId>.jsonl` for replay and crash recovery.
- `src/runtime-stores.ts` implements typed `ThreadStore`, `EventStore`, and `MessageStore` contracts under `~/.hicode/runtime-store-v2/`.
- `src/agent.ts` emits hidden `message.appended` records for exact user, assistant, and tool messages; `src/runtime.ts` emits the system message once when a new model-backed session begins.
- `src/session-store.ts` reconstructs complete resumable sessions from typed records or normalized protocol events when legacy session JSON is missing. Older incomplete event streams remain explicitly replay-only.
- `src/recovery.ts` reads recoverable failed/interrupted/denied turns from the append-only protocol store and merges them with legacy runtime logs so desktop recovery controls survive restart during the v0.6 migration.
- `src/turn-state-machine.ts` deterministically derives turn phase, bounded partial output, pending approval/tool state, and a conservative recovery action from protocol records.
- CLI/TUI `/sessions` shows replay-only event sessions, and `/resume <id>` opens those sessions as read-only transcript replay instead of pretending they can continue model context.
- Full saved session resume continues runtime protocol sequence numbers from the append-only event store, so resumed turns do not duplicate prior event sequences.
- Electron, CLI, and TUI use `RuntimeEventBus` plus client adapters for assistant text. The legacy `emitEvent` callback remains compatible for one migration period.
- The Electron stdout bridge is no longer an assistant transport. It remains an opt-out compatibility path for old command/tool console text and can be disabled with `HICODE_LEGACY_STDOUT_BRIDGE=0`.

Tests:

- `test/runtime-protocol-tests.mjs`
- `test/runtime-store-tests.mjs`
- `test/runtime-store-integration-tests.mjs`
- `test/runtime-event-sink-tests.mjs`
- `test/runtime-concurrency-tests.mjs`
- `test/runtime-client-adapter-tests.mjs`
- `tests/electron-e2e/run.mjs`
- Included in `npm run verify` and `npm run release:check`.

Version sync:

- `package.json` is now on the `0.6.0-alpha.7` release-candidate line.
- `scripts/sync-version.mjs` checks that Electron `app.getVersion()` and renderer labels remain wired to package metadata instead of hard-coded version text.

## Transport Mapping

Desktop / Electron:

- Main process owns a process-local `RuntimeEventBus` and injects it into normal and isolated runtimes.
- Assistant deltas project to the existing `output` IPC channel; completion and timeline events retain the existing `tool-event` channel. No renderer API break is required.
- Assistant deltas are not duplicated into the legacy tool timeline/log. Their durable authority is the append-only protocol store.
- Hidden `message.appended` events never enter legacy timeline or Job logs; they are local replay context for typed stores and SDK consumers.
- Real Electron E2E runs a local streaming model with `HICODE_LEGACY_STDOUT_BRIDGE=0` and verifies the complete response in the chat view.

CLI / TUI:

- Both clients inject their own `RuntimeEventBus`, disable direct assistant stdout rendering, and project typed assistant events with `connectAssistantTextOutput(...)`.
- Console/stdout interception remains only for legacy command/tool framing in TUI; model text does not depend on it.
- `/sessions` includes complete normalized event sessions as resumable entries and older incomplete event sessions as `replay` entries.
- `/resume <id>` resumes full saved sessions when session JSON exists.
- `/resume <id>` reconstructs complete model context from normalized system, user, assistant, and tool message records when only protocol JSONL exists.
- Event-only streams created before normalized message records remain read-only; human-readable summaries are never promoted into model context.

Future SDK / app-server:

- SDK streaming should expose the `RuntimeProtocolEvent` envelope directly.
- Legacy event fields remain compatibility metadata, but new automations key off `schemaVersion`, `kind`, `status`, `sessionId`, `turnId`, and `sequence`.

## Event Shape

Each protocol event includes:

- `schemaVersion`
- `id`
- `sessionId`
- `turnId`
- `sequence`
- `kind`
- `legacyType`
- `status`
- `actor`
- `tool`
- `title`
- `summary`
- `createdAt`
- `updatedAt`
- `visibility`
- `payload`

Example:

```json
{
  "schemaVersion": 1,
  "id": "rpe_...",
  "sessionId": "session_...",
  "turnId": "session_...-turn-1",
  "sequence": 1,
  "kind": "turn.started",
  "legacyType": "turn:start",
  "status": "running",
  "actor": "runtime",
  "title": "Agent turn",
  "createdAt": 1783497600000,
  "visibility": ["timeline", "job", "sdk"]
}
```

## Kinds

Initial protocol kinds:

- `turn.started`
- `turn.updated`
- `turn.completed`
- `turn.failed`
- `turn.denied`
- `turn.interrupted`
- `assistant.delta`
- `assistant.completed`
- `message.appended`
- `model.output`
- `tool.started`
- `tool.output`
- `tool.completed`
- `tool.failed`
- `tool.denied`
- `tool.interrupted`
- `approval.requested`
- `approval.resolved`
- `diff.created`
- `diff.updated`

## Statuses

Allowed statuses:

- `running`
- `waiting`
- `done`
- `error`
- `denied`
- `interrupted`

Important rule: `simulated`, `not_run`, and industrial quality gate states are not coerced into `done` here. Those belong to Quality Gate and artifact evidence models. Runtime protocol events describe runtime execution state only.

## Visibility

The `visibility` array tells downstream consumers where an event is safe and useful to render:

- `chat`
- `timeline`
- `diff`
- `job`
- `sdk`
- `hidden`

Assistant deltas route to chat/sdk; assistant completions route to chat/timeline/sdk. Exact `message.appended` records route only to hidden/sdk consumers. Tool events route to timeline/job/sdk, diffs to diff/timeline/job/sdk, and approval request/resolution pairs to timeline/job/sdk. `model.output` is retained as a reserved compatibility kind and is not the new assistant transport.

## Validation

`validateRuntimeProtocolEvent(event)` rejects malformed envelopes:

- unsupported schema version
- empty `id`, `sessionId`, `turnId`, or `title`
- non-positive sequence
- unknown kind
- unknown status
- invalid visibility
- `message.appended` without a non-empty message ID and valid system/user/assistant/tool message
- `approval.resolved` without a request ID and an `allow`, `always`, or `deny` decision

## Recovery Projection

`buildRecoveryPlan(events)` and `reduceTurnState(events)` use the same pure reducer. The reducer never calls a model, tool, or permission callback. It returns one of these actions:

- `retry_turn`: model-only or read-only-tool interruption; retry is allowed only after restoring the source session.
- `retry_with_approval`: a denied or unanswered approval; the prior decision is not reused.
- `review_output`: a complete assistant answer exists but the terminal record is absent or failed; the answer is shown rather than generated twice.
- `inspect_tool`: a tool may still be running or a side-effecting tool already completed; one-click retry is blocked.
- `none`: terminal completion requires no recovery.

Assistant partial output is bounded to 32,768 characters in the recovery projection. Exact message records remain the model-context authority. Legacy logs without tool-side-effect evidence remain visible but are not automatically retried.

`isRuntimeProtocolEvent(event)` is the type guard for future consumers.

## Migration Plan

1. Keep legacy runtime event fields intact. Completed.
2. Attach protocol envelopes to every runtime event. Completed.
3. Append protocol events to a durable JSONL event store. Completed.
4. Emit assistant deltas/completions through an injected sink and migrate Electron/CLI/TUI. Completed in HC-RUN-201.
5. Make recent sessions replay from persisted protocol events. Completed with backward-compatible replay-only handling for incomplete v1 streams.
6. Reconstruct complete resumable context from typed stores and normalized message events. Implemented in HC-RUN-202; final release evidence remains the promotion gate.
7. Derive conservative crash/approval/tool recovery from protocol records. Implemented in HC-RUN-203; final evidence remains the acceptance gate.
8. Expose protocol streaming through a future local app-server and SDK.

## Guardrails

- Do not copy Codex or Claude Code source.
- Do not use this protocol as a reason to fake features.
- Do not mark simulated industrial evidence as real runtime completion.
- Do not remove legacy event fields until Electron, CLI, TUI, and tests have migrated.
