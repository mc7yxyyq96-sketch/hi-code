# Durable Attachments And Command Routing

Status: Implemented by HC-RUN-220

## Attachment Lifecycle

Desktop attachments are imported into the Hi Code app-data directory, under `attachments-v2/`. The selected source path is never stored in attachment metadata and is never sent through Renderer IPC. `FileAttachmentStore` writes:

- `records/<attachment-id>.json`: typed metadata with session ownership, detected kind, MIME type, size, SHA-256, and blob key.
- `blobs/<sha256>`: content-addressed bytes shared by duplicate records.

Directories use owner-only permissions and files use mode `0600` where supported. Metadata and blobs are written atomically. Every read verifies that the blob is a regular file and that its size and SHA-256 still match the record.

The Renderer receives an opaque attachment ID plus display metadata. Runtime queue metadata contains IDs only. Persisted user messages contain `attachment_ref` parts rather than source paths, base64 payloads, or copied file content. These references survive an app restart because the records and blobs live outside the selected workspace.

## Supported Inputs

Content is classified from bytes rather than trusting a file extension:

| Kind | Import limit | Provider behavior |
| --- | ---: | --- |
| PNG, JPEG, GIF, WebP | 8 MiB | Materialized to a verified data URL when the selected provider declares image input support |
| UTF-8 text | 2 MiB | Read locally and inlined up to 256 KiB per provider request |
| PDF | 20 MiB | Preserved durably, but rejected before network I/O until the selected transport has a compatible PDF wire format |
| Other binary file | 20 MiB | Preserved durably, but rejected before network I/O until a compatible file transport exists |

An unsupported format is not reported as uploaded or processed. The Runtime produces a visible capability/transport error, sends no provider request, and does not add the failed input to model history.

## Provider Boundary

`attachment_ref` is a Hi Code persistence type, not a provider wire type. Before every model request, `materializeAttachmentMessages`:

1. Loads each referenced record from the injected attachment store.
2. Verifies metadata identity and blob integrity.
3. Derives required provider capabilities.
4. Negotiates capabilities before any network request.
5. Converts only supported image and text data into transport content.

All low-level provider adapters reject an unmaterialized reference. This keeps a missing or corrupted attachment from being silently dropped.

## Electron And Renderer Contract

The preload bridge exposes bounded methods:

- `attachFile(payload)` imports a selected file or a pasted image data URL.
- `attachImage(payload)` remains an image-only compatibility alias.
- `listAttachments(sessionId)` returns display metadata.
- `removeAttachment(id)` removes a record owned by the active session.
- `send({ text, attachmentIds })` accepts at most eight unique attachment IDs.

Unsent attachment records are discarded before switching or creating a conversation, preventing an old-session ID from being sent through a new Runtime. Sent attachment chips are reconstructed from durable session references after resume.

## Command Registry

`CommandRegistry` is the single classification contract for CLI, TUI, Desktop, and shared Runtime input. It resolves one of four routes:

1. `shell`: input beginning with `!`.
2. `slash`: registered slash commands and aliases.
3. `native`: host-specific matchers such as a known desktop application alias.
4. `agent`: ordinary model input.

Registration rejects duplicate IDs and overlapping slash aliases. Native matchers are ordered by explicit priority; multiple top-priority matches fail closed with `command_route_conflict`. Unknown slash commands are visible errors and never fall through to a model. A failed Desktop native-open operation falls back explicitly to the registry's agent route instead of rerunning native matching.

This prevents coding requests such as `运行测试` from being mistaken for application-launch commands while keeping known application aliases compatible.

## Migration And Rollback

Existing `@path/to/image.png` content remains supported. Existing sessions with inline `image_url` content remain readable. New attachments do not move or delete legacy workspace files.

Rollback is additive: revert the HC-RUN-220 commits. Existing sessions and legacy image prompts continue to work; `attachments-v2/` may remain unused for a later upgrade or be removed through explicit attachment/session cleanup. No reverse session migration is required.

## Verification

```bash
npm run build
npm run test:attachment-command
npm run test:services
npm run test:renderer
npm run test:security
npm run verify
npm run release:check
```

The focused contract covers content addressing, restart persistence, integrity failure, capability preflight before network I/O, real Runtime/provider materialization, session reference persistence, command aliases, unknown commands, and native-route conflicts.
