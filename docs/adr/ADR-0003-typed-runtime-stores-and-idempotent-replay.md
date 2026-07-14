# ADR-0003: Typed Runtime Stores And Idempotent Replay

Status: Accepted

Date: 2026-07-10

Owners: Runtime Engine

## Context

Hi Code currently persists full model context in one session JSON file and appends validated runtime protocol events to a per-session JSONL file. Event-only sessions are visible, but they are intentionally replay-only because current runtime events do not yet guarantee enough normalized message data to reconstruct user, assistant, tool, approval, and diff context. A crash or missing session JSON therefore prevents a safe continuation even when durable events exist.

## Decision

HC-RUN-202 introduces additive typed store interfaces for threads, events, and messages while preserving the current files as migration inputs:

1. `EventStore` provides append, list, last-sequence, and import operations with `(sessionId, eventId)` and `(sessionId, sequence)` idempotency.
2. `MessageStore` persists normalized system, user, assistant, and tool messages with stable message IDs and source event references.
3. `ThreadStore` persists thread metadata, token usage, model, workspace, migration state, and current turn state.
4. A `RuntimeStore` facade commits related thread/message/event records and reconstructs a complete `Session` without requiring legacy session JSON.
5. The v1 importer reads existing session JSON and runtime JSONL, never rewrites them, and records imported source fingerprints so repeated imports are harmless.
6. Corrupt or incomplete source records are reported as diagnostics; valid records before and after a bad JSONL line remain available.
7. A running turn found without a terminal event is reconstructed as interrupted and recoverable, never silently completed.

The first implementation uses confined, permission-restricted app-data files behind interfaces. A later SQLite/WAL implementation can replace the backend without changing callers.

## Consequences

Positive:

- Event-only sessions can regain complete model context when the required normalized messages exist.
- Repeated startup/import cannot duplicate messages or events.
- Thread, message, and event responsibilities become explicit and independently testable.
- Existing Electron, CLI, TUI, and session JSON behavior remains compatible during migration.

Costs:

- Legacy and typed stores coexist for one migration period.
- Writes must preserve ordering and diagnose partial failure.
- Some old JSONL records do not contain enough content and remain replay-only until a legacy session import supplies it.

Security and privacy:

- Store paths remain under `HICODE_DIR` and reject unsafe session IDs.
- Files and directories use owner-only permissions where the platform supports them.
- Model messages are local project data and are not logged as command evidence.
- Import diagnostics must not include API keys, environment variables, or unrestricted file contents.

Compatibility:

- Legacy session JSON and runtime JSONL are read-only migration sources and remain available for rollback.
- Existing public session functions continue through a compatibility facade.
- No Electron IPC channel changes are required for this task.

## Rejected Alternatives

- Delete legacy stores after first import: rejected because migration must be reversible.
- Reconstruct tool context from human-readable summaries: rejected because summaries cannot safely recreate tool-call semantics.
- Treat every running turn as completed on startup: rejected as false execution evidence.
- Introduce SQLite and rewrite all clients in one task: rejected as a big-bang migration.

## Verification And Rollout Gates

- Deleting a legacy session JSON after import still permits complete user, assistant, tool, approval, and diff replay.
- An event-only thread with normalized messages can resume model context.
- Repeating imports and appends does not duplicate sequence numbers, event IDs, or message IDs.
- A running turn without a terminal event is reported as interrupted and recoverable.
- Corrupt JSONL lines produce diagnostics without discarding valid neighboring events.
- Existing session, runtime protocol, CLI/TUI, Electron E2E, security, DoD, build, verify, and release gates pass.
