# Main Process Services

Date: 2026-07-04

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
  - Runtime input, permission answer, and interrupt event channels
- `electron/services/queue-service.mjs`
  - Existing runtime queue clear/snapshot behavior
  - This is not a DAG or Job Center implementation
- `electron/services/mcp-service.mjs`
  - Configured MCP server initialization
  - Existing capability listing
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
- `electron/services/git-service.mjs`
  - Existing Git status, diff, stage, unstage, commit message, and commit channels
- `electron/services/diff-service.mjs`
  - Existing tool events, recoverable tasks, and diff accept/reject channels
- `electron/services/workspace-service.mjs`
  - Workspace folder selection, file preview, session operations, config save/load, and model connection test
  - Imports image, PDF, text, and file attachments into the injected app-data `FileAttachmentStore`; returns opaque IDs and display metadata without source paths
- `electron/services/editor-service.mjs`
  - Workspace-confined UTF-8 file snapshots and saves for the integrated editor
  - Enforces a 2 MiB bound, SHA-256 expected revisions, conflict refusal, sibling temporary writes, fsync, and atomic rename
  - Force overwrite remains an explicit Renderer confirmation; the service never retries a stale normal save automatically
- `electron/services/security-service.mjs`
  - Auth IPC registration
  - Path guard and sensitive log redaction utilities

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
- Workspace file reads use the existing workspace path confinement.
- Integrated editor open/save uses the same workspace path authority. It rejects symlink escapes, binary or invalid UTF-8 content, oversized files, and stale normal saves. A force save is available only through an explicit typed request after visible user confirmation.
- Attachment records and content-addressed blobs stay under app data, use owner permissions, and are revalidated on read. Attachment IDs are session-owned and bounded before Runtime queueing.
- Store install validation continues to block remote `sourcePath` and `sourceRoot`.
- Remote downloads continue to require HTTPS.
- Domain Pack installation is confined to `~/.vibe/domain-packs`, remote pack URLs require HTTPS, local path references are rejected for remote manifests, and pack manifests cannot define automatic scripts or executable commands.
- Agent Team artifacts are written under the current workspace `.hicode/generated/agent-team/*`; industrial tool plans are dry-run-only metadata and do not execute external tools.
- Industrial Tool Adapter artifacts are confined to the current workspace, external tool execution requires explicit user approval, and Sprint 6G only permits the FreeCAD, KiCad, OpenPLC/IEC, and IfcOpenShell/IFC adapters to run real local tooling. PLC/OpenPLC execution is limited to local syntax-check style commands and never performs device download. IfcOpenShell/IFC execution is limited to local IFC inspection evidence and never declares building-code compliance. SolidWorks bridge generation never launches commercial software and marks native CAD outputs as external-required. AVEVA bridge generation never connects to enterprise systems and rejects plaintext credentials.
- Quality Gate Runner command gates run without shell interpolation and with an allowlisted environment. Gate evidence must distinguish `simulated`, `not_run`, and `requires_approval` from `passed`.
- Release Builder confines release outputs to `releases/<version>/` inside the workspace. Failed gates and `requires_approval` gates block release. Simulated, not-run, skipped, and warning gates are preserved as release risks and must appear in release notes instead of being promoted to passed.
- Bash tool environment allowlisting remains in `src/tools/bash.ts`.
- MCP server processes and industrial tool execution paths must use
  `src/process-env.ts` (`buildSafeChildEnv`, `redactEnvForLogs`) instead of
  inheriting the full parent `process.env`. Server-specific MCP credentials are
  only passed from the explicit MCP server `env` config block.

## Compatibility Boundary

Renderer and preload channels are unchanged:

- `runtime-queue:clear`
- `auth-status`, `register`, `login`, `logout`
- `list-capabilities`
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
- `tool-events:list`, `recoverable-tasks:list`
- `diffs:list`, `diffs:accept`, `diffs:reject`, `diffs:accept-all`, `diffs:reject-all`, `diffs:clear-archived`
- `git:status`, `git:diff`, `git:stage`, `git:unstage`, `git:commit-message`, `git:commit`
- `editor:file:open`, `editor:file:save`
- `pick-folder`, `get-cwd`, `list-dir`, `read-file`
- `attach-file`, `attach-image`, `attachments:list`, `attachment:remove`
- `list-sessions`, `resume-session`, `delete-session`
- `get-config`, `save-config`, `test-model`

The event channels also remain unchanged:

- `input`
- `ask-response`
- `interrupt`

## Validation

Required validation for this layer:

```bash
npm run build
npm run verify
node test/feature-tests.mjs
node test/main-process-services-tests.mjs
npm run test:editor-workbench
node test/patch-arena-tests.mjs
node test/industrial-project-tests.mjs
node test/domain-pack-tests.mjs
node test/agent-team-tests.mjs
node test/industrial-tool-tests.mjs
node test/release-builder-tests.mjs
node --check electron/main.mjs
node --check electron/preload.cjs
```
