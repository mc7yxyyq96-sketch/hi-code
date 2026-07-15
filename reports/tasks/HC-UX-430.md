# HC-UX-430 Desktop UX Stabilization

Status: In Review

Branch: `codex/desktop-ux/hc-ux-430`

Parent commit: `aed6055dc9ee28aa2b7780a93614bebefe87073a`

Started: `2026-07-15T15:10:39Z`

## Scope

Stabilize the production Electron workbench around one execution profile,
native desktop menus, exact-session permission deduplication, a private cached
and virtualized Store, and responsive acceptance at 720, 800, 1100, 1440, and
1920 pixels. Existing Runtime, Provider, MCP, security, release, and industrial
business behavior remains authoritative and compatible.

## Implementation

- The typed App Shell publishes a versioned industrial design-system identity
  and supported responsive tiers.
- The model picker derives an Execution Profile Card from the effective model,
  speed, reasoning, privacy, and context-budget configuration.
- Electron installs native Edit/View roles plus a closed set of Hi Code menu
  commands. Preload and Renderer validate and execute real existing actions.
- Permission prompts hash exact request semantics, share concurrent decisions,
  and remember approvals only for the current process session.
- Main process persists bounded private Store metadata, serves cached entries
  immediately, refreshes in the background, and reports truthful latency and
  partial-source state.
- The Store renders a bounded visible row window rather than every catalog
  entry.
- Electron E2E verifies real interactions, performance, popup bounds, and five
  responsive screenshot fixtures.

## Security Constraints

- No generic native-menu IPC was introduced.
- Permission fingerprints contain hashes, not action text, and are not written
  to disk.
- Denials are not silently converted into remembered approvals.
- Catalog cache files are owner-only, bounded, atomically replaced, and contain
  metadata rather than credentials or executable authority.
- Remote Store failures and cold fallback remain explicit; fallback data is
  marked partial and is not represented as a complete remote catalog.

## Current Verification

Focused tests and real Electron E2E pass. The latest Electron run records cold
Store open at 47 ms, cold API P95 at 1.1 ms, cached API P95 at 0.3 ms, and 12
rendered rows for 12 visible results. The complete 14-command evidence capture
and final Program Control acceptance are the remaining review steps; this task
is not marked complete before those artifacts exist.

## Rollback

Revert the HC-UX-430 commits. The prior App Shell, model picker, permission
mode, direct Store fetch, and renderer navigation remain intact because the
change preserves their existing APIs and data locations.
