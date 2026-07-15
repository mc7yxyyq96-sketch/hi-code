# HC-UX-430 Integration Review

## Decision

Accepted. The clean implementation commit
`3de0b62be1bb2080b9885e1a35fcf1d545ebd03d` passed all 14 commands recorded in
`reports/evidence/HC-UX-430/manifest.json`. `RISK-UX-007` is closed by this
evidence; Customer Value Preview remains gated by HC-ONB-431 and HC-DIAG-432.

## Compatibility Review

- Existing Runtime, Provider, MCP, Job Center, industrial panels, and release
  gates are unchanged.
- Existing preload methods remain available; two bounded event subscriptions
  were added for native commands and Store refresh notifications.
- Store installation validation and installed-state authority are unchanged.
- Permission modes and tool-level session approval remain compatible.
- No HC-ONB-431, HC-DIAG-432, Fusion, Computer Use, or industrial scope was
  implemented early.

## Security Review

- Native menus expose a closed command set and native Electron roles only.
- Exact permission memory is process-local, hashed, action-sensitive, and
  approval-only.
- Store cache persistence is owner-only, bounded, atomic, and carries no secret
  or process-execution capability.
- Renderer event payloads are validated and bounded before dispatch.
- Existing context isolation, sandbox, Node isolation, CSP, workspace limits,
  and child-process policy remain unchanged.

## Acceptance Review

Focused tests cover permission deduplication, menu roles, execution profile
derivation, Store cache replacement/expiry/bounds, virtual range behavior, and
responsive design metadata. Real Electron E2E covers native menu interactions,
profile-card visibility and bounds, Store cold/cache timing, bounded rendered
rows, and screenshot regression at 720/800/1100/1440/1920.

The evidence profile passed with 14/14 commands, zero failed commands, and a
zero-finding full-tree DoD scan. Program Control independently verifies the
task and board state, implementation commit, command set, log existence, log
hashes, risk closure, and reproducible evidence script.
