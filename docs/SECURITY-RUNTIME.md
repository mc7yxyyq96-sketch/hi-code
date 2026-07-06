# Hi Code Runtime Security Baseline

Last updated: 2026-07-04

This document records the security baseline that must hold before Hi Code is
treated as a distributable desktop coding agent.

## Electron Renderer Boundary

- `contextIsolation` must stay enabled.
- `nodeIntegration` must stay disabled.
- Renderer sandbox is enabled for the production BrowserWindow.
- Renderer code may only use the narrow `window.hicode` API exposed by
  `electron/preload.cjs`.
- Preload must not expose raw `ipcRenderer`, generic `send`, or generic
  `invoke` helpers.
- `renderer/index.html` must include a Content Security Policy. Remote scripts
  are blocked by default with `script-src 'self'`.

## Tool Execution Boundary

- File tools must resolve paths through workspace confinement and reject
  symlink escapes.
- Bash tools still require permission according to the runtime permission mode.
- Bash child processes receive a filtered environment by default. The baseline
  allowlist is `PATH`, `HOME`, `SHELL`, `TMPDIR`, `LANG`, and `LC_ALL`.
- Additional bash environment variables require an explicit allowlist through
  `HICODE_BASH_ENV_ALLOWLIST` or runtime `envAllowlist`.
- MCP servers and industrial tool execution paths use `buildSafeChildEnv` and
  do not inherit the full parent `process.env`. The default child environment
  only includes basic runtime variables such as `PATH`, home directory, temp
  directory, locale, and Windows tool discovery paths.
- MCP server-specific secrets such as `GITHUB_TOKEN` may be passed only when
  explicitly configured in that MCP server's `env` block. Parent process
  secrets like `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and unrelated
  `*_TOKEN`/`*_SECRET` values are not inherited automatically.
- Logs must use redacted environment summaries; keys containing token, secret,
  password, auth, credential, or API key semantics must be masked.
- Reviewer/read-only bash runs through macOS `sandbox-exec` where available.

## Store / Extension Boundary

- Remote catalog items may not reference local `sourcePath` or `sourceRoot`
  values.
- Local path imports are restricted to trusted local store sources such as the
  Codex cache and Hi Code store directories.
- Remote downloads must use HTTPS.
- Download filenames are sanitized before writing to the local cache.
- If a download item provides `install.sha256`, the downloaded bytes must match.
- If a download item does not provide `install.sha256`, direct IPC install is
  blocked until the renderer passes an explicit confirmation from the install
  preview.

## Required Checks

Run these before handing off a change:

```bash
npm run build
node --check electron/main.mjs
node --check electron/preload.cjs
node --check renderer/renderer.js
node test/feature-tests.mjs
node test/entrypoint-tests.mjs
node test/security-baseline.mjs
```

`npm run verify` runs the same build, syntax, feature, entrypoint, and security
baseline checks.

## Dependency Audit Status

Current Sprint 0 result:

- `npm run audit:prod`: passes with 0 production vulnerabilities.
- `npm run audit:high`: fails on development/packaging dependencies:
  - `electron <=39.8.4`
  - `electron-builder` / `app-builder-lib` / `dmg-builder` via vulnerable
    `tar`

The available fixes require breaking major upgrades (`electron@43.x` and
`electron-builder@26.x`). These upgrades must be handled as a dedicated
packaging/security sprint with Electron launch smoke tests, packaged DMG tests,
preload compatibility checks, and renderer sandbox regression checks.

Until that upgrade lands, production runtime dependency audit is clean, but
packaged desktop release readiness remains blocked by the dev/packaging audit.
