# ADR-0012: Conflict-Safe Integrated Editor And Runtime Review Loop

Status: Accepted

Date: 2026-07-11

## Context

The Files modal could preview text but could not provide an integrated edit/save loop. Adding a renderer-side write path would bypass workspace confinement. Saving by path alone would silently overwrite external changes. A Diff comment button that only changed local UI state would also create a fake review workflow instead of requesting an Agent revision.

## Decision

1. A main-process editor service resolves every target through the existing workspace guard and accepts only existing regular UTF-8 files up to 2 MiB.
2. Every snapshot carries a main-process SHA-256 revision. Normal save compares that revision before writing and immediately before replacement.
3. Save writes a unique sibling temporary file, flushes it, atomically renames it over the target, restores the original mode, and removes any failed temporary file.
4. Revision mismatch returns `file_conflict` without writing. Conflict remains sticky in the UI; normal save is disabled. Reload and force overwrite are explicit, confirmed choices.
5. CodeMirror 6 is bundled as a lazy local Renderer chunk and exposed only through a renderer-internal loader/factory. It cannot call preload or Node APIs, and it does not consume the App Shell startup bundle budget.
6. Diff comments are typed, line-specific, byte-bounded, and checked against the current selected diff.
7. A submitted comment enters the existing conversation and Runtime through `runLine`. It does not call a model directly or create a second task queue.
8. No autosave, collaborative merge, new persistence schema, or file watcher is introduced in this task.

## Consequences

### Positive

- Stale normal saves fail closed instead of destroying external changes.
- Editor, filesystem, and Runtime responsibilities remain separated.
- The review action has observable user-message, Runtime-request, Agent-response, and subsequent diff evidence.
- CodeMirror package resolution is handled by Vite rather than by the legacy browser module loader.
- Rollback requires no data migration.

### Costs

- SHA-256 snapshots read the complete bounded file.
- Files above 2 MiB and non-UTF-8 files require an external editor.
- The renderer and main process retain a compatibility adapter until the full Files surface migrates.
- Atomic replacement does not guarantee a collaborative merge against a write that occurs after the second comparison.

### Security And Compatibility

- Renderer sandbox, context isolation, and disabled Node integration remain unchanged.
- Preload exposes only bounded open/save requests, not generic filesystem or IPC primitives.
- Workspace-external paths and symlink escapes are rejected by the established path authority.
- Binary and oversized inputs are rejected before replacement.
- Force overwrite requires a visible conflict and explicit confirmation in the UI.
- Existing session, Runtime, permission, Diff, and project formats remain unchanged.

## Rejected Alternatives

- **Write from the Renderer:** rejected because it bypasses the Electron trust boundary.
- **Save by modification time only:** rejected because timestamps can collide or be preserved while content changes.
- **Automatically overwrite on conflict:** rejected because it can destroy user or tool output.
- **Automatically merge arbitrary source text:** rejected because a reliable language-independent merge is outside this task.
- **Load CodeMirror directly from a bare browser import or CDN:** rejected because production uses local files, CSP, and an offline-compatible bundle.
- **Send review comments directly to the model:** rejected because it bypasses the durable conversation, Runtime queue, permissions, and event path.

## Verification

- `npm run test:editor-workbench`
- `npm run test:workspace-shell`
- `npm run test:services`
- `npm run test:renderer`
- `npm run test:security`
- `npm run test:electron-e2e`
- `npm run verify`
- `npm run release:check`
- `npm run scan:dod`

The Electron test mutates an open file outside Hi Code, proves the stale draft does not overwrite it, verifies explicit conflict actions at 720 px, reloads external content, and proves a line comment reaches the real Runtime adapter.

## Rollback

Revert HC-UI-310. There is no file-format or app-data migration to reverse. Existing workspace content, session history, Runtime events, and Diff records remain valid.
