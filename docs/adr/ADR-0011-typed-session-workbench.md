# ADR-0011: Typed Session Workbench With Bounded Conversation Rendering

Status: Accepted

Date: 2026-07-11

## Context

HC-UI-301 established a typed route shell, but recent sessions, conversation messages, Runtime timeline, recovery tasks, and the Diff Inspector still rebuilt DOM imperatively inside one bootstrap module. Long conversations mounted every historical message, live snapshots serialized presentation state, and responsive panel focus was coordinated by unrelated listeners. Rewriting persistence, Runtime, IPC, and UI at once would create two authorities and place working desktop behavior at risk.

## Decision

1. React owns five declared workbench mount points while the existing local Electron document and business handlers remain in place.
2. One immutable typed workspace store owns presentation state for sessions, conversation, timeline, recovery, diffs, drawer state, and action availability.
3. Bootstrap publishes normalized data and registers concrete existing handlers through a renderer-internal controller. Missing handlers fail closed.
4. Conversation rendering uses bounded windows with at most 160 mounted messages; stored history is not truncated.
5. Streaming updates one active assistant message. Background completion finalizes the source live snapshot rather than the session currently visible to the user.
6. ANSI and diff presentation use typed text rows without raw HTML. Diff preview has a fixed upper bound.
7. No persistence schema, IPC channel, preload API, permission rule, or app-data path changes in this migration.

## Consequences

### Positive

- Long sessions have a measurable DOM bound and remain navigable.
- Recent sessions and responsive panels have one keyboard/focus contract.
- Real business actions stay on established API and permission paths.
- A migrated mount has one owner, preventing duplicate rendering and event handlers.
- Later composer or panel migrations can use the same store/controller boundary.

### Costs

- Bootstrap and React coexist until remaining panels migrate.
- Normalization code must keep presentation types compatible with persisted/runtime inputs.
- Windowed history requires explicit older/newer controls instead of one unbounded page.

### Security And Compatibility

- The bridge is renderer-internal and exposes no Node, filesystem, environment, or generic IPC primitive.
- Message and diff content are rendered as text.
- Destructive actions retain current permission, service, and error behavior.
- Stored sessions and Runtime event logs require no migration or rollback.

## Rejected Alternatives

- **Mount all conversation history:** rejected because DOM cost grows without a product bound.
- **Copy sessions into a new React persistence store:** rejected because it creates conflicting authorities.
- **Keep imperative rendering under React containers:** rejected because two owners can overwrite state and handlers.
- **Disable unavailable controls silently:** rejected because it produces unexplained dead UI.
- **Rewrite composer, approvals, Runtime, and workbench together:** rejected as an unsafe big-bang migration.

## Verification

- `npm run test:workspace-shell`
- `npm run test:renderer`
- `npm run test:electron-e2e`
- `npm run test:security`
- `npm run verify`
- `npm run release:check`
- `npm run scan:dod`

The Electron test injects 10,000 messages, verifies at most 160 mounted rows, navigates history, checks session keyboard focus, exercises drawers, and asserts no uncaught renderer errors.

## Rollback

Revert HC-UI-302. The underlying session, Runtime, diff, attachment, and permission implementations remain unchanged behind the compatibility boundary.
