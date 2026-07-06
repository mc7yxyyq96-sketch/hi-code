# Contributing to Hi Code

[简体中文](CONTRIBUTING.md) | **English**

Thanks for your interest in improving Hi Code — a local-first desktop coding
agent for any OpenAI-compatible model.

## Development setup

```bash
npm install
npm run build        # compile src/ (TypeScript) → dist/
```

Run it:

```bash
npm run dev          # CLI/TUI via tsx (no build step)
npm run app          # build + launch the Electron desktop app
node dist/index.js   # run the compiled CLI
```

## Before you open a PR

Please run the standard checks and make sure they pass:

```bash
npm run build
node --check renderer/renderer.js
node --check electron/main.mjs
node test/feature-tests.mjs   # expect: N passed, 0 failed
```

## Project layout

- `src/` — the TypeScript agent core (runtime, agent loop, tools, MCP, git,
  sessions, multi-agent orchestration). Compiled to `dist/`.
- `electron/` — the desktop main process (`main.mjs`) and `preload.cjs`.
- `renderer/` — the desktop UI (`index.html`, `renderer.js`, `style.css`).
- `test/` — no-LLM feature tests and mock servers.
- `docs/` — architecture notes and the open/closed-source split.

## Guidelines

- Keep the security boundaries intact — permission gates, workspace path
  confinement, and secret redaction. See `SECURITY.md`.
- Do not commit API keys or any `~/.hicode` runtime data.
- Match the existing code style; keep changes focused.
- Prefer small, reviewable PRs with a clear description of the behavior change.
- The open-source edition must run without any closed-source backend. See
  `docs/OPEN_CLOSED_SPLIT.md` for what belongs where.

## Reporting bugs

Open an issue with reproduction steps, your OS, the model/provider you used,
and relevant logs (with secrets redacted). For security issues, follow
`SECURITY.md` instead.
