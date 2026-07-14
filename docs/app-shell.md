# Typed App Shell

HC-UI-301 introduces a real React/TypeScript/Vite shell around the existing Hi Code panels. It is a compatibility migration boundary, not a second UI implementation.

## Build And Entry Flow

```text
renderer/app-shell/main.tsx
  -> Vite production bundle
  -> renderer/generated/app-shell.js
  -> renderer/renderer.js
  -> mountHiCodeAppShell()
  -> bootstrapHiCode()
```

`renderer/index.html` remains the Electron document. `renderer/generated/` is intentionally ignored; `npm run build` type-checks the shell, regenerates the bundle, and then compiles the shared runtime.

## Route Contract

`renderer/app-shell/contracts.ts` defines every shell destination. A route contains:

- stable route ID and Chinese label;
- legacy panel ID;
- expected `#main` class;
- active side-navigation ID;
- existing real trigger ID;
- icon class and direct-navigation capability.

Store, Plugins, Skills, Agents, and MCP share `capabilityView`, so the registry resolves legacy state with `(panelId, navId)`. Duplicate route IDs or duplicate legacy mappings are startup errors.

## Legacy Panel Adapter

`LegacyPanelAdapter`:

1. Validates required shell, panel, navigation, and trigger elements.
2. Applies a legacy route atomically by updating main class, panel visibility, active navigation, and typed shell state.
3. Routes React navigation through the existing trigger's `click()` behavior, preserving current lifecycle and API code.
4. Rejects a route without a real trigger rather than presenting a fake button.
5. Publishes actionable compatibility errors to the React shell.

Do not call panel APIs from the App Shell or duplicate an existing panel handler. A panel is migrated only in its assigned task with behavior, persistence, errors, tests, and E2E evidence.

## State Boundary

`renderer/app-shell/store.ts` is an immutable external store consumed through React `useSyncExternalStore`. It owns:

- active shell route and navigation ID;
- compact drawer state;
- compatibility error state.

Business state remains in `renderer/app/state.js` until the relevant panel migration. This split prevents the shell from becoming a second runtime or domain store.

HC-UI-302 is the first panel migration behind this boundary. `WorkspacePortals` owns the Session Sidebar, Conversation, Timeline/recovery, Diff Inspector, and responsive workbench controls. A separate immutable workspace presentation store receives normalized data from bootstrap; existing APIs and persistence remain authoritative. See `docs/session-workbench.md` and ADR-0011.

## Responsive Behavior

- Above 820px, the established sidebar and workspace actions remain the visible navigation.
- At 820px and below, top actions remain compact and the React App Shell exposes an icon button and full route drawer.
- The drawer is keyboard dismissible, restores focus to its trigger, and scrolls independently.
- Modals sit above the shell and retain all close/submit controls.

## Adding A Route

1. Add one typed definition in `DEFAULT_SHELL_ROUTES`.
2. Provide an existing production panel, active nav, and real trigger.
3. Add unit coverage for registry and adapter behavior.
4. Add real Electron navigation coverage when the route changes responsive behavior.
5. Never add a route whose trigger is a placeholder or whose panel exists only in demo mode.

## Commands

```bash
npm run check:renderer-types
npm run build:renderer
npm run test:app-shell
npm run test:workspace-shell
npm run test:renderer
npm run test:electron-e2e
```
