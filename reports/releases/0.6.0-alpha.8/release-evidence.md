# Hi Code 0.6.0-alpha.8 Release Evidence

Status: Candidate verification in progress

## Included Task Evidence

- Typed runtime store and reconstruction: `reports/evidence/HC-RUN-202/manifest.json`
- Turn recovery and approval safety: `reports/evidence/HC-RUN-203/manifest.json`
- Electron supported line and local package: `reports/evidence/HC-PLAT-110/manifest.json`
- Linux, macOS, and Windows startup matrix: `reports/evidence/HC-PLAT-110/ci-matrix.json`
- Release integration task: `reports/tasks/HC-REL-ALPHA-8.md`

## Candidate Capture

`npm run program:evidence:alpha8` runs 13 commands in the isolated release worktree: build, global verification, release verification, feature tests, Electron compatibility, security, DoD unit tests, full-tree DoD scan, production dependency audit, real Electron E2E, unsigned macOS packaging, program-control checks, and whitespace validation.

The capture writes redacted logs and SHA-256 artifact bindings to `reports/evidence/HC-REL-ALPHA-8/manifest.json`. The candidate cannot be marked passed until every command succeeds and the manifest is independently checked. A passed candidate is still not a formal release, tag, signed package, notarized package, or public promotion.
