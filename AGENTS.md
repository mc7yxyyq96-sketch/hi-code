# Hi Code Agent Handoff

Current version: 0.5.0
Last updated: 2026-07-04

This repository is Hi Code, a desktop coding agent workbench with a shared TypeScript runtime, Electron desktop UI, CLI/TUI entry points, OpenAI-compatible model profiles, MCP, skills/plugins/store foundations, visual diff, Git workflow, runtime events, recovery, and a main-process job queue.

Before making changes, read:

1. `docs/HANDOFF-v0.5.0.md`
2. `docs/OPEN_CLOSED_SPLIT.md`
3. `docs/hi-code-architecture-and-sprints.md`
4. `docs/sprint-1-core-workbench-execution.md`

Engineering rules:

- Keep renderer isolated. Renderer must not get direct filesystem, shell, or secret access.
- Prefer adding core behavior under `src/` and exposing narrow Electron IPC from `electron/preload.cjs`.
- Preserve CLI/Electron shared runtime behavior.
- Do not commit user secrets, `~/.vibe`, iCloud backups, local sessions, auth files, or API keys.
- Run these checks before handing off:

```bash
npm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node test/feature-tests.mjs
```

Current high-priority work:

- Split `electron/main.mjs` into service modules.
- Promote `RuntimeJobQueue` into a full JobController with persisted job history.
- Connect main-process queue state to Renderer UI via `runtime-queue`.
- Complete MCP manager, Skill injection, Plugin lifecycle, and open-source/closed-source packaging split.
