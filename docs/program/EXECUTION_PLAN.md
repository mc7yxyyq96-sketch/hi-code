# Hi Code v0.6.0-alpha.6 → v1.0 产品级桌面应用全权开发方案

> 角色视角：全栈开发负责人、产品经理、项目负责人、系统架构师
>
> 当前源码快照：v0.6.0-alpha.6，commit `6ed9ed666bb817f8d1e863c76b0bf61b31c7b52d`
>
> 核心目标：先达到一流 Agentic Coding 桌面产品的工程深度，再通过统一工业项目图、工业工具适配器、质量门禁和交付证据形成差异化。

---

## 1. 执行摘要

### 1.1 当前真实成熟度

Hi Code 不是空壳。当前已经具备可工作的 Electron/CLI/TUI 入口、LLM runtime、文件和 Bash 工具、MCP stdio、权限、diff、Git、Job Center、worktree、Patch Arena、工业项目、Domain Pack、工业适配器、Quality Gate、Release Builder、Industrial Control Box 样板和较广的自动化测试。

但它仍是 **广度较大、核心闭环不够深的 alpha 产品**。真正影响产品级交付的主要问题，不是缺少更多菜单，而是：

1. Runtime Protocol 仍是旧事件的附加映射，不是桌面、CLI、TUI、SDK 的唯一事实源。
2. 模型流式输出没有进入协议事件；桌面通过全局改写 `process.stdout.write` 和 `console.*` 获取输出。
3. append-only JSONL 不能完整重放 assistant 消息，event-only 会话只能读摘要，不能可靠继续。
4. Codex CLI、Claude Code、local model provider 仍是 `not_configured` 占位，Patch Arena 还不是可信的多 Provider 竞技系统。
5. Renderer 仍由约 4,766 行 bootstrap、5,077 行 CSS、808 行 HTML 集中控制，响应式会隐藏关键入口。
6. Electron 31 已远离当前受支持稳定版本；打包、签名、自动升级、跨平台 E2E、崩溃恢复和 SBOM 尚未达到公开发布标准。
7. 工业能力目前更接近“项目/文档/artifact 生成器 + adapter 框架”，还缺少统一工程对象图、参数与单位系统、变更影响分析、商业软件远程 Worker 和领域级验证深度。

### 1.2 最大优势

Hi Code 已经有一条竞争产品通常不会默认提供的产品骨架：

`Requirement → Task/Agent → Tool/Adapter → Artifact → Quality Gate → Evidence → Release Package`

这个方向正确。下一步应停止继续横向堆行业菜单，把它深化为稳定、可恢复、可扩展、可审计的统一工程平台。

### 1.3 最大风险

最大风险是“模块很多所以误认为产品已完成”。目前最核心的会话、事件、恢复、Provider、桌面工作区和发布系统仍没有形成同一个可验证闭环。继续增加 CAD/化工/能源入口，只会扩大维护面。

### 1.4 项目负责人结论

下一阶段不是继续沿用旧的 Sprint 0–8B 扩功能，而是重排为五条工程主线：

1. **Runtime Engine 与持久化事实源**
2. **Code Studio 桌面工作区与开发闭环**
3. **扩展、Provider、App Server 与 SDK**
4. **安全、跨平台、打包与发布工程**
5. **Industrial Studio 与真实工业交付闭环**

编码产品稳定版先行，工业能力并行深化但不得反向破坏核心。

---

## 2. 当前能力证据表

| 能力 | 源码证据 | 测试证据 | 当前完成度 |
|---|---|---|---|
| Electron 安全壳 | `electron/main.mjs`、`electron/preload.cjs` | `test/security-baseline.mjs`、`test/entrypoint-tests.mjs` | 中高 |
| CLI/TUI/Runtime | `src/index.ts`、`src/tui.tsx`、`src/runtime.ts` | `test/feature-tests.mjs` | 中 |
| Runtime Protocol v1 | `src/runtime-protocol.ts`、`src/runtime-event-store.ts` | `test/runtime-protocol-tests.mjs` | 中低；协议不是事实源 |
| 模型流式调用 | `src/llm.ts`、`src/agent.ts` | feature/runtime tests | 中；仅 OpenAI Chat Completions 兼容面 |
| 文件/Bash/Git/Diff/权限 | `src/tools/*`、`src/git.ts`、`src/permissions.ts` | feature/security tests | 中高 |
| MCP | `src/mcp.ts`、`src/config.ts` | feature/service tests | 中；仅 stdio |
| Job Center | `src/job-center.ts`、`electron/services/job-service.mjs` | `test/job-center-tests.mjs` | 中高 |
| Worktree 隔离 | `src/worktree-runner.ts`、对应 service | `test/worktree-runner-tests.mjs` | 中高 |
| Patch Arena | `electron/services/patch-arena-service.mjs` | `test/patch-arena-tests.mjs` | 中；多 Provider 执行未完成 |
| Provider Registry | `src/agent-provider.ts`、`electron/services/provider-service.mjs` | `test/provider-tests.mjs` | 中低；只有 internal 真正执行 |
| Industrial Project | `src/industrial-project.ts`、对应 service/UI | `test/industrial-project-tests.mjs` | 中 |
| Domain Pack | `src/domain-packs.ts`、对应 service/UI | `test/domain-pack-tests.mjs` | 中 |
| 工业 Adapter | `src/freecad-adapter.ts`、`kicad-adapter.ts`、`plc-openplc-adapter.ts`、`bim-ifc-adapter.ts`、SolidWorks/AVEVA bridge | `test/industrial-tool-tests.mjs` | 广度中高、深度中低 |
| Quality Gate | `src/quality-gates.ts` | `test/quality-gate-tests.mjs` | 中高 |
| Release Builder | `src/release-builder.ts` | `test/release-builder-tests.mjs` | 中 |
| 样板项目 | `src/industrial-control-box-sample.ts` | `test/industrial-control-box-sample-tests.mjs` | 中；CAD/PCB 可为 simulated |
| DoD/Skeleton Detector | `src/definition-of-done.ts`、`scripts/scan-dod.mjs` | `test/definition-of-done-tests.mjs` | 中高 |
| CI | `.github/workflows/ci.yml` | Ubuntu 单平台 | 中低 |

当前本地基线结果：`npm run verify`、`npm run release:check` 和 `npm run scan:dod` 均通过；生产依赖审计没有 high vulnerability。历史验收报告中的部分问题已被当前源码修复，不能继续把历史报告当作现状。

---

## 3. 关键缺口表

| 严重度 | 缺口 | 用户影响 | 根因 | 相关文件 |
|---|---|---|---|---|
| P0 | 模型输出不进入 Runtime Protocol | 崩溃后无法完整重放；桌面/CLI/TUI语义不一致 | `model.output` 有 schema 无真实发射路径 | `src/runtime-protocol.ts`、`src/agent.ts` |
| P0 | Electron 通过 stdout/console monkey patch 接收模型输出 | 输出串线、并行 session 难隔离、测试和 SDK 难复用 | presentation 与 runtime 耦合 | `electron/main.mjs`、`src/agent.ts`、`src/tui.tsx` |
| P0 | Event store 不能恢复完整 assistant 消息 | event-only session 只能只读摘要，不能继续任务 | JSONL 只存工具/turn 摘要；完整消息仍依赖 session JSON | `src/runtime-event-store.ts`、`src/session-store.ts` |
| P0 | Electron 31 过旧 | 安全、Chromium、Node、打包兼容和发布风险 | 依赖未升级 | `package.json` |
| P0 | 机密仍可存入 `~/.hicode/config.json` | API Key 明文落盘 | 配置模型把 `apiKey` 作为普通字段 | `src/config.ts`、workspace settings handler |
| P0 | 跨平台命令隔离不足 | Windows/Linux 上 agent 命令边界弱 | Bash sandbox 主要依赖 macOS `sandbox-exec` | `src/tools/bash.ts` |
| P1 | Codex/Claude/local Provider 为占位 | Patch Arena 不能真实比较多个 agent | Provider adapter 生命周期未实现 | `electron/services/provider-service.mjs` |
| P1 | LLM 传输仅 OpenAI Chat Completions | 不同模型 reasoning、tool streaming、附件和 usage 语义丢失 | 缺 Provider-specific adapter | `src/llm.ts`、`src/config.ts` |
| P1 | MCP 仅 stdio | 无远程 HTTP/OAuth 生态 | 配置和 transport 单一 | `src/config.ts`、`src/mcp.ts` |
| P1 | Renderer 中央控制器和样式过大 | 改一个面板易破坏全局；响应式不稳定 | 渐进拆分未完成 | `renderer/app/bootstrap.js`、`renderer/style.css`、`renderer/index.html` |
| P1 | 小窗口关键入口被隐藏 | 用户找不到任务、竞技场、工业项目和 timeline | 断点中 `display:none` / `overflow:hidden`，没有 overflow/drawer 替代 | `renderer/style.css` |
| P1 | 缺少集成终端、文件编辑器、App Preview | 编码闭环不如一流桌面 coding agent | 当前主要是 chat + modal/file preview | Renderer/Electron 新模块 |
| P1 | 无真实 Electron E2E 和视觉回归 | 自动测试通过仍可能出现 UI 不可用 | 当前测试以模块和静态断言为主 | `test/*`、CI |
| P1 | 打包发布链不足 | 不能稳定向用户分发 | 无签名/公证/自动更新/Linux矩阵/SBOM | `package.json`、CI |
| P1 | 工业对象缺统一图模型和版本关系 | 复杂项目变更无法做影响分析 | requirements/artifacts/gates 仍偏列表式 | industrial core |
| P1 | 商业工业软件缺远程 Worker | 用户机器未安装或许可证受限时无法工程化执行 | 只有本机 bridge 计划 | SolidWorks/AVEVA adapters |
| P2 | Renderer 内置大量 browser demo 数据 | 生产 bundle 增大，测试可能被 demo 路径掩盖 | demo API 与生产 bootstrap 混在一起 | `renderer/app/bootstrap.js` |
| P2 | 本地 email/password auth 对单机工具价值低 | 增加安全与维护面 | 账号概念与云服务尚未分离 | `electron/main.mjs` |
| P2 | 旧 `VibeConfig`、`.vibe`、日志前缀残留 | 品牌和迁移语义混乱 | 历史兼容未封装 | `src/config.ts` 等 |

### 3.1 UI 历史截图判断

截图中的 “H...” 品牌截断问题在当前 CSS 中已针对 `brand-label` 做了不可收缩处理，版本号允许省略，因此原问题大概率已经缓解。但同类风险没有根治：

- `sidebar-toggle` 最小宽度 78px，品牌、版本号和按钮仍竞争空间。
- <=1180px 直接隐藏 timeline。
- <=1180/1320px 顶部动作使用 `overflow:hidden`。
- <=820px 顶部动作全部 `display:none`。
- 侧栏“折叠”仍是 212/190px，而不是 icon rail 或 drawer。

正确方案不是继续补几个 CSS，而是建立响应式 App Shell。

---

## 4. 产品定义：一个引擎、两个工作室、一个交付中心

### 4.1 产品结构

#### Hi Code Engine

所有客户端共享的本地 Agent Runtime：线程、turn、模型、工具、审批、worktree、任务、artifact、事件、恢复、插件和策略。

#### Code Studio

面向软件开发：

- Chat / Plan / Steer / Queue
- 项目、会话和并行任务
- 文件树、编辑器、终端、App Preview
- 工具时间线、审批、Diff Review、代码评论
- Git、worktree、commit、PR、CI
- Skills、Plugins、Hooks、MCP
- Job Center、Automations、Release

#### Industrial Studio

面向工业产品：

- 需求、系统、子系统、接口、参数和单位
- CAD/PCB/PLC/BIM/电气/工艺/材料 artifact
- Tool Worker 与 Adapter
- BOM、变更影响、验证、质量门禁
- 真实/模拟/未运行状态
- 人工审批、标准清单、证据包

#### Delivery Center

软件和工业共用：

- Quality Gate
- Evidence Ledger
- Release Readiness
- 安装包、源码、图纸、BOM、测试和审计交付包

### 4.2 不做 UI 克隆

目标是能力和工程深度对齐，不复制 Claude Code/Codex 的源码、提示词、文档、资产或具体界面。Hi Code 的信息架构应围绕“工程任务、artifact 和证据”，而不是模仿单一聊天产品。

---

## 5. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│                        Hi Code Clients                       │
│ Electron Desktop │ CLI │ TUI │ TypeScript SDK │ Python SDK │
└──────────────────────────────┬───────────────────────────────┘
                               │ versioned JSON-RPC / event stream
┌──────────────────────────────▼───────────────────────────────┐
│                      Hi Code Engine                          │
│ Thread/Turn │ Event Bus │ Provider │ Tool │ Policy │ Job    │
│ Worktree    │ Diff      │ Artifact │ Gate │ Plugin │ Hook   │
└───────────────┬──────────────────────┬───────────────────────┘
                │                      │
     ┌──────────▼──────────┐   ┌──────▼──────────────────────┐
     │ Durable Local Store │   │ Execution / Worker Fabric   │
     │ SQLite + Blob Store │   │ local sandbox / remote tool │
     │ snapshots + export  │   │ workers / commercial bridge │
     └──────────┬──────────┘   └──────┬──────────────────────┘
                │                      │
     ┌──────────▼──────────────────────▼──────────────────────┐
     │ Code Project Graph + Industrial Engineering Graph      │
     │ Requirement→Design→Artifact→Verification→Evidence      │
     └─────────────────────────────────────────────────────────┘
```

### 5.1 Engine 与 Electron 解耦

新增 `hicode-engine` 本地服务进程。Electron main 不再承载大部分 runtime 状态，只负责：

- 窗口生命周期
- OS 对话框、Keychain、通知、菜单
- 安全 WebContents 管理
- Engine 启停和受控 IPC bridge

Engine 支持：

- stdio（桌面子进程、CLI）
- Unix socket / Windows named pipe
- localhost WebSocket（仅开发或显式启用）
- JSON-RPC request/response + server events

### 5.2 Runtime Protocol v2

必须成为唯一事实源，至少定义：

- `thread.created/updated/archived`
- `turn.queued/started/steered/interrupted/completed/failed`
- `message.user.created`
- `message.assistant.delta/completed`
- `reasoning.summary.delta/completed`（Provider 支持时）
- `tool.call.created/started/output.delta/completed/failed`
- `approval.requested/resolved`
- `file.change.created`
- `diff.created/commented/resolved/applied`
- `job.created/status.changed`
- `artifact.created/updated`
- `gate.started/completed`
- `usage.updated`

每个事件具备：

- schemaVersion
- eventId
- threadId / turnId
- sequence
- idempotencyKey
- timestamp
- actor/source
- visibility
- payload
- optional parentEventId / causationId / correlationId

### 5.3 Durable Store

使用存储适配层，目标实现为 SQLite/WAL + blob/artifact 目录：

- `threads`
- `turns`
- `events`
- `messages`
- `tool_calls`
- `approvals`
- `jobs`
- `artifacts`
- `gate_results`
- `snapshots`
- `migrations`

现有 session JSON 和 runtime JSONL 只作为 v1 导入源。迁移后仍提供 JSONL 导出用于审计。

### 5.4 Provider 分层

必须区分：

1. **Model Provider Adapter**：OpenAI Responses、OpenAI Chat Completions legacy、Anthropic Messages、Gemini、Ollama/OpenAI-compatible。
2. **External Agent Adapter**：Codex CLI/app-server、Claude Code CLI/SDK、自定义 Agent。

统一能力描述：

- text / image / file / PDF
- tool calling
- streaming tool calls
- reasoning summary
- structured output
- context window
- prompt caching
- usage/cost
- interruption/resume
- max output

不支持的能力必须在发起任务前提示，不能静默降级。

### 5.5 Tool Execution Kernel

统一所有 Bash、MCP、插件、工业工具和外部 Agent 的执行策略：

- filesystem roots
- network policy
- env allowlist
- command allow/deny
- timeout/CPU/memory/output limit
- process tree termination
- user approval
- audit event
- artifact collection

平台策略：

- macOS：受控 profile + workspace 约束；逐步替换对单一 `sandbox-exec` 的依赖。
- Linux：bubblewrap/user namespace/seccomp 可用时启用。
- Windows：restricted token/job object；高风险任务推荐 WSL2、容器或受控 Worker。
- 所有平台：无强隔离时必须显示“权限边界较弱”，不得假装已沙箱化。

### 5.6 Industrial Engineering Graph

统一节点：

- Requirement
- Function
- System / Subsystem / Component
- Interface
- Parameter / Unit
- Material
- Artifact
- Verification
- Evidence
- Risk
- Change
- Release

统一关系：

- satisfies
- allocated_to
- depends_on
- interfaces_with
- produces
- derived_from
- verifies
- evidenced_by
- supersedes
- blocks_release

所有 artifact 具备：

- real / simulated / not_run / external_required
- toolName、toolVersion、adapterVersion
- source inputs、parameters、units
- checksum
- generatedAt
- human approval
- linked requirements/tests

### 5.7 Commercial Tool Worker

SolidWorks、AVEVA、Altium、Revit、CODESYS、TwinCAT 不应只做本机按钮。新增安全 Worker：

```text
Hi Code Engine → Worker Registry → Licensed Windows Worker
               → SolidWorks/AVEVA/... Bridge
               → artifact + logs + tool version + evidence
```

Worker 注册：OS、工具、版本、许可证状态、能力、并发、允许项目。任务通过 mTLS/短期 token 或本地受控网络执行。商业工具未连接时保持 `external_required`。

---

## 6. 渐进式目录演进

不做一次性 monorepo 大迁移。先建立边界，再逐模块迁移：

```text
packages/
  protocol/          # v2 schema、JSON-RPC、event types
  engine/            # thread/turn/provider/tool/policy/job/artifact
  storage/           # SQLite/JSONL migration/blob store
  sdk-ts/
  sdk-python/
  industrial-core/   # graph、units、traceability、change impact
  industrial-worker-protocol/
apps/
  desktop/
    main/
    preload/
    renderer/
  cli/
  tui/
plugins/
  built-in/
domain-packs/
  built-in/
tests/
  unit/
  integration/
  electron-e2e/
  visual/
```

迁移期间保持原入口和兼容 façade，直到对应测试和数据迁移完成。

---

## 7. v0.6 分批开发计划

### 7.1 v0.6.0-alpha.7：模型输出进入协议，移除桌面 stdout 依赖

**用户问题**：模型回复无法作为协议事件可靠持久化；并行 session 容易串流。

**修改面**：

- 新增 `RuntimeEventSink` / `RuntimeEventBus`
- `src/agent.ts` 通过 sink 发送 assistant delta/completed
- Runtime Protocol 增加真实 message/model events
- Electron、CLI、TUI 分别订阅同一事件，不再依赖全局 stdout
- 旧 stdout bridge 保留一个版本的 feature flag fallback

**持久化**：delta 可批量写入，completed 必须持久化完整内容。

**测试**：

- 两个并发 runtime 输出不串线
- 中断时保留 partial response
- Electron adapter、CLI adapter、TUI adapter 接收同一事件序列
- 无 `process.stdout.write` monkey patch 也能完成桌面 turn

**验收**：`npm run verify`、runtime protocol focused tests、desktop bridge tests。

**禁止提前做**：不在本批重写整个 UI，不引入所有 Provider。

### 7.2 v0.6.0-alpha.8：完整事件重放、线程恢复和存储适配层

**用户问题**：event-only session 只能摘要回放，崩溃后不能继续。

**修改面**：

- `ThreadStore` / `EventStore` / `SnapshotStore` 接口
- message、tool、approval、diff 全量事件
- turn 状态机和幂等恢复
- JSON/JSONL v1 importer
- desktop/CLI/TUI session browser 使用同一 store

**验收**：

- 删除 session JSON 后仍可从 events 重建完整对话
- app 在模型 streaming、tool running、approval waiting 三种状态崩溃后可恢复
- sequence/idempotency 无重复
- 老用户数据可读，迁移失败可回滚

### 7.3 v0.6.0-alpha.9：Provider Adapter v2、附件与统一 Command Router

**用户问题**：只支持 OpenAI-compatible chat completions；command/native action/agent route 分散。

**修改面**：

- Model Provider 接口和 capability negotiation
- OpenAI Responses adapter + legacy adapter
- Anthropic adapter
- Ollama/OpenAI-compatible adapter
- attachment store：image/file/PDF metadata、hash、capability check
- `CommandRegistry`：slash/native/agent/tool intent 分层

**验收**：

- 不支持图片的模型在发送前明确阻止
- provider-specific usage/error/tool semantics 不丢失
- 命令名冲突可检测
- CLI/TUI/Desktop command parity matrix 通过

### 7.4 v0.6.0-beta.1：新 App Shell 与渐进式 React/TypeScript Renderer

**技术决策**：采用 React + TypeScript + Vite 渐进迁移，不做一次性重写。

**先迁移**：

1. App Shell / Router / Store
2. Session Sidebar
3. Conversation / Timeline / Inspector
4. Settings
5. Job Center / Patch Arena
6. Industrial / Store / Plugins

**保留**：preload contract 和未迁移旧面板，通过 adapter 嵌入。

**验收**：720、1024、1440、1920 宽度无功能不可达；顶部动作进入 overflow menu；timeline/inspector 使用 drawer；键盘可完成核心任务。

### 7.5 v0.6.0-beta.2：完整编码桌面闭环

新增：

- CodeMirror 6 文件编辑器
- xterm.js + PTY 集成终端
- Diff comments 和 review loop
- App Preview（受控 WebContentsView/本地 server）
- Plan mode、steer running turn、queued follow-up
- Git commit/branch/PR/CI status
- 并行 session/worktree workspace

验收用户流：

`打开仓库 → 提问/计划 → 执行 → 终端测试 → Preview 验证 → Diff 评论 → 修正 → Commit/PR`

整个流程不离开 Hi Code。

### 7.6 v0.6.0-rc.1：安全、E2E、打包和发布

- Electron 升级到当前受支持稳定主线
- electron-builder 升级到受支持 26.x
- OS Keychain/safeStorage secret refs
- macOS/Windows/Linux CI matrix
- Playwright Electron E2E + visual regression
- macOS signing/notarization
- Windows signing
- Linux AppImage/deb
- auto-update stable/beta/nightly channels
- crash report（默认本地、用户选择上传）
- SBOM、checksums、release provenance

### 7.7 v0.6.0 稳定版发布门槛

- Runtime Protocol v2 是唯一事实源
- 任意完整 turn 可从 store 重放
- 无全局 stdout bridge
- 三平台核心 E2E 通过
- 签名安装包和更新链路通过
- P0/P1 发布问题为 0
- Code Studio 核心用户流通过
- 文档只宣称真实能力

---

## 8. v0.7–v1.0 路线

### v0.7：Plugin / Skill / Hook 平台

- `hicode.plugin.json` v2
- command、skill、agent、hook、MCP、settings、permission
- hook events：SessionStart、BeforeModel、BeforeTool、AfterTool、BeforeCommit、BeforeRelease、OnError
- 插件独立进程/Worker 隔离，不允许任意 renderer 注入
- scaffold/validate/test/pack/sign/install/update/uninstall
- trust level 和企业 managed policy

### v0.8：App Server / SDK / External Agent

- 本地 app-server JSON-RPC
- TypeScript/Python SDK
- thread start/resume、stream、approval、job、artifact API
- 真实 Codex adapter
- 真实 Claude Code adapter
- local agent adapter
- external agent 强制 worktree
- Patch Arena 真实多 Provider candidate
- desktop/CLI/TUI/SDK thread handoff

### v0.9：企业、安全与远程执行

- managed policy
- MCP HTTP/OAuth
- gateway/proxy
- remote execution workers
- SSO/组织账号（此时再替换当前单机本地 auth）
- audit ledger
- telemetry opt-in
- MDM 配置
- signed plugin/domain pack

### v1.0：Industrial Studio

不同时深挖十几个行业。先做三个高价值完整纵向样板：

1. **自动化控制柜/设备单元**：机械外壳、电气、PLC、PCB、BOM、FAT/SAT。
2. **微电网/能源控制系统**：单线图、负荷/潮流、保护设置、控制、BOM、验证。
3. **化工 Process Skid**：PFD/P&ID、设备/管线表、物料衡算、HAZOP、控制、FAT/SAT。

每个样板必须具备：

- 结构化 requirements
- 工程对象图
- 参数/单位
- 真实或明确 simulated 的 tool runs
- artifact preview
- change impact
- domain gates
- human approvals
- evidence binder
- release package

完成三个纵向闭环后，再扩展 SolidWorks、AVEVA、Altium、Revit、CODESYS、TwinCAT 等商业 Worker。

---

## 9. UI 重构蓝图

### 9.1 信息架构

```text
AppShell
├─ ProjectRail                # 项目/模式/全局入口
├─ SessionSidebar             # 会话、任务、筛选、状态
├─ Workspace
│  ├─ ConversationPane
│  ├─ PlanPane
│  ├─ EditorPane
│  ├─ DiffPane
│  ├─ TerminalPane
│  ├─ PreviewPane
│  ├─ JobPane
│  ├─ ArenaPane
│  └─ IndustrialPane
├─ Inspector
│  ├─ Context/Files
│  ├─ Tools/MCP
│  ├─ Approvals
│  ├─ Artifacts
│  ├─ Gates
│  └─ Usage/Diagnostics
├─ CommandPalette
└─ NotificationCenter
```

### 9.2 状态分层

- Server state：Engine event stream + query cache
- UI state：pane layout、selection、filters、drafts
- Persisted preference：window/layout/theme/density/keybindings
- Form state：industrial/adapter/settings 表单
- 不在一个全局 object 中混合所有状态

建议：React Context 仅放稳定服务；Zustand/Redux Toolkit 任选其一管理 UI；TanStack Query 或自研 event cache 管 server state。不要同时引入多个大状态库。

### 9.3 响应式规则

| 宽度 | 布局 |
|---|---|
| >= 1440 | Project rail + session sidebar + workspace + inspector |
| 1100–1439 | rail + sidebar + workspace；inspector 作为可停靠 overlay |
| 800–1099 | icon rail + workspace；sidebar/inspector 为 drawer；动作进入 `More` |
| 720–799 | 单主视图 + icon rail；所有次级 pane 使用全高 sheet；不隐藏功能 |

禁止使用 `overflow:hidden` 或 `display:none` 让功能消失而没有替代入口。

### 9.4 设计 Token

- spacing：4/8/12/16/24/32
- radius：6/8/12/16
- density：comfortable/compact
- typography：UI、mono、工业数据三套 token
- semantic colors：info/success/warning/error/simulated/not-run/approval
- motion：120ms micro、180ms panel、240ms layout
- reduced-motion 完整支持
- 对比度目标 WCAG 2.2 AA

### 9.5 动效

只表达状态：

- streaming cursor
- tool running pulse
- approval wait
- diff applied
- job progress transition
- panel open/close

不使用持续装饰动画，不让动画掩盖错误。

### 9.6 性能

- 长对话、timeline、job events 使用虚拟列表
- 大 diff 分文件/分块加载
- 工业表格采用 row virtualization
- 3D/CAD preview 独立 worker/webview，按需加载
- event stream 批量合并渲染，避免每 token 全树更新

### 9.7 测试

- Playwright Electron：启动、开项目、发消息、审批、diff、恢复、设置、Job、Industrial
- screenshot widths：720/820/1024/1180/1440/1920
- keyboard-only flows
- axe accessibility
- IME 中文输入测试
- 1000 条事件、5000 行 diff、10000 行 BOM 性能基准

---

## 10. 90 天路线图

| 周 | 里程碑 | 发布门槛 |
|---|---|---|
| 1 | 建立 Program Board、ADR、E2E 基线；Electron 升级兼容分支 | 当前测试不回退；新 Electron 启动 smoke 通过 |
| 2 | Runtime Event Sink；assistant delta/completed 事件 | Desktop 不依赖 stdout 获取回复 |
| 3 | Thread/Event/Message store adapter | 完整 turn 可重建 |
| 4 | 崩溃/中断/审批恢复和 v1 migration | crash recovery matrix 通过 |
| 5 | Provider Adapter v2 + OpenAI Responses/legacy | capability negotiation 通过 |
| 6 | Anthropic/Ollama adapter、附件和 Command Registry | 多模型集成测试通过 |
| 7 | React/TS App Shell、session sidebar | 720–1920 布局 smoke 通过 |
| 8 | Conversation/Timeline/Inspector 迁移 | 长事件虚拟化通过 |
| 9 | Editor、Diff Review、Terminal | 文件编辑/测试/diff 流程通过 |
| 10 | App Preview、Plan/Steer/Queue、Git/PR | 完整 coding loop E2E 通过 |
| 11 | Keychain、sandbox policy、MCP HTTP/OAuth 基础 | security suite 通过 |
| 12 | 签名/更新/三平台 CI、SBOM | RC artifacts 可安装 |
| 13 | 工业图 v2 + Control Box 2.0 集成 | 一个工业纵向 release binder 通过 |

90 天目标是 **v0.6 stable coding desktop + Industrial Studio preview**，不是宣称所有工业行业深度完成。

---

## 11. 第一批立即实施的三个任务

### HC-RUN-201：Runtime Event Sink 与 assistant output 事件

**范围**：`src/agent.ts`、`src/runtime.ts`、`src/runtime-protocol.ts`、Electron/TUI adapter、tests。

**验收**：

- assistant delta/completed 进入协议
- 两个 session 并发不串流
- desktop 不依赖 stdout bridge
- 原 CLI 输出保持兼容

### HC-RUN-202：完整事件重放和恢复契约

**范围**：event/message store adapter、session replay、migration tests。

**验收**：

- 删除 session JSON 后仍恢复完整 user/assistant/tool/diff/approval transcript
- event-only session 可以继续，不再只读摘要
- 崩溃后 running turn 变成 recoverable 状态

### HC-QA-101：Electron Playwright 与响应式基线

**范围**：E2E harness、测试夹具、720/1024/1440 screenshot、关键动作可达性。

**验收**：

- CI 能启动真实 Electron
- 顶部动作、小窗口 sidebar、timeline/inspector 均有可访问入口
- 历史品牌截断回归测试

这三个任务足够小，可以独立提交、测试和回滚。

---

## 12. Codex 全权开发组织方式

### 12.1 不使用一个超长会话直接改所有代码

使用一个 Program Director 和四个隔离 worktree：

- `program-director`：维护 backlog、依赖、ADR、验收，不直接大规模编码
- `runtime-engine`：Protocol/Store/Provider/Tool
- `desktop-ux`：Renderer/Electron UX/E2E
- `security-release`：sandbox/keychain/CI/package/update
- `industrial-platform`：graph/adapters/workers/samples
- `integration-review`：合并、回归、审计

### 12.2 每个任务的强制结构

每张任务卡必须含：

- problem
- user outcome
- in-scope files/interfaces
- out-of-scope
- migrations
- security impact
- tests
- acceptance criteria
- rollback
- docs
- evidence paths

### 12.3 合并门禁

- build
- type/syntax
- focused unit/integration
- feature regression
- security
- DoD scan
- Electron E2E（影响 UI/IPC 时）
- migration test（影响 store 时）
- artifact/evidence validation（影响 industrial/release 时）

### 12.4 Codex 可以自主决定的内容

- 小范围命名、文件拆分、测试组织
- 满足架构约束的内部实现
- 修复同一根因引起的相邻 bug
- 低风险依赖升级

### 12.5 必须停下并记录 blocker 的内容

- 产品数据不可逆迁移
- 安全策略显著放宽
- 商业软件 SDK/许可证不可用
- 需要证书、账号、云资源或付费服务
- 需要改变隐私/遥测默认值
- 两个 ADR 方案有明显产品取舍

Codex 遇到 blocker 时不得用 mock 冒充完成，应继续处理不依赖 blocker 的任务。

---

## 13. Definition of Done

一个功能只有同时满足以下条件才算完成：

1. 真实用户入口
2. 核心实现
3. Engine/API/IPC 契约
4. 状态与持久化
5. 取消、错误、恢复
6. 权限和安全边界
7. unit/integration/E2E 中适用的测试
8. 文档和迁移说明
9. 运行 evidence
10. 无 TODO-only、mock-only、fake pass
11. simulated/not_run/external_required 标记真实
12. 可回滚
13. 在 720/1024/1440 宽度可用
14. CLI/TUI/SDK 适用时有一致路径

---

## 14. 暂时不能对外宣称的能力

在相应验收通过前，不能宣称：

- 已达到 Claude Code/Codex 全功能同等水平
- 已完成可靠 app-server/SDK
- Codex/Claude provider 已真实可用
- 所有平台具有同等级强沙箱
- 所有会话可从 protocol 完整恢复
- 已完成 SolidWorks/AVEVA 深度自动化
- 已精通所有工业领域
- Hi Code 能自动完成安全认证或法规合规
- simulated/dry-run artifact 是真实工具输出
- 当前安装包适合大规模企业部署

---

## 15. 项目负责人需要确认的十个决策

| 决策 | 推荐默认 |
|---|---|
| Renderer 是否迁移 React/TS | 是，渐进迁移，不大爆炸重写 |
| 持久化目标 | SQLite/WAL + blob store，保留 JSONL 导出 |
| v0.6 首发平台 | macOS + Windows；Linux beta 同步 CI |
| 模型 Provider 首批 | OpenAI Responses、legacy compatible、Anthropic、Ollama |
| 集成编辑器 | CodeMirror 6；不把产品做成完整 IDE |
| 终端 | xterm.js + PTY，命令执行仍走 policy kernel |
| 商业工业工具 | Licensed Remote Worker，而不是本机假集成 |
| 第一工业纵向 | 自动化控制柜/设备单元 |
| Telemetry | 默认关闭或本地优先，用户显式选择上传 |
| 云服务范围 | v0.6 不做；v0.8 后按账号/协作需求立项 |

---

## 16. 最终成功标准

Hi Code 真正成功，不是菜单比竞争产品多，而是：

1. 用户能在桌面完成真实软件从需求到 PR/Release 的闭环。
2. 任务崩溃、应用重启和会话切换后仍可恢复。
3. 多 Agent 在隔离 workspace 中工作，结果可比较、审查和合并。
4. 插件、Hooks、MCP、SDK 通过稳定协议扩展，而不是修改主进程。
5. 工业项目中的每个 artifact 都能追溯到需求、工具、参数、验证和证据。
6. 真实、模拟、未运行和外部执行状态永远不会混淆。
7. 客户拿到的是安装包、源码、图纸/BOM/PLC/报告、测试和 evidence，而不是骨架。
