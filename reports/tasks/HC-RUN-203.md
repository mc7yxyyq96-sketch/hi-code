# HC-RUN-203 Task Manifest

Status: Completed

Owner: Runtime Engine

Release: `0.6.0-alpha.8`

Branch: `codex/runtime-engine/hc-run-203`

Parent commit: `9245a0a57f71b6e56157260c5bcb45776bfa0f96`

Started: `2026-07-10T16:13:35Z`

Completed: `2026-07-10T17:32:06Z`

Evidence: `reports/evidence/HC-RUN-203/manifest.json`

## Problem

Durable events can identify interrupted work, but the current recovery list offers the same raw retry for model failures, unanswered approvals, and tools with unknown side effects. Approval decisions are not durably paired with requests, and streamed partial output is not part of the recovery plan.

## Outcome

Implement a deterministic turn state reducer and conservative recovery planner that preserves partial output, records approval resolution, restores the source session before safe retries, and blocks one-click replay when tool side effects are unknown.

## Scope

- Typed turn lifecycle and recovery action model.
- Protocol-derived state reduction and partial-output projection.
- Durable `approval.resolved` events linked to request events.
- Safe classification of model, approval, read-only tool, and mutating-tool interruption.
- Additive recovery fields through existing IPC and renderer UI.
- Session-aware safe retry and review-only/blocked UI states.
- Unit, runtime integration, renderer, security, and migration compatibility tests.

## Out Of Scope

- Automatic background retry without a user action.
- Tool compensation or rollback beyond existing diff undo.
- Reattaching to an operating-system process after Hi Code exits.
- Provider-specific continuation tokens, distributed workers, or Job DAG recovery.
- HC-PROV-210, HC-UI-301, and industrial domain changes.

## Interfaces

- `reduceTurnState(events)` returns one typed state for a turn.
- `buildRecoveryPlan(events)` returns the safe action and user-facing reason.
- `RecoverableTask` adds phase, recovery action, retry safety, approval, tool, and partial-output metadata.
- Legacy `permission:resolved` maps to protocol `approval.resolved` with request ID and decision validation.
- `recoverable-tasks:list` remains the existing bounded read API.

## Persistence And Migration

No destructive migration is required. New protocol events append to legacy JSONL and typed EventStore. Old streams without resolution events are treated as unanswered approval or unknown tool state, never guessed as allowed.

## Security

Recovery cannot reuse approvals, execute an unknown tool, or auto-retry a turn after a mutating/external side effect. Partial output is bounded. Existing workspace, permission, child-process environment, and Electron IPC boundaries remain unchanged.

## Tests

- State transition table and terminal-state tests.
- Streaming crash and partial-output preservation.
- Waiting approval and resolved approval fixtures.
- Unknown tool execution and completed mutating-tool blocking.
- Read-only tool retry fixture.
- Real runtime approval request/resolution event pairing.
- Renderer retry restores source session and blocked plans do not execute.
- Full build, verify, release check, feature, security, DoD, storage, and Electron E2E gates.

## Rollback

Revert HC-RUN-203 commits. Existing events remain protocol-valid except that older binaries ignore additive `approval:resolved` records. No session, event, message, artifact, or user file is deleted.

## Result

- Deterministic recovery states and actions are implemented in production code.
- Approval request/resolution pairs preserve both protocol request identity and legacy timeline parent identity.
- Append-only integration fixtures verify streamed partial output, unanswered approval, and unknown tool execution after process loss.
- Renderer actions restore the source session and block replay-only or side-effect-unknown retries.
- The evidence manifest records 18 passing commands, 23 hashed key artifacts, real Electron acceptance, and zero failed gates.

## Commit Plan

1. Turn state reducer, recovery planner, protocol event, and focused tests.
2. Runtime approval pairing and renderer-safe recovery behavior.
3. Global gates, documentation, program state, and evidence.
