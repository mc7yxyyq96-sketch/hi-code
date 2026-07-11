# Typed Session Workbench

HC-UI-302 migrates the Session Sidebar, Conversation, Runtime Timeline, recovery list, and Diff Inspector into the typed App Shell. The migration keeps the current Electron APIs, Runtime protocol, session persistence, permission flow, attachment store, and diff service authoritative.

## Ownership Boundary

React exclusively owns the children of these existing production mounts:

- `#sessions`: recent, running, transient, and replay sessions.
- `#chat`: persisted and live conversation messages.
- `#workbenchControlsMount`: responsive panel controls and action errors.
- `#timelineWorkspaceMount`: recovery tasks and Runtime/tool events.
- `#inspectorWorkspaceMount`: applied changes, preview, archive, and rollback actions.

`renderer/app/bootstrap.js` must not append, replace, or query generated children in those mounts. It normalizes existing API results into `window.hicodeAppShell.workspace` and registers concrete handlers once. The bridge is renderer-internal and does not add IPC or preload capabilities.

## Typed State

`renderer/app-shell/workspace/store.ts` publishes immutable snapshots through `useSyncExternalStore`. It owns:

- sessions, active session, and filter text;
- conversation messages and the active streaming assistant ID;
- Runtime timeline and recoverable tasks;
- diffs, selected diff, and archived visibility;
- the single responsive workbench drawer;
- registered action names and the last actionable error.

The store is presentation state, not a second persistence layer. Session history still comes from `listSessions` and `readSession`; Runtime output still comes from protocol events; changes still come from the diff service.

## Action Adapter

`WorkspaceController` fails closed when a production callback is absent. React disables unavailable controls and describes why. Bootstrap registers these real handlers:

| Surface | Actions |
| --- | --- |
| Sessions | open, delete |
| Recovery | refresh, retry/reconfirm, review/inspect |
| Timeline | retry a recoverable turn, select related diff |
| Inspector | select, archive, rollback, archive all, rollback all, history, clear history |

Errors are written to the typed store and shown in the workbench alert. No action returns a synthetic success result.

## Long Conversation Contract

The store may retain a 10,000-message transcript, but `Conversation` mounts at most 160 message rows. The user can move to older/newer windows or return to the latest output. Streaming replaces the active assistant message instead of adding one DOM node per token.

This is bounded windowing rather than destructive truncation: persisted messages remain available and the visible range reports its exact offsets. Timeline rendering is independently capped at 120 newest events while persisted protocol history remains authoritative.

## Session Switching

- Leaving a running conversation captures a typed live snapshot.
- Incoming chunks update that source snapshot while another session is visible.
- Turn completion finalizes the source snapshot, never the currently viewed saved session.
- Selecting the running session restores the live snapshot without invoking a fake resume.
- Selecting a saved or replay session reads persisted messages through the existing API.

## Safety And Presentation

- Message content is rendered as text segments; ANSI colors never become HTML.
- Diff previews use typed rows and a hard 803-row preview bound.
- React never receives filesystem, Node, environment, or generic IPC access.
- Delete, rollback, retry, and approval behavior remains on existing permission and service paths.
- Missing handlers disable controls and produce an actionable visible error.

## Keyboard And Responsive Behavior

- Arrow Up/Down and Home/End move focus through recent sessions.
- Enter activates the focused session through the existing handler.
- At medium/small widths, Timeline and Inspector use one shared drawer state.
- Escape closes the drawer and restores focus to its trigger.
- Wide layouts keep both panels visible.

## Verification

```bash
npm run check:renderer-types
npm run test:workspace-shell
npm run test:renderer
npm run test:electron-e2e
npm run verify
npm run release:check
npm run scan:dod
```

Real Electron acceptance covers 720, 1024, 1440, and 1920 widths, a 10,000-message transcript, bounded mounted rows, session keyboard focus, responsive panel drawers, navigation, and page-error monitoring.

## Rollback

Revert HC-UI-302. No session format, Runtime event, attachment record, diff record, user configuration, IPC channel, or app-data location changes. HC-UI-301 remains the compatible shell boundary.
