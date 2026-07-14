# ADR-0002: Runtime Protocol Authority Through Staged Migration

Status: Accepted

Date: 2026-07-10

Owners: Runtime Engine, Desktop UX

## Context

Electron, CLI, and TUI share `src/runtime.ts`, and versioned Runtime Protocol envelopes are already appended to JSONL. However, part of assistant output still reaches desktop through compatibility stdout/console bridging, and full context resume still depends on session JSON. Global output interception creates concurrency and replay risk. Removing the legacy path immediately would break working clients and user sessions.

## Decision

Runtime Protocol will become the single execution and transcript authority through additive stages:

1. Introduce an injected `RuntimeEventSink`.
2. Emit first-class assistant delta and completion events through the sink.
3. Add client adapters for Electron, CLI, and TUI while preserving legacy fields.
4. Add per-session concurrency tests that prove output isolation.
5. Introduce typed Thread/Event/Message stores and idempotent importers in later tasks.
6. Remove stdout/session compatibility paths only after replay, resume, and client parity gates pass.

Runtime status does not reinterpret industrial evidence. `simulated`, `not_run`, and `external_required` remain artifact/gate states and can never be mapped to a real passed execution.

## HC-RUN-201 Implementation Status

- `RuntimeEventBus` now provides validated, immutable, session-filtered delivery with listener fault isolation.
- Agent streaming emits durable `assistant.delta` and `assistant.completed` protocol events with stable message/session/turn identity.
- Electron, CLI, and TUI use client adapters rather than reading assistant text from global stdout.
- The Electron compatibility stdout bridge remains enabled by default for legacy command/tool framing during migration and is disabled with `HICODE_LEGACY_STDOUT_BRIDGE=0` in real Electron acceptance.
- Full context reconstruction remains deferred to HC-RUN-202; HC-RUN-201 does not mark event-only sessions fully resumable.

## Consequences

Positive:

- All clients can consume one typed stream.
- Assistant content becomes replayable and attributable to a session/turn.
- Parallel sessions no longer share a global output buffer.
- Future SDK/app-server work can expose the same protocol.

Costs:

- A compatibility period retains duplicate projections.
- Store migration and replay tests are required before legacy removal.
- Event ordering and append failure become explicit operational concerns.

Security:

- Protocol payloads must not contain raw credentials or unrestricted environment data.
- Visibility metadata controls whether an event is safe for chat, timeline, job, or SDK consumers.
- Tool and approval events retain existing permission and path boundaries.

Compatibility:

- Existing event fields and IPC channels remain available during migration.
- Existing session JSON and JSONL files are imported, not overwritten.
- Event schema changes are versioned.

## Rejected Alternatives

- Big-bang runtime rewrite: rejected because it risks Electron, CLI, TUI, and user-data regressions.
- Keep stdout as the desktop transport: rejected because global mutable output is not concurrency-safe or replayable.
- Build a separate industrial runtime: rejected because it would duplicate security, job, and release semantics.
- Mark event-only sessions fully resumable before message reconstruction exists: rejected as a false capability claim.

## Verification And Rollout Gates

HC-RUN-201 must prove:

- assistant output is emitted through the protocol sink;
- two concurrent sessions cannot mix deltas;
- a desktop turn works with compatibility stdout bridging disabled;
- CLI and TUI adapters preserve user-visible output;
- build, verify, release check, feature, security, and DoD gates pass.

Later store tasks must prove full transcript reconstruction, idempotent import, crash recovery, and safe fallback before the compatibility path is removed.
