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
npm run test:preview
npm run test:runtime-control
npm run test:git-collaboration
npm run test:secrets
npm run test:secret-store
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

Desktop package validation is separate from the source release gate:

```bash
npm run release:preflight -- --platform=darwin
npm run dist:mac
npm run release:package-smoke -- --platform=darwin
npm run release:sbom
npm run release:provenance
npm run release:checksums
npm run release:verify-checksums
```

Use `dist:win`/`--platform=win32` on Windows and `dist:linux`/`--platform=linux` on Linux. CI and development packages must stay visibly unsigned and update-disabled. Formal signing, notarization, and publication require explicit approval and credentials; a missing credential is a release blocker, not a reason to weaken the preflight.

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
- Desktop model, sensitive MCP, and Agent Provider credentials must persist as
  validated `secretRef` values. Electron `safeStorage` owns encrypted values;
  unavailable encryption and Linux `basic_text` must fail closed.
- Renderer/preload APIs may expose sanitized config and reference status only.
  They must not expose a credential getter or repopulate saved keys.
- CLI credentials use `HICODE_API_KEY`, profile-specific
  `HICODE_PROFILE_<PROFILE>_API_KEY`, or MCP-specific fallback variables. CLI
  config writes must refuse to rewrite detected plaintext credentials.
- Remote Responses endpoints must use HTTPS. Loopback HTTP is permitted only for local services and tests; credentials must not enter provider events or logs.
- File previews and diff operations must stay confined to the selected workspace.
- Desktop attachments must use the app-data `attachments-v2` store. Renderer and queue payloads carry bounded opaque IDs, source paths are not persisted, and each blob read must pass size and SHA-256 verification.
- Unsupported PDF or general-file transport must fail before provider network I/O and must not be reported as processed.
- Input classification must use the shared Command Registry. Unknown slash commands and ambiguous native matchers fail closed; ordinary coding requests must remain on the agent route.
- Bash, MCP servers, and industrial adapters must not inherit the whole host environment. Bash uses the allowlist in `src/tools/bash.ts`; MCP/tool adapters use `src/process-env.ts` and only receive explicitly configured extra env.
- Managed child processes must pass `src/execution-policy.ts`. Platform capability is probed rather than inferred: macOS `sandbox-exec` and Linux bubblewrap are partial isolation, while Windows remains weak until a reviewed restricted-token backend exists. Unsupported requested controls fail closed in strict mode or remain explicitly weak in report-only evidence.
- Electron-builder runs through `scripts/run-electron-builder.mjs` with a release-specific environment allowlist. Model keys, cloud credentials, arbitrary tokens, package credentials, and unknown variables are not inherited. Signing and publication variables are admitted only in explicitly approved release mode, and logs expose key presence rather than values.
- Application updates are disabled for unpackaged, invalid-manifest, unsigned, and unapproved builds. The updater does not auto-download or silently install; main-process confirmation and a verified downloaded package are mandatory. Automatic rollback is forbidden.
- Non-interactive command runners use `src/execution-runner.ts` for timeout, bounded output, metadata-only audit, and descendant cleanup. A Renderer-supplied approval boolean is never sufficient for worktree, command-gate, or real industrial execution.
- Git and GitHub CLI children use the same minimal environment and argument-array rule. Ambient tokens, model keys, package credentials, cloud secrets, and `SSH_AUTH_SOCK` must not be inherited; GitHub login remains in the external `gh` credential store.
- Plan mode cannot execute mutating tools. Prompt order lives only in the main-process Runtime queue, and Steer must remain an explicit cancelled turn followed by a new queued instruction.
- Integrated terminal startup must pass the existing execution permission state. The renderer never receives a raw PTY or generic IPC surface, and shell/cwd/env selection remains main-process-owned.
- Terminal input after startup executes under the one visible session authorization and is not re-approved command by command. The terminal starts in the active workspace but is not an operating-system filesystem sandbox; changing workspace or closing its owner must end the full process tree.
- Terminal children use the same minimal child-environment policy. Input, output, full env maps, and transcript content must not enter persisted logs.
- App Preview must remain loopback-HTTP-only and main-process-owned. Preview pages run in sandboxed child windows with no preload, no Node integration, no DevTools, no permissions, no downloads, and no external navigation. Failed checks must not be promoted to passed.
- Store installs must write only into app data directories such as `~/.vibe/store`.
- Remote catalog entries must not read local `sourcePath` or `sourceRoot`.
- Remote downloads must use HTTPS.
- Download entries should provide `sha256`; `signature` and `signatureAlgorithm` fields are reserved for stronger verification.

Migration must run after Electron readiness and before Runtime/service startup.
Config and encrypted vault writes are one atomic operation. A reversible,
encrypted migration snapshot must preserve exact prior config bytes and vault
entries; journal and logs must contain no secret values.

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
