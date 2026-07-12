# ADR-0015: Authoritative Coding And Git Delivery Loop

Status: Accepted

Date: 2026-07-12

## Context

Hi Code already had Runtime execution, a persisted queue, Job Center records, and local Git status/diff/stage/commit operations. The desktop renderer also retained historical local queue behavior, interruption could later be overwritten as success, and branch/PR/CI delivery was not one protected workflow. Those gaps make a coding agent difficult to steer and make delivery state easy to misread.

The product needs Plan, queued prompts, steering, commit, Pull Request, and CI state without adding a second Runtime, storing GitHub credentials, silently modifying a dirty worktree, or claiming that an interrupted model request was mutated in place.

## Decision

1. Keep `RuntimeJobQueue` in the main process as the only execution-order authority. The renderer submits every prompt immediately and only projects queue state.
2. Store `executionMode` in queue and Job Center metadata. Plan mode enforces a read-only tool boundary before permission handling, including when a user selected a high-trust execution mode.
3. Define Steer as a truthful interrupt-and-follow-up operation. It records `runtime.steer.requested`, marks the active queue item cancelled, aborts the current Runtime, and inserts the new instruction at the front of the pending queue. It does not claim unsupported in-stream mutation.
4. Preserve explicit cancellation when a handler settles. A cancelled job cannot be rewritten to `done` or `error`; ordinary failures must still be rethrown to and persisted by the authoritative queue.
5. Keep Git and GitHub ownership in the main process. Renderer and preload receive bounded typed operations, never an executable, shell string, arbitrary `cwd`, credential, or generic IPC method.
6. Refuse branch creation, branch switching, and Pull Request creation while the selected repository is dirty. Existing stage and commit actions remain available to resolve that state.
7. Create Pull Requests only after a fresh native confirmation. If the branch has no upstream, allow only non-force `git push --set-upstream origin HEAD`; never auto-merge.
8. Use the external `gh` credential store. Git and GitHub child processes receive a minimal environment with interactive prompts disabled; Hi Code does not inherit or persist ambient tokens or `SSH_AUTH_SOCK`.
9. Normalize PR checks without promoting failures, pending work, skipped work, or unknown conclusions. Missing `gh`, missing authentication, no PR, and network failures remain visible and actionable.

## Consequences

- Queued prompts, Plan runs, and Steer follow-ups share one durable order and Job Center trail.
- Steering is recoverable but starts a new turn; it is not an in-place edit of provider context.
- Git delivery cannot switch away from or publish over uncommitted user work through these controls.
- SSH-agent-only pushes may require a separately authorized future credential route because `SSH_AUTH_SOCK` is intentionally excluded.
- GitHub CLI installation and authentication remain user-managed prerequisites. Local Git work continues without them.
- This workflow creates or updates branches and Draft Pull Requests only when requested. Merge, rebase, force push, release publication, and repository settings remain outside its authority.

## Rejected Alternatives

- **Renderer-owned prompt queue:** rejected because it creates hidden state and prevents consistent persistence and recovery.
- **Treat Steer as model-context mutation:** rejected because current transports cannot guarantee it and would produce false execution history.
- **Overwrite cancellation after the handler returns:** rejected because an interrupted turn would appear successful.
- **Run Git through shell command strings:** rejected because branch and PR text would become command syntax.
- **Pass the complete parent environment to Git or `gh`:** rejected because model, package, cloud, or source-control secrets could leak to child processes or logs.
- **Automatically stash, reset, force push, or merge:** rejected because these actions can conceal or overwrite user work.
- **Infer CI success from an open PR:** rejected because PR state and check conclusions are independent.

## Verification And Rollback Gates

- Runtime queue tests prove Plan read-only enforcement, next-position steering, failure persistence, and cancellation preservation.
- Real temporary-repository tests prove dirty protection, validated branch operations, bounded PR arguments, minimized child environments, and truthful failed/pending CI normalization.
- Service, preload, renderer, and security tests cover typed IPC, native PR confirmation, actionable GitHub failures, and disabled unavailable actions.
- Real Electron E2E completes Plan/queue/Steer and local stage/commit/branch actions at supported compact and desktop widths. Deterministic PR/CI responses are tested through the same core client with an injected external-command runner; E2E does not create a real remote PR.
- Full build, verify, release check, DoD scan, production audit, and three-platform CI must pass.

Rollback removes the new Git collaboration channels and UI, restores the prior queue settlement behavior, and leaves existing Runtime input, local Git status/diff/stage/commit, Job Center, editor, terminal, and preview behavior available. No user-data migration is required.
