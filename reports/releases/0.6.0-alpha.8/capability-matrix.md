# Hi Code 0.6.0-alpha.8 Capability Matrix

Status: Candidate verification in progress

| Capability | Delivery state | Evidence | Public claim boundary |
| --- | --- | --- | --- |
| Typed thread, event, and message stores | Implemented | `reports/evidence/HC-RUN-202/manifest.json` | Exact model messages and protocol events persist in confined owner-only app data |
| Event-derived model-context reconstruction | Implemented for complete normalized streams only | `test/runtime-store-integration-tests.mjs` | Complete normalized streams can resume without session JSON; older incomplete streams remain replay-only |
| Idempotent legacy import | Implemented | `test/runtime-store-tests.mjs` | Session JSON and runtime JSONL are imported additively and are never deleted by migration |
| Conservative interrupted-turn recovery | Implemented | `reports/evidence/HC-RUN-203/manifest.json` | Safe model/read-only retries require a user action; unknown or completed mutating effects are blocked |
| Approval resolution persistence | Implemented | `test/turn-recovery-tests.mjs` | Recovery does not reuse an earlier approval decision |
| Supported Electron runtime | Implemented | `reports/evidence/HC-PLAT-110/manifest.json` | Electron 43.1.0, Chromium 150, and Node 24 embedded runtime are pinned and checked |
| Linux, macOS, and Windows startup smoke | Implemented in CI | `reports/evidence/HC-PLAT-110/ci-matrix.json` | Real production Electron entrypoint starts on the three CI platforms; this is not an installer-signing claim |
| macOS alpha packaging | Implemented locally, unsigned | `reports/evidence/HC-PLAT-110/manifest.json` | An arm64 DMG can be generated; Gatekeeper trust, signing, and notarization are not claimed |
| External Codex and Claude providers | Not configured | `docs/agent-providers.md` | Registry entries do not mean the external CLIs are executable providers |
| Commercial industrial integrations | External bridge only | Adapter documentation and tests | SolidWorks and AVEVA require licensed external environments, explicit approval, and external execution |

Implemented means a production path and acceptance evidence exist. It does not mean every planned Provider, editor, packaging, or industrial capability is part of this candidate.
