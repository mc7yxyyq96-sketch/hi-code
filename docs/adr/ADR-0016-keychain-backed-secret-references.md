# ADR-0016: Keychain-Backed Secret References

Status: Accepted

Date: 2026-07-12

## Context

Hi Code model profiles and MCP configuration historically allowed API keys and
tokens to live directly in `config.json`. File permissions reduce accidental
disclosure but do not provide platform-backed encryption, and the renderer did
not need access to the values. Agent Provider state also had an optional secret
field that could be persisted as plaintext.

The desktop, CLI, MCP, Provider, and migration paths need one truthful contract:
desktop credentials are encrypted by the operating system, CLI credentials have
a non-Electron fallback, failed migrations preserve user data, and no UI or log
surface receives a secret value.

## Decision

1. Persist versioned, scoped `secretRef` values in config and Provider state.
2. Store desktop values in an owner-private vault encrypted record-by-record
   through Electron `safeStorage`.
3. Reject unavailable encryption and Linux `basic_text`; never silently fall
   back to plaintext.
4. Expose only sanitized config and configured/not-configured status through
   preload and renderer APIs. Never repopulate a saved key into the renderer.
5. Start legacy migration after Electron is ready and before main-process
   services or Runtime are created.
6. Make config/vault writes atomic as a unit. Preserve an encrypted migration
   snapshot and a value-free hash journal so controlled rollback can restore the
   exact previous config and prior vault records.
7. Externalize sensitive MCP and Agent Provider fields through the same vault.
   Blank or omitted Provider secret input retains an existing reference.
8. Keep CLI credential resolution environment-only for new secure
   configurations. Profile and MCP fallback names are deterministic. Refuse to
   rewrite legacy config while it still contains plaintext credentials.
9. Keep child-process environment filtering independent. A key in the vault is
   never an implicit grant to Bash, Git, MCP, terminal, or an adapter.

## Consequences

- Desktop config and Provider JSON become safe to inspect for troubleshooting
  without revealing credential values.
- A copied config reference is unusable without the same OS-user vault.
- Linux sessions without a supported secret service must use CLI environment
  variables or configure a secure backend before desktop saving works.
- Controlled rollback can restore legacy plaintext by design; it is an internal
  recovery primitive rather than a renderer convenience action.
- OS secure storage is an at-rest control, not a defense against a compromised
  main process running as the logged-in user.

## Rejected Alternatives

- **Keep plaintext with mode `0600`:** rejected because permissions are not
  platform-backed encryption and secrets remain visible to backups and tools.
- **Use one application encryption key in the repository or config:** rejected
  because it only relocates the plaintext key problem.
- **Use Electron `basic_text` on Linux:** rejected because its name accurately
  describes the absence of acceptable secret protection.
- **Send decrypted keys to the renderer:** rejected because the renderer only
  needs configuration status and would expand the compromise boundary.
- **Delete legacy values before vault write succeeds:** rejected because a
  backend or disk failure could irreversibly lose credentials.
- **Reuse ambient environment variables for desktop child processes:** rejected
  because credential storage and subprocess authorization are separate grants.

## Verification And Rollback Gates

- Unit tests cover scoped references, config sanitization, encryption,
  unavailable backends, rotation, corruption, atomic failure restoration,
  migration, and exact rollback.
- Provider tests prove plaintext and legacy values do not remain in
  `providers.json` and blank/omitted inputs retain prior references.
- Service, renderer, preload, and security tests prove the status-only bridge
  and absence of a secret getter.
- Real Electron E2E verifies OS-backed persistence or fail-closed behavior.
- Full build, verify, release check, DoD scan, production audit, and supported
  CI platforms must pass before acceptance.

Rollback of the feature restores the previous config-loading code only after a
controlled `rollbackMigration` operation has restored legacy config. Removing
the vault path without rollback is forbidden because it would orphan references.
