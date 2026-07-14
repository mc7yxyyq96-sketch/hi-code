# 你只需要做 4 步

## 第 1 步：备份项目

打开 Hi Code 项目目录，确认它是：

`/Users/jack/Documents/Codex/2026-07-03/new-chat/work/Hi-Code`

最好先复制一份项目，或者在 Git 中提交当前代码。

## 第 2 步：把这个压缩包内容放进项目根目录

解压后，把以下内容拖入 Hi Code 项目根目录：

- `AGENTS.md`
- `docs/`
- `planning/`
- `reports/`
- `PROMPT-复制给Codex.txt`
- `CONTINUE-中断后复制给Codex.txt`

看到“合并文件夹”时选择合并。不要删除原项目代码。

放好以后，项目根目录应同时看到：

- `package.json`
- `electron/`
- `renderer/`
- `src/`
- `AGENTS.md`
- `docs/program/`
- `planning/backlog.json`

## 第 3 步：在 Codex 中打开 Hi Code 项目目录

在 Codex 桌面 App 中添加或打开这个本地项目目录：

`/Users/jack/Documents/Codex/2026-07-03/new-chat/work/Hi-Code`

权限选择项目工作区可读写和可运行命令的模式，不要选择无限制全磁盘访问。

## 第 4 步：新建一个线程并粘贴启动 Prompt

打开 `PROMPT-复制给Codex.txt`，全选、复制，粘贴到 Codex，发送。

之后让 Codex按 backlog 连续执行。会话中断时，粘贴 `CONTINUE-中断后复制给Codex.txt`。
