# HC-UI-310 - Integrated Editor And Review Loop

Status: In progress

Owner: Desktop UX

Branch: `codex/desktop-ux/hc-ui-310`

Started: 2026-07-11T14:02:09Z

Parent commit: `8b13b88f2336afe70150861a7575d50c9e81f68e`

## Problem

The Files panel can list and preview workspace text, but it cannot edit or save it. The Diff Inspector can archive or roll back a change, but it cannot attach a line-specific review comment or route that comment back through the real Runtime. Adding these controls without disk revision checks would risk overwriting external edits; adding a visual-only comment action would be a fake review loop.

## Outcome

Provide one integrated CodeMirror 6 editor with workspace-confined open, edit, save, reload, dirty-state, and explicit disk-conflict handling. Extend the typed Diff Inspector with bounded file/line comments whose submit action enters the existing conversation and Runtime execution path, so the resulting Agent revision is durable and visible in the same session.

## In Scope

- CodeMirror 6 mounted in the existing Files workflow.
- Text-file open metadata, bounded reads, revision tokens, atomic saves, and explicit conflict responses.
- Save, reload, keyboard save, dirty-state, external-change conflict, and deliberate force-overwrite handling.
- Typed diff line selection, review comment input, and real Runtime revision request.
- Core, IPC/preload, Renderer, security, and real Electron acceptance tests.
- Architecture, API, conflict, review, evidence, and rollback documentation.

## Out Of Scope

- PTY terminal, app preview, GitHub PR/CI workflow, or full IDE behavior.
- Binary/large-file editing, language servers, extensions, debugging, or collaborative editing.
- Changing Runtime, session, Diff, Git, Job Center, industrial, or release persistence formats.
- Formal release, signing, notarization, or public promotion.

## Interfaces And Ownership

- Main-process editor service owns bounded file snapshots, revision comparison, and atomic writes.
- Existing workspace/security services remain the path authority; Renderer paths are untrusted input.
- Preload exposes only validated editor open/save requests and normalized responses.
- CodeMirror owns editor presentation state, not persistence or permissions.
- Typed Workspace Inspector owns comment draft/selection state; bootstrap invokes the existing `runLine` Runtime path.
- Existing Diff service remains authoritative for archive and rollback.

## Security And Data Integrity

- Reads and writes remain inside the active workspace after realpath/symlink checks.
- Only bounded UTF-8 text is editable; NUL/binary and oversized files fail visibly.
- Save requires the revision returned by open/reload. A mismatch never overwrites disk content.
- Force overwrite is a distinct, explicit user action after conflict presentation.
- Writes use a temporary sibling and atomic rename while preserving the existing file mode where possible.
- Review comments are rendered as text and bounded before entering Runtime; no raw HTML or hidden network path is introduced.

## Baseline

From clean parent `8b13b88`, the following incremental baseline passed on 2026-07-11:

- `npm run build`
- `npm run test:workspace-shell`: 15 passed
- `npm run test:renderer`: 170 passed

The completed HC-RUN-220 evidence remains authoritative for its historical ten-hour run and is not repeated for this UI task.

## Test Strategy

1. Failure-first core tests for snapshot metadata, conflict refusal, force save, atomic replacement, text/size checks, and path confinement.
2. IPC/preload contract tests for validated payloads and normalized failures.
3. Renderer tests for CodeMirror integration, dirty/reload/conflict states, keyboard save, selected diff lines, and revision request construction.
4. Real Electron E2E in an isolated temporary workspace for open/edit/save, external disk mutation conflict, reload, and review-to-Runtime behavior.
5. Task evidence for build, verify, release check, security, DoD, production audit, Electron E2E, and Git diff checks.

## Rollback

Revert HC-UI-310. The existing read-only Files preview, Diff archive/rollback behavior, Runtime/session data, and workspace files remain compatible. No file format, session migration, or app-data migration is introduced.

## Commit Plan

1. Program boundary, baseline, and migration risk.
2. Failure-first editor, conflict, and review contract tests.
3. Main-process editor service plus IPC/preload/API integration.
4. CodeMirror Files workflow and typed Diff review UI.
5. Electron/security regressions, documentation, and evidence.
