# HC-UI-301 - React/TypeScript/Vite App Shell Compatibility Layer

Status: In progress

Owner: Desktop UX

Branch: `codex/desktop-ux/hc-ui-301`

Started: 2026-07-11T07:52:25Z

Parent commit: `fd46ac75767e4a2844da1e48ee4d9b24b3583d61`

## Problem

The production Renderer is functional, but global navigation, route visibility, and responsive shell behavior are distributed across static HTML, a large legacy bootstrap module, and CSS breakpoints. Incremental changes can create two route owners or hide a panel without a reachable alternative.

## Outcome

Introduce a production React 18, TypeScript, and Vite App Shell that owns the typed shell/route boundary while preserving every existing view through a real Legacy Panel Adapter. Existing panel code remains operational and is migrated in later tasks rather than copied into an untested rewrite.

## In Scope

- Deterministic Renderer bundle generation with Vite and TypeScript checking.
- Typed route registry and external shell state store.
- Legacy Panel Adapter that validates required DOM roots and is the only shell-level visibility writer.
- React-owned responsive navigation surface and shell status contract.
- Compatibility events so existing bootstrap navigation updates the typed shell without duplicate state.
- Real Electron E2E at 720, 1024, 1440, and 1920 content widths.
- Focus, overflow, and no-horizontal-clipping assertions for core routes.

## Out Of Scope

- Rewriting the conversation, timeline, Git, Job Center, Arena, industrial, Store, or settings panels.
- Changing Runtime, IPC channels, preload APIs, storage locations, or product capabilities.
- Replacing the existing visual language or copying another product's UI.
- Version promotion, signing, notarization, or public release.

## Compatibility And Security Boundaries

- `renderer/index.html` remains the Electron `loadFile` entry.
- `renderer/renderer.js` remains the stable production boot entry and loads the generated App Shell bundle.
- Existing element IDs and event behavior remain available to `renderer/app/bootstrap.js`.
- No remote code, CDN, inline executable script, Node integration, or expanded preload bridge is introduced.
- The adapter fails visibly when a required legacy panel is missing instead of silently presenting a fake route.

## Baseline

After creating the isolated worktree from `fd46ac7`, the following existing gates passed before product edits:

- `npm run build`
- `npm run verify`
- `npm run release:check`
- `node test/feature-tests.mjs` (80 passed)

## Test Strategy

1. Failure-first App Shell tests for route registration, invalid/duplicate routes, state subscription, legacy panel availability, and generated bundle contracts.
2. Existing Renderer architecture, feature, service, security, DoD, runtime, and release regression suites.
3. Real Electron E2E navigation and geometry evidence at 720, 1024, 1440, and 1920 widths.
4. Full release check, production dependency audit, and full-tree Skeleton Detector.

## Rollback

Revert the HC-UI-301 commits. The legacy bootstrap and panel DOM are not deleted or migrated, so the previous stable `renderer/renderer.js -> bootstrapHiCode()` path remains restorable without data migration.

## Commit Plan

1. Program boundary and risk registration.
2. Failure-first App Shell and compatibility tests.
3. Build pipeline and typed shell contracts.
4. Legacy Panel Adapter and React shell integration.
5. Responsive E2E, documentation, and evidence.
