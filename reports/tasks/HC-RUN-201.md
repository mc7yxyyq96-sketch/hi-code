# HC-RUN-201 Task Evidence

Status: Completed

Owner: Runtime Engine

Release: `0.6.0-alpha.7`

Branch: `codex/runtime-engine/hc-run-201`

Parent commit: `23d9509`

## Problem

Assistant model text was printed directly from `src/agent.ts` to global stdout. Electron and TUI monkey-patched that process-global stream, so output was not a durable runtime event and parallel sessions had no typed isolation boundary. The protocol declared `model.output` but did not emit complete assistant messages.

## Implementation

- Added validated materialized runtime events and a session/turn/type-filtered `RuntimeEventBus` with listener fault isolation.
- Added first-class `assistant:delta` and `assistant:completed` protocol kinds.
- Emitted stable message IDs, ordered deltas, full completion content, model/step metadata, and truthful completed/interrupted/error status from the real Agent SSE loop.
- Persisted assistant protocol events before client delivery.
- Kept the legacy `emitEvent` callback as a compatibility adapter while making event IDs protocol-owned.
- Added reusable structured and text client adapters that prevent duplicate completion output.
- Migrated Electron, CLI, and TUI assistant text to private/shared EventBus projections.
- Kept Electron IPC channels unchanged and retained the stdout bridge only for legacy command/tool text behind `HICODE_LEGACY_STDOUT_BRIDGE`.
- Added a real Electron streaming model test with the compatibility stdout bridge disabled.

## Independent Commit Series

- `283b419` - typed assistant event contract and EventBus.
- `f1fe85a` - real Agent streaming, durable completions, and concurrency isolation.
- Final client/evidence commit - Electron/CLI/TUI adapters, documentation, and acceptance evidence.

## Scope Boundary

This task does not implement the HC-RUN-202 typed Thread/Message stores or claim that event-only sessions can resume full model context. Existing session JSON remains the full-context compatibility store. No provider, industrial adapter, permission, path, or release semantics are weakened.

## Acceptance Evidence

The final command, artifact, and redacted log hashes are captured in `reports/evidence/HC-RUN-201/manifest.json`: 13 commands passed and none failed.

- Two deliberately interleaved SSE sessions must retain isolated deltas, completions, protocol stores, and transcripts.
- Empty model output must produce assistant and turn error states.
- Client adapter tests must prove no duplicate completion output and completed-only fallback.
- Real Electron must render a two-chunk model response with `HICODE_LEGACY_STDOUT_BRIDGE=0`.
- Build, verify, release, feature, security, DoD, production audit, and Electron E2E gates must pass.

## Security And Compatibility Review

The EventBus delivers shallow-frozen event snapshots and isolates subscriber exceptions. Assistant event payloads contain content and runtime context but no environment or credential data. Existing IPC channel names and legacy event fields remain intact. The compatibility callback and stdout bridge can be rolled back independently; protocol JSONL is additive and existing session files are not migrated or deleted.

## Rollback

Revert the three HC-RUN-201 commits in reverse order. Existing session JSON and prior runtime JSONL remain readable. Do not remove only the concurrency or real Electron acceptance while retaining the new stream path.
