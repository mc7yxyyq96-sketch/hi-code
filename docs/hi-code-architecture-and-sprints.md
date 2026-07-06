# Hi Code v0.5 Architecture and Sprint Plan

Hi Code v0.5 的目标是从“聊天壳 + 本地工具”升级成真正的 Coding Agent 工作台。规划方式按全栈开发经理 + AI Agent 团队推进：先定架构边界，再按 Sprint 交付可验收的产品能力。

Codex 对标依据：OpenAI Codex manual，2026-06-30 通过 `openai-docs` skill 抓取。重点参考官方手册里的 Codex app features、app commands、approvals and sandboxing、skills、MCP、plugins、memories、subagents。

## Product Target

Hi Code v0.5 需要具备这些核心体验：

- Codex 风格工作台：线程、项目、工具时间线、Diff、Git、MCP、Skill、插件、设置集中在一个桌面应用里。
- 可视化代码变更：agent 修改文件后，用户能看到文件级和 hunk 级 diff，并可 Accept / Reject / Undo。
- 结构化 agent 运行过程：工具调用、文件修改、权限请求、diff 生成不再只靠终端文本流，而是有事件模型。
- 本地优先：中国下载源友好，能接 DeepSeek、OpenAI-compatible API、Ollama、本地模型、MCP、插件商店。
- 安全默认：renderer 不直接碰文件系统、shell、密钥；main process 统一做路径校验、权限、脱敏、安装预览。

## Architecture Layers

### 1. Renderer UI

只负责界面和交互，不直接读写敏感文件，不直接执行 shell。

主要模块：

- Chat workspace
- Tool timeline
- Diff panel
- Git page
- MCP manager
- Skills page
- Plugin/store page
- Settings
- Project memory editor

### 2. Preload IPC

只暴露窄接口：

- `workspace.*`
- `toolEvents.*`
- `diff.*`
- `git.*`
- `mcp.*`
- `skills.*`
- `plugins.*`
- `auth.*`
- `config.*`

禁止 renderer 直接获得 Node.js 能力。

### 3. Electron Main Services

新增服务模块，避免 `electron/main.mjs` 长成一坨：

- `auth-service`
- `workspace-service`
- `diff-service`
- `git-service`
- `mcp-service`
- `skill-service`
- `plugin-service`
- `tool-event-service`
- `store-service`

### 4. Core Agent Runtime

CLI 和 Electron 继续共用。新增结构化事件：

- `tool:start`
- `tool:output`
- `tool:done`
- `file:changed`
- `permission:requested`
- `diff:created`
- `git:changed`
- `mcp:changed`
- `skill:selected`

### 5. Persistence

放在 `~/.vibe`：

- `auth.json`
- `config.json`
- `sessions/`
- `workspace-state.json`
- `tool-events/`
- `plugins.json`
- `store.json`
- `memory/`

## AI Agent Team

Manager / Architect 负责拆任务、验收、合并，保证架构一致。

| Agent | Responsibility |
| --- | --- |
| Architect Agent | IPC 契约、事件 schema、模块边界、跨 Sprint 架构一致性 |
| Frontend Agent | Codex 风格 UI、Diff 面板、工具时间线、Git/MCP/Skill/Plugin 页面 |
| Electron Agent | main/preload IPC、服务模块、文件安全、配置读写 |
| Core Runtime Agent | agent 执行事件化、工具调用结构化、文件变更事件 |
| Git/Diff Agent | diff 生成、apply/reject、stage/commit、Git 状态 |
| MCP/Plugin Agent | MCP 增删改查、测试连接、tools/resources/prompts、插件启用状态 |
| Skill/Memory Agent | Skill 读取和上下文注入、HI.md/CLAUDE.md/AGENTS.md 兼容 |
| Security Agent | 路径沙箱、密钥脱敏、MCP prompt injection、权限边界审查 |
| QA Agent | feature tests、Playwright 截图、Electron smoke test、回归验收 |

## Codex Parity Matrix

Status:

- `Done`: 已有可用基础。
- `Partial`: 有雏形，但不完整。
- `Planned`: 进入 v0.5-v0.6 规划。
- `Later`: 保留接口，不进当前主线。

Priority:

- `P0`: 不做就不像 Coding Agent 工作台。
- `P1`: 对标 Codex/Claude Code 的关键完整度。
- `P2`: 产品增强或生态能力。

| Area | Codex Capability | Hi Code Current | Target | Priority | Sprint |
| --- | --- | --- | --- | --- | --- |
| App shell | 项目切换、侧栏、线程列表、设置入口 | Partial | 项目、线程、设置、能力页保持稳定导航 | P0 | S1 |
| Commands | `/status` `/plan` `/review` `/mcp` 等命令入口 | Partial | 命令面板、快捷键、命令搜索、命令结果联动 UI | P1 | S1-S3 |
| Thread search | 搜索历史线程，打开旧会话 | Partial | 会话标题 + 内容检索，恢复上下文 | P1 | S4 |
| Goal / Plan | 计划模式、目标进度条 | Planned | 计划视图、任务 checklist、可暂停/恢复 | P1 | S4 |
| Tool timeline | 任务侧栏展示 agent 行为、来源、产物 | Planned | 工具调用时间线：开始、输出、完成、失败、权限 | P0 | S1 |
| Diff pane | Git diff、文件/hunk stage/revert、内联评论 | Partial CLI only | 可视化 diff，文件级 Accept/Reject，hunk 预留 | P0 | S1 |
| Git workflow | status、stage、commit、push、PR | Partial CLI `/diff` | Git 状态页、stage/unstage、commit message、commit | P0 | S2 |
| Worktrees | Local / Worktree / Cloud 模式 | Planned | Local 先做完整，Worktree 作为隔离执行模式 | P1 | S6 |
| Integrated terminal | 每个线程内置终端，可读输出 | Planned | scoped terminal panel，输出可被 agent 引用 | P1 | S6 |
| Approvals | 权限请求、最小授权、session 授权 | Partial | UI 权限卡片、文件/shell/MCP 分级批准 | P0 | S1-S3 |
| Sandbox | workspace write、read-only、full access | Partial | 文件权限 profile、敏感路径 deny、网络策略预留 | P0 | S1-S3 |
| MCP | App settings 管理 MCP，tools/resources/prompts | Partial | MCP 管理器：新增、删除、测试、启用、脱敏 | P0 | S3 |
| MCP transports | stdio、HTTP、OAuth、Bearer | Partial stdio | stdio P0，HTTP/Bearer P1，OAuth Later | P1 | S3-S6 |
| Skills | metadata 发现、`$skill`、progressive disclosure | Partial | SKILL.md 真正注入上下文，显式/隐式触发 | P0 | S4 |
| Skill scopes | repo/user/admin/system skills | Partial local scan | repo `.agents/skills` + user `~/.vibe/store/skills` | P1 | S4 |
| AGENTS.md | 项目指导文件分层读取 | Partial memory load | 兼容 AGENTS.md，新增 HI.md，兼容 CLAUDE.md | P0 | S4 |
| Memories | 本地长期记忆，设置控制 | Planned | 项目 memory 可编辑、可禁用、敏感信息提示 | P1 | S4-S6 |
| Plugins | 插件目录、安装、禁用、卸载、marketplace | Partial store foundation | registry、启用/禁用、插件详情、卸载、更新 | P0 | S5 |
| Plugin bundle | skills + MCP + app integrations | Partial manifest only | 插件可贡献 skills/mcp/hooks/views | P1 | S5 |
| Store sources | marketplace source, curated/local | Partial | 自定义下载源、国内镜像、签名/sha256 校验 | P1 | S5-S7 |
| Subagents | 显式并行 subagent，custom agents | Partial CLI/team | UI 展示 agent 分工、状态、结果汇总 | P1 | S6 |
| Review mode | uncommitted/base branch review | Partial reviewer agent | Review 页面：范围选择、finding 列表、修复入口 | P1 | S6 |
| Browser | in-app browser preview/comment/browser-use | Planned | 本地 dev server preview + screenshot validation | P2 | S7 |
| Computer use | 操作本地 app / OS UI | Later | 保留 connector 能力位，不进入 v0.5 主线 | P2 | Later |
| Automations | thread/project automations | Later | 保留 schema，不进入 v0.5 主线 | P2 | Later |
| Auth/profile | 登录、使用统计、模型配置 | Partial local auth | 本地账号先完善，云同步后置 | P1 | S6 |
| Settings | 模型、外观、Git、MCP、权限、快捷键 | Partial | 设置拆页，敏感配置脱敏 | P1 | S3-S6 |

## Sprint Plan

### Sprint 1: Core Workbench Feel

Goal: 做出“像 Codex/Claude Code 的工作台”的第一层真实感，而不是聊天壳。

Execution board: `docs/sprint-1-core-workbench-execution.md`.

Deliverables:

- Tool timeline event schema and UI.
- File change event capture.
- Visual Diff panel.
- Accept / Reject / Undo at file level.
- Permission request cards tied to tool events.

Acceptance:

- Agent 修改文件后 UI 能显示 diff。
- 用户能单文件 Accept / Reject。
- Reject 能恢复原文件内容。
- `/undo` 和 UI diff 状态一致。
- `npm run build` 通过。
- `node test/feature-tests.mjs` 通过。
- Playwright 截图覆盖工具时间线 + diff panel。

### Sprint 2: Git Workflow

Deliverables:

- Git status page.
- Dirty file list.
- Stage / unstage.
- Commit message generation.
- Commit operation.
- `/diff` 与 UI diff panel 联动。

Acceptance:

- 能看到 dirty files。
- 能选择文件 stage。
- 能生成 commit message。
- 能完成 commit。

### Sprint 3: MCP Manager

Deliverables:

- MCP server list.
- Add / edit / delete / enable / disable.
- Test connection.
- Show tools/resources/prompts.
- Env secret masking.

Acceptance:

- UI 配 MCP 后写入 `~/.vibe/config.json`。
- 重新加载后 MCP 可见。
- 密钥不在 UI 明文展示。

### Sprint 4: Skill + Memory

Deliverables:

- Read local and repo skills.
- `$skill` selection loads `SKILL.md`.
- Skill content enters agent context only when selected.
- Project memory editor.
- `HI.md` support.
- `CLAUDE.md` and `AGENTS.md` compatibility.

Acceptance:

- Skill 内容能进入 agent 上下文。
- 项目记忆可编辑、保存、重载。
- `HI.md` / `CLAUDE.md` / `AGENTS.md` 会按优先级进入上下文。

### Sprint 5: Plugin System and Store Lifecycle

Deliverables:

- Plugin registry.
- Enable / disable / uninstall.
- Plugin detail page.
- Plugin contributes skills/mcp/hooks/views.
- Store source management.
- Install preview from Store Foundation reused.

Acceptance:

- 插件安装后能被 registry 发现。
- 禁用后不再贡献能力。
- 卸载后本地状态和 UI 同步。

### Sprint 6: Worktrees, Subagents, Auth, Settings

Deliverables:

- Worktree execution mode.
- UI subagent activity.
- Custom agent config.
- Auth settings hardening.
- Model profile management.
- Permission profile UI.

Acceptance:

- 可创建隔离 worktree 任务。
- 多 agent 状态可见。
- 权限/模型配置可视化管理。

### Sprint 7: Browser, Distribution, Hardening

Deliverables:

- In-app browser preview.
- Browser comments.
- Store signing / sha256 verification.
- Electron smoke test.
- App packaging polish.

Acceptance:

- 本地 dev server 可在应用内预览。
- 截图/评论能回到 agent 任务。
- Store 安装包完整性校验通过。

## Sprint 1 Implementation Breakdown

### Architect Agent

- Define `ToolEvent` schema.
- Define `FileChange` and `DiffEntry` schema.
- Define IPC contracts.

### Core Runtime Agent

- Emit events from tool execution.
- Wrap `write_file` and `edit_file` with before/after snapshots.
- Emit `diff:created`.

### Electron Agent

- Add `tool-event-service`.
- Add `diff-service`.
- Persist per-session events under `~/.vibe/tool-events/`.
- Expose `list-tool-events`, `list-diffs`, `accept-diff`, `reject-diff`.

### Frontend Agent

- Add tool timeline UI.
- Add diff panel UI.
- Add file list, diff view, Accept / Reject buttons.
- Keep Codex-like beige workbench style.

### Security Agent

- Review path confinement.
- Ensure reject cannot write outside workspace.
- Ensure renderer cannot send arbitrary target path without main validation.

### QA Agent

- Add feature tests for diff accept/reject.
- Add Playwright screenshot for timeline and diff panel.

## Definition of Complete

A Sprint is complete only when:

- Product behavior is implemented, not only mocked.
- Main/preload/renderer boundaries are respected.
- Tests pass.
- At least one Playwright screenshot exists for visible UI changes.
- Docs are updated when behavior or user workflows change.
- Security-sensitive changes have a short review note.

## Current Adjustment

The Store Foundation work already completed before this document is treated as a Sprint 5 prerequisite, not the official Sprint 1. It remains useful and should be folded into Plugin System and Store Lifecycle.
