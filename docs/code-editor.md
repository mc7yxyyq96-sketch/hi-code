# Integrated Code Editor And Review Loop

HC-UI-310 adds a production CodeMirror 6 editor to the existing Files surface and connects line-level Diff comments to the current conversation and Runtime. The feature does not create a second filesystem authority, session store, Runtime queue, or permission path.

## Ownership

- `electron/services/editor-service.mjs` owns bounded file snapshots, SHA-256 revisions, conflict detection, and atomic replacement.
- `electron/preload.cjs` validates editor request shape before invoking the two typed IPC channels.
- `renderer/api/hicode-api.js` is the only renderer-to-preload adapter used by the Files component.
- `renderer/app-shell/editor/code-editor.ts` owns CodeMirror presentation and keyboard behavior. It has no filesystem or IPC access.
- `renderer/components/file-tree.js` owns open, dirty, save, reload, conflict, and explicit force-overwrite UI state.
- `renderer/app-shell/workspace/Inspector.tsx` owns line selection and review-comment presentation.
- `renderer/app-shell/workspace/review.ts` validates and bounds the structured review request.
- `renderer/app/bootstrap.js` sends that request through the existing `runLine` conversation and Runtime path.

## File Contract

The editor opens only an existing regular file resolved by the current workspace path guard. The main process rejects:

- missing or workspace-external paths, including symlink escapes;
- files or save payloads larger than 2 MiB;
- binary files, NUL bytes, and invalid UTF-8;
- save requests without a valid `sha256:<digest>` expected revision.

An open response includes content, UTF-8 encoding, size, modification time, relative path, and the SHA-256 revision. The renderer never derives a trusted revision itself.

## Save And Conflict Contract

Normal save is a compare-and-replace operation:

1. Read the current disk snapshot and compare it with the revision returned by open or the previous successful save.
2. Write the new bytes to a uniquely created sibling temporary file.
3. Flush the temporary descriptor.
4. Re-read the target and compare the revision again.
5. Atomically rename the temporary file over the target and restore the original mode.

If either comparison differs, the service returns `file_conflict` and does not overwrite the disk file. The conflict UI remains visible while the user continues editing. Normal save is disabled until the user chooses one of two explicit actions:

- **Reload** discards the editor draft after confirmation and reads the external file.
- **Force overwrite** requires a separate confirmation and sends `force: true`.

Force overwrite is intentionally a user decision, not an automatic retry. The editor has no background autosave.

## CodeMirror Boundary

CodeMirror is bundled by Vite in the typed App Shell. The legacy browser bootstrap never imports bare package specifiers. `window.hicodeAppShell.editor` is a renderer-internal factory, not a preload capability.

The surface provides line numbers, history, selection, syntax highlighting for JavaScript, TypeScript, JSON, Markdown, CSS, and HTML, line wrapping, and `Mod-S` save. Unsupported extensions remain editable as plain UTF-8 text.

## Diff Review Loop

A review comment is bound to one diff ID, path, side, and positive line number. Comments are limited to 8,000 UTF-8 bytes. The generated request contains at most seven nearby lines and is limited to 24,000 UTF-8 bytes.

Submitting **Request revision**:

1. validates that the comment still matches the selected diff;
2. builds a structured `hicode.diff_review` payload;
3. records a readable user message in the active conversation;
4. enters the existing Runtime or its existing queue through `runLine`;
5. leaves subsequent Agent output, tool calls, permissions, and file changes on their established durable paths.

There is no review-only mock response and no direct model call from React.

## IPC

- `editor:file:open` accepts `{ path }`.
- `editor:file:save` accepts `{ path, content, expectedRevision, force? }`.

Both channels are registered through the centralized IPC registrar. Errors use the existing normalized `{ ok: false, error, code? }` contract.

## Verification

```bash
npm run build
npm run test:editor-workbench
npm run test:workspace-shell
npm run test:services
npm run test:renderer
npm run test:security
npm run test:electron-e2e
npm run verify
npm run release:check
npm run scan:dod
```

Real Electron acceptance covers open, edit, save, compact layout, external disk mutation, refusal to overwrite, sticky conflict state, explicit force action, reload, and a Diff comment that reaches the isolated model Runtime.

## Residual Risk

Sibling temporary files and rename provide atomic replacement on the supported local filesystems. They do not provide a cross-process advisory lock. The second revision comparison narrows the race window, but another process could still write after that comparison. Hi Code therefore does not claim collaborative merge semantics in HC-UI-310.

## Rollback

Revert HC-UI-310. No project file format, session format, Runtime protocol, app-data location, or migration is introduced. Workspace files changed by users remain ordinary files; the previous read-only Files preview and existing Diff archive/rollback paths remain compatible.
