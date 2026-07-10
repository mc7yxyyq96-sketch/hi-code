# Runtime Stores

Date: 2026-07-10

Status: HC-RUN-202 implementation contract

## Purpose

Hi Code must resume a model turn from durable, exact context rather than from human-readable logs. The runtime store layer separates thread metadata, protocol events, and model messages while preserving the v1 session JSON and runtime JSONL files as rollback sources.

## Store Contracts

- `ThreadStore` reads, lists, upserts, and deletes `RuntimeThreadRecord` metadata.
- `EventStore` appends and lists validated `RuntimeProtocolEvent` records with event-ID and per-session sequence conflict detection.
- `MessageStore` appends and lists normalized `RuntimeMessageRecord` values for system, user, assistant, and tool roles.
- `FileRuntimeStore` coordinates snapshot synchronization, event import, transcript loading, session reconstruction, and confined deletion.

The first backend is file based so the migration remains inspectable and reversible. Callers depend on interfaces rather than file layout, allowing a later SQLite/WAL backend without changing runtime clients.

## Local Layout

Typed data lives below the Hi Code app-data root:

```text
~/.hicode/runtime-store-v2/<session-id>/
  thread.json
  events.jsonl
  messages.jsonl
```

Directories use owner-only `0700` permissions and files use `0600` where supported. Session IDs are validated before path construction. Writes to `thread.json` use a flushed temporary file and atomic rename; a failed rename removes the temporary file.

## Exact Message Records

The runtime emits `message.appended` after each model-context mutation:

- system message at the beginning of a new model-backed session;
- user prompt before the model request;
- assistant message, including tool calls;
- tool result with `tool_call_id` and tool name;
- final or interrupted assistant message.

These records have `hidden` and `sdk` visibility. Electron does not copy them into timeline, Job, or compatibility logs. UI text continues to use assistant delta/completion projections, so exact replay context is not rendered twice or exposed as an operational summary.

## Import And Idempotency

Legacy files are migration sources, not files to rewrite:

- session JSON imports a complete snapshot when no complete typed thread exists;
- runtime JSONL imports validated events in sequence order;
- repeated identical event IDs, event sequences, and message IDs are duplicate no-ops;
- conflicting content for an existing ID or event sequence is rejected;
- a partial typed import never replaces a complete legacy event read;
- valid records around a corrupt JSONL line remain readable and produce bounded diagnostics.

The importer never deletes legacy files. Once a complete typed context exists, an older legacy snapshot cannot overwrite it.

## Reconstruction Rules

A session is resumable only when its active message list contains a valid system message and exact normalized context. `loadSession` then rebuilds model messages, token totals, workspace, model, timestamps, and first prompt from typed records.

Older protocol streams that lack normalized messages remain replay-only. Hi Code may display their user/tool/status summary, but it never converts that summary into model context. This prevents a plausible-looking but semantically invalid continuation.

Approval and diff events remain in the event transcript for audit and UI projection. They are not fabricated as model messages.

## Recovery Boundary

When a turn has a start event and no terminal event, replay reports it as interrupted. HC-RUN-203 derives the recovery action from approval, tool, assistant-output, and terminal records. Model-only interruption can be retried after source-session restoration; unknown tool side effects require inspection; unanswered approvals require a new decision. Legacy logs without enough side-effect evidence never receive an automatic retry classification.

## Verification

- `npm run test:runtime-stores` covers store contracts, idempotency, corruption diagnostics, permissions, path confinement, and lifecycle.
- `npm run test:runtime-store-integration` runs a real local model fixture through a tool call, removes legacy session JSON and typed cache, rebuilds solely from protocol JSONL, resumes with prior tool context, and checks interrupted recovery.
- Both suites run inside `npm run verify` and `npm run release:check`.
- Security tests ensure hidden model messages do not enter legacy timeline logs.

## Rollback

Revert the HC-RUN-202 commits and remove `~/.hicode/runtime-store-v2/` only if the user explicitly chooses to discard the derived cache. Legacy session JSON and runtime JSONL remain untouched and continue to support the pre-migration behavior.
