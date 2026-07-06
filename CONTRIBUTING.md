# 参与共建 Hi Code

**简体中文** | [English](CONTRIBUTING.en.md)

感谢你有兴趣改进 Hi Code —— 一个面向任意 OpenAI 兼容模型的本地优先桌面编码 Agent。

## 开发环境

```bash
npm install
npm run build        # 编译 src/（TypeScript）→ dist/
```

运行：

```bash
npm run dev          # 用 tsx 直接跑 CLI/TUI（免构建）
npm run app          # 构建并启动 Electron 桌面应用
node dist/index.js   # 运行已编译的 CLI
```

## 提 PR 之前

请跑一遍标准检查，确保全部通过：

```bash
npm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node test/feature-tests.mjs   # 期望：N passed, 0 failed
```

## 项目结构

- `src/` —— TypeScript 编写的 Agent 核心（运行时、Agent 循环、工具、MCP、Git、会话、多 Agent 编排），编译到 `dist/`
- `electron/` —— 桌面主进程（`main.mjs`）与 `preload.cjs`
- `renderer/` —— 桌面界面（`index.html`、`renderer.js`、`style.css`）
- `test/` —— 不依赖 LLM 的功能测试与 mock server
- `docs/` —— 架构说明与开源/闭源边界文档

## 约定

- **保持安全边界不被破坏** —— 权限确认、工作区路径限制、密钥脱敏，详见 [SECURITY.md](SECURITY.md)
- 不要提交 API Key 或任何 `~/.hicode` 下的运行时数据
- 与现有代码风格保持一致，改动尽量聚焦
- 优先提交小而可评审的 PR，并清楚说明行为变化
- 开源版必须能在**没有任何闭源后端**的情况下运行，边界见 [docs/OPEN_CLOSED_SPLIT.md](docs/OPEN_CLOSED_SPLIT.md)

## 报告 Bug

开 Issue 时请附上：复现步骤、你的操作系统、使用的模型/服务商，以及相关日志（**记得先把密钥打码**）。安全问题请改走 [SECURITY.md](SECURITY.md)，不要公开提交。

> Hi Code 尚处于起步阶段，非常欢迎 Issue、讨论和 PR 🙌
