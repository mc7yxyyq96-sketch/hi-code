# ADR-0010: Gradual React App Shell With Legacy Panel Adapter

Status: Accepted

Date: 2026-07-11

## Context

The production desktop Renderer contains working panels and established IPC behavior, but shell navigation and route visibility were coordinated by static HTML and a large JavaScript bootstrap module. A full rewrite would put working Job Center, Arena, Git, Store, industrial, settings, conversation, and recovery behavior at unnecessary risk. Keeping the old shell indefinitely would leave route state implicit and make small-window navigation regressions difficult to contain.

`capabilityView` also hosts five distinct destinations. A panel ID alone cannot identify whether the user is viewing Store, Plugins, Skills, Agents, or MCP; any compatibility layer must preserve the panel plus active-navigation pair.

## Decision

Hi Code adopts React 18, TypeScript, and Vite for a gradual Renderer migration:

1. `renderer/index.html` remains the trusted local Electron document.
2. `renderer/renderer.js` remains the stable module entry. It mounts the generated App Shell before calling the legacy bootstrap.
3. Source lives under `renderer/app-shell/`; Vite produces `renderer/generated/app-shell.js` during every production build. Generated output is ignored by Git and recreated before packaging.
4. A typed route registry owns route IDs and the legacy `(panelId, navId)` mapping. Duplicate mappings fail closed.
5. `LegacyPanelAdapter` validates every required production panel and trigger, owns shell-level panel visibility, and routes new UI intent through the existing real trigger rather than copying panel behavior.
6. The React shell initially owns compact navigation and shell state. Business panels remain on the compatibility path until a later task migrates each one with its own tests.
7. The fallback in `renderer/app/router.js` remains for browser-only compatibility, but production Electron installs the typed bridge first.

## Consequences

### Positive

- Existing functionality remains available without a big-bang rewrite.
- Route and drawer state have a typed, independently testable boundary.
- Missing panels, duplicate routes, and fake navigation entries fail visibly.
- 720px layouts regain a complete navigation alternative while wide layouts keep the established shell.
- Later panel migrations can replace one route at a time behind the same registry.

### Costs

- React and legacy DOM coexist during the migration window.
- Every route change must update the typed registry and the legacy trigger contract together.
- A production build is required before launching Electron because the generated bundle is not committed.

### Security And Compatibility

- No new preload method, IPC channel, remote script, CDN, Node primitive, or inline executable script is introduced.
- CSP remains local-only and the Renderer sandbox remains enabled.
- The adapter invokes existing DOM triggers, so permission, API, persistence, cancellation, and error behavior stay on established code paths.
- A modal layer always outranks compact shell navigation so the shell cannot intercept modal controls.

## Rejected Alternatives

- **Rewrite every panel in React at once:** rejected because it would duplicate state and risk losing tested workflows.
- **Mount a decorative React badge only:** rejected because it would not own a real route or interaction boundary.
- **Keep adding CSS-only breakpoints:** rejected because it does not solve implicit route ownership or missing compact alternatives.
- **Commit the generated bundle:** rejected because generated code would create noisy reviews and could drift from typed source.

## Verification

- `npm run test:app-shell`
- `npm run test:renderer`
- `npm run test:electron-e2e`
- `npm run build`
- `npm run verify`
- `npm run release:check`
- `npm run scan:dod`

Real Electron acceptance covers 720, 1024, 1440, and 1920 content widths. At compact width it opens the React drawer, navigates through an existing trigger, verifies active route synchronization, closes on Escape, restores focus, and checks horizontal geometry.

## Rollback

Revert HC-UI-301. No panel DOM, IPC channel, stored data, or user configuration is migrated, so restoring the previous `renderer/renderer.js -> bootstrapHiCode()` entry requires no data rollback.
