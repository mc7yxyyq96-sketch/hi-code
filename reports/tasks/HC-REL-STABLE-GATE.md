# HC-REL-STABLE-GATE: Hi Code 0.6.0 Stable Release Gate

## Status

- Assessment implementation: **completed**
- Engineering baseline: **passed**
- Stable promotion decision: **blocked**
- Formal Release created: **no**
- Formal tag created: **no**
- Package version changed: **no** (`0.6.0-alpha.8`)

## Purpose

Evaluate the committed v0.6 engineering evidence against the stable-release conditions in `docs/program/EXECUTION_PLAN.md` without publishing, tagging, signing, changing risk state, or entering an industrial task.

## Implementation

- `scripts/stable-release-gate.mjs` reads committed task manifests, the three-platform HC-REL-420 CI matrix, Program Control state, risk state, and release policy documentation.
- Engineering requirements and promotion requirements are reported separately. Missing engineering evidence rejects the gate; missing external signing or unresolved release risk blocks promotion without rewriting a passing engineering result.
- `npm run release:stable-gate:assess` writes the JSON decision and Markdown report while returning success when the assessment itself is valid.
- `npm run release:stable-gate` uses strict mode and exits `2` unless the decision is `ready`.
- The evidence collector records strict exit `2` as the expected assertion for this known blocked decision. Every other evidence profile continues to require exit `0` by default.

## Stable Conditions

The evaluator checks:

1. Runtime Protocol v2 authority and client isolation.
2. Complete turn replay and conservative interrupted-turn recovery.
3. Linux, macOS, and Windows Electron smoke.
4. Linux, macOS, and Windows native package smoke.
5. Code Studio editor, terminal, preview, and Git delivery evidence.
6. HC-MCP-410 compatibility and security evidence.
7. Latest full-tree DoD/Skeleton result.
8. No open P0 or P1 board/audit work.
9. Truthful unsigned/update-disabled documentation.
10. macOS signing and notarization, Windows code signing, and stable update-chain evidence.
11. Disposition of open critical/high non-industrial release risks.

## Decision

Ten engineering conditions pass. Stable promotion remains blocked by:

- `RISK-REL-001`: Apple signing/notarization and Windows code-signing evidence are external prerequisites. HC-REL-420 CI artifacts are explicitly unsigned and update-disabled.
- `RISK-PROV-001`: Program Control still records a high open Provider capability risk. The evaluator reports it but does not change or downgrade it.

`RISK-REL-001` remains OPEN exactly as requested. No signing result, release publication, or tag is simulated.

## Security Review

- The evaluator is read-only except for its two repository-local report outputs.
- It does not read credentials, invoke a package publisher, create Git references, or mutate risk state.
- Git metadata is read with a minimal environment.
- Promotion is fail-closed when signature/notarization or platform update-chain evidence is absent, even if native package smoke succeeds.
- Open P0/P1 release-board work or current audit issues reject the engineering gate.
- A warning that artifacts are unsigned or update-disabled prevents signed-chain success.

## Integration Review

- **HC-REL-420:** unchanged; its manifests and CI matrix are consumed as evidence.
- **HC-MCP-410:** unchanged; its committed compatibility/security manifest is consumed as the latest engineering slice.
- **Desktop/CLI/TUI:** no production runtime code is modified by this task.
- **Release state:** `currentRelease` remains `0.6.0-alpha.8`; the stable gate records `blocked` independently from the completed assessment task.
- **Industrial scope:** no industrial task or adapter is changed.

## Tests And Evidence

Focused evaluator tests cover ready, blocked, and rejected outcomes; unsigned artifacts; open high risks; missing replay evidence; platform smoke failure; and report output without publication side effects.

The authoritative command, timing, digest, and result record is:

- `reports/evidence/HC-REL-STABLE-GATE/manifest.json`
- `reports/evidence/HC-REL-STABLE-GATE/gate-result.json`
- `reports/releases/0.6.0-stable/gate-report.md`

## Rollback

Revert the independent task commit. This removes only the evaluator, its tests, scripts, board entry, status entry, and evidence. It does not alter HC-REL-420, HC-MCP-410, package artifacts, Git tags, Releases, credentials, or risk state.
