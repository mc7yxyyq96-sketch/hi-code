# Hi Code v0.5.2 GitHub Release Draft

## 中文版

### 标题

Hi Code v0.5.2 - 桌面稳定性、商店生命周期、用量统计与发布打包

### 概要

Hi Code v0.5.2 是早期开源桌面版的一次稳定性版本。这个版本重点让用户更容易下载、安装、验证和继续参与开发，也方便后续在 Codex、Claude Code、Cursor 等工具之间协同迭代。

当前版本仍然是早期预览版，但已经具备可运行的本地 Agent 循环、桌面工程工作台、商店生命周期、MCP 支持、Job Center、Patch Arena、工业项目基础模型和发布检查。UI 体验、工业工作流深度和外部工具集成会继续演进。

### 主要更新

- 增加本地用量统计持久化和设置中心的用量统计面板。
- 修复桌面端 slash 命令、原生应用打开拦截等命令流问题。
- 改进已安装 Plugin、Skill、Agent、MCP 条目的商店生命周期展示。
- 为受商店管理的能力条目增加启用、禁用、卸载和只读状态。
- 改进商店详情页中文说明，避免把本地摘要伪装成在线翻译。
- 优化设置、Git、Job Center、工业工作台、Domain Pack、Agent Team、Toolchain、Quality Gate 等面板的响应式布局。
- 增加渲染层回归测试，覆盖弹窗裁切、设置页溢出、能力生命周期、侧边栏折叠和工作台断点。
- 增加发布元数据和 `npm run release:checksums`，用于可重复生成发布校验文件。
- 修复会话可靠性：用户输入会在模型响应前持久化，模型不可达时不会丢失本轮对话入口。

### 下载

当前 GitHub Release 已上传：

- `Hi.Code-Setup-0.5.2-win-x64.exe`
- `SHA256SUMS-v0.5.2.txt`

本地 `release/` 目录还包含可后续补传的产物：

- `Hi Code-0.5.2-arm64.dmg`
- `Hi Code-0.5.2-win.zip`

### SHA256

```text
7b66d2a6c4a00776f1d2c760be432bd265c1d3a594e63680785eee3fe45333c5  release/Hi Code-0.5.2-arm64.dmg
aa76fd189fceec21fbac38df6b1cbc232247435abbd7255ab9385aa0ef4df423  release/Hi Code-0.5.2-win.zip
3ad9d74890a4a9b11adf403cf80b48186dc7a7c3b744232603d0598a51ef9045  release/Hi Code-Setup-0.5.2-win-x64.exe
```

### 验证结果

最近一次本地验证：

- `npm run build`: passed
- `npm run verify`: passed
- `npm run release:check`: passed
- `node test/feature-tests.mjs`: 76 passed / 0 failed
- `node test/renderer-architecture-tests.mjs`: 141 passed / 0 failed
- `npm run test:security`: passed
- `npm run scan:dod`: 0 findings
- `npm run dist:mac`: passed
- `npm run dist:win`: passed
- `npm run release:checksums`: passed

### 已知限制

- macOS DMG 尚未签名。首次启动时可能需要右键应用并选择“打开”。
- Windows 安装包尚未签名，可能触发 SmartScreen 提示。
- FreeCAD、KiCad、OpenPLC、IfcOpenShell、SolidWorks、AVEVA 等外部工业工具会进行安全检测。未安装工具时走 dry-run 或 bridge-plan，不会假装已经执行真实商业软件集成。
- 真实 Codex CLI / Claude Code CLI Provider 集成保留到后续版本。当前外部 Provider 条目不能宣传为已完整接入。

### 升级说明

- 现有本地配置和会话仍保存在用户数据目录。
- 商店管理的能力条目现在会显示更清晰的生命周期状态。
- 发布校验文件可以通过以下命令重新生成：

```bash
npm run release:checksums
```

### 中文公告文案

Hi Code v0.5.2 现已发布早期开源桌面预览版。Hi Code 是一个本地优先的 AI 工程工作台，支持 OpenAI 兼容模型，具备真实 Agent 循环、MCP、可视化 diff、Git 工作流、商店生命周期、Job Center、Patch Arena 和早期工业项目工作流。本次版本重点提升稳定性、打包发布、UI 自适应和验证流程，方便更多用户安全试用并反馈问题。

## English Version

### Title

Hi Code v0.5.2 - desktop stability, Store lifecycle, usage stats, and release packaging

### Summary

v0.5.2 is a stabilization release for the early open-source desktop build. It focuses on making the app easier to try, verify, package, and continue developing across Codex, Claude Code, and Cursor.

This version is still an early preview. The core local agent loop, desktop workbench, Store lifecycle, MCP support, Job Center, Patch Arena, industrial project foundation, and release checks are present, but the UI and industrial workflow depth will continue to evolve.

### Highlights

- Added local usage statistics persistence and a Settings usage dashboard.
- Fixed desktop command flow issues around slash-command handling and native app opening.
- Improved Store lifecycle visibility for installed Plugin, Skill, Agent, and MCP entries.
- Added enable, disable, uninstall, and read-only states for managed capability entries.
- Improved Chinese Store detail summaries without pretending local summaries are online translation.
- Tightened responsive desktop layouts for settings, Git, Job Center, industrial workbench, Domain Pack, Agent Team, Toolchain, and Quality Gate panels.
- Added renderer regression tests for modal clipping, settings overflow, capability lifecycle states, sidebar collapse, and workbench breakpoints.
- Added package metadata and `npm run release:checksums` for repeatable release checksum generation.
- Fixed session reliability so user turns are persisted before model response and remain recoverable when the model server is unreachable.

### Downloads

Currently uploaded to GitHub Release:

- `Hi.Code-Setup-0.5.2-win-x64.exe`
- `SHA256SUMS-v0.5.2.txt`

Additional local artifacts in `release/` can be uploaded later:

- `Hi Code-0.5.2-arm64.dmg`
- `Hi Code-0.5.2-win.zip`

### SHA256

```text
7b66d2a6c4a00776f1d2c760be432bd265c1d3a594e63680785eee3fe45333c5  release/Hi Code-0.5.2-arm64.dmg
aa76fd189fceec21fbac38df6b1cbc232247435abbd7255ab9385aa0ef4df423  release/Hi Code-0.5.2-win.zip
3ad9d74890a4a9b11adf403cf80b48186dc7a7c3b744232603d0598a51ef9045  release/Hi Code-Setup-0.5.2-win-x64.exe
```

### Verification

Latest local verification:

- `npm run build`: passed
- `npm run verify`: passed
- `npm run release:check`: passed
- `node test/feature-tests.mjs`: 76 passed / 0 failed
- `node test/renderer-architecture-tests.mjs`: 141 passed / 0 failed
- `npm run test:security`: passed
- `npm run scan:dod`: 0 findings
- `npm run dist:mac`: passed
- `npm run dist:win`: passed
- `npm run release:checksums`: passed

### Known Limitations

- macOS DMG is not signed yet. On first launch, right-click the app and choose Open.
- Windows installer is not signed yet and may trigger SmartScreen.
- External industrial tools such as FreeCAD, KiCad, OpenPLC, IfcOpenShell, SolidWorks, and AVEVA are detected safely. Missing tools use dry-run or bridge-plan behavior and do not pretend to execute real commercial integrations.
- Real Codex CLI / Claude Code CLI provider integration is reserved for a later version. Current external provider entries must not be described as fully integrated.

### Upgrade Notes

- Existing local config and sessions remain under the user data directory.
- Store-managed capability entries now expose clearer lifecycle state.
- The release checksum file can be regenerated with:

```bash
npm run release:checksums
```

### Suggested Announcement Copy

Hi Code v0.5.2 is now available as an early open-source desktop preview. It is a local-first AI engineering workbench for OpenAI-compatible models, with a real agent loop, MCP support, visual diffs, Git workflow, Store lifecycle, Job Center, Patch Arena, and early industrial project workflows. This release focuses on stability, packaging, UI responsiveness, and verification so more users can safely try the app and give feedback.
