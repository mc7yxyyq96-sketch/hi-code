# Hi Code Claude Code Handoff

Current version: 0.5.0
Last updated: 2026-07-04

You are continuing Hi Code, a Codex/Claude Code style desktop coding agent. The user wants parity with Codex and Claude Code, plus China-friendly model/API/provider/store setup.

Read first:

- `docs/HANDOFF-v0.5.0.md`
- `docs/OPEN_CLOSED_SPLIT.md`
- `docs/hi-code-architecture-and-sprints.md`

Current product state:

- Electron app shell exists.
- Model provider setup supports OpenAI-compatible profiles, Kimi, DeepSeek, Qwen, GLM, MiniMax, Gemini, OpenRouter, Ollama/custom.
- Runtime emits structured events for turns, tools, permissions, output, and diffs.
- Visual Changes panel supports Accept/Reject/History/Clear archived.
- Git page supports status, stage/unstage, commit message generation, and commit.
- Store foundation supports plugins, skills, MCP servers, agents, categories, search, pagination, install preview, and China-friendly sources.
- Runtime has `RuntimeJobQueue` in main process to serialize input jobs.

When developing:

- Improve UX, copywriting, and Claude Code parity, but keep security boundaries intact.
- Do not put API keys or local user data into the repo.
- Keep open-source and closed-source boundaries from `docs/OPEN_CLOSED_SPLIT.md`.
- After edits, run:

```bash
npm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node test/feature-tests.mjs
```

Next best Claude Code tasks:

- Polish job queue UI and task center.
- Refine UX for permission prompts, progress states, and queued messages.
- Improve model setup copy and provider error messages.
- Draft GitHub-ready README and product screenshots for the open-source edition.
