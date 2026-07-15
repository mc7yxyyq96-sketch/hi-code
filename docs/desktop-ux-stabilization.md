# Desktop UX Stabilization

HC-UX-430 consolidates desktop execution controls, native menu behavior,
permission prompting, Store performance, and responsive acceptance without
replacing the existing Runtime, Provider, MCP, or business-panel authorities.

## Execution Profile

The model picker renders one derived Execution Profile Card. It presents the
effective model, response speed, reasoning level, privacy boundary, and context
budget from the current validated configuration. The card is a projection of
real settings; changing reasoning or model still uses the established config
and Runtime paths.

- Local endpoints are labelled local and do not claim remote privacy.
- Remote endpoints are labelled remote and show the data-boundary warning.
- The token budget is derived from the configured context window and threshold.
- Missing values remain explicit defaults; the Renderer does not invent
  Provider health or verification.

## Native Desktop Menus

`electron/services/native-menu-service.mjs` installs a real Electron menu.
Standard Edit actions use Electron roles for undo, redo, cut, copy, paste,
paste-and-match-style, delete, and select all. View actions use native zoom and
fullscreen roles. Hi Code-specific commands use a fixed allowlist and are sent
to the focused production window as `native-menu-command` events.

Preload validates every received command against the same closed set. The
Renderer maps those commands to existing actions for new chat, search,
composer focus, sidebar visibility, and settings. There is no generic menu IPC
or Renderer-provided command execution.

## Permission Fingerprints

An exact permission request receives a SHA-256 fingerprint over normalized
tool, action, mutation class, and scope. Within the current process session:

- an approved exact fingerprint is not prompted again;
- concurrent exact requests share one pending decision;
- a changed action produces a different prompt;
- denied requests are not remembered;
- the fingerprint does not expose the action text.

The existing permission modes and tool-level allowlist remain compatible.
Session fingerprints are memory-only and disappear on restart. This is not a
cross-session or workspace-wide grant.

## Store Cache And Virtualization

Catalog metadata is cached at `~/.hicode/store/catalog-cache.json` through
`electron/services/store-catalog-cache.mjs`. The directory and files use owner
permissions, writes use a sibling temporary file and atomic replacement, and
the cache has a bounded entry count and TTL. Installed state is always
rehydrated from the authoritative install registry before returning results.

Normal Store navigation uses stale-while-refresh:

1. A matching cached result is returned immediately.
2. Main process refreshes the source in the background.
3. A bounded `store-catalog-updated` event invalidates only the matching view.
4. A cold remote source returns the truthful built-in quick catalog while the
   aggregate source refreshes; it is marked `partial`, never presented as the
   complete remote result.

The response reports cache source, duration, target, and target compliance.
The Store list renders only a bounded visible range with overscan; the full
catalog is not materialized into DOM rows.

## Responsive Contract

The industrial App Shell uses `hicode-industrial-v1` design metadata and the
same compact workbench density at these supported content widths:

- 720 px
- 800 px
- 1100 px
- 1440 px
- 1920 px

Electron E2E validates navigation reachability, menu behavior, profile bounds,
Store latency, bounded Store rows, and screenshot fixtures at every width.
Scrollable panels remain independently scrollable and popovers must fit inside
the visible content area.

## Performance Contract

Measured in the isolated Electron fixture environment:

- cached Store open P95 must be at most 300 ms;
- cold Store open P95 must be at most 1.5 seconds;
- Store virtualization must keep rendered rows bounded independently of total
  catalog size.

These are real main-process API timings, not animation or timeout estimates.
The observed values are recorded in Electron E2E output and the task evidence.

## Verification

```bash
CI=true npm run test:desktop-ux
CI=true npm run test:renderer
CI=true npm run test:app-shell
CI=true npm run test:security
CI=true npm run test:electron-e2e
CI=true npm run program:evidence:desktop-ux
```
