# HC-UI-312 Secure App Preview And Auto-Verification

Status: In Progress

Branch: `codex/desktop-ux/hc-ui-312`

Parent commit: `549fc629f7d7b46a3df04c3e7a9bc6ea4ce4435d`

Started: `2026-07-12T02:53:12Z`

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

## Planned Verification

- Focused preview service and URL policy tests.
- Renderer App Shell preview tests, including unavailable and failed-verification states.
- Security baseline and centralized IPC contract checks.
- Real Electron E2E with a local fixture server, blocked external navigation, DOM checks, screenshot evidence, close, and reopen.
- Build, verify, release check, feature tests, DoD/Skeleton scan, production audit, and clean-diff evidence.

## Rollback

Revert the HC-UI-312 implementation commits. Existing Runtime, editor, terminal, conversation, Diff Inspector, and legacy panels remain unchanged and continue to provide the pre-preview workflow.
