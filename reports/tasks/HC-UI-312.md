# HC-UI-312 Secure App Preview And Auto-Verification

Status: Completed

Branch: `codex/desktop-ux/hc-ui-312`

Parent commit: `549fc629f7d7b46a3df04c3e7a9bc6ea4ce4435d`

Started: `2026-07-12T02:53:12Z`

Completed: `2026-07-12T05:41:01Z`

## Scope

Deliver a recoverable local application preview inside the existing typed App Shell. A centralized main-process preview manager will own local server registrations and isolated preview WebContents, enforce loopback-only origins, prevent external navigation and popups, and capture bounded screenshot and DOM verification evidence without exposing Electron or Node capabilities to previewed content.

This task does not implement Git/PR/CI orchestration, remote browser automation, internet-hosted previews, industrial adapters, signing, or release promotion.

## Acceptance Contract

- A user can register or open an HTTP application served from an explicit loopback address and see it in an isolated preview surface.
- Preview WebContents use context isolation, disabled Node integration, sandboxing, no preload bridge, denied popup/download/permission requests, and an origin allowlist.
- Navigation outside the registered loopback origin fails closed and provides a visible diagnostic.
- Preview ownership is bound to the creating window and workspace; switching workspace or closing the owner tears down its preview resources.
- Closing and reopening a preview is recoverable without retaining stale WebContents or server records.
- Screenshot and DOM verification produce bounded evidence with timestamps and explicit pass/fail checks; a failed check is never reported as passed.
- Browser-only renderer mode exposes an unavailable reason rather than a fake preview.

## Baseline

- Real entrypoints remain `electron/main.mjs`, `electron/preload.cjs`, `renderer/index.html`, and `renderer/renderer.js` with the typed App Shell loaded through the established renderer bootstrap.
- Package version is `0.6.0-alpha.8`.
- `npm run verify`: passed from clean parent commit before task-state changes.
- HC-UI-311 committed evidence remains 18/18; the historical HC-RUN-220 long-duration evidence is reused and is not rerun for this task.

## Security Design Constraints

- The trusted Hi Code renderer never navigates to preview content.
- Previewed content receives no preload API, Node integration, Electron remote access, clipboard/session permission, download path, or popup capability.
- Only canonical loopback HTTP URLs with validated ports are accepted; credentials, fragments, non-loopback hosts, and non-HTTP schemes are rejected.
- All preview operations use typed, bounded IPC payloads and owner/workspace authorization.
- DOM and screenshot capture are bounded, redacted where required, and stored only in the task's approved app-data evidence directory.
- Cleanup is idempotent and may destroy only preview resources created by the manager.

## Implementation

- `electron/services/preview-service.mjs` owns canonical URL validation, isolated BrowserWindow creation, owner/workspace lifecycle, permission/network/navigation policy, reload/reopen, bounded DOM inspection, PNG capture, and atomic evidence writes.
- `electron/preload.cjs` and `renderer/app-shell/preview/api.ts` provide a bounded typed bridge with no generic IPC or native window authority.
- `renderer/app-shell/preview/PreviewPortal.tsx` provides registration, selection, reload/reopen, verification, blocked-navigation diagnostics, evidence display, close, and remove actions through real service calls.
- Workspace change, renderer owner close, renderer-process failure, and application quit destroy live preview windows. Closed records can be reopened without reusing stale WebContents.
- `docs/secure-app-preview.md` and ADR-0014 define the supported loopback-only behavior and security boundary.

## Verification

Machine-captured evidence from clean implementation commit `d1138ab3583bb22117fb2e097acbd76e986b00e2` records 15/15 passing gates:

- build, service, App Shell, renderer, security, verify, release check, feature, DoD, full-tree DoD, production audit, program-control, and clean-diff checks
- 20 focused App Preview checks: 12 service and 8 typed renderer checks
- real Electron E2E for isolation, blocked popup/navigation, disabled DevTools, reload, PNG/JSON evidence, compact layout, close, reopen, and removal

GitHub Actions run `29181437110` for Draft PR #16 passed the general test job and real Electron smoke on Ubuntu, macOS, and Windows. The completed historical HC-RUN-220 long-duration evidence was not rerun.

## Evidence

- Implementation commit: `d1138ab3583bb22117fb2e097acbd76e986b00e2`
- Local evidence commit: `dd7655eb6a4d304224b884588930047cd66ce06f`
- Local evidence: `reports/evidence/HC-UI-312/manifest.json`
- CI evidence: `reports/evidence/HC-UI-312/ci-matrix.json`
- Draft PR: `https://github.com/mc7yxyyq96-sketch/hi-code/pull/16`

## Acceptance Result

- A real local application opens only from a canonical loopback HTTP URL in an isolated child window.
- Preview content has no Hi Code preload, Node integration, DevTools, permissions, download, popup, webview, or external navigation authority.
- Lifecycle ownership, reload, close, reopen, workspace change, owner close, crash cleanup, and application quit are covered.
- DOM and screenshot evidence is bounded, owner-only, timestamped, and truthful; missing checks remain failed.
- Browser-only mode fails closed with an actionable reason.

## Captured Verification Contract

- Focused preview service and URL policy tests.
- Renderer App Shell preview tests, including unavailable and failed-verification states.
- Security baseline and centralized IPC contract checks.
- Real Electron E2E with a local fixture server, blocked external navigation, DOM checks, screenshot evidence, close, and reopen.
- Build, verify, release check, feature tests, DoD/Skeleton scan, production audit, and clean-diff evidence.

## Rollback

Revert the HC-UI-312 implementation commits. Existing Runtime, editor, terminal, conversation, Diff Inspector, and legacy panels remain unchanged and continue to provide the pre-preview workflow.
