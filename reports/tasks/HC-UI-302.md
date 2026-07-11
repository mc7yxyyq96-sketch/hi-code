# HC-UI-302 - Session Workbench Migration

Status: Completed

Owner: Desktop UX

Branch: `codex/desktop-ux/hc-ui-302`

Started: 2026-07-11T10:21:16Z

Completed: 2026-07-11T12:31:58Z

Parent commit: `35754d00fcdb6141daebfc1c011e5d0c0328a2ed`

## Problem

The typed App Shell now owns routes, but the Session Sidebar, Conversation, Timeline, and Diff Inspector still render through independent imperative DOM loops. Saved-session opening works through real APIs, yet long transcripts rebuild every message, live snapshots serialize HTML, and panel drawers do not share one typed focus/state contract.

## Outcome

Move these four workbench surfaces into React behind one typed workspace store and a compatibility controller. Existing Electron APIs, Runtime events, session persistence, attachment behavior, approvals, diff actions, and recovery actions remain authoritative. Legacy bootstrap publishes normalized state and registers its real handlers; React does not create a parallel backend or persistence path.

## In Scope

- Typed session, conversation message, timeline, recovery, diff inspector, and drawer models.
- React Session Sidebar with real open/delete callbacks, active/running state, search filtering, and keyboard navigation.
- Virtualized/windowed conversation rendering with bounded mounted message rows and stable live streaming updates.
- React Timeline and recovery actions backed by existing Runtime/tool event handlers.
- React Diff Inspector with real select/archive/rollback/history actions and unchanged diff semantics.
- Shared responsive drawer/focus contract at 720, 1024, 1440, and 1920 widths.
- Failure-first unit/contract tests and real Electron saved/live session tests.

## Out Of Scope

- Changing session or Runtime persistence formats.
- Replacing the composer, attachment tray, permission prompt, run status, model picker, IPC, or preload API.
- Migrating Git, Job Center, Arena, Store, industrial panels, settings, editor, terminal, or preview.
- Version promotion, signing, notarization, formal release, or visual imitation of another product.

## Interfaces And Ownership

- `window.hicodeAppShell.workspace` is Renderer-internal only; it does not expand the preload bridge.
- Bootstrap owns API calls and registers concrete actions once.
- The workspace store owns normalized UI state and immutable snapshots.
- React owns children of the four declared mount points; legacy code must not write those children after migration.
- Session data remains sourced from `listSessions`, `readSession`, `resumeSession`, `newSession`, and `deleteSession`.

## Performance Contract

- A 10,000-message transcript may exist in store without mounting 10,000 message rows.
- The visible range includes a bounded overscan window and preserves scroll-to-latest behavior.
- Streaming updates replace only the active assistant message in store.
- Session and timeline lists apply explicit caps or windowing without losing access to persisted history.

## Security And Error Boundaries

- Message text is rendered as React text/parsed ANSI segments, never injected as untrusted HTML.
- Diff previews render typed lines, not raw `innerHTML`.
- Missing callbacks disable actions with an explanation instead of presenting a fake working control.
- Delete, rollback, archive, retry, and approval behavior continue through existing permission/API paths.
- No remote resource, Node primitive, environment variable, or new IPC channel is introduced.

## Baseline

The parent HC-UI-301 evidence records 13/13 commands passing, including real Electron E2E at 720, 1024, 1440, and 1920 widths, security, DoD, production audit, and release checks.

## Test Strategy

1. Failure-first tests for store immutability, 10,000-message windowing, active-session state, callback availability, drawer focus, ANSI safety, and diff line normalization.
2. Existing App Shell, Renderer architecture, feature, security, DoD, and release suites.
3. Real Electron E2E for saved session open/delete alternatives, live turn visibility, transcript row bounds, and keyboard drawer operation.
4. Full machine-captured task evidence with redacted logs and artifact hashes.

## Rollback

Revert HC-UI-302. HC-UI-301 retains the stable shell, and the existing bootstrap APIs, persistence, IPC, and business handlers remain unchanged behind the compatibility boundary, so no data migration or rollback is required.

## Commit Plan

1. Program boundary and migration risk.
2. Failure-first workspace store/windowing tests.
3. Typed store, controller, and React workspace components.
4. Bootstrap compatibility integration and real actions.
5. Responsive Electron E2E, documentation, and evidence.

## Delivered

- Added an immutable typed workspace store and renderer-internal compatibility controller.
- Migrated recent sessions, conversation, Timeline/recovery, Diff Inspector, and workbench drawer controls to React portals.
- Preserved real session persistence, Runtime events, attachments, approvals, recovery, and Diff handlers without new IPC.
- Bounded conversation rendering to 160 mounted rows while retaining access to 10,000-message history.
- Replaced raw ANSI/diff HTML rendering with typed text segments and bounded diff rows.
- Added visible fail-closed action errors, disabled unavailable controls, session keyboard navigation, and drawer focus restoration.
- Prevented a background turn completion from finalizing the saved session currently visible to the user.
- Made task evidence invoke the repository-locked npm CLI with the current Node runtime, removing PATH/package-manager ambiguity.

## Acceptance

- Long-session performance target: passed with 10,000 stored messages and at most 160 mounted rows.
- No hidden action without alternative: passed; real handlers are registered once and missing handlers disable controls with an explanation.
- Keyboard navigation: passed for session Arrow Up/Down, Home/End, drawer Escape, and focus restoration.
- Responsive behavior: passed at 720, 1024, 1440, and 1920 Electron content widths.
- Security: no preload/IPC expansion; text-only message/diff presentation; existing destructive-action boundaries retained.

## Evidence

`reports/evidence/HC-UI-302/manifest.json` records 14/14 passing commands from clean source commit `423a05a64acf8f4c916b2b48cc5237a42b38a25b`:

- build, verify, and release check;
- feature, App Shell, workspace shell, Renderer, security, and DoD tests;
- full-tree DoD scan with zero findings;
- production dependency audit;
- real Electron E2E;
- Program control and Git diff checks.

The first evidence attempt exposed a macOS Team-ID mismatch between an app-bundled Node and Rollup's native module. The runner was fixed to execute the locked npm CLI with the current compatible Node runtime; the failed attempt was discarded and the final clean capture reran every command successfully.

## Residual Limits

- Composer, approval prompt, attachment tray, run status, and remaining product panels stay on the HC-UI-301 compatibility path.
- Conversation windowing is fixed-row bounded rendering rather than measured variable-height virtualization; it meets the current DOM bound and remains replaceable behind the same store.
- The current release remains an unsigned alpha. HC-UI-302 does not promote, sign, notarize, or publish a release.
