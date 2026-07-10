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
- `src/session-store.ts` merges event-only sessions into Recent as replay-only entries when the full chat session JSON is missing.
- `src/recovery.ts` reads recoverable failed/interrupted/denied turns from the append-only protocol store and merges them with legacy runtime logs so desktop recovery controls survive restart during the v0.6 migration.
- CLI/TUI `/sessions` shows replay-only event sessions, and `/resume <id>` opens those sessions as read-only transcript replay instead of pretending they can continue model context.
- Full saved session resume continues runtime protocol sequence numbers from the append-only event store, so resumed turns do not duplicate prior event sequences.
- Electron, CLI, and TUI use `RuntimeEventBus` plus client adapters for assistant text. The legacy `emitEvent` callback remains compatible for one migration period.
- The Electron stdout bridge is no longer an assistant transport. It remains an opt-out compatibility path for old command/tool console text and can be disabled with `HICODE_LEGACY_STDOUT_BRIDGE=0`.

Tests:

- `test/runtime-protocol-tests.mjs`
- `test/runtime-event-sink-tests.mjs`
- `test/runtime-concurrency-tests.mjs`
- `test/runtime-client-adapter-tests.mjs`
- `tests/electron-e2e/run.mjs`
- Included in `npm run verify` and `npm run release:check`.

Version sync:

- `package.json` is now on the `0.6.0-alpha.6` development line.
- `scripts/sync-version.mjs` checks that Electron `app.getVersion()` and renderer labels remain wired to package metadata instead of hard-coded version text.

## Transport Mapping

Desktop / Electron:

- Main process owns a process-local `RuntimeEventBus` and injects it into normal and isolated runtimes.
- Assistant deltas project to the existing `output` IPC channel; completion and timeline events retain the existing `tool-event` channel. No renderer API break is required.
- Assistant deltas are not duplicated into the legacy tool timeline/log. Their durable authority is the append-only protocol store.
- Real Electron E2E runs a local streaming model with `HICODE_LEGACY_STDOUT_BRIDGE=0` and verifies the complete response in the chat view.

CLI / TUI:

- Both clients inject their own `RuntimeEventBus`, disable direct assistant stdout rendering, and project typed assistant events with `connectAssistantTextOutput(...)`.
- Console/stdout interception remains only for legacy command/tool framing in TUI; model text does not depend on it.
- `/sessions` includes durable event-only sessions as `replay` entries.
- `/resume <id>` resumes full saved sessions when session JSON exists.
- `/resume <id>` opens event-only sessions as read-only replay with user turns, tool summaries, and completion status when only JSONL runtime events exist.
- Event-only replay is intentionally not loaded into model context; users can copy the useful replay summary into a new prompt when they want to continue.

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
- `model.output`
- `tool.started`
- `tool.output`
- `tool.completed`
- `tool.failed`
- `tool.denied`
- `tool.interrupted`
- `approval.requested`
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

Assistant deltas route to chat/sdk; assistant completions route to chat/timeline/sdk. Tool events route to timeline/job/sdk, diffs to diff/timeline/job/sdk, and approval requests to timeline/job/sdk. `model.output` is retained as a reserved compatibility kind and is not the new assistant transport.

## Validation

`validateRuntimeProtocolEvent(event)` rejects malformed envelopes:

- unsupported schema version
- empty `id`, `sessionId`, `turnId`, or `title`
- non-positive sequence
- unknown kind
- unknown status
- invalid visibility

`isRuntimeProtocolEvent(event)` is the type guard for future consumers.

## Migration Plan

1. Keep legacy runtime event fields intact. Completed.
2. Attach protocol envelopes to every runtime event. Completed.
3. Append protocol events to a durable JSONL event store. Completed.
4. Emit assistant deltas/completions through an injected sink and migrate Electron/CLI/TUI. Completed in HC-RUN-201.
5. Make recent sessions replay from persisted protocol events. Event-only sessions are visible as replay-only entries; full LLM context resume still requires saved session JSON.
6. Reconstruct complete resumable context from typed stores. Planned in HC-RUN-202; not claimed by HC-RUN-201.
7. Expose protocol streaming through a future local app-server and SDK.

## Guardrails

- Do not copy Codex or Claude Code source.
- Do not use this protocol as a reason to fake features.
- Do not mark simulated industrial evidence as real runtime completion.
- Do not remove legacy event fields until Electron, CLI, TUI, and tests have migrated.
