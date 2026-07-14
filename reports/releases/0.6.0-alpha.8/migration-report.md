# Hi Code 0.6.0-alpha.8 Migration Report

## Scope

This candidate adds a derived typed runtime store and conservative recovery metadata while upgrading the embedded Electron runtime. It does not destructively rewrite projects, configuration, Job Center records, industrial project files, release packages, legacy session JSON, or legacy runtime JSONL.

## Runtime Store Migration

- `~/.hicode/runtime-store-v2/<session-id>/` stores thread metadata, validated protocol events, and exact normalized model messages.
- Existing session JSON and runtime JSONL remain migration sources and rollback inputs.
- Imports use deterministic source fingerprints and record identifiers; identical repeats are no-ops and conflicting content is rejected.
- A complete typed context cannot be replaced by an older legacy snapshot.
- Complete normalized streams can reconstruct model context when legacy session JSON is absent. Incomplete older streams remain read-only.

## Recovery Compatibility

Interrupted turns are reduced from durable events. Model-only or read-only work may be offered for explicit retry after restoring the source session. Unanswered approvals require a new decision. Unknown or completed mutating effects are inspection-only and are never automatically replayed.

## Electron Compatibility

Electron moves from 31.7.7 to 43.1.0 with Chromium 150 and Node 24. IPC channel names, preload API names, renderer routes, and persisted application formats remain unchanged. Browser-created windows and untrusted navigation are now denied.

## Rollback

Revert the alpha.8 integration commits to restore alpha.7 metadata. Reverting HC-PLAT-110 restores the earlier Electron dependency line. Reverting HC-RUN-202 and HC-RUN-203 leaves legacy and derived runtime files on disk; deleting the derived store is optional and requires an explicit user decision.
