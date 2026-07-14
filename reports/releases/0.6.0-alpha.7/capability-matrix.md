# Hi Code 0.6.0-alpha.7 Capability Matrix

Status: Release candidate verified

| Capability | Delivery state | Evidence | Public claim boundary |
| --- | --- | --- | --- |
| Program control and immutable baseline | Implemented | `reports/evidence/baseline/manifest.json` | Auditable local program board and hashed command evidence |
| Responsive Electron desktop shell | Implemented | `reports/evidence/HC-QA-101/manifest.json` | Real Electron launch and core-action reachability at 720, 1024, and 1440 content widths |
| Protocol-native assistant streaming | Implemented | `reports/evidence/HC-RUN-201/manifest.json` | Assistant deltas and completions reach Electron, CLI, and TUI without stdout as the model transport |
| Parallel runtime output isolation | Implemented | `test/runtime-concurrency-tests.mjs` | Interleaved sessions retain separate events and transcripts |
| Append-only runtime protocol log | Implemented | `src/runtime-event-store.ts` | Runtime events are persisted as validated JSONL before delivery |
| Full event-only context reconstruction | Not delivered in this release | `planning/backlog.json` (`HC-RUN-202`) | Event-only sessions may be inspected, but resumable model context still requires session JSON |
| External Codex and Claude providers | Not configured | `docs/agent-providers.md` | Provider slots exist; this release does not claim working external CLI integration |
| Industrial adapters | Mixed real detection, real draft generation, and explicit dry-run | Adapter tests and per-adapter documentation | Commercial or unavailable tools remain `simulated`, `not_run`, or `external_required` |
| Signed cross-platform distribution | Not delivered in this release candidate | `planning/backlog.json` (`HC-REL-420`) | Local development builds are supported; signed production installers are not claimed |

The matrix is intentionally narrower than the complete product backlog. A capability is listed as implemented only when its production path and acceptance evidence exist.
