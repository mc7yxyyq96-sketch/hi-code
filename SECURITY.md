# 安全策略

**简体中文** | [English](SECURITY.en.md)

Hi Code 运行的是一个能读写文件、执行 shell 命令的编码 Agent。我们非常重视它的安全边界。

## 报告漏洞

请**不要**为安全问题公开开 Issue。

请改用 GitHub 的私密漏洞上报：在本仓库的 **Security → Report a vulnerability** 提交。我们会尽量在数天内回复。

上报时请尽量包含：

- 问题描述及其影响
- 复现步骤（有最小可复现示例更好）
- 受影响的版本（见 `VERSION` / `package.json`）

## 安全相关范围

以下环节与安全直接相关：

- 对 `write_file`、`edit_file`、`bash` 的权限确认机制
- 工作区路径限制（防止读写到项目之外）
- macOS 上的 `sandbox-exec` bash 沙箱
- MCP server 配置与商店安装流程
- `~/.hicode` 下的本地账号/凭据存储

## 关于密钥

- API Key 存放在 `~/.hicode/config.json`（权限 `0600`）或环境变量中 —— **切勿提交到仓库**
- `~/.hicode` 下的运行时数据（会话、日志、账号）属于私有，已被版本控制排除
- 应用中展示的工具输出会对明显的密钥（Bearer token、API Key）做脱敏，但请你在批准命令前仍自行审查

## 给用户的建议

- 只把 Hi Code 指向你信任的仓库
- 批准 shell 命令和 diff 之前先看清楚内容
- 在 macOS 上用 `--sandbox` 把 bash 的文件写入限制在工作区内
- 对不熟悉的任务，优先用 `default` 权限模式，而不是 `yolo`
