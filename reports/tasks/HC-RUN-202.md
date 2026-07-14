# HC-RUN-202 Task Manifest

Status: Completed

Owner: Runtime Engine

Release: `0.6.0-alpha.8`

Branch: `codex/runtime-engine/hc-run-202`

Parent commit: `b044fdcecf1a153393cce29d7267eb2205c99dec`

Started: `2026-07-10T14:15:23Z`

Completed: `2026-07-10T15:48:14Z`

## Problem

Full model context still depends on legacy session JSON. Runtime JSONL is durable but event-only sessions remain read-only, repeated imports have no formal idempotency contract, and a crash can leave a running turn without an explicit recoverable state.

## Outcome

Provide typed ThreadStore, EventStore, and MessageStore interfaces plus a compatibility facade that imports legacy files without rewriting them, reconstructs complete sessions from typed records, rejects duplicates deterministically, and diagnoses interrupted turns.

## Scope

- Typed thread, event, and message records and validation.
- Confined owner-only app-data backend behind store interfaces.
- Idempotent legacy session JSON and runtime JSONL importer.
- Full user/assistant/tool message reconstruction.
- Approval and diff transcript projections with source event references.
- Event-only continuation when normalized context is complete.
- Corrupt-record diagnostics and interrupted-turn recovery fixtures.
- Compatibility wiring for current session list/load/save/delete paths.

## Out Of Scope

- HC-RUN-203 turn state machine and automatic retry execution.
- Provider Adapter v2, attachments, Electron upgrade, renderer migration, or industrial modules.
- Destructive removal of legacy session JSON or runtime JSONL.
- SQLite/WAL backend promotion.

## Interfaces

- `ThreadStore`: get/list/upsert/delete thread metadata.
- `EventStore`: append/list/import events and return sequence diagnostics.
- `MessageStore`: append/list/import normalized model messages.
- `RuntimeStore`: coordinated import, reconstruction, resumability decision, and deletion.
- Existing `saveSession`, `loadSession`, `listSessions`, and `deleteSession` remain compatible.

## Migration And Rollback

Import is additive and source-fingerprinted. Legacy files are never overwritten or deleted by migration. Rollback reverts HC-RUN-202 commits and leaves both legacy source files and typed files intact.

## Security

All paths remain under `HICODE_DIR`, session IDs are validated, files use mode `0600`, directories use mode `0700`, and diagnostics exclude message bodies and secrets.

## Tests

- `test/runtime-store-tests.mjs`: 14 focused store, idempotency, corruption, permission, path, and lifecycle checks.
- `test/runtime-store-integration-tests.mjs`: 10 real runtime migration checks, including a tool call, complete reconstruction after legacy deletion, continuation with prior tool context, stale legacy crash-window precedence, conflict fallback, and interrupted-turn diagnosis.
- `test/runtime-protocol-tests.mjs`: 25 protocol and compatibility checks, including strict `message.appended` validation.
- `npm run verify` and `npm run release:check` include both new suites.
- `reports/evidence/HC-RUN-202/manifest.json` records 16 passing gates, including security, DoD, production audit, and real Electron E2E.

## Implemented

- Added typed file-backed `ThreadStore`, `EventStore`, `MessageStore`, and coordinating `FileRuntimeStore` contracts.
- Added exact hidden `message.appended` records for system, user, assistant, and tool messages.
- Synchronized legacy JSONL events into the typed store with deterministic event ID and sequence conflict handling.
- Reconstructed complete model context from normalized events when session JSON is absent or stale.
- Kept incomplete pre-migration streams read-only instead of inventing model context from summaries.
- Kept exact model messages out of Electron legacy timeline and Job logs.
- Marked unterminated running turns as interrupted/recoverable without starting automatic retry behavior.
- Preserved legacy session JSON and runtime JSONL as non-destructive rollback sources.

## Evidence

- Implementation commits: `e98add8` and `1d50d21`.
- Evidence manifest: `reports/evidence/HC-RUN-202/manifest.json`.
- Gate result: 16 passed, 0 failed.
- DoD full-tree result: 0 blocking findings.
- Production dependency audit: 0 high-or-critical advisories.
- Electron E2E: passed against the production Electron entrypoint.

## Remaining Boundary

HC-RUN-202 preserves exact context and identifies interrupted work. It does not automatically restart streams, replay side-effecting tools, or approve pending actions. Those decisions remain blocked behind HC-RUN-203.

## Commit Plan

1. Typed store contracts, backend, and focused unit tests: completed in `e98add8`.
2. Idempotent migration and complete replay/resume integration: completed in `1d50d21`.
3. Compatibility gates, documentation, and machine evidence: completed in the task evidence commit.
