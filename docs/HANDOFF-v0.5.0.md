# Hi Code v0.5.0 Handoff

Date: 2026-07-04

This is the handoff document for continuing Hi Code on another machine with Codex and Claude Code.

## Current Version

- Product version: `0.5.0`
- Package: `hi-code`
- Desktop app: `Hi Code`
- Binary field still points to `hicode`
- Latest feature verification: `67 passed, 0 failed`

## What Hi Code Is

Hi Code is a local-first desktop coding agent workbench inspired by Codex and Claude Code.

It combines:

- OpenAI-compatible model APIs
- Runtime tool loop
- Local file tools
- Bash tools with permission gates
- MCP tools
- AI team / subagents
- Store for Plugins, Skills, MCP, Agents
- Visual diff and Git workflows
- Runtime event timeline
- Recoverable tasks
- Main-process input job queue

## Main Architecture

```text
Renderer UI
  -> preload narrow IPC
  -> Electron main services
  -> shared TypeScript runtime
  -> LLM client
  -> tools / MCP / subagents
  -> structured events
  -> Renderer timeline, progress, diff, recovery
```

Important files:

| Area | File |
| --- | --- |
| Runtime state machine | `src/runtime.ts` |
| Agent/model/tool loop | `src/agent.ts` |
| LLM client | `src/llm.ts` |
| Tool dispatcher | `src/tools/index.ts` |
| Bash tool | `src/tools/bash.ts` |
| Filesystem tools | `src/tools/fs.ts` |
| Event schema | `src/events.ts` |
| Runtime job queue | `src/job-queue.ts` |
| Diff service | `src/diff-service.ts` |
| Recoverable tasks | `src/recovery.ts` |
| Git workflow | `src/git.ts` |
| Config/model profiles | `src/config.ts` |
| Electron bridge | `electron/main.mjs` |
| Preload IPC | `electron/preload.cjs` |
| Renderer UI | `renderer/index.html`, `renderer/renderer.js`, `renderer/style.css` |
| Tests | `test/feature-tests.mjs` |

Active entrypoint guard:

- Electron main process: `electron/main.mjs`
- Preload bridge: `electron/preload.cjs`
- Renderer document: `renderer/index.html`
- Renderer logic: `renderer/renderer.js`
- CLI/TUI entry: `src/index.ts`
- Legacy v0.4 entry files live under `legacy/v0.4/` and must not be edited for production changes.

## Completed Since Sprint 1

### Workbench

- Codex-like beige desktop shell.
- Sidebar with chat, search, files, Git, store, plugins, Skill, MCP, commands.
- Chat composer with model picker and reasoning level.
- Runtime progress strip above composer.
- Input can be typed while busy and queued for later sending.

### Model API Setup

- Provider presets: DeepSeek, Kimi, Qwen, GLM, MiniMax, SiliconFlow, Gemini, OpenRouter, OpenAI, Ollama, custom.
- Profiles are saved into `~/.vibe/config.json`.
- Already configured profiles can be switched from the composer model menu.
- Reasoning level can be selected from the model menu.

### Runtime and Events

- `turn:start`, `turn:update`, `turn:done`
- `tool:start`, `tool:output`, `tool:done`
- `permission:requested`
- `diff:created`, `diff:updated`
- Bash output streams into events.
- Runtime logs are written under `~/.vibe/logs/events-YYYY-MM-DD.jsonl` with redaction.
- Recoverable tasks are parsed from logs.
- `RuntimeJobQueue` serializes main-process input jobs and restores recent history.

### Diff and Git

- Visual Changes panel.
- Accept / Reject.
- Accept all / Reject all.
- History / Clear archived.
- Undo updates diff status.
- Git status page.
- Stage / unstage.
- Generate commit message.
- Commit staged changes.

### Store / Plugin / Skill / MCP Foundation

- Store page can browse/search Plugins, Skills, MCP, Agents.
- Pagination exists.
- Store sources include builtin/local/China-friendly/GitHub-oriented concepts.
- Install preview shows planned writes/downloads/config changes.
- Local capability pages exist for plugins, skills, MCP.

### Task Progress / Queue

- Runtime status strip shows stage, elapsed time, steps, model, recent output.
- Stop state no longer falsely reports done.
- Renderer queues text while busy.
- Main process serializes jobs through `RuntimeJobQueue`.

### Local App Launch

- Native open-app shortcut exists in Electron main.
- App aliases include ToDesk, Apple Music, Chrome, Safari, WeChat, Terminal, Finder, WPS, Word.

## Known Weak Spots

These are the most important issues for the next developers.

1. `electron/main.mjs` is too large.
   - Split into services: runtime, config, auth, store, git, diff, mcp, native app, logs, queue.

2. `RuntimeJobQueue` is not yet a full JobController.
   - It serializes inputs and persists recent history.
   - It does not yet model pause/resume/retry/archive, task DAG dependencies, artifacts, gate execution results, or approval records.
   - Next step: upgrade this into the full Task Center in a later sprint.

3. Renderer queue and main queue are partially unified.
   - Renderer still keeps a local composer queue for UX while the current turn is busy.
   - Main process owns authoritative queued/running state.
   - Next step: let composer submissions go directly through a future JobController so only one queue remains.

4. Store is still foundation-level.
   - Needs real registry lifecycle: update, uninstall, enable/disable, version, checksum/signature.

5. Skill injection is incomplete.
   - Skill pages exist, but selected `SKILL.md` needs proper progressive disclosure into runtime context.

6. MCP manager is incomplete.
   - Need add/edit/delete/test UI and tools/resources/prompts visibility.

7. Product naming still has old `vibe` references.
   - README and config paths still mention old naming.
   - Decide whether to preserve `~/.vibe` for compatibility or migrate to `~/.hicode`.

8. Auth is local mock/basic.
   - Open-source edition can keep local auth optional.
   - Closed-source edition should own cloud login/sync/license.

9. Security needs another pass before GitHub.
   - Check path confinement, command execution, plugin install writes, store downloads, config redaction.

10. GitHub release readiness is not done.
   - Need LICENSE, CONTRIBUTING, SECURITY, public README polish, screenshots, issue templates.

## Recommended Next Sprint

Sprint 1: Service Split and JobController.

Deliverables:

- `JobController` replacing thin queue.
- Persisted job records under `~/.vibe/jobs`.
- Main queue state exposed via preload IPC.
- `electron/main.mjs` split into services.
- Store, Git, Diff, Auth, Config, Workspace, Runtime, and MCP handlers moved behind service modules.
- Tests for queue, interrupt, permission waiting, retry, and recovery.

Acceptance:

- User can queue multiple prompts while one is running.
- UI reflects authoritative main queue.
- App restart shows recent failed/retryable jobs.
- Interrupt stops current job without losing queued jobs unless user clears them.
- Tests pass.

## Codex Development Lane

Codex should focus on architecture and correctness:

- Split `electron/main.mjs`.
- Build `JobController`.
- Add tests for queue/interrupt/retry/recovery.
- Harden security boundaries.
- Improve Git/Diff correctness.
- Prepare GitHub repository hygiene.

Suggested Codex first task:

```text
Refactor Electron main into services without changing behavior. Preserve all IPC names. Add tests where core logic can move to src/.
```

## Claude Code Development Lane

Claude Code should focus on product experience and parity:

- Task Center UI.
- Permission and progress UX polish.
- Claude Code style command palette.
- Skill/MCP/Plugin pages and setup copy.
- README/screenshots/public docs.
- Error messages for provider setup.

Suggested Claude Code first task:

```text
Design and implement a Task Center panel that displays queued, running, waiting permission, failed, retryable, and completed jobs using runtime-queue plus existing tool events.
```

## Verification Commands

Run from project root:

```bash
npm install
npm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node test/feature-tests.mjs
```

Desktop build:

```bash
npm run dist:mac
open release/Hi\ Code-0.5.0-arm64.dmg
```

Current package scripts still output app name/version through `electron-builder` using `package.json`.

## Continuation Notes

After the original v0.5.0 handoff, the local continuation work added:

- Sprint 0 verification scripts and entrypoint/security baseline tests.
- Stale root entry files moved to `legacy/v0.4/`; production changes must use active entrypoints only.
- Bash child process environment filtering.
- Store local path restrictions and explicit confirmation for unverified downloads.
- Electron renderer sandbox and `docs/SECURITY-RUNTIME.md`.
- Production dependency audit passes with `npm run audit:prod`; full dev audit remains blocked on Electron/electron-builder major upgrades.
- Renderer access to authoritative main-process `runtime-queue` state.
- A `runtime-queue:clear` IPC path so the composer can clear both local and main queued jobs.
- Recent `RuntimeJobQueue` history with `done`, `error`, and `canceled` records.
- Optional persisted queue history under `~/.vibe/jobs/runtime-jobs.json` for future Task Center work.
- Store download filename sanitization and sha256 verification when catalog entries provide `install.sha256`.

Latest local verification after these changes:

```bash
pnpm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node --check electron/preload.cjs
node test/feature-tests.mjs
```

Result: `67 passed, 0 failed`.

## Do Not Transfer

Do not put these into GitHub or shared packages:

- `node_modules/`
- `dist/`
- `release/`
- `.playwright-cli/`
- `~/.vibe/config.json`
- `~/.vibe/auth.json`
- `~/.vibe/sessions/`
- `~/.vibe/logs/`
- user screenshots with personal info unless manually approved
- any API key or token

## Package Included for iCloud

The handoff source archive should include:

- `src/`
- `electron/`
- `renderer/`
- `docs/`
- `test/`
- `build/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `HI.md`
- `VERSION`
- `hicode.config.example.json`

The archive should not include generated dependencies or private runtime state.
