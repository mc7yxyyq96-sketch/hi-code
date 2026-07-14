# HC-QA-101 Task Evidence

Status: Completed

Owner: Desktop UX

Release: `0.6.0-alpha.7`

Branch: `codex/desktop-ux/hc-qa-101`

Parent commit: `d30ec81`

## Problem

Renderer unit and smoke tests did not launch a real Electron process. Responsive CSS hid top actions below 820px and hid the timeline below 1180px, but there was no real-window test proving alternative controls remained reachable. Screenshot-only manual review had repeatedly missed clipping and inaccessible panels.

## Implementation

- Added Playwright as a development dependency and a real Electron harness.
- Isolated test user data and minimized inherited environment variables.
- Added 720/1024/1440 layout, navigation, brand, overflow, page-error, and screenshot assertions.
- Added responsive timeline and diff drawers backed by the existing panels and data.
- Added a Linux/Xvfb Electron smoke job with failure artifacts.
- Added commands and fixture-update documentation.
- Fixed workspace-brand wrapping and clipped top actions discovered by the real-window screenshots.
- Added project-level pnpm build-script authorization for the locked Electron and esbuild packages while retaining `package-lock.json` as the canonical CI lock.

## Scope Boundary

No runtime protocol, model execution, Job Center semantics, industrial adapter, provider, or user-data migration is changed. The drawers expose existing panel behavior; they do not create alternate data paths.

## Acceptance Evidence

Final commands, screenshots, environment, artifact hashes, and redacted log hashes are recorded in `reports/evidence/HC-QA-101/manifest.json`.

- Commands: 10 passed, 0 failed.
- Real Electron: production main/preload/renderer launched successfully.
- Widths: 720, 1024, and 1440 passed overflow, brand, navigation, and settings assertions.
- Panels: responsive timeline and diff drawers passed; desktop panels remained visible.
- Security: temporary `HOME`, `USERPROFILE`, and user data were verified; no sensitive parent-process environment key was inherited.
- DoD: unit and full-tree scans passed without weakening detection rules.
- Production dependencies: high-severity audit gate passed.

## Review

The mobile controls expose the existing timeline and diff panels rather than duplicating data or creating a mock path. At compact width, top actions are hidden only where the corresponding sidebar routes are interaction-tested. The test opens chat through local `/help`, so acceptance does not depend on a configured model or network endpoint. Remote Linux/Xvfb execution will become visible when this branch reaches GitHub CI; the same command passed locally on macOS arm64.

## Rollback

Revert the task commit to remove the harness and responsive drawer controls. No persistent user data is migrated. Do not remove only the tests while retaining unverified responsive CSS.
