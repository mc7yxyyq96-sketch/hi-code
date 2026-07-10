# HC-RUN-202 Task Manifest

Status: In progress

Owner: Runtime Engine

Release: `0.6.0-alpha.8`

Branch: `codex/runtime-engine/hc-run-202`

Parent commit: `b044fdcecf1a153393cce29d7267eb2205c99dec`

Started: `2026-07-10T14:15:23Z`

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

- Store contract and path tests.
- Idempotent append/import tests.
- Full context reconstruction after deleting legacy session JSON.
- Event-only resumability and incomplete-context fallback.
- User, assistant, tool, approval, and diff replay fixtures.
- Corrupt JSONL and interrupted-running-turn recovery fixtures.
- Existing protocol, session, feature, security, DoD, Electron E2E, build, verify, and release checks.

## Commit Plan

1. Typed store contracts, backend, and focused unit tests.
2. Idempotent migration and complete replay/resume integration.
3. Compatibility clients, global gates, documentation, and evidence.
