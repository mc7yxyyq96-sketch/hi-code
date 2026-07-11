# HC-UI-301 - React/TypeScript/Vite App Shell Compatibility Layer

Status: Completed

Owner: Desktop UX

Branch: `codex/desktop-ux/hc-ui-301`

Started: 2026-07-11T07:52:25Z

Completed: 2026-07-11T09:47:05Z

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

## Delivered Implementation

- React 18, TypeScript, and Vite build a deterministic local App Shell bundle before Electron packaging.
- A typed route registry rejects duplicate IDs and duplicate legacy `(panelId, navId)` mappings.
- An immutable external store owns active route, compact drawer, and visible compatibility errors.
- The Legacy Panel Adapter validates every required panel, navigation item, and real trigger before mount, then applies route visibility atomically.
- Existing bootstrap triggers remain the behavior authority; the App Shell delegates to them instead of copying Job, Arena, Store, Git, industrial, or conversation logic.
- Compact navigation at 720px is keyboard dismissible, restores focus, scrolls independently, and cannot cover modal controls.
- Wide layouts retain the established navigation while sharing the same typed route state.

## Evidence Infrastructure Finding

The first evidence attempt exposed a project-local `node_modules/.bin/npm` shadowing the invoking pnpm-compatible package manager. The attempt was retained as a failed local diagnostic only, then removed. `sanitizeEvidencePath()` now excludes that local bin from evidence subprocess lookup, a program-control regression check covers the boundary, and the clean rerun executed every command normally.

## Verification

The committed evidence manifest records 13 of 13 commands passing:

- `npm run build`
- `npm run verify`
- `npm run release:check`
- `node test/feature-tests.mjs`
- `npm run test:app-shell`
- `npm run test:renderer`
- `npm run test:security`
- `npm run test:dod`
- `npm run scan:dod`
- `npm run audit:prod`
- `npm run test:electron-e2e`
- `npm run test:program`
- `git diff --check`

Real Electron acceptance covers 720, 1024, 1440, and 1920 content widths, including drawer navigation through existing triggers, route synchronization, Escape focus restoration, modal layering, and horizontal geometry.

## Evidence

- Manifest: `reports/evidence/HC-UI-301/manifest.json`
- Captured source commit: `f25eab4c72bfff8a2a9e8b7f7ccfd6a2767cf1d6`
- Result: 13 passed, 0 failed
- DoD full-tree scan: 0 findings

## Implementation Commits

- `a3b8146` program boundary and risk registration
- `ce88e41` failure-first App Shell contract tests
- `f67f35e` typed App Shell core and build pipeline
- `0f4ce8f` legacy panel bridge and responsive Electron acceptance
- `27715f8` migration architecture and operator documentation
- `f25eab4` evidence subprocess command-resolution hardening

## Residual Boundary

HC-UI-301 does not claim that business panels have been rewritten in React. Conversation, sessions, timeline, inspector, Git, Store, Job Center, Arena, and industrial panels remain real legacy implementations behind the tested adapter. Their incremental migration is assigned to explicit later tasks, beginning with HC-UI-302.
