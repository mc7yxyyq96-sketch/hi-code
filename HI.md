# Hi Code Project Memory

Version: 0.5.0
Date: 2026-07-04

Hi Code is being built as a Codex/Claude Code style desktop coding agent workbench.

Product direction:

- Keep the app usable in China: Kimi, DeepSeek, Qwen, GLM, MiniMax, Ollama/local, OpenRouter, OpenAI-compatible APIs, China-friendly store mirrors.
- Keep the core open enough for GitHub, while reserving cloud account, commercial marketplace, paid agent/skill packs, analytics, and hosted sync for a closed-source edition.
- Prioritize real coding-agent behavior over landing pages or decorative UI.

Current runtime architecture:

- `src/runtime.ts`: shared runtime state machine.
- `src/agent.ts`: model/tool loop.
- `src/tools/index.ts`: tool execution and structured tool events.
- `src/job-queue.ts`: main-process input job queue.
- `src/events.ts`: event schema.
- `src/diff-service.ts`: visual diff accept/reject service.
- `src/recovery.ts`: recoverable task parser from runtime logs.
- `electron/main.mjs`: Electron bridge, services, IPC, current integration hub.
- `renderer/renderer.js`: desktop UI behavior.

Current verification baseline:

- `npm run build`
- `node --check renderer/renderer.js`
- `node --check electron/main.mjs`
- `node test/feature-tests.mjs`
- Last feature-test count: 64 passed, 0 failed.

Immediate next goal:

Build a full Job/Task Center: queued, running, waiting permission, interrupted, failed, retryable, completed. Persist enough state under `~/.vibe` to survive app restart.
