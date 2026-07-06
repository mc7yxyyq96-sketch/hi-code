# Worktree Runner

Sprint 3B adds isolated execution for future multi-Agent and Provider workflows. The goal is to prevent Agent runs from writing into the main workspace by default.

## Design

Core implementation lives in `src/worktree-runner.ts`.

Main exports:

- `createIsolatedWorkspace`
- `runInIsolatedWorkspace`
- `collectChanges`
- `generatePatch`
- `cleanupWorkspace`
- `preserveWorkspaceOnFailure`
- `validatePatchPaths`
- `WorktreeRunner`

Electron IPC lives in `electron/services/worktree-service.mjs`.

IPC channels:

- `worktree:create`
- `worktree:run`
- `worktree:collectChanges`
- `worktree:cleanup`

All IPC calls pass through the shared IPC registrar and return normalized `{ ok, ... }` responses.

## Modes

`auto` is the default.

Mode selection:

1. Git worktree mode: preferred when the source is a clean Git repository and `git worktree` succeeds.
2. Copy sandbox mode: fallback when the source is not a Git repository or when `auto` cannot create a worktree.
3. Dry-run mode: records a plan and Job events without executing commands or modifying files.
4. Direct mode: only allowed when explicitly requested with `allowDirect`; it is not the default Provider path.

Provider runs use isolated mode by default. `hicode-internal` creates an isolated workspace, enqueues runtime execution with `metadata.executionCwd`, and lets the runtime execute inside that workspace.

## Safety Boundaries

- Main workspace dirty state is checked before Git worktree execution.
- Dirty Git sources are rejected by default unless the caller explicitly sets `allowDirty`.
- Worktree paths must be under the configured safe root, currently `~/.vibe/worktrees` in Electron.
- Copy sandbox paths must also stay under the safe root.
- Cleanup only removes paths with a matching `.hicode-worktree-runner.json` manifest.
- Cleanup refuses unmanaged paths.
- Patch paths are validated; absolute paths and `..` path segments are rejected.
- Provider direct mode requires explicit `executionMode: "direct"` plus `allowDirect: true`.

## Change Collection

`collectChanges` returns:

- changed files
- unified patch
- summary
- logs
- artifacts
- risk notes

Git worktree mode uses `git diff --binary HEAD --` and excludes the Worktree Runner manifest. Copy sandbox mode compares source and sandbox file snapshots and generates text patches.

Patch artifacts are stored under the runner safe root and registered as Job artifacts.

## Job Center Integration

Worktree Runner writes these events when applicable:

- `worktree.created`
- `worktree.command.started`
- `worktree.command.finished`
- `worktree.patch.collected`
- `worktree.patch.failed`
- `worktree.cleaned`
- `worktree.cleanup.failed`
- `worktree.preserved`

Provider runs also write Provider events:

- `provider.run.started`
- `provider.run.queued`
- `provider.run.failed`
- `provider.run.dry_run`

Provider execution metadata includes:

- `jobCenterId`
- `providerId`
- `providerRunId`
- `executionCwd`
- `isolatedWorkspace`
- `isolatedWorkspaceMode`

## Failure Preservation

If collection or cleanup fails, the runner returns the preserved workspace path and writes a Job event. Failed command runs are preserved instead of cleaned automatically.

Successful Provider runs currently collect patch artifacts and clean the isolated workspace unless `preserveWorkspace` is requested.

## Validation

Required commands:

```bash
npm run build
npm run verify
node test/worktree-runner-tests.mjs
node test/provider-tests.mjs
node test/feature-tests.mjs
```
