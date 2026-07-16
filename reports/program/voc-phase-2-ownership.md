# VOC Phase 2 File Ownership

Recorded: 2026-07-16

Source checkpoint: `55506620929d61ece5059032ebf9e4b571a17a51`

## Exclusive Ownership

| Owner | Branch | Exclusive scope |
| --- | --- | --- |
| HC-ONB-431 | `codex/desktop-ux/hc-onb-431` | Onboarding pages and components, tutorial state machine, simple/expert mode domain state, sample-project wizard and templates, onboarding renderer tests and Electron E2E fixtures, `docs/user/getting-started.md`, `docs/user/simple-mode.md`, task report and evidence |
| HC-DIAG-432 | `codex/runtime-engine/hc-diag-432` | Doctor core and schema, capability probes, diagnostics service and UI component, support-bundle implementation, diagnostics/security tests, `docs/user/system-diagnostics.md`, `docs/development/doctor-schema.md`, task report and evidence |
| Integration & Review | `codex/integration-review/voc-phase-2` | Electron Help menu, Renderer router and navigation registry, preload API, IPC registry, command registry, package scripts, combined E2E, compatibility review, and VOC Phase 2 gate reports |

## Shared-File Rules

1. Task branches do not independently rewrite shared registries.
2. Task-owned modules expose typed registration descriptors or service methods that the integration branch consumes.
3. Shared files are changed only after both task commits are reviewed on the dedicated integration branch.
4. Neither task branch may contain the other task's implementation or revert retained work from HC-PROV-301 or HC-UX-430.
5. Each task must finish with an independent clean commit, tests, task report, evidence manifest, and Integration Review input.
6. Simulated, `not_run`, `external_required`, unavailable, and approval-required states remain explicit and may not be promoted to effective or passed.

## Merge Order

1. Review HC-ONB-431 implementation and evidence.
2. Review HC-DIAG-432 implementation and evidence.
3. Integrate both commits into `codex/integration-review/voc-phase-2`.
4. Add shared menu, route, IPC, preload, command, and script registrations.
5. Run the complete VOC Phase 2 gate and publish only a `PASS` or `FAIL` result.
