# Runtime Protocol Foundation

Date: 2026-07-08

## Purpose

Hi Code needs a stable runtime protocol before it can grow to Codex / Claude Code scale. The protocol is the shared event envelope for desktop UI, CLI/TUI, future SDKs, Job Center, Patch Arena, and external agent adapters.

This document describes the first v0.6 slice. It is intentionally compatible with the existing runtime event stream: current events still flow as before, and a versioned `payload.runtimeProtocol` envelope is attached to each emitted runtime event.

## Current Implementation

Core file:

- `src/runtime-protocol.ts`

Runtime integration:

- `src/runtime.ts` calls `createRuntimeProtocolEvent(...)` for every emitted runtime event.
- The generated envelope is attached as `event.payload.runtimeProtocol`.
- `src/runtime-event-store.ts` appends validated protocol events to `~/.hicode/runtime-events/<sessionId>.jsonl` for replay and crash recovery.
- `src/session-store.ts` merges event-only sessions into Recent as replay-only entries when the full chat session JSON is missing.
- Existing renderer and Electron event consumers can continue to use the legacy event fields while new code migrates to the protocol envelope.

Tests:

- `test/runtime-protocol-tests.mjs`
- Included in `npm run verify` and `npm run release:check`.

Version sync:

- `package.json` is now on the `0.6.0-alpha.1` development line.
- `scripts/sync-version.mjs` checks that Electron `app.getVersion()` and renderer labels remain wired to package metadata instead of hard-coded version text.

## Transport Mapping

Desktop / Electron:

- Main process emits existing `tool-event` IPC messages.
- Each message now carries `payload.runtimeProtocol`.
- Renderer panels can migrate one panel at a time without breaking legacy `type`, `status`, `title`, and `payload` reads.

CLI / TUI:

- The shared `createRuntime(...)` path emits the same protocol envelope when an `emitEvent` callback is supplied.
- Current CLI output remains unchanged until the append-only event store and replay layer land.

Future SDK / app-server:

- SDK streaming should expose the `RuntimeProtocolEvent` envelope directly.
- Legacy event fields may remain as compatibility metadata, but new automations should key off `schemaVersion`, `kind`, `status`, `sessionId`, `turnId`, and `sequence`.

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

The first slice mostly routes tool events to timeline/job/sdk, diffs to diff/timeline/job/sdk, and approval requests to timeline/job/sdk.

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

1. Keep legacy runtime event fields intact.
2. Attach protocol envelopes to every runtime event.
3. Append protocol events to a durable JSONL event store.
4. Make recent sessions replay from persisted protocol events. Event-only sessions are now visible as replay-only entries; full LLM context resume still requires the saved session JSON.
5. Make CLI/TUI and Electron consume the same protocol stream.
6. Expose protocol streaming through a future local app-server and SDK.

## Guardrails

- Do not copy Codex or Claude Code source.
- Do not use this protocol as a reason to fake features.
- Do not mark simulated industrial evidence as real runtime completion.
- Do not remove legacy event fields until Electron, CLI, TUI, and tests have migrated.
