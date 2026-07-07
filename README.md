<div align="center">
  <img src="build/icon.png" width="112" alt="Hi Code" />
  <h1>Hi Code</h1>
  <p><strong>简体中文</strong> | <a href="README.en.md">English</a></p>
  <p>本地优先的桌面编码 Agent 工作台 · 接入任意 OpenAI 兼容模型</p>
  <p>
    <img src="https://img.shields.io/badge/version-0.5.1-4f6f64" alt="version" />
    <img src="https://img.shields.io/badge/license-MIT-5b6f92" alt="license" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-3c873a" alt="node" />
    <img src="https://img.shields.io/badge/status-起步阶段·持续更新-e0a458" alt="status" />
  </p>
</div>

---

**Hi Code 是一个本地优先的桌面编码 Agent 工作台**，对标 Codex / Claude Code 的使用体验，但面向国内环境从零打造：接入**任意 OpenAI 兼容模型**——Kimi、DeepSeek、通义千问（Qwen）、智谱 GLM、MiniMax、Ollama / 本地模型、vLLM、OpenRouter，或任何能讲 `/chat/completions` 的服务。

它不是一个套壳聊天框，而是一个**真正会干活的 Agent 循环**：模型自己读写文件、执行命令、搜索仓库、反复迭代直到任务完成——全程有流式输出、彩色 diff 预览，以及在改动你机器之前的**权限确认**。

> ⚠️ **项目处于起步阶段**：v0.5.1 是一个可用、可跑通的早期版本，核心能力已经成型，但仍在快速迭代中。功能、界面、文档都会**持续更新**。欢迎试用、提 Issue、参与共建 🙌

---

## 🖼 界面预览

> 界面截图整理中，敬请期待。桌面应用是一体化工作台，包含：聊天与工具时间线、可视化 diff（保留 / 撤销 / 历史）、Git 面板、模型设置、商店与 MCP 配置等工作区。

<!-- TODO: 在此放置界面截图，例如：
<div align="center">
  <img src="docs/screenshots/workspace.png" width="760" alt="Hi Code 工作台" />
</div>
-->

---

## ✨ 核心特性

### 🤖 真实的 Agent 能力
- **多步工具调用**（单轮最多 50 步），模型自主决策
- **工具集**：`read_file`、`write_file`、`edit_file`、`ls`、`glob`、`grep`（ripgrep）、`bash`
- **流式输出** + **彩色 diff 预览**：每次写入/编辑前先给你看改了什么
- **容错补丁**：`edit_file` 匹配不上时自动回退到缩进无关的模糊匹配
- **可中断**：一键停止正在执行的任务，保留已产出的内容
- **撤销**：`/undo` 回滚上一轮的文件改动

### 🖥 双前端
- **桌面应用（Electron）**：聊天、工具时间线、可视化 diff、Git、模型设置、商店、插件、技能、MCP —— 一体化工作台
- **终端 TUI（Ink）**：滚动回看、实时流式、权限确认、Tab 补全、模型/Token 状态栏；管道/CI 环境自动回退到 readline

### 🏭 工程化工作台（桌面版）
围绕「多 Agent 工业化开发」的一组内置面板，均已可用、持续打磨中：

- **任务中心**：运行队列可视化，排队 / 取消 / 历史记录，任务可持久化恢复
- **竞技场（Patch Arena）**：多个 Agent 竞争产出补丁，对比、评审、择优采纳
- **AI 团队 / 智能体编排**：组建各有分工的专家团队，独立 git worktree 中并行开发
- **工业项目**：面向硬件/工程领域的项目模板与流程（含 FreeCAD 等工具适配雏形）
- **质量门禁**：为改动设置准入检查，结果可追溯
- **发布中心**：构建发布产物、生成发布记录
- **领域包**：按行业领域打包模板、检查单与 Agent 配置，一键安装启用

### 🧑‍🤝‍🧑 多 Agent 协作
内置一支各有分工、共享同一工作目录的专家团队：

| 角色 | 权限 | 职责 |
| --- | --- | --- |
| `architect` | 只读 | 调研代码库，产出具体的实现计划 |
| `coder` | 完整 | 按计划实际改代码 |
| `reviewer` | 只读 + bash | 看 diff、跑测试，通过或指出问题 |
| `tester` | 完整 | 写测试并运行 |
| `explorer` | 只读 | 检索并回答代码库相关问题 |

- `/team <目标>` —— 固定流水线：架构 → 编码 → 评审 →（必要时）修复
- `/build <目标>` —— 管理者把目标拆成任务图，yolo 模式下并行执行
- `/council <问题>` —— 多个模型并行作答，再由一个模型融合出最优答案
- `/debate <问题> [轮数]` —— 多模型多轮辩论、互相纠错，最后给出裁决

### 🔌 可扩展
- **MCP 客户端**：连接 stdio MCP server，其工具自动变成 Agent 可用的工具
- **商店雏形**：插件 / 技能 / MCP / Agent，支持分类、搜索、分页、安装预览，内置国内友好的镜像源
- **项目记忆**：自动把 `AGENTS.md` / `CLAUDE.md` / `README.md` 载入系统提示

### 🛡 安全边界
- **权限系统**：`default`（改动前确认）· `acceptEdits` · `yolo`（全自动）
- **工作区路径限制**：文件读写不越界到项目之外
- **Bash 沙箱（macOS）**：用 `sandbox-exec` 把 shell 写操作限制在工作区内
- **密钥脱敏**：工具输出里的 Bearer token、API Key 等会被自动打码

### 💾 其它
- **会话持久化**：每一轮都保存，`--continue` / `/resume` 随时接着聊
- **上下文管理**：Token 估算 + 自动/手动 `/compact` 压缩
- **图片输入**：`@截图.png` 把图片附到消息里（供支持视觉的模型使用）
- **韧性**：遇到 429 / 5xx / 网络错误自动指数退避重试

---

## 📦 下载安装

从 [Releases](../../releases) 页面下载对应平台的安装包：

- **Windows**：`Hi Code-Setup-<版本>-win-x64.exe` 安装器（可自选安装目录），或便携版 `Hi Code-<版本>-win.zip` 解压即用
- **macOS**：`Hi Code-<版本>.dmg`（应用暂未签名，首次打开请右键 → 打开）

发布包附带 `SHA256SUMS.txt`，可校验下载完整性。也可以按下面的方式从源码构建。

---

## 🚀 快速开始

> 需要 Node.js **>= 18**。

```bash
git clone <你的仓库地址> hi-code
cd hi-code
npm install
npm run build          # 编译 src/（TypeScript）→ dist/
```

运行方式：

```bash
npm run app            # 构建并启动桌面应用（Electron）
npm run dev            # 终端 TUI（用 tsx 直接跑，免构建）
node dist/index.js     # 运行已编译的 CLI
```

自行打包桌面安装包：

```bash
npm run dist:mac       # macOS dmg
npm run dist:win       # Windows 安装器 + 便携 zip（在 macOS/Linux 上也能交叉打包）
```

> 代码入口：桌面主进程 `electron/main.mjs`，渲染进程 `renderer/index.html`（组件在 `renderer/components/`），终端 CLI `dist/index.js`（源码 `src/`）。

一次性任务（跑完即退出）：

```bash
node dist/index.js "解释一下 src/agent.ts 做了什么"
```

> 桌面版**无需注册即可使用**：登录页有「跳过，先在本地使用」，本地账号只是可选功能。

---

## ⚙️ 配置模型

Hi Code 按优先级读取配置：**内置默认值 < `~/.hicode/config.json` < 环境变量**。

**方式一：桌面应用内设置**（推荐）——在界面里填 Base URL、模型名、API Key 即可。

**方式二：配置文件** —— 复制 [`hicode.config.example.json`](hicode.config.example.json) 到 `~/.hicode/config.json` 后编辑。支持多模型 profile（用于「模型融合」，让不同模型互补），也兼容单个扁平的 `{ baseURL, apiKey, model }`。

**方式三：环境变量**（适合 CI / 脚本，见 [`.env.example`](.env.example)）：

```bash
export HICODE_BASE_URL="https://api.deepseek.com/v1"
export HICODE_API_KEY="sk-你的key"
export HICODE_MODEL="deepseek-chat"
```

支持的服务：Kimi、DeepSeek、Qwen、GLM、MiniMax、Gemini、OpenRouter、Ollama / 自建，以及任何 OpenAI 兼容 API。

---

## ⌨️ 斜杠命令

```
/help  /clear  /compact  /undo  /diff
/team  /build  /agent  /agents  /council  /debate
/models  /model  /mode  /yolo
/sessions  /resume  /mcp  /sandbox
/cost  /tools  /init  /cwd  /exit
```

输入糖：`!命令` 直接执行 shell，`@路径` 把文件内容内联进消息。

---

## 🗺 路线图

Hi Code 才刚起步，方向是从「个人编码助手」逐步长成「本地优先的多 Agent 工业化开发工作台」。竞技场（Patch Arena）、工业项目、质量门禁、发布中心、领域包等工作台已落地第一版，接下来：

- **近期**：打磨各工作台的 UX 与文案，权限/进度/排队体验优化，补充界面截图与上手教程，更多 UI/端到端测试
- **中期**：完善 Agent Provider 抽象（统一接入 Claude Code / Codex / 本地 CLI），丰富领域包与工业工具适配（EDA / CAD / 仿真）
- **远期设想**：工业化模式深化 —— 全链路可追溯、审计日志、发布凭证，以及团队协作与远程执行

> 路线图会随进展调整，欢迎在 Issue 里一起讨论优先级。

---

## 🤝 参与共建 & 安全

- 欢迎贡献 —— 见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 发现安全问题？请按 [SECURITY.md](SECURITY.md) 私密上报，不要公开开 Issue

---

## 📄 许可与声明

以 [MIT 许可证](LICENSE) 开源 © 2026 Hi Code Authors。

这是**开源版**。云端同步、计费、托管仓库等商业增值能力属于独立的闭源版，运行本仓库的任何功能都**不依赖**它们——边界见 [docs/OPEN_CLOSED_SPLIT.md](docs/OPEN_CLOSED_SPLIT.md)。

> Hi Code 是一个独立项目，与 OpenAI、Anthropic 没有任何隶属或背书关系。文中提到「Codex」「Claude Code」仅用于描述这类工具的形态。
