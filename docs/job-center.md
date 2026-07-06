# Job Center

Sprint 2A introduces the core Job Center model. It is a local, persistent tracking layer for future Hi Code engineering work: runtime prompts, agent work, tool calls, tests, reviews, releases, and later industrial tool runs. This sprint only adds the model, store, IPC, tests, and documentation. Later sprints connect Provider runs, Worktree Runner operations, and Patch Arena candidates through Job Center events, artifacts, and gate results.

## Storage

The Electron app stores Job Center data in:

```text
~/.vibe/jobs/job-center.json
```

The file is JSON with `schemaVersion: 1` and an array of jobs. The store creates parent directories with private permissions and writes the file with `0600` where the filesystem supports it.

## Data Model

Types are defined in `src/job-center.ts`.

- `Job`
  - Top-level tracked engineering unit.
  - Includes `id`, `title`, `status`, `source`, `trigger`, `actor`, `executor`, `cwd`, timestamps, `tasks`, `artifacts`, `events`, `gateResults`, `approvals`, and `retryCount`.
- `Task`
  - A unit of work inside a job.
  - Includes `id`, `title`, `status`, owner/executor fields, timestamps, `steps`, artifact references, and gate result references.
- `TaskStep`
  - A concrete step inside a task.
  - Includes `id`, `title`, `status`, optional command, executor, timestamps, error, artifact references, and gate result references.
- `Artifact`
  - A produced file or output.
  - Includes `id`, `type`, `path`, optional `name`, `mimeType`, `size`, `sha256`, producer metadata, and timestamp.
- `JobEvent`
  - Append-only job event log entry.
  - Includes `id`, `jobId`, `type`, `message`, `createdAt`, actor, task/step references, status, and structured data.
- `GateResult`
  - Quality gate result, such as build, test, review, lint, release, or future industrial validation.
  - Includes `id`, `gate`, `status`, message, score, task/step references, artifact references, timestamp, and metadata.
- `ApprovalRecord`
  - Permission or approval record for future human-in-the-loop flows.
  - Includes `id`, `status`, requester/decider fields, timestamps, scope, reason, and metadata.

## Status Machine

Job statuses:

- `queued`
- `running`
- `paused`
- `waiting_approval`
- `succeeded`
- `failed`
- `cancelled`

Allowed transitions:

| From | To |
| --- | --- |
| `queued` | `running`, `paused`, `cancelled` |
| `running` | `waiting_approval`, `paused`, `succeeded`, `failed`, `cancelled` |
| `paused` | `queued`, `cancelled` |
| `waiting_approval` | `running`, `paused`, `failed`, `cancelled` |
| `succeeded` | terminal |
| `failed` | terminal, except `retryJob()` requeues it |
| `cancelled` | terminal, except `retryJob()` requeues it |

Illegal transitions throw and are normalized by IPC into `{ ok: false, error }`.

Task and step statuses use the same status vocabulary in Sprint 2A so future Job Center UI can group job, task, and step state consistently.

## Job Store API

`JobStore` supports:

- `createJob(input)`
- `getJob(id)`
- `listJobs(options)`
- `updateJob(id, patch)`
- `appendJobEvent(id, event)`
- `addArtifact(id, artifact)`
- `addGateResult(id, gateResult)`
- `cancelJob(id, reason, actor)`
- `retryJob(id, actor)`
- `pauseJob(id, actor)`
- `resumeJob(id, actor)`

Runtime Queue compatibility:

- Existing `RuntimeJobQueue` remains in place.
- Runtime input creates a Job Center job with `source: "runtime_queue"`.
- Runtime Queue jobs carry `metadata.jobCenterId`.
- Queue state changes mirror into Job Center status transitions.
- Runtime tool events append `runtime.*` job events.
- Runtime diffs are recorded as `Artifact` entries of type `diff`.

Patch Arena compatibility:

- Arena runs create a Job Center job with `source: "patch-arena"`.
- Candidate workspace creation, command execution, patch collection, cleanup, accept/reject, and merge decisions append `arena.*` job events.
- Candidate patch, summary, changed-file, log, and gate artifacts are recorded as Job Center artifacts.
- Candidate quality checks are recorded as `GateResult` entries with candidate metadata.

Industrial Project compatibility:

- Creating or editing `.hicode/project.json` creates a Job Center job with `source: "industrial-project"`.
- Artifact additions append `industrial.artifact.added` events and record the project file as an artifact.
- Quality gate additions append `industrial.gate.result` events and write Job Center gate results when the status maps to the Job Center gate status vocabulary.
- Requirement Builder and Spec Builder operations append `industrial.requirement.*` events, record generated spec documents as artifacts, and record user confirmations as Job Center approval records.

## IPC API

Registered through `electron/services/job-service.mjs` and `electron/ipc/register-ipc-handlers.mjs`.

Public channels:

- `job:create`
- `job:list`
- `job:get`
- `job:cancel`
- `job:retry`
- `job:pause`
- `job:resume`
- `job:events`
- `job:artifacts`

Internal/maintenance channels currently exposed through the narrow preload API for future panels and tests:

- `job:update`
- `job:event:add`
- `job:artifact:add`
- `job:gate:add`

Preload methods validate `jobId` as a string and coerce payloads to plain objects before IPC.

## Renderer UI

Sprint 2B adds a usable Job Center panel in the renderer.

Entry points:

- Sidebar: `任务`
- Workspace top bar: `任务`
- Runtime Queue status strip: `任务` button when the running or queued runtime item has a `jobCenterId`

The panel includes:

- Job list, sorted by most recently updated.
- Job detail with status, source, executor, and error message.
- Task and step timeline.
- Event log with basic folding when the event count is large.
- Artifact list with `Preview` and `Reveal` actions.
- Gate result area.
- Manual refresh.
- Polling refresh while the panel is visible.

Supported user operations:

- View job list.
- View job detail.
- Cancel active jobs.
- Retry failed or cancelled jobs.
- Pause queued/running/waiting jobs.
- Resume paused jobs.
- Preview small text artifacts.
- Reveal artifact location in Finder.

When artifact files are missing or outside allowed roots, the API returns a readable error and the UI shows a toast instead of crashing.

## Job Lifecycle Example

1. User sends a prompt from the composer.
2. Runtime Service creates a Job Center job with `source: "runtime_queue"`.
3. Runtime Queue receives the prompt and stores `metadata.jobCenterId`.
4. Job Center initially records the job as `queued`.
5. Runtime Queue starts the item and mirrors status to `running`.
6. Runtime tool events append `runtime.*` entries to the Job Event Log.
7. Runtime diffs are added as `Artifact` records of type `diff`.
8. When the runtime turn completes, queue status mirrors to `succeeded` or `failed`.
9. The Job Center UI can retry failed/cancelled jobs, or inspect artifacts and gate results.

## Artifact Rules

Artifacts must include:

- `type`
- `path`
- `createdAt`

Recommended fields:

- `name`
- `mimeType`
- `size`
- `sha256`
- `producedBy.taskId`
- `producedBy.stepId`
- `producedBy.executor`

Absolute artifact paths are restricted to allowed roots in the Electron app:

- current workspace
- `~/.vibe`

Relative artifact paths are allowed for future workspace-relative records.

## Gate Result Rules

Gate results must include:

- `gate`
- `status`
- `createdAt`

Allowed gate statuses:

- `passed`
- `failed`
- `warning`
- `skipped`
- `simulated`
- `not_run`
- `requires_approval`

Gate results should reference relevant artifact ids when a build log, test report, diff, CAD export, PLC validation, or release artifact exists.

Sprint 7A Quality Gate Runner writes full evidence JSON as a `quality_gate_evidence` artifact and stores the release-readable result under `gateResults[].metadata.qualityGate`. `simulated`, `not_run`, and `requires_approval` are intentionally distinct from `passed`.

Sprint 7B Release Builder creates jobs with `source: "release-builder"`. It writes release readiness events, package build events, a `release.readiness` gate result, and a `release_package` artifact pointing to `releases/<version>/release-manifest.json`.

## Verification

Required checks for this layer:

```bash
npm run build
npm run verify
node test/feature-tests.mjs
node test/job-center-tests.mjs
node --check electron/main.mjs
node --check electron/preload.cjs
```
