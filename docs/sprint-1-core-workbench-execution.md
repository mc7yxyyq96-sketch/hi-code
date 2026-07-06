# Sprint 1 Execution Plan: Core Workbench Feel

Sprint 1 的目标是把 Hi Code 从“聊天壳”推进到“可观察、可审查、可回滚”的 Coding Agent 工作台。这个 Sprint 不做完整 Git 工作流、不做 MCP 管理器、不做 Skill 注入；这些放到后续 Sprint。Sprint 1 只做工作台底座：工具时间线、结构化文件变更、可视化 Diff、Accept / Reject / Undo。

## Non-Negotiable Outcome

用户让 agent 改文件后，Hi Code UI 必须能做到：

- 看到 agent 调用了哪些工具。
- 看到每个工具的状态：运行中、成功、失败、被拒绝。
- 看到哪些文件被改了。
- 看到每个文件的 diff。
- 对每个文件执行 Accept 或 Reject。
- Reject 后文件恢复到修改前内容。
- `/undo` 和 UI diff 状态一致。

## Current Entry Points

| Area | Current File | Notes |
| --- | --- | --- |
| Runtime turn loop | `src/runtime.ts` | 已有 `undoStack` 和 `recordChange`，适合挂 `file:changed` / `diff:created` |
| Tool execution | `src/tools/index.ts` | `previewAndWrite` / `previewAndEdit` 已拿到 old/new 内容，是 diff event 的最佳切入点 |
| Permission | `src/permissions.ts` | 目前通过 `ask` 输出文本，需要补结构化 permission event |
| Electron bridge | `electron/main.mjs` | 当前 stdout 桥接到 renderer，需要加事件 channel |
| Preload API | `electron/preload.cjs` | 需要暴露 timeline / diff IPC |
| Renderer UI | `renderer/index.html`, `renderer/renderer.js`, `renderer/style.css` | 需要新增 timeline 和 diff panel |
| Tests | `test/feature-tests.mjs` | 可补 diff accept/reject 的无模型测试 |

## Event Contract

Architect Agent 先冻结这个最小契约，后续 Agent 不得随意改字段名。

```ts
type ToolEventStatus = "running" | "done" | "error" | "denied";

interface ToolEvent {
  id: string;
  sessionId: string;
  turnId: string;
  type: "tool:start" | "tool:output" | "tool:done" | "permission:requested" | "diff:created" | "diff:updated";
  tool?: string;
  title: string;
  summary?: string;
  status?: ToolEventStatus;
  path?: string;
  diffId?: string;
  createdAt: number;
  updatedAt?: number;
  payload?: Record<string, unknown>;
}

interface DiffEntry {
  id: string;
  sessionId: string;
  turnId: string;
  path: string;
  absPath: string;
  before: string | null;
  after: string;
  status: "pending" | "accepted" | "rejected" | "undone";
  tool: "write_file" | "edit_file" | "undo";
  createdAt: number;
  updatedAt?: number;
}
```

## Team Assignments

### Manager / Architect

Owner: main thread

Responsibilities:

- Freeze event schema and IPC contract.
- Keep scope limited to Sprint 1.
- Review all PR-sized patches before moving to next layer.
- Ensure Codex parity matrix stays mapped to implementation.

Outputs:

- This execution plan.
- Final Sprint 1 acceptance report.

### Architect Agent

Task IDs: `S1-A1`, `S1-A2`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-A1 | Define runtime event and diff schema | Current `runtime.ts`, `tools/index.ts` | Types/interfaces in core or service module | none | Schemas compile and are referenced by runtime/main |
| S1-A2 | Define IPC contract | Event schema | IPC names and payloads for timeline/diff | S1-A1 | Renderer has no direct fs access |

Suggested IPC:

- `tool-events:list`
- `diffs:list`
- `diffs:accept`
- `diffs:reject`

### Core Runtime Agent

Task IDs: `S1-R1`, `S1-R2`, `S1-R3`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-R1 | Add runtime event emitter | `createRuntime` opts | `emitEvent` hook from runtime to Electron | S1-A1 | CLI still works without emitter |
| S1-R2 | Emit tool events | `executeTool`, `runTurn` | `tool:start`, `tool:done`, `tool:error` | S1-R1 | Tool event list records read/write/edit/bash/MCP |
| S1-R3 | Emit file diff events | `previewAndWrite`, `previewAndEdit` | `diff:created` with before/after | S1-R1 | write/edit produce `DiffEntry` before user accepts |

Implementation notes:

- Keep CLI compatible: `emitEvent` must be optional.
- Do not remove current console output yet; UI can use both during migration.
- For write/edit, permission remains the gate; after the write succeeds, create a pending UI diff so the user can Accept or Reject the already-applied agent change.

### Electron Agent

Task IDs: `S1-E1`, `S1-E2`, `S1-E3`, `S1-E4`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-E1 | Add `tool-event-service` | Runtime emitted events | In-memory + persisted event store | S1-R1 | Events survive renderer refresh during app session |
| S1-E2 | Add `diff-service` | `DiffEntry` | list/accept/reject/undo APIs | S1-R3 | Reject restores before content safely |
| S1-E3 | Add IPC handlers | Services | Preload-safe APIs | S1-E1, S1-E2 | Renderer uses IPC only |
| S1-E4 | Path safety review | diff abs paths | Workspace-confined accept/reject | S1-E2 | Reject cannot write outside cwd |

Persistence:

- In memory first for Sprint 1.
- Persist optional under `~/.vibe/tool-events/<sessionId>.jsonl` if low-risk.
- Diff entries should store `before` and `after` only for files under workspace and size-capped.

### Frontend Agent

Task IDs: `S1-F1`, `S1-F2`, `S1-F3`, `S1-F4`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-F1 | Add workbench split layout | Current chat UI | Chat + timeline + diff affordance | none | Does not break mobile/min width |
| S1-F2 | Tool timeline UI | `tool-events:list` | Event rows with running/done/error states | S1-E3 | Events update during a turn |
| S1-F3 | Diff panel UI | `diffs:list` | File list + unified-ish diff viewer | S1-E3 | Shows pending file diff |
| S1-F4 | Accept/Reject actions | diff IPC | Buttons update diff status and file content | S1-E2 | Reject removes/reverts changed file |

UI rules:

- Keep beige Codex-like palette.
- Tool timeline should be dense and scannable, not card-heavy.
- Diff panel can start file-level; hunk-level controls are reserved for Sprint 2.
- Buttons must be clear: Accept, Reject, Undo.

### Git/Diff Agent

Task IDs: `S1-D1`, `S1-D2`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-D1 | Implement text diff renderer model | `DiffEntry` | line-level diff data | S1-A1 | Renderer can display added/removed/context lines |
| S1-D2 | Align `/undo` with diff state | runtime undo | Diff statuses update on undo | S1-E2 | UI no longer shows undone diffs as pending |

Notes:

- Use existing `diff` dependency if available.
- Keep binary/large files out of Sprint 1: mark them as not previewable.

### Security Agent

Task IDs: `S1-S1`, `S1-S2`, `S1-S3`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-S1 | Review workspace confinement | diff accept/reject | Security notes + tests | S1-E2 | Path traversal rejected |
| S1-S2 | Review permission events | permission requests | No secret leakage in timeline | S1-R2 | API keys/env values redacted |
| S1-S3 | Review renderer IPC | preload handlers | Narrow payload validation | S1-E3 | Renderer cannot pass arbitrary absolute paths |

### QA Agent

Task IDs: `S1-Q1`, `S1-Q2`, `S1-Q3`

| Task | Description | Input | Output | Depends On | Acceptance |
| --- | --- | --- | --- | --- | --- |
| S1-Q1 | Feature tests for diff service | service APIs | no-LLM tests | S1-E2 | Accept/reject pass in temp workspace |
| S1-Q2 | Runtime event tests | mock tool execution | events emitted in order | S1-R2 | write/edit produce tool + diff events |
| S1-Q3 | Playwright screenshot | UI running locally | screenshot artifact | S1-F4 | Shows timeline + diff panel |

## Execution Order

1. `S1-A1`, `S1-A2`: schema and IPC freeze.
2. `S1-R1`: optional runtime emitter.
3. `S1-E1`: event service skeleton.
4. `S1-R2`, `S1-R3`: emit tool and diff events.
5. `S1-E2`, `S1-E3`: diff service and IPC.
6. `S1-F1`, `S1-F2`: layout and timeline.
7. `S1-F3`, `S1-F4`: diff panel and actions.
8. `S1-D1`, `S1-D2`: diff rendering and undo sync.
9. `S1-S1`-`S1-S3`: security pass.
10. `S1-Q1`-`S1-Q3`: automated tests and screenshot.

## Task Board

| ID | Agent | Status | Notes |
| --- | --- | --- | --- |
| S1-A1 | Architect | Done | `src/events.ts` |
| S1-A2 | Architect | Done | Preload-safe IPC added |
| S1-R1 | Core Runtime | Done | Optional `emitEvent` hook |
| S1-R2 | Core Runtime | Done | Tool + permission events |
| S1-R3 | Core Runtime | Done | `diff:created` payloads |
| S1-E1 | Electron | Done | In-memory event store |
| S1-E2 | Electron | Done | `DiffService` accept/reject |
| S1-E3 | Electron | Done | IPC handlers wired |
| S1-E4 | Electron/Security | Done | Workspace-confined reject |
| S1-F1 | Frontend | Done | Three-column workbench |
| S1-F2 | Frontend | Done | Live timeline UI |
| S1-F3 | Frontend | Done | Unified diff panel |
| S1-F4 | Frontend | Done | Accept/Reject actions |
| S1-D1 | Git/Diff | Done | Renderer line diff model |
| S1-D2 | Git/Diff | Done | `/undo` emits `diff:updated` |
| S1-S1 | Security | Done | Path confinement tested |
| S1-S2 | Security | Done | Tool args redaction |
| S1-S3 | Security | Done | Renderer only uses narrow IPC |
| S1-Q1 | QA | Done | DiffService accept/reject tests |
| S1-Q2 | QA | Done | Runtime event tests |
| S1-Q3 | QA | Done | Screenshot artifact generated |

## Definition of Done

Sprint 1 is done when all are true:

- `npm run build` passes.
- `node test/feature-tests.mjs` passes.
- Agent file edits generate timeline entries.
- Agent file edits generate visible file diffs.
- Accept marks a diff accepted without reverting file content.
- Reject restores the prior file content or deletes newly created files.
- `/undo` updates UI-visible diff status.
- Playwright screenshot exists under `output/playwright/`.
- Security notes confirm renderer cannot write arbitrary paths.

## Manager Notes

The highest-risk dependency is the boundary between runtime events and Electron services. Keep the first implementation boring:

- Optional event emitter in runtime.
- Main process owns event/diff state.
- Renderer receives snapshots and live updates.
- File-level diff only.
- No hunk-level apply until Sprint 2.

## Implementation Report

Completed in this Sprint 1 pass:

- Added shared event/diff types in `src/events.ts`.
- Added reusable `DiffService` in `src/diff-service.ts`.
- Wired Runtime and tools to emit `tool:start`, `tool:done`, `permission:requested`, `diff:created`, and `diff:updated`.
- Added Electron event/diff stores plus IPC handlers for listing, accepting, and rejecting diffs.
- Added preload APIs without exposing filesystem access to the renderer.
- Reworked chat into a Codex-like workbench: Timeline + Chat + Changes.
- Added renderer demo events so static browser previews show the real layout.
- Added feature tests for structured events and diff accept/reject safety.

Validation:

- `node --check electron/main.mjs`
- `node --check electron/preload.cjs`
- `node --check renderer/renderer.js`
- `npm run build`
- `node test/feature-tests.mjs` -> 67 passed, 0 failed
- Playwright screenshot: `output/playwright/hi-code-sprint1-workbench.png`
