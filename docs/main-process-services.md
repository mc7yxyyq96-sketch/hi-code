# Main Process Services

Date: 2026-07-12

Sprint 1A splits Electron main-process IPC registration into service modules without changing renderer/preload channels or user data locations.

## Service Layout

- `electron/ipc/ipc-utils.mjs`
  - Standard IPC registrar
  - Error normalization
  - Argument coercion helpers
  - Sensitive-field redaction
- `electron/ipc/register-ipc-handlers.mjs`
  - Single registration entrypoint for all main-process channels
- `electron/services/runtime-service.mjs`
  - Runtime input, Plan-mode queue submission, permission answer, truthful interrupt, and Steer follow-up channels
  - Delegates execution order to the main-process `RuntimeJobQueue`; the renderer never owns an execution queue
- `electron/services/queue-service.mjs`
  - Runtime queue clear/snapshot behavior and persisted queue projection
  - This is not a DAG or Job Center implementation
- `electron/services/mcp-service.mjs`
  - Configured MCP stdio and Streamable HTTP initialization
  - Capability listing plus lifecycle/reload/connect/reconnect/disconnect/cancel channels
  - OAuth token rotation and expiry metadata through one desktop secret-store configuration transaction, with recursively redacted lifecycle audit events
- `electron/services/store-service.mjs`
  - Existing Store / Plugin / Skill / MCP install preview and install channels
- `electron/services/job-service.mjs`
  - Job Center create/list/get/control/event/artifact channels
  - Uses the persistent `JobStore` model from `src/job-center.ts`
- `electron/services/provider-service.mjs`
  - Agent Provider registry, configuration, run, cancel, and internal-runtime adapter channels
  - Uses `src/agent-provider.ts` for Provider types and validation logic
- `electron/services/worktree-service.mjs`
  - Isolated workspace create/run/collect/cleanup channels
  - Uses `src/worktree-runner.ts` and records all operations in Job Center
- `electron/services/patch-arena-service.mjs`
  - Patch Arena run/candidate/merge/artifact channels
  - Uses `src/patch-arena.ts`, Worktree Runner isolation, and Job Center events
- `electron/services/industrial-project-service.mjs`
  - Industrial Project schema/get/save/artifact/traceability/gate channels
  - Requirement Builder and Spec Builder channels for draft, requirement persistence, artifact/test/spec generation, and approval
  - Uses `src/industrial-project.ts` and `src/industrial-requirement-builder.ts`, writes `.hicode/project.json` plus `.hicode/generated/requirements/*`, and records Job Center audit events
- `electron/services/domain-pack-service.mjs`
  - Domain Pack list/get/validate/install/update/enable/disable/uninstall/recommend channels
  - Uses `src/domain-packs.ts`, stores packs under `~/.vibe/domain-packs`, applies enabled pack standards/checklists/gates to `.hicode/project.json`, and records Job Center audit events
- `electron/services/agent-team-service.mjs`
  - Professional Agent Profile list/get, division plan create/list/get, and Multi-Agent Job creation channels
  - Uses `src/agent-team.ts`, `~/.vibe/agent-team`, enabled Domain Packs, `.hicode/project.json`, and Job Center task/event/artifact/approval records
- `electron/services/industrial-tool-service.mjs`
  - Industrial Tool Adapter list/detect/capability/dry-run channels
  - Uses `src/industrial-tool-adapters.ts`, project `toolchain`, enabled Domain Pack `toolRequirements`, and Job Center events/artifacts/gates
  - Sprint 6B allows real FreeCAD execution with explicit approval; Sprint 6C allows real KiCad CLI execution with explicit approval; Sprint 6D allows OpenPLC/IEC syntax-check execution with explicit approval; Sprint 6E allows IfcOpenShell/IFC inspection with explicit approval; Sprint 6F generates SolidWorks bridge packages without launching SolidWorks; Sprint 6G generates AVEVA connector plans without connecting to enterprise systems; other external tool adapters remain dry-run-only
- `electron/services/quality-gate-service.mjs`
  - Quality Gate list/run/approval channels
  - Uses `src/quality-gates.ts`, writes evidence JSON under `.hicode/artifacts/quality-gates/*`, records Job Center gate results, and mirrors results into `.hicode/project.json` when an Industrial Project exists
- `electron/services/release-service.mjs`
  - Release readiness, release package build, and open release folder channels
  - Uses `src/release-builder.ts`, reads `.hicode/project.json` plus Job Center gate results, writes `releases/<version>/*`, records release build Job events/gates, and stores `release-manifest.json` as a `release_package` Job artifact
- `electron/services/release-policy.mjs`
  - Defines release modes, stable/beta/nightly channel mapping, semantic version ordering, signing/notarization preflight, rollback policy, and the packaging child environment allowlist
  - CI/development packages remain explicitly unsigned and update-disabled; release mode fails closed when approval or required platform signing evidence is missing
- `electron/services/update-service.mjs`
  - Owns packaged-app update capability, predefined channel persistence, manual check/download, and native-confirmed installation through `electron-updater`
  - Never auto-downloads, installs on quit, accepts a Renderer feed URL, or permits automatic downgrade
- `electron/services/git-service.mjs`
  - Git status, diff, stage, unstage, commit message, commit, local branch, Pull Request, and CI-status channels
  - Refuses dirty branch/PR mutations and requires a fresh native confirmation before PR creation
- `electron/services/diff-service.mjs`
  - Existing tool events, recoverable tasks, and diff accept/reject channels
- `electron/services/workspace-service.mjs`
  - Workspace folder selection, file preview, session operations, config save/load, and model connection test
  - Imports image, PDF, text, and file attachments into the injected app-data `FileAttachmentStore`; returns opaque IDs and display metadata without source paths
- `electron/services/editor-service.mjs`
  - Workspace-confined UTF-8 file snapshots and saves for the integrated editor
  - Enforces a 2 MiB bound, SHA-256 expected revisions, conflict refusal, sibling temporary writes, fsync, and atomic rename
  - Force overwrite remains an explicit Renderer confirmation; the service never retries a stale normal save automatically
- `electron/services/terminal-service.mjs`
  - Owns real PTY capability detection, policy authorization, trusted shell selection, input/output, resize, and process-tree cleanup
  - Binds one terminal to one renderer owner and the current workspace; workspace/window/app close ends the session
  - Uses the shared safe child environment, 64 KiB IPC bounds, a one MiB in-memory transcript tail, and redacted metadata-only logs
  - Terminal startup is one explicit authorization unit. Commands typed after startup are not approved one by one, and the shell retains the desktop user's OS permissions
- `electron/services/preview-service.mjs`
  - Owns canonical loopback-HTTP validation, isolated child BrowserWindows, preview lifecycle, DOM checks, screenshots, and owner-only evidence
  - Binds each preview to one renderer owner and canonical workspace; owner/window/workspace/app close destroys its live window
  - Denies preload access, Node integration, DevTools, permissions, downloads, popups, webviews, external navigation, and cross-origin network resources
- `electron/services/security-service.mjs`
  - Auth IPC registration
  - Path guard and sensitive log redaction utilities
- `electron/services/execution-policy-service.mjs`
  - Owns the cached platform capability probe and policy evaluation used by desktop process launchers
  - Exposes only `execution-policy:capabilities`; the Renderer cannot submit executables, roots, environment values, or policy overrides
- `electron/services/secret-store-service.mjs`
  - Electron `safeStorage` vault for model, MCP, and Agent Provider credentials
  - Atomic sanitized-config persistence, startup migration, encrypted recovery
    snapshot, controlled rollback, and status-only renderer projection

## IPC Registration Rule

Do not add new `ipcMain.handle(...)` calls directly in `electron/main.mjs`.

New handlers must be added by:

1. Adding or extending a service method.
2. Registering the channel in that service module through `register.handle(...)`.
3. Keeping the preload API narrow and parameter-validated.
4. Adding a test in `test/main-process-services-tests.mjs` or an existing feature/security test.

`registerIpcHandlers({ services, ipcMain, dialog, shell })` is the only app-level registration entrypoint.

## Error Contract

Every `ipcMain.handle` registration goes through `createIpcRegistrar`.

Thrown errors are converted into:

```json
{ "ok": false, "error": "message" }
```

The normalized error path redacts API keys, bearer tokens, password-like fields, and secret-like fields before logging.

## Security Boundary

- `contextIsolation` remains enabled.
- `nodeIntegration` remains disabled.
- Renderer sandbox remains enabled.
- Renderer still has no raw `ipcRenderer`.
- Preload validates parameter shape before invoking main-process channels.
- Config IPC returns only sanitized JSON and credential-reference status.
  Desktop secrets are decrypted in main-process service paths only; no preload
  or renderer secret getter exists.
- Workspace file reads use the existing workspace path confinement.
- Integrated editor open/save uses the same workspace path authority. It rejects symlink escapes, binary or invalid UTF-8 content, oversized files, and stale normal saves. A force save is available only through an explicit typed request after visible user confirmation.
- Integrated terminal creation uses the same Runtime permission state and a main-process-owned PTY. The renderer cannot select an executable, cwd, arguments, or environment. The terminal starts in the active workspace and is closed before workspace changes; this workspace binding is not an OS filesystem sandbox.
- Worktree commands, custom command gates, and real industrial adapter execution require a fresh main-process permission decision. Renderer payload flags express intent only and cannot authorize a process.
- Runtime Bash, terminal, Quality Gate, Worktree, Patch Arena, MCP, and supported industrial adapters consume the shared execution policy. Strict requests fail closed; compatible report-only launches preserve a `weak` warning and policy audit instead of claiming isolation.
- Terminal children receive a minimal safe environment and never inherit API keys, tokens, passwords, unknown variables, or `SSH_AUTH_SOCK`. Raw input, output, and transcripts are not persisted in logs.
- App Preview accepts only `http:` loopback targets. Every page runs in a unique non-persistent sandboxed session with no preload or Node access. The trusted renderer never navigates to preview content, and failed verification checks remain failed.
- Plan mode remains read-only at the tool boundary even in higher-trust permission modes. Steer is persisted as cancel-and-follow-up; an interrupted queue item cannot later become successful.
- Git and GitHub commands use bounded argument arrays, `shell: false`, timeouts, and the minimal child environment. Branch switching and PR creation refuse dirty worktrees. PR creation allows only a confirmed non-force upstream push and never auto-merges.
- Attachment records and content-addressed blobs stay under app data, use owner permissions, and are revalidated on read. Attachment IDs are session-owned and bounded before Runtime queueing.
- Store install validation continues to block remote `sourcePath` and `sourceRoot`.
- Remote downloads continue to require HTTPS.
- Domain Pack installation is confined to `~/.vibe/domain-packs`, remote pack URLs require HTTPS, local path references are rejected for remote manifests, and pack manifests cannot define automatic scripts or executable commands.
- Agent Team artifacts are written under the current workspace `.hicode/generated/agent-team/*`; industrial tool plans are dry-run-only metadata and do not execute external tools.
- Industrial Tool Adapter artifacts are confined to the current workspace, external tool execution requires explicit user approval, and Sprint 6G only permits the FreeCAD, KiCad, OpenPLC/IEC, and IfcOpenShell/IFC adapters to run real local tooling. PLC/OpenPLC execution is limited to local syntax-check style commands and never performs device download. IfcOpenShell/IFC execution is limited to local IFC inspection evidence and never declares building-code compliance. SolidWorks bridge generation never launches commercial software and marks native CAD outputs as external-required. AVEVA bridge generation never connects to enterprise systems and rejects plaintext credentials.
- Quality Gate Runner command gates run without shell interpolation and with an allowlisted environment. Gate evidence must distinguish `simulated`, `not_run`, and `requires_approval` from `passed`.
- Release Builder confines release outputs to `releases/<version>/` inside the workspace. Failed gates and `requires_approval` gates block release. Simulated, not-run, skipped, and warning gates are preserved as release risks and must appear in release notes instead of being promoted to passed.
- Desktop packaging children receive a release-tool allowlist rather than the complete parent environment. CI/development artifacts embed `unsigned` and `updateEnabled: false`. macOS/Windows application updates require an approved signed package; approved Linux releases remain explicitly `integrity_verified` through HTTPS updater metadata rather than claiming platform signing.
- Update installation is packaged-only and main-process controlled. The Renderer can select only `stable`, `beta`, or `nightly`; it cannot set a feed URL or authorization header. Download and install are separate actions, and installation requires a native confirmation after verified download.
- Bash tool environment allowlisting remains in `src/tools/bash.ts`.
- MCP server processes and industrial tool execution paths must use
  `src/execution-policy.ts`, `src/execution-runner.ts`, and `src/process-env.ts`
  instead of inheriting the full parent `process.env` or relying on direct-child
  timeout behavior. Server-specific MCP credentials are only passed from the
  explicit MCP server `env` config block; policy audit contains key names only.
- Remote MCP connections require HTTPS except for loopback development. Tokens
  are resolved only in the main process, custom authorization/cookie headers are
  rejected, and lifecycle audit data is recursively redacted before persistence.

## Compatibility Boundary

Public renderer and preload channels include:

- `runtime:enqueue`, `runtime:steer`, `runtime-queue:clear`
- `auth-status`, `register`, `login`, `logout`
- `list-capabilities`
- `mcp:lifecycle`, `mcp:reload`, `mcp:connect`, `mcp:reconnect`, `mcp:disconnect`, `mcp:cancel`
- `list-store`, `set-store-source`, `preview-store-item`, `install-store-item`
- `job:create`, `job:list`, `job:get`, `job:cancel`, `job:retry`, `job:pause`, `job:resume`, `job:events`, `job:artifacts`, `job:artifact:preview`, `job:artifact:open`
- `provider:list`, `provider:get`, `provider:configure`, `provider:run`, `provider:cancel`
- `worktree:create`, `worktree:run`, `worktree:collectChanges`, `worktree:cleanup`
- `arena:list`, `arena:get`, `arena:create`, `arena:acceptCandidate`, `arena:rejectCandidate`, `arena:mergeCandidate`, `arena:artifact:preview`, `arena:artifact:open`
- `industrial-project:schema`, `industrial-project:get`, `industrial-project:validate`, `industrial-project:save`, `industrial-requirement:draft`, `industrial-requirement:add`, `industrial-requirement:criteria:update`, `industrial-requirement:artifact-plan`, `industrial-requirement:test-plan`, `industrial-requirement:spec-package`, `industrial-requirement:approve`, `industrial-project:artifact:add`, `industrial-project:traceability:add`, `industrial-project:gate:add`
- `domain-pack:list`, `domain-pack:get`, `domain-pack:validate`, `domain-pack:install`, `domain-pack:update`, `domain-pack:enable`, `domain-pack:disable`, `domain-pack:uninstall`, `domain-pack:recommend`
- `agent-team:profiles`, `agent-team:profile:get`, `agent-team:plan:create`, `agent-team:plan:list`, `agent-team:plan:get`, `agent-team:job:create`
- `toolchain:list`, `toolchain:detect`, `toolchain:capabilities`, `toolchain:validate-adapter`, `toolchain:run`
- `quality-gate:list`, `quality-gate:run`, `quality-gate:approve`
- `release:readiness`, `release:build`, `release:open`
- `app:update-status`, `app:update-channel`, `app:check-updates`, `app:update-download`, `app:update-install`
- `tool-events:list`, `recoverable-tasks:list`
- `diffs:list`, `diffs:accept`, `diffs:reject`, `diffs:accept-all`, `diffs:reject-all`, `diffs:clear-archived`
- `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit-message`, `git:commit`, `git:branches`, `git:branch:create`, `git:branch:switch`, `git:collaboration`, `git:pr:create`
- `editor:file:open`, `editor:file:save`
- `terminal:capabilities`, `terminal:create`, `terminal:status`, `terminal:write`, `terminal:resize`, `terminal:close`
- `preview:capabilities`, `preview:open`, `preview:list`, `preview:reopen`, `preview:reload`, `preview:verify`, `preview:close`, `preview:remove`
- `pick-folder`, `get-cwd`, `list-dir`, `read-file`
- `attach-file`, `attach-image`, `attachments:list`, `attachment:remove`
- `list-sessions`, `resume-session`, `delete-session`
- `get-config`, `config:credential-status`, `save-config`, `test-model`

The event channels also remain unchanged:

- `input`
- `ask-response`
- `interrupt`

## Validation

Required validation for this layer:

```bash
npm run build
npm run test:mcp
npm run verify
node test/feature-tests.mjs
node test/main-process-services-tests.mjs
npm run test:editor-workbench
npm run test:terminal
npm run test:preview
npm run test:release-pipeline
npm run test:runtime-control
npm run test:git-collaboration
node test/patch-arena-tests.mjs
node test/industrial-project-tests.mjs
node test/domain-pack-tests.mjs
node test/agent-team-tests.mjs
node test/industrial-tool-tests.mjs
node test/release-builder-tests.mjs
node --check electron/main.mjs
node --check electron/preload.cjs
npm run test:electron-e2e
npm run release:package-smoke -- --platform=darwin
```
