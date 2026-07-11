# HC-RUN-220 Task Manifest

Status: In progress

Owner: Runtime Engine

Release: `0.6.0-alpha.9`

Branch: `codex/runtime-engine/hc-run-220`

Parent commit: `12ff24e`

Started: `2026-07-11T05:03:45Z`

## Problem

Desktop image attachments are currently copied into `.hicode/attachments` inside the selected workspace and converted to large inline data URLs. They have no durable typed metadata, integrity record, or provider capability preflight. PDF and general file attachment errors are not represented. Input routing is also split between Runtime shell/slash handling and Electron native-app parsing, so unknown commands or overlapping matchers can silently reach the Agent or the wrong native action.

## Outcome

Deliver an app-data attachment store with content-addressed blobs, durable per-attachment metadata, restart-safe session references, integrity verification, and provider capability checks before network I/O. Add a shared Command Registry that resolves shell, slash, native, and agent routes deterministically, rejects duplicate/conflicting registrations, and preserves current CLI/TUI/Desktop behavior through compatibility adapters.

## Scope

- Typed `AttachmentRecord`, metadata schema, hash, kind, MIME, size, session ownership, and content-addressed blob persistence.
- Image, PDF, UTF-8 text, and generic file classification with bounded imports and visible validation errors.
- Session messages persist attachment references; provider requests materialize verified image or text content only after capability preflight.
- Electron IPC/preload/renderer use attachment IDs while retaining the legacy image entrypoint as an adapter.
- Command Registry descriptors, aliases, surface matrix, conflict detection, canonical resolution, and deterministic fallback.
- Existing slash handlers and native app launcher remain behavior-compatible behind the registry.

## Out Of Scope

- Provider-hosted file upload lifecycle, PDF extraction/OCR, cloud attachment sync, virus scanning service, or arbitrary binary execution.
- New model providers, external Codex/Claude task executors, React App Shell, editor, terminal, preview, or industrial modules.
- Secret migration, remote MCP transport, or release signing.

## Interfaces

- `FileAttachmentStore`: put/get/list/read/remove/removeSession over app-data records and blobs.
- `AttachmentRefContentPart`: durable session reference, never a provider wire type.
- `materializeAttachmentMessages`: integrity and capability gate from persisted references to transport content.
- `CommandRegistry`: register/list/resolve with route and surface contracts.
- Runtime input options carry bounded attachment IDs without embedding file contents in queue metadata.

## Migration And Compatibility

Existing `@workspace/image.png` prompts continue to work. Existing sessions containing inline `image_url` parts remain readable. New desktop attachments use app-data records and attachment references; no old file is moved or deleted. The `attach-image` IPC/API remains as an image-only compatibility alias over the new store. Rollback leaves app-data attachment records unused but intact.

## Security

All store paths derive from validated IDs and fixed app-data roots. Directories use owner-only permissions, records and blobs use mode `0600`, writes are atomic, and every read rechecks size and SHA-256. Renderer payloads carry IDs only. Unsupported PDF/binary/image capabilities fail before provider network I/O. Commands with attachments cannot be silently routed to shell, slash, or native actions.

## Tests

- Content addressing, deduplication, persistence across a new store instance, hash mismatch, missing blob, path/ID rejection, MIME sniffing, size bounds, and removal behavior.
- Image and UTF-8 text materialization, PDF/file capability rejection before transport, and legacy inline image compatibility.
- Command aliases, unknown slash behavior, duplicate alias rejection, native matcher conflicts, agent fallback, and CLI/TUI/Desktop parity.
- Runtime/Electron queue attachment propagation, session resume chips, visible errors, preload validation, and renderer smoke behavior.
- Full build, verify, release, feature, security, DoD, production audit, and Electron E2E gates.

## Baseline

On parent `12ff24e`, `npm run build`, `npm run verify`, `npm run release:check`, and `node test/feature-tests.mjs` passed. Feature tests reported 80 passes and zero failures. The first local build attempt was blocked only by pnpm rejecting a cross-worktree `node_modules` symlink without a TTY; replacing that ignored development symlink with a local copy resolved the environment issue without source changes.

## Rollback

Revert HC-RUN-220 commits. New app-data attachment records are additive and may remain for a future retry or be removed by the explicit attachment cleanup path. Existing workspace attachments, sessions, commands, and model profiles require no reverse migration.

## Commit Plan

1. Record task boundary, dependency, baseline, and risk.
2. Add failure-first store, materialization, registry, Runtime, and Electron tests.
3. Implement durable attachment Core and provider preflight.
4. Implement shared command resolution and compatible Runtime/Electron routing.
5. Connect IPC/preload/renderer persistence and error surfaces.
6. Document, capture evidence, complete program state, commit, push, and open a draft review.
