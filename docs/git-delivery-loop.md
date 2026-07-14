# Plan, Queue, Steer, And Git Delivery

HC-GIT-320 completes the local coding delivery loop without introducing a second Runtime or automatic repository mutation. The selected workspace, main-process Runtime queue, Job Center, Git service, and external GitHub CLI remain distinct authorities.

## Runtime Control

### Plan mode

Use the composer mode control to switch between normal execution and `计划`. A Plan prompt is submitted to the same main-process queue with `metadata.executionMode = "plan"`. The Runtime may inspect files and repository state, but mutating tools are denied at the tool-policy boundary before permission approval. Selecting full-access mode does not bypass the Plan read-only rule.

### Queued prompts

Submitting while a turn is active sends the prompt directly to the main process. `RuntimeJobQueue` assigns its durable ID and position; the renderer only displays the returned state. There is no renderer-side execution queue.

### Steer

While a turn is running, enter the revised instruction and choose `调整方向`. Hi Code:

1. records `runtime.steer.requested` on the active Job;
2. marks the active queue item cancelled;
3. aborts the current Runtime request;
4. inserts the new instruction immediately after the interruption and ahead of ordinary queued prompts.

Steer starts a follow-up turn. It does not claim to modify an already-running provider request in place. A cancelled turn remains cancelled after its handler settles.

## Local Git Workflow

The Git view operates only on the selected workspace repository.

1. Review changed files and worktree/staged diffs.
2. Stage or unstage explicit paths, or use the existing all-file controls.
3. Commit staged changes with a bounded message.
4. On a clean worktree, create a validated local branch or switch to an existing local branch.
5. Enter a PR title, base branch, optional body, and Draft choice.
6. Confirm the native dialog before Hi Code publishes an upstream branch or invokes `gh pr create`.
7. Refresh the collaboration section to read Pull Request and check status.

Branch creation, branch switching, and Pull Request creation refuse a dirty worktree. Hi Code never stashes, resets, cleans, force-checks out, rebases, force-pushes, merges, or enables auto-merge through this workflow.

## GitHub Prerequisites

Pull Request and CI features use the installed `gh` executable. Install and authenticate it outside Hi Code:

```bash
gh auth login
```

Hi Code uses the external GitHub CLI or operating-system credential store; it does not read or save GitHub tokens. Child processes receive only a minimal environment. Ambient model keys, source-control tokens, package tokens, cloud secrets, passwords, and `SSH_AUTH_SOCK` are excluded.

If `gh` is missing, the PR action is disabled and the UI explains the prerequisite. If authentication, network access, or an existing PR is missing, the exact state remains visible without printing credential values or secret environment names.

## CI State

The collaboration summary preserves these states:

- `passed`: all reported checks are successful or neutral/skipped as defined by GitHub.
- `failed`: at least one check failed, timed out, was cancelled, or requires action.
- `pending`: at least one check is queued, requested, waiting, or in progress and no failure is present.
- `skipped`: the individual check was skipped.
- `unknown`: GitHub returned no conclusive check state.

A failed or pending check is never promoted to success. An open Pull Request with no checks remains `unknown`.

## Failure And Recovery

- Ordinary Runtime exceptions are shown once, rethrown to the authoritative queue, and persisted as queue errors.
- User or Steer interruption is persisted as cancellation, not success or generic failure.
- Dirty Git state returns `dirty_worktree` and leaves every file untouched.
- Detached HEAD, invalid branch names, missing `origin`, failed publication, missing `gh`, missing login, malformed GitHub responses, and missing PR URLs fail closed.
- PR body content is not written to Runtime audit logs. Logs retain only bounded titles, branches, result codes, and redacted URLs/status.

## Verification

```bash
npm run build
npm run test:runtime-control
npm run test:git-collaboration
npm run test:services
npm run test:renderer
npm run test:security
npm run test:electron-e2e
npm run verify
npm run release:check
npm run scan:dod
```

The Electron test uses a real temporary Git repository for stage, commit, dirty protection, and branch operations. It deliberately does not create a remote Pull Request. PR argument construction and failed/pending CI behavior use a deterministic command-runner fixture against the production Git collaboration client.

## Non-goals

- Remote agent providers or hosted execution
- Automatic merge, rebase, force push, repository settings, or release publication
- Storage or management of GitHub credentials
- In-place mutation of a running provider request
- Replacement of Job Center, Worktree Runner, or Patch Arena
