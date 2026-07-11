# ADR-0009: Durable Attachments And Deterministic Command Routing

Status: Accepted

Date: 2026-07-10

Owners: Runtime Engine

## Context

Desktop image selection previously copied files into the selected workspace and expanded paths into model input. Attachment identity, integrity, session ownership, provider capability negotiation, and restart behavior were implicit. PDF and general-file behavior had no truthful end-to-end contract.

Input routing was also split between Runtime prefix checks, slash-command handlers, and Electron native-application matching. That allowed ordinary coding language to be intercepted by a native matcher and made alias or matcher conflicts difficult to detect.

## Decision

1. Store imported attachments under a fixed app-data root as typed records and content-addressed blobs. Never persist or send the selected source path.
2. Persist opaque attachment references in user messages. Materialize bytes only at the model-provider boundary after record, hash, role, and capability validation.
3. Classify content from bytes, apply per-kind import limits, and fail visibly before network I/O for transports that cannot represent the attachment.
4. Keep legacy inline images and `attach-image` as compatibility paths; new Desktop input uses bounded attachment IDs.
5. Route shell, slash, native, and agent input through one `CommandRegistry` contract on every client surface.
6. Reject duplicate slash aliases and ambiguous top-priority native matchers. Unknown slash commands fail closed.
7. Keep host actions outside the shared Runtime. A host may pass a pre-resolved route to Runtime, but it may not create a parallel command classifier.

## Consequences

- Attachments survive restart without modifying the project workspace.
- Duplicate content shares blob storage while retaining per-session records.
- Providers never receive Hi Code persistence references, unverified bytes, or unsupported attachments.
- PDF and arbitrary binary files can be retained as user data but are not claimed as processed until a compatible transport is added.
- Existing CLI, TUI, Desktop, slash commands, native aliases, and legacy image prompts remain compatible.
- App-data cleanup must account for attachment records when sessions are deleted or unsent attachments are discarded.

## Security And Privacy

- Attachment IDs, session IDs, file names, record paths, and blob keys are validated; paths derive only from fixed roots.
- Symlinked or non-regular record/blob files are rejected.
- Owner-only permissions and atomic writes protect local records where the platform supports them.
- SHA-256 and byte length are checked on every read.
- Source paths and attachment bytes do not enter Runtime queue metadata, Job metadata, or legacy timeline logs.
- Attachments cannot accompany shell, slash, or native commands.

## Rejected Alternatives

- Continue copying attachments into the selected workspace: rejected because it mutates user projects and leaks local paths into prompts.
- Persist base64 in session JSON: rejected because it duplicates large private content and makes replay stores unbounded.
- Let each provider silently ignore unsupported files: rejected because it creates false execution evidence.
- Infer command route independently in each client: rejected because precedence and conflict behavior diverge.
- Treat every `打开`, `启动`, or `运行` prefix as a native application request: rejected because it intercepts common coding instructions.

## Verification And Rollout Gates

- Attachment metadata and bytes survive construction of a new store instance.
- Missing, tampered, oversized, cross-session, and unsupported attachments produce visible failures.
- Unsupported PDF/file input makes no provider request and does not enter conversation history.
- A real Runtime/provider request receives a verified image while persistence retains only the reference.
- Slash aliases resolve canonically; unknown slash commands and ambiguous native routes fail closed.
- Electron IPC, Renderer, Runtime, provider, security, DoD, feature, verify, release, and E2E gates pass.

## Rollback

Revert HC-RUN-220. The app-data store is additive and may remain unused. Legacy session and inline-image formats require no reverse migration.
