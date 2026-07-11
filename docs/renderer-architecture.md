# Renderer Architecture

Sprint 1B keeps the existing Hi Code UI behavior and splits the renderer into small ES modules. The production renderer entry is still `renderer/renderer.js`; it is now a thin bootloader that calls `bootstrapHiCode()` from `renderer/app/bootstrap.js`.

## Module Layout

- `renderer/renderer.js`: stable renderer entrypoint loaded by `renderer/index.html`.
- `renderer/app/bootstrap.js`: app wiring, event registration, and compatibility glue for the current UI.
- `renderer/app/state.js`: shared renderer state with `getState`, `setState`, `subscribe`, and `resetState`.
- `renderer/app/router.js`: shared view switching helper for Home, Chat, Capabilities/Store, Git, Job Center, Patch Arena, and Industrial Project views.
- `renderer/api/hicode-api.js`: safe wrapper around `window.hicode` preload APIs.
- `renderer/components/runtime-panel.js`: runtime queue and run-status helpers.
- `renderer/components/file-tree.js`: file modal mount/update logic.
- `renderer/components/diff-viewer.js`: diff status and preview renderer.
- `renderer/components/job-center-panel.js`: Job Center list/detail/timeline/artifact/gate UI.
- `renderer/components/patch-arena-panel.js`: Patch Arena run/candidate/diff/log/gate UI.
- `renderer/components/industrial-project-panel.js`: Industrial Project config, Requirement Builder, Spec Builder, artifact, traceability, and gate UI.
- `renderer/components/domain-pack-panel.js`: Domain Pack install/enable/disable/detail UI for standards, templates, checklists, tool requirements, quality gates, and agent profiles.
- `renderer/components/agent-team-panel.js`: Professional Agent Team profile, plan, Multi-Agent Job, review chain, artifact, and approval UI.
- `renderer/components/toolchain-panel.js`: Industrial Tool Adapter detection, setup hints, capability display, Domain Pack/project tool requirements, and safe dry-run artifact UI.
- `renderer/components/quality-gate-panel.js`: Quality Gate list/detail/evidence/rerun/approval UI.
- `renderer/components/release-center-panel.js`: Release readiness, gate/artifact/risk/approval summary, build release package action, and open release folder action.
- `renderer/components/mcp-panel.js`: Plugins, Skills, and MCP capability metadata and labels.
- `renderer/components/store-panel.js`: Store labels, paging constants, query normalization, and icons.
- `renderer/components/ai-team-panel.js`: AI Team quick-card command behavior.
- `renderer/components/settings-panel.js`: model picker DOM helpers.
- `renderer/components/toast.js`: user-facing notification controller.
- `renderer/utils/dom.js`: small DOM helpers.
- `renderer/utils/format.js`: display formatting helpers.
- `renderer/utils/validation.js`: JSON parsing and form validation helpers.

## State Management

Shared state must live in `renderer/app/state.js`. Use:

- `getState()` to read the current mutable state object.
- `setState({ ...patch })` to update state and notify subscribers.
- `subscribe(listener)` for modules that need to react to state changes.

New panel modules should not create hidden global variables. Local DOM-only state is acceptable inside a `mount...Panel()` closure when it is private to that panel; cross-panel state must be stored through `setState`.

## API Calls

Renderer modules must call main-process functionality through `renderer/api/hicode-api.js`, not directly through `window.hicode`.

Rules:

- Create one wrapped API with `createHiCodeApi(window.hicode, { onError })`.
- Use `api.has("methodName")` for optional preload methods.
- API failures should surface through toast or a panel-level status message.
- Do not expose raw `ipcRenderer` or generic invoke behavior to renderer modules.
- For persisted project features, missing preload APIs must fail closed instead of returning successful empty data.
- Attachment selection uses `attachFile`, renders typed pending chips, and sends only opaque attachment IDs. Unsent records are discarded before a conversation switch; resumed messages reconstruct chips from persisted references.

The demo fallback remains in `bootstrap.js` only for development without preload. Production behavior must not rely on mock data.

## Panel Development

New or changed panels should expose a mount/update style API:

- `mountXPanel({ elements, api, ...deps })` for DOM event setup.
- `render/update` methods for repeatable UI refreshes.
- No direct main-process calls outside the API wrapper.
- No direct cross-panel state mutation outside `setState`.
- Keep DOM text and button behavior compatible unless the sprint explicitly changes UI behavior.

## Verification

Run these before accepting renderer architecture changes:

```bash
npm run build
npm run verify
node test/feature-tests.mjs
node --check renderer/renderer.js
node --check renderer/app/bootstrap.js
node test/renderer-architecture-tests.mjs
```

Sprint 1B did not introduce Job Center, Patch Arena, or industrial domain modules. Later sprints added Job Center, Patch Arena, Industrial Project, Requirement Builder, Spec Builder, Domain Packs, Professional Agent Team, and Industrial Toolchain as separate modules without changing the renderer entrypoint.
