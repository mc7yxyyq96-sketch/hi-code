# Patch Arena

Patch Arena lets one Hi Code task produce one or more isolated candidate patches, run quality gates, then wait for an explicit user decision before merging anything into the main workspace.

## Data Model

Core model lives in `src/patch-arena.ts`.

- `ArenaRun`: one user task, provider selection, source workspace, Job Center link, candidate list, decisions, and artifacts.
- `ArenaCandidate`: one provider execution result, isolated workspace metadata, patch, score, gates, logs, artifacts, and risk notes.
- `CandidatePatch`: patch file path, changed files, summary, size, and hash.
- `CandidateScore`: aggregate score from gate failures, warnings, risky files, security-sensitive files, and changed file count.
- `CandidateGateResult`: per-candidate gate result with status, command, exit code, duration, and metadata.
- `MergeDecision`: explicit accept, reject, or merge record.

Statuses are intentionally small:

- Run: `queued`, `running`, `ready`, `failed`, `cancelled`, `merged`
- Candidate: `queued`, `running`, `ready`, `rejected`, `merged`, `failed`
- Gate: `passed`, `failed`, `warning`, `skipped`

## Execution Flow

Electron service implementation lives in `electron/services/patch-arena-service.mjs`.

1. Renderer sends `arena:create` with a task and provider IDs.
2. The service creates a Job Center job with source `patch-arena`.
3. Each provider gets a separate Worktree Runner workspace.
4. The provider command runs inside that isolated workspace.
5. Worktree Runner collects a patch and changed file summary.
6. Patch Arena runs quality gates and writes candidate artifacts.
7. The run becomes `ready` when at least one candidate is collected.
8. The user can accept, reject, or explicitly merge a candidate.

External providers such as `codex-cli` and `claude-code` remain `not_configured` until their adapters are implemented. Patch Arena refuses unavailable providers instead of pretending they ran.

## IPC API

- `arena:list`
- `arena:get`
- `arena:create`
- `arena:acceptCandidate`
- `arena:rejectCandidate`
- `arena:mergeCandidate`
- `arena:artifact:preview`
- `arena:artifact:open`

All calls go through `electron/ipc/ipc-utils.mjs` so errors are normalized and sensitive text is redacted.

## Artifacts

Each candidate writes:

- `changes.patch`
- `summary.json`
- `changed-files.json`
- `logs.txt`
- `gate-results.json`

Artifacts are saved under `~/.vibe/patch-arena/artifacts/<runId>/<candidateId>/` or the managed Worktree Runner safe root for collected patches. Job Center also records these artifact paths.

## Gates

Sprint 3C gates:

- Syntax check for changed JavaScript files
- `npm run build` when `package.json` has a `build` script and `npm` exists
- `node test/feature-tests.mjs` when present, otherwise `npm run test` when available
- Changed files summary
- Risky file detection
- Security-sensitive file detection

Missing local tools or scripts are reported as `skipped` or `warning`; they are not treated as successful real execution.

## Merge Safety

Patch Arena never auto-merges.

Before merge:

- The user must call `arena:mergeCandidate`.
- The candidate must have a patch artifact.
- Patch paths are validated with Worktree Runner path checks.
- The main workspace must be a clean Git workspace.
- `git apply --check` must pass before `git apply`.

On failure, the patch file and decision record are retained. The service writes a Job Center event for both successful and failed merge attempts.

## Renderer

The UI panel lives in `renderer/components/patch-arena-panel.js` and is mounted from `renderer/app/bootstrap.js`.

The panel supports:

- Creating a run
- Selecting enabled providers
- Listing runs and candidates
- Previewing patch artifacts
- Reading logs and gate results
- Accepting, rejecting, and merging candidates

## Validation

```bash
npm run build
npm run verify
node test/feature-tests.mjs
node test/patch-arena-tests.mjs
```
