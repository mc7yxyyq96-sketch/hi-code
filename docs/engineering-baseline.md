# Hi Code Engineering Baseline

Date: 2026-07-04

This document freezes the Sprint 0 engineering baseline. Future Codex or Claude Code work must keep these entrypoints and security boundaries intact unless the task explicitly changes this baseline.

## Real Entrypoints

- Electron main process: `electron/main.mjs`
- Electron preload bridge: `electron/preload.cjs`
- Renderer document: `renderer/index.html`
- Renderer logic: `renderer/renderer.js`, typed source under `renderer/app-shell/`, and legacy panels under `renderer/app/` and `renderer/components/`
- CLI/TUI source entry: `src/index.ts`
- Compiled CLI binary: `dist/index.js`

`package.json` uses `electron/main.mjs` as the app main entry and `dist/index.js` as the `hicode` binary.

## Deprecated Entrypoints

The root-level v0.4 files are not production entrypoints:

- `legacy/v0.4/main.mjs`
- `legacy/v0.4/renderer.js`
- `legacy/v0.4/index.html`

Do not edit or reintroduce root-level `main.mjs`, `renderer.js`, or `index.html` for product changes. They are kept only as legacy reference material.

## Local Development Commands

```bash
npm install
npm run build
npm run app
```

This extracted workspace was installed with a bundled Node/pnpm runtime. On a normal developer machine, use the project `npm` scripts directly.

## Test Commands

```bash
npm run test
npm run test:feature
npm run test:entrypoints
npm run test:security
npm run test:app-shell
npm run test:openai-responses
npm run test:terminal
npm run check:syntax
npm run verify
```

`test/feature-tests.mjs` must use `fileURLToPath(import.meta.url)` for test-local paths so MCP mock servers work when the project path contains spaces or non-ASCII characters.

## Release Check

`npm run release:check` must run at least:

```bash
npm run build
npm run check:syntax
npm run test:feature
```

The current script also runs entrypoint/security tests and production dependency audit.

## Security Boundaries

- Renderer must not receive Node.js primitives or raw `ipcRenderer`.
- `contextIsolation` must remain `true`.
- `nodeIntegration` must remain `false`.
- Renderer `sandbox` should remain `true`; any future compatibility exception must be documented with a failing repro and mitigation.
- The React/Vite App Shell must remain a local generated bundle. Do not load framework code from a CDN or expand CSP for the shell.
- New shell routes must use the typed registry and a real existing trigger. Missing panels, duplicate mappings, and non-actionable routes fail closed.
- `renderer/index.html` must keep a CSP that blocks remote scripts by default.
- Preload APIs must validate argument types before calling main-process IPC.
- Main-process IPC handlers must use normalized error returns instead of leaking thrown exceptions.
- Model profiles must select non-default wire protocols explicitly. Omitted `protocol` remains `chat_completions`; only `protocol: "responses"` may route to `/responses`.
- Remote Responses endpoints must use HTTPS. Loopback HTTP is permitted only for local services and tests; credentials must not enter provider events or logs.
- File previews and diff operations must stay confined to the selected workspace.
- Desktop attachments must use the app-data `attachments-v2` store. Renderer and queue payloads carry bounded opaque IDs, source paths are not persisted, and each blob read must pass size and SHA-256 verification.
- Unsupported PDF or general-file transport must fail before provider network I/O and must not be reported as processed.
- Input classification must use the shared Command Registry. Unknown slash commands and ambiguous native matchers fail closed; ordinary coding requests must remain on the agent route.
- Bash, MCP servers, and industrial adapters must not inherit the whole host environment. Bash uses the allowlist in `src/tools/bash.ts`; MCP/tool adapters use `src/process-env.ts` and only receive explicitly configured extra env.
- Integrated terminal startup must pass the existing execution permission state. The renderer never receives a raw PTY or generic IPC surface, and shell/cwd/env selection remains main-process-owned.
- Terminal input after startup executes under the one visible session authorization and is not re-approved command by command. The terminal starts in the active workspace but is not an operating-system filesystem sandbox; changing workspace or closing its owner must end the full process tree.
- Terminal children use the same minimal child-environment policy. Input, output, full env maps, and transcript content must not enter persisted logs.
- Store installs must write only into app data directories such as `~/.vibe/store`.
- Remote catalog entries must not read local `sourcePath` or `sourceRoot`.
- Remote downloads must use HTTPS.
- Download entries should provide `sha256`; `signature` and `signatureAlgorithm` fields are reserved for stronger verification.

## Store Install Baseline

Store items must pass validation before preview or install:

- `id`, `kind`, and `install.kind` are constrained to known safe values.
- Plugin and Skill local imports are allowed only from trusted local sources.
- Download filenames are sanitized before writing to disk.
- Missing `sha256` requires explicit user confirmation in the install flow.
- Hash mismatch aborts installation.

## Sprint 0 Acceptance

The baseline is accepted only when these pass:

```bash
npm run build
npm run check:syntax
node test/feature-tests.mjs
npm run verify
npm run release:check
```
