# ADR-0004: Turn State And Conservative Recovery

Status: Accepted

Date: 2026-07-10

Owners: Runtime Engine

## Context

HC-RUN-202 can rebuild exact model context and identify a turn that lacks a terminal event. The existing recovery UI still treats every failed, denied, or interrupted turn as a raw prompt retry. That is unsafe: a process can disappear while a command or external tool is running, and retrying the whole prompt can repeat an unknown side effect. Approval requests also have no durable resolution event, so restart cannot distinguish an unanswered prompt from an approved action that may already have started.

## Decision

Hi Code derives an explicit turn state from the append-only Runtime Protocol and produces a conservative recovery disposition:

1. Model-only interruption may be retried after restoring the original session.
2. An unanswered approval is recovered by requesting approval again; no prior decision is reused.
3. A tool start without a matching terminal event is `inspect_tool` and cannot be retried from the recovery button.
4. A failed turn after a completed mutating or external tool is also `inspect_tool` because the side effect may already exist.
5. Read-only tool activity does not by itself block a turn retry.
6. Assistant deltas are preserved as bounded partial output evidence.
7. `approval.resolved` records the explicit allow/always/deny decision and references the request event.
8. A terminal `turn.completed` is never returned as recoverable. Missing terminal events are interrupted, never silently completed.

The state reducer is deterministic and pure. It consumes ordered protocol events and does not execute a model, tool, or approval decision. UI and future SDK clients use the same recovery plan.

## States

- `running_model`
- `streaming`
- `waiting_approval`
- `tool_running`
- `completed`
- `failed`
- `denied`
- `interrupted`

Recovery actions:

- `retry_turn`
- `retry_with_approval`
- `review_output`
- `inspect_tool`
- `none`

## Security And Side Effects

Recovery never reuses a prior approval. It never auto-runs an unfinished tool and never represents unknown tool state as success. Bash, file mutations, subagents, MCP calls, and unknown tools are treated as side-effecting. Only the known read-only tools `read_file`, `ls`, `glob`, and `grep` are safe for automatic whole-turn retry classification.

The partial assistant output is local protocol data. Recovery metadata is bounded and contains no environment variables or credentials.

## Compatibility

Legacy log recovery remains available with a conservative default. Existing `recoverable-tasks:list` IPC remains valid; new fields are additive. The renderer restores the source session before a permitted retry. Older clients can continue to read `status` and `retryInput`.

## Rejected Alternatives

- Retry every interrupted prompt: rejected because mutating tools can execute twice.
- Mark a completed assistant message as a completed turn without a terminal event: rejected as fake completion evidence.
- Persist and replay an allow decision after restart: rejected because approval is scoped to the original process and exact action state.
- Add automatic tool rollback in this task: rejected because tool-specific compensation requires a later execution journal.

## Verification

- Crash during assistant streaming preserves partial output and permits session-aware retry.
- Crash while waiting for approval requires a new human decision.
- Crash during an unknown tool execution blocks one-click retry.
- Completed mutating tool plus later failure blocks whole-turn retry.
- Read-only tool plus model failure remains retryable.
- Approval request/resolution events are paired and protocol-valid.
- Existing build, verify, release, security, DoD, storage, and Electron gates remain green.
