<div align="center">
  <img src="build/icon.png" width="112" alt="Hi Code" />
  <h1>Hi Code</h1>
  <p><a href="README.md">简体中文</a> | <strong>English</strong></p>
  <p>A local-first desktop coding agent for any OpenAI-compatible model</p>
  <p>
    <img src="https://img.shields.io/badge/version-0.5.0-4f6f64" alt="version" />
    <img src="https://img.shields.io/badge/license-MIT-5b6f92" alt="license" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-3c873a" alt="node" />
    <img src="https://img.shields.io/badge/status-early%20stage-e0a458" alt="status" />
  </p>
</div>

---

Current version: **0.5.0**.

Hi Code is a desktop coding agent workbench in the spirit of Codex and Claude Code, built for **any OpenAI-compatible model** — Kimi, DeepSeek, Qwen, GLM, MiniMax, Ollama/local models, vLLM, OpenRouter, OpenAI-compatible APIs, or anything that speaks `/chat/completions`.

The project started as `vibe`; some internal paths and compatibility names still use `vibe` and will be migrated carefully.

It's a real agent loop: the model reads and writes files, runs shell commands, searches the repo, and iterates until the task is done — with streaming output, colored diffs, and a permission gate before anything mutates your machine.

## Features

- **Agent loop** with multi-step tool use (up to 50 steps/turn)
- **Tools:** `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep` (ripgrep), `bash`
- **🖥 Real TUI (Ink):** scrollback, live streaming, spinner, in-app permission prompts, Tab completion, a live model/token status footer — with an automatic readline fallback for pipes/CI
- **🌿 Git-aware:** branch + dirty count in the banner and system prompt; `/diff` to review the working tree
- **🖼 Image input:** `@photo.png` attaches the image to your message for vision-capable models
- **🧑‍🤝‍🧑 AI team / multi-agent:** delegate to specialist teammates that run autonomously and report back
- **🔌 MCP client:** connect stdio MCP servers; their tools become agent tools
- **💾 Session persistence:** every turn is saved; `--continue` / `/resume` to pick up where you left off
- **⏹ Interruptible:** Ctrl-C cancels an in-flight turn cleanly (keeps the partial output)
- **↩ Undo:** `/undo` reverts the file changes from the last turn
- **⌨ Persistent history + Tab completion:** ↑/↓ recalls commands across sessions; Tab completes slash commands, roles, and `@file` paths
- **🛡 Bash sandbox (macOS):** confine shell writes to the workspace via `sandbox-exec`
- **Streaming** assistant output (token-by-token)
- **Colored diff preview** before every write/edit
- **Tolerant patching:** `edit_file` falls back to fuzzy (indentation-insensitive) matching
- **Permission system:** `default` (confirm mutations) · `acceptEdits` · `yolo`
- **Context management:** token estimate + auto/manual `/compact`
- **Resilience:** retry with exponential backoff on 429/5xx/network errors
- **Slash commands:** `/help /clear /compact /undo /diff /team /build /agent /agents /council /debate /models /model /mode /yolo /sessions /resume /mcp /sandbox /cost /tools /init /cwd /exit`
- **Input sugar:** `!cmd` runs a shell command directly, `@path` inlines a file into your message
- **Project memory:** auto-loads `AGENTS.md` / `CLAUDE.md` / `README.md` into the system prompt
- **One-shot mode:** `hicode "explain src/agent.ts"`

### Engineering workbench (desktop)

A set of built-in desktop panels aimed at "industrial-grade" multi-agent development — all shipped in an early but working form:

- **Job center:** visualize the runtime queue; queue, cancel, and persist/recover tasks
- **Patch Arena:** multiple agents compete to produce a patch; compare, review, and adopt the best one
- **AI team / agent orchestration:** assemble specialist teams that work in parallel in isolated git worktrees
- **Industrial projects:** project templates and workflows for hardware/engineering domains (early FreeCAD-style tool adapters included)
- **Quality gates:** admission checks for changes, with traceable results
- **Release center:** build release artifacts and generate release records
- **Domain packs:** per-industry bundles of templates, checklists, and agent profiles — install and enable in one click

## AI team (multi-agent)

Hi Code ships with a roster of specialist agents that share your working directory and
collaborate on real files:

| Role        | Tools                  | Job                                            |
| ----------- | ---------------------- | ---------------------------------------------- |
| `architect` | read-only              | investigates and writes a concrete plan        |
| `coder`     | full                   | implements changes                             |
| `reviewer`  | read-only + bash       | reviews diffs, runs tests, approves or flags   |
| `tester`    | full                   | writes and runs tests                          |
| `explorer`  | read-only              | researches and answers questions               |

Ways to use them:

**1. Fixed pipeline** — architect → coder → reviewer → (auto fix-up if not approved):

```
› /team add a --version flag to the CLI and cover it with a test
```

**2. Manager + parallel** — a manager model decomposes the goal into a task
graph; independent tasks run **concurrently** (in `yolo` mode), dependent ones
wait for and receive their predecessors' reports:

```
› /yolo
› /build scaffold a config module, a logger module, then wire them into main
╔══ PROJECT MANAGER ══
  task plan:
    t1  @coder     create the config module        
    t2  @coder     create the logger module         
    t3  @coder     wire both into main      ⟵ t1, t2
▶ running 2 in parallel: t1:@coder, t2:@coder
  ✓ t1 @coder  [write_file]
  ✓ t2 @coder  [write_file]
▶ t3 — @coder …
```

**3. Delegate a single teammate:**

```
› /agent explorer where is rate limiting handled in this repo?
› /agent reviewer check my last change for off-by-one bugs
```

The lead agent can also delegate on its own via the `spawn_agent` tool whenever it
decides a subtask deserves a focused specialist (e.g. an independent review).

## Model fusion (多模型融合，取长补短)

Different models have different strengths. Hi Code lets several models work together
two ways:

### 1. Heterogeneous team — fusion by specialization

Map each role to its own model. A strong reasoner plans, a code-specialized model
implements, a *different* model reviews (cross-checking the first):

```json
{
  "profiles": {
    "reasoner": { "baseURL": "https://api.deepseek.com/v1", "apiKey": "sk-..", "model": "deepseek-reasoner" },
    "coder":    { "baseURL": "http://127.0.0.1:8000/v1",    "apiKey": "x",     "model": "qwen2.5-coder-32b" },
    "fast":     { "baseURL": "http://127.0.0.1:11434/v1",   "apiKey": "x",     "model": "llama3.1:8b" }
  },
  "defaultProfile": "coder",
  "roleModels": {
    "architect": "reasoner",
    "coder":     "coder",
    "reviewer":  "reasoner",
    "explorer":  "fast"
  }
}
```

Now `/team <goal>` runs the architect on `deepseek-reasoner`, the coder on
`qwen2.5-coder`, and the reviewer back on `deepseek-reasoner` — each agent shows
its model in the header. `/models` prints the full mapping.

### 2. Model council — fusion by cross-validation

`/council <question>` asks **every** member model the same question in parallel,
then a synthesizer model merges their answers — keeping the strongest points,
correcting errors, and flagging disagreement:

```json
{
  "councilMembers": ["reasoner", "coder", "fast"],
  "councilSynthesizer": "reasoner"
}
```

```
› /council what's the safest way to migrate this table without downtime?
⚖ MODEL COUNCIL
  ◆ reasoner (deepseek-reasoner) …
  ◆ coder    (qwen2.5-coder-32b) …
  ◆ fast     (llama3.1:8b)       …
  ★ synthesis (deepseek-reasoner) → one merged best-of answer
```

### 3. Debate — fusion by argument

`/debate <question> [rounds]` runs multiple rounds where each model sees the
others' latest answers and revises or defends its position, then a moderator
delivers the verdict. Debaters have **read-only codebase tools** (`read_file`,
`ls`, `glob`, `grep`), so they can ground their arguments in the real source —
a model that actually checks the code can correct one that's guessing:

```
› /debate is rate limiting handled in the gateway or the client? 2
▶ Debate round 1/2   (one model greps the code, one guesses)
▶ Debate round 2/2   (the guesser is corrected by evidence)
  ★ synthesis → verdict, grounded in the codebase
```

## Install

**Prebuilt desktop packages** — grab them from the [Releases](../../releases) page:

- **Windows:** `Hi Code-Setup-<version>-win-x64.exe` installer (choose your install dir), or the portable `Hi Code-<version>-win.zip`
- **macOS:** `Hi Code-<version>.dmg` (unsigned for now — right-click → Open on first launch)

Each release ships a `SHA256SUMS.txt` to verify downloads.

**From source:**

```bash
cd hi-code
npm install
npm run build
npm link        # optional: puts `hicode` on your PATH
```

Or run from source without building:

```bash
npm run dev      # uses tsx
```

Package desktop builds yourself:

```bash
npm run dist:mac   # macOS dmg
npm run dist:win   # Windows installer + portable zip (cross-builds on macOS/Linux)
```

## Configure

Hi Code reads config from (in priority order) env vars → `~/.hicode/config.json` → defaults.

### Desktop quick setup

In the desktop app, click **接入 API** or the model pill, then:

1. choose a provider;
2. paste the API key;
3. click **测试连接** and **保存并使用**.

The app writes the default profile to `~/.hicode/config.json` and reloads the model immediately. Use **高级 JSON** only when you need multiple profiles, council models, MCP servers, or sandbox settings.

### Skill Store sources

The desktop **商店** page can search and install Plugins, Skills, MCP servers, and Agents from the active catalog source. Catalog items are validated in the Electron main process, and installs show a permission/file-change preview before writing local files. See `docs/store-catalog.md` and `docs/store-catalog.schema.json` for the source format.

### v0.5 planning

The v0.5 architecture, AI Agent team split, Codex parity matrix, and Sprint roadmap live in `docs/hi-code-architecture-and-sprints.md`.

### Env vars

```bash
export VIBE_BASE_URL="http://127.0.0.1:11434/v1"   # OpenAI-compatible endpoint
export VIBE_API_KEY="sk-..."                        # any non-empty string for local
export VIBE_MODEL="deepseek-chat"
```

### `~/.hicode/config.json`

```json
{
  "baseURL": "https://api.deepseek.com/v1",
  "apiKey": "sk-xxxxxxxx",
  "model": "deepseek-chat",
  "contextWindow": 65536,
  "temperature": 0.2,
  "compactThreshold": 0.75
}
```

### Pointing at common backends

| Backend            | baseURL                              | notes                          |
| ------------------ | ------------------------------------ | ------------------------------ |
| Ollama             | `http://127.0.0.1:11434/v1`          | `apiKey` can be any string     |
| vLLM               | `http://127.0.0.1:8000/v1`           | must serve a tool-capable model|
| DeepSeek (hosted)  | `https://api.deepseek.com/v1`        | needs a real key               |
| LM Studio          | `http://127.0.0.1:1234/v1`           |                                |

> The model **must support tool/function calling** for the agent loop to work. Most current DeepSeek, Qwen, and Llama-3.1+ instruct models do.

## Usage

```bash
hicode                       # interactive — Ink TUI on a real terminal
hicode --no-tui              # force the plain readline frontend
hicode --yolo                # auto-approve all tool calls
hicode -m deepseek-coder     # override model
hicode "add a /version flag" # one-shot (non-interactive)
hicode --continue            # resume the last session here
```

On a real terminal Hi Code runs a full **Ink TUI** (scrollback, live streaming,
spinner, Tab completion, in-app permission prompts). When stdin isn't a TTY
(pipes, CI, `--no-tui`) it automatically falls back to a readline REPL — the
agent core is identical either way.

In the REPL, just talk to it:

```
› refactor src/llm.ts to retry on 429 with exponential backoff, then run the build
```

## Sessions, sandbox & MCP

### Sessions

Every turn is written to `~/.hicode/sessions/<id>.json` (keyed by working directory).

```bash
hicode --continue        # resume the most recent session in this directory
hicode --resume <id>     # resume a specific session
```

In the REPL: `/sessions` lists them, `/resume <id>` loads one.

### Sandbox (macOS)

```bash
hicode --sandbox         # confine bash file-writes to the workspace + temp dirs
```

Reads stay unrestricted; writes outside the workspace are denied by an
`sandbox-exec` SBPL profile. Toggle at runtime with `/sandbox on|off`. (No-op on
non-macOS platforms — there it just runs normally.)

### MCP servers

Add stdio MCP servers to `~/.hicode/config.json`; their tools are auto-discovered
at startup and offered to the agent as `mcp__<server>__<tool>`:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "ghp_..." } }
  }
}
```

`/mcp` lists connected servers and their tools.

## Architecture

```
src/
  index.ts         entry: CLI flags, frontend selection (TUI vs readline), one-shot
  tui.tsx          Ink terminal UI (scrollback, streaming, input, prompts)
  runtime.ts       shared session runtime (turns, commands, undo) used by both frontends
  completer.ts     Tab-completion (commands, roles, @paths)
  agent.ts         the tool-use loop (runLoop / runTurn)
  llm.ts           OpenAI-compatible streaming client (raw fetch + SSE + retry)
  context.ts       token estimation + compaction
  session-store.ts persist / list / resume sessions
  mcp.ts           stdio MCP client (JSON-RPC) + tool registry
  permissions.ts   confirmation gate + modes
  commands.ts      slash commands
  ui.ts            colors, diffs, spinner, team/agent framing
  agents/
    roles.ts      specialist role definitions + tool allowlists
    subagent.ts   spawnAgent() + runTeam() pipeline
    manager.ts    runBuild() — task-graph decomposition + parallel execution
    council.ts    runCouncil() ensemble + runDebate() multi-round debate
  tools/
    index.ts      tool schemas + dispatch (incl. spawn_agent, diff preview)
    fs.ts         read/write/edit/ls/glob
    bash.ts       shell exec + ripgrep grep
```

## Safety notes

- Mutating tools (`write_file`, `edit_file`, `bash`) prompt for confirmation unless you're in `yolo` mode.
- `bash` runs with your shell and environment — only point Hi Code at repos you trust, and review commands before approving.

## Contributing & Security

- Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) (private reporting).

## License

Released under the [MIT License](LICENSE) © 2026 Hi Code Authors.

This is the open-source edition. Cloud sync, billing, hosted registries, and
other commercial add-ons live in a separate closed-source edition and are not
required to run anything here — see [docs/OPEN_CLOSED_SPLIT.md](docs/OPEN_CLOSED_SPLIT.md).

> Hi Code is an independent project and is not affiliated with, endorsed by, or
> sponsored by OpenAI or Anthropic. "Codex" and "Claude Code" are referenced
> only to describe the style of tool.
