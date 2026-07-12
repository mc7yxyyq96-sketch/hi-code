# HC-SEC-401 Keychain-Backed Secrets And Credential Migration

Status: Completed

Branch: `codex/security-release/hc-sec-401`

Parent commit: `6059a6d6fe8d9aeb8f187ccfd70a1195b58162d4`

Started: `2026-07-12T11:27:16Z`

Completed: `2026-07-12T14:37:48Z`

## Scope

Remove plaintext model credentials and sensitive MCP environment values from the shared Hi Code config file. Desktop secrets are stored as encrypted values through Electron `safeStorage`; persisted config contains validated opaque `secretRef` values. CLI/TUI resolves explicit environment fallbacks without requiring Electron or writing credentials to disk.

Existing model transports continue to receive a runtime-only `apiKey` string. Existing stdio MCP servers continue to receive resolved string environment values. The compatibility boundary is inside config loading, so provider, Runtime, and MCP transport code does not gain storage responsibilities.

This task does not implement MCP HTTP/OAuth, remote vault synchronization, account credential storage, signing identities, automatic release, or industrial-tool credential flows.

## Acceptance Contract

- Successful desktop config saves contain no plaintext model `apiKey` values and no plaintext values for sensitive MCP environment names.
- Persisted credentials use versioned, validated `hicode-secret:` references. Runtime objects receive resolved values only in memory.
- Electron rejects credential persistence when `safeStorage` encryption is unavailable or reports the insecure Linux `basic_text` backend.
- CLI/TUI can resolve profile-specific `HICODE_PROFILE_<PROFILE>_API_KEY` variables and the existing default-profile environment variables without Electron or a plaintext fallback file.
- Existing plaintext config is migrated before the first desktop Runtime starts. Migration writes the sanitized config atomically and retains only an encrypted rollback snapshot plus a non-secret journal.
- Migration and ordinary config-save failures restore both the prior config bytes and prior secret-store state. Explicit rollback restores the exact pre-migration config and records that state without logging secret values.
- Renderer config reads never receive decrypted credentials. Leaving a configured API Key field empty preserves its existing `secretRef`; entering a replacement rotates the encrypted value.
- Model connection tests may use a newly entered in-memory key or an existing `secretRef`, but never return the credential to the renderer or logs.
- Existing non-sensitive config, MCP stdio compatibility, model-provider routing, config permissions, and environment override behavior remain compatible.

## Baseline

- Real entrypoints remain `electron/main.mjs`, `electron/preload.cjs`, `renderer/index.html`, and `renderer/renderer.js` with the typed App Shell mounted through the existing bootstrap.
- Package version is `0.6.0-alpha.8`.
- `node node_modules/npm/bin/npm-cli.js run verify`: passed from the clean HC-GIT-320 parent before task-state changes.
- The audit confirmed `src/config.ts` accepts persisted `apiKey`, `electron/services/workspace-service.mjs` writes renderer JSON verbatim, and the Renderer retains submitted keys after successful saves.
- The completed historical HC-RUN-220 evidence is not rerun as a standalone ten-hour task; its covered suites remain part of normal verify/release gates.

## Security Design Constraints

- No custom reversible encryption key is stored beside encrypted values. Desktop encryption authority remains the operating-system facility exposed by Electron `safeStorage`.
- The encrypted vault, migration journal, and config use owner-only directory/file permissions and atomic sibling replacement.
- Secret identifiers, status, and timestamps may be logged; plaintext, ciphertext, environment values, and decrypted config snapshots may not.
- Secret references are bounded strings with controlled namespaces. Unknown schemes, traversal, control characters, and malformed profile/environment identifiers fail closed.
- CLI fallback is environment-only. Hi Code does not silently create a plaintext CLI credential file.
- Migration never deletes the original config before a complete encrypted snapshot and replacement are durable.

## Planned Verification

- Pure config tests for reference validation, plaintext extraction, profile-specific environment fallback, local no-key profiles, and unresolved references.
- Electron secret-store tests for encryption availability, atomic write, rotation, deletion, migration, rollback, corrupt vault, and failure restoration.
- Workspace-service tests for sanitized saves, preserved references, connection tests through references, and no secret return values.
- MCP tests proving sensitive environment references resolve in memory and still pass through the existing minimal child environment.
- Renderer tests proving saved credentials are not retained or repopulated and configured state remains visible.
- Build, verify, release check, feature, security, DoD unit, full-tree DoD scan, production audit, program-control, and real Electron E2E gates.

## Implemented Delivery

- `src/secret-references.ts` defines bounded versioned model, MCP, and Agent
  Provider references, persistence sanitization, plaintext discovery, and
  deterministic CLI fallback names.
- `electron/services/secret-store-service.mjs` implements the Electron
  `safeStorage` vault, owner-private atomic config/vault writes, status-only
  projection, startup migration, encrypted snapshot, value-free journal, and
  exact controlled rollback.
- `electron/main.mjs` migrates credentials after Electron readiness and before
  service/Runtime construction. Desktop config loading rejects legacy plaintext
  and resolves references only in the main process.
- Workspace config IPC returns sanitized JSON plus configured status. Model
  connection testing accepts either a newly entered in-memory key or an existing
  reference. Preload exposes no credential getter.
- Renderer settings clear key inputs after save, preserve only references that
  the secure store reports as configured, and surface fail-closed migration
  errors without receiving decrypted values.
- Agent Provider secret fields are externalized before Provider state is
  persisted. Legacy state migrates transactionally; blank or omitted fields
  preserve prior references.
- CLI profile and MCP environment fallbacks work without Electron. `/model`
  refuses to rewrite a legacy config containing plaintext credentials.
- Provider metadata now reports `secret-reference-or-environment` rather than
  implying config-file credential storage.

## Focused Verification Result

- Secret reference suite: 13 passed.
- Electron secret-store suite: 11 passed.
- Agent Provider suite: 35 passed.
- Main-process service suite: 178 passed.
- Renderer architecture suite: 183 passed.
- Security baseline: 214 passed.
- Real Electron E2E: passed credential persistence/fail-closed behavior and all
  existing desktop workbench checks. The first run exposed a test-isolation
  counter that included the new credential connection test; the assertion was
  corrected to count requests produced by its own step, and the complete rerun
  passed.

## Acceptance Evidence

- `reports/evidence/HC-SEC-401/manifest.json` records 16/16 local acceptance
  commands passing from clean source commit `c107121c32ee7bafc4dc76cd718ff9e73f2640f1`.
- Build, complete verify, release check, feature tests, focused credential,
  Provider, service, Renderer, security, DoD, production audit, program-control,
  and real Electron E2E all passed.
- The full-tree DoD scan reported zero findings.
- GitHub Actions run `29196545587` for Draft PR #18 passed the general test job
  and real Electron smoke on Ubuntu, macOS, and Windows. The immutable CI
  projection is `reports/evidence/HC-SEC-401/ci-matrix.json`.

All acceptance criteria are satisfied. Formal merge, release promotion,
signing, and publication remain separately approval-gated.

## Rollback

Revert the HC-SEC-401 implementation commits. A completed migration also has an encrypted snapshot that can restore the exact pre-migration config through the tested rollback operation while the same OS user and secure-storage backend remain available.
