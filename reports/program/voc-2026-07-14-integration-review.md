# VOC-2026-07-14 Integration Review

## Decision

Accepted into Program Control. The change adds a customer-value stabilization lane and one ECAD flagship vertical without reopening completed Provider, MCP, security, release-pipeline, or Stable Gate work.

## Verified Starting Point

- Source branch: `codex/program-control/voc-2026-07-14`
- Parent commit: `d85216c9428ae8d7836714bc14bd15f3e6baa8fe`
- HC-PROV-301: completed; `RISK-PROV-001` remains closed.
- HC-MCP-410, HC-SEC-402, and HC-REL-420: completed with their existing evidence unchanged.
- Stable engineering status: `PASS_INTERNAL_ONLY`.
- Formal stable promotion: still blocked only by `RISK-REL-001`.
- Baseline before edits: build, verify, release check, 80 feature tests, 1408 Program Control checks, and DoD scan passed.

## Scope Review

The backlog retains every historical task and adds the requested UX, onboarding, diagnostics, Fusion, Computer Use, Industrial Graph v2, electrical graph, ECAD intelligence, connector, and flagship-demo tasks. `HC-IND-510` is retained as historical work and marked superseded by `HC-ECAD-530`; it was not deleted or rewritten.

The release board and customer-value roadmap enforce this sequence:

1. Customer-value stabilization: HC-UX-430, HC-ONB-431, HC-DIAG-432.
2. Fusion and secure Computer Use: HC-FUS-440, HC-CU-450.
3. Industrial graph foundation: HC-IND-501.
4. Licensed Worker and electrical graph: HC-IND-502, HC-ECAD-520.
5. ECAD design and data intelligence: HC-ECAD-521, HC-ECAD-522.
6. ECAD manufacturing and vendor connectors: HC-ECAD-523, HC-ECAD-524.
7. Control Cabinet Full Demo 3.0 and Industrial Preview Gate: HC-ECAD-530.

## Safety and Truthfulness Review

- Existing security, DoD, Skeleton Detector, and release gates are unchanged.
- Commercial connectors retain explicit `real`, `simulated`, `not_run`, `external_required`, `unsupported`, and `approval_required` states.
- Machine-specific manufacturing output remains behind postprocessing, schema validation, approval, and checksum requirements.
- Computer Use remains behind HC-SEC-402 and HC-DIAG-432.
- Industrial implementation remains behind Fusion and secure Computer Use.
- `RISK-REL-001` remains open; this review does not claim signing, notarization, or formal stable promotion.

## Automated Contract

`test/program-control-tests.mjs` now verifies:

- all VOC tasks exist in both backlog and release board;
- every dependency resolves to a retained task;
- Provider, MCP, release pipeline, and Stable Gate completion cannot be reopened by this change;
- the accepted dependency order is preserved;
- Store latency, responsive-width, onboarding, and truth-state targets remain measurable;
- every planned task has a distinct worktree branch;
- new delivery risks are explicitly tracked.

## Validation

- JSON schemas/syntax: passed for backlog, release board, customer-value roadmap, and risk register.
- `node --check test/program-control-tests.mjs`: passed.
- `git diff --check`: passed.
- `CI=true npm run test:program`: 1465 passed, 0 failed.
- `CI=true npm run build`: passed.
- `CI=true npm run verify`: passed.
- `CI=true npm run release:check`: passed.
- `CI=true node test/feature-tests.mjs`: 80 passed, 0 failed.
- `CI=true npm run scan:dod`: passed with 0 findings.

The repository gates were rerun after the final Program Control contract was added. No completed task was reopened and no security, DoD, Skeleton Detector, or release rule was relaxed.
