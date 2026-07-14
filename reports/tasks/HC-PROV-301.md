# HC-PROV-301 Task Manifest

Status: Completed

Started: 2026-07-13T19:40:48Z

Completed: 2026-07-14T03:33:00Z

Branch: `codex/runtime-engine/hc-prov-301`

Parent commit: `bc208d111b1d73704be63cfe28087b4f935f14b3`

## Problem

Hi Code had production model transports and an early Agent Provider registry, but it did not have one production control plane for provider kind, discovery, capability, health, credentials, privacy, failure policy, usage, or external Agent execution. Codex CLI and Claude Code CLI were represented as reserved adapters rather than real, isolated execution paths. `RISK-PROV-001` therefore remained open at the 0.6.0 Stable Gate.

## Outcome

Deliver a production Provider control plane that explicitly separates Model Providers from External Agent Providers, secures credentials through references and rotation, normalizes failure/retry/fallback behavior, records aggregate usage, exposes truthful privacy and health, and runs configured external Agents through authorization, managed execution, Job Center, and Worktree Runner isolation.

## Scope

- Model Provider discovery for OpenAI Responses, Anthropic, OpenAI-compatible, and Ollama profiles.
- External Agent providers for Hi Code internal runtime, Codex CLI, Claude Code CLI, and custom Agent Worker.
- Versioned Provider registry, discovery filters, capability queries, health checks, enable/disable, and credential state.
- OS-backed secret references, migration, rotation, expiry, and recursive redaction.
- Timeout, cancellation, bounded retry/fallback, unavailable/quota/auth/network normalization.
- Token, latency, cost, provider usage, and failure-rate persistence without prompt or credential content.
- Provider Settings UI and validated IPC/preload/API controls.
- Isolated external Agent execution with Job events, artifacts, gates, patch collection, and truthful dry-run.

## Out Of Scope

- Installation or licensing of Codex CLI, Claude Code CLI, or an enterprise worker.
- Automatic selection of an executable merely because it is found on `PATH`.
- Formal release, tag, publication, Apple notarization, or commercial code signing.
- Changes to `RISK-REL-001`.
- Industrial Engineering Graph or any new industrial module.

## Interfaces

- `src/provider-control-plane.ts` owns normalized Provider descriptors, registry, health, and failure policy.
- `src/model-provider.ts` remains the Model Provider execution facade used by Runtime.
- `src/agent-provider.ts` remains the compatible autonomous Agent execution registry.
- `electron/services/provider-service.mjs` composes both kinds into one control projection and IPC service.
- `electron/services/external-agent-provider-service.mjs` owns real external Agent lifecycle and Job integration.
- `src/provider-usage-store.ts` owns private aggregate usage persistence.

## Migration And Compatibility

- Existing Provider IPC names remain available; discovery, capabilities, health, registry version, usage, and rotation are additive.
- Existing `hicode-internal` Runtime Queue and Job Center behavior remains intact.
- Existing model profiles retain their explicit transport selection and are projected as `kind: model`.
- The legacy `local-model` descriptor remains available as model-profile compatibility state and cannot masquerade as an external Agent.
- Desktop, CLI, TUI, MCP, Job Center, Worktree Runner, and Patch Arena entrypoints remain unchanged.

## Security

- Provider JSON persists references and lifecycle metadata, never API key values.
- Credential rotation writes through the OS-backed secret store; expiry is visible without exposing the secret.
- Errors, metadata, logs, Job events, and artifacts receive recursive sensitive-value redaction.
- External Agents require an absolute configured executable, validated argv, explicit authorization, isolation by default, managed minimal environment, bounded timeout/output, cancellation, and process-tree cleanup.
- Direct workspace execution is not the default and requires explicit caller intent plus authorization.
- Local, remote, and enterprise providers expose distinct privacy levels.

## Tests

- Provider registry, discovery, capability, health, enable/disable, and version tests.
- Credential expiry, redaction, failure categorization, retry, fallback, and persistent usage tests.
- Real isolated-copy external Agent lifecycle with injected managed execution, Job events, artifacts, patch collection, failed approval, and simulated dry-run tests.
- IPC, preload, Renderer Provider Settings, Patch Arena filtering, model transport, service, security, feature, DoD, production audit, Program Control, and real Electron E2E gates.

## Rollback

- Revert the independent task commit to restore the prior Agent registry and model-profile behavior.
- Existing Provider config remains readable because new control metadata is additive and secret references use the established secret store.
- Isolated workspaces and Job artifacts remain auditable; rollback does not mutate user workspaces or stored secrets.

## Stop Conditions

- Any plaintext credential in Provider JSON, logs, artifacts, or usage blocks completion.
- Any Model Provider exposed as an executable Agent, unapproved external process, direct-by-default run, shell execution, unrestricted child environment, fake healthy state, or simulated result reported as real blocks completion.
- Any Desktop, CLI, TUI, MCP, Runtime, Job, Worktree, Patch Arena, release-check, Security, or DoD regression blocks completion.
- `RISK-REL-001` remains open and no formal release action is authorized by this task.

## Implemented

- Added the unified versioned Provider control registry and normalized capabilities, health, privacy, credential, failure, retry, and fallback contracts.
- Added private aggregate usage persistence and integrated Runtime and external Agent usage accounting.
- Added real Codex CLI, Claude Code CLI, and custom Agent Worker adapters behind explicit configuration, authorization, managed argv execution, isolation, Job events, gates, artifacts, patch evidence, timeout, and cancellation.
- Added Model/Agent discovery and Provider Settings UI with health, capabilities, credentials, privacy, usage, and enable/disable controls.
- Added validated IPC/preload/API methods, Patch Arena Agent filtering, architecture documentation, ADR, and comprehensive Provider hardening tests.

## Focused Verification

- `test/provider-hardening-tests.mjs`: 40 passed.
- `test/provider-tests.mjs`: 35 passed.
- `test/model-provider-tests.mjs`: 35 passed.
- `test/main-process-services-tests.mjs`: 202 passed.
- `test/renderer-architecture-tests.mjs`: passed.
- `test/security-baseline.mjs`: passed.
- `test/feature-tests.mjs`: passed.
- Evidence capture: 16 of 16 commands passed.
- Full-tree DoD scan: zero findings.

## Integration Review

- API compatibility: original Provider operations remain available and new control-plane operations are additive.
- Execution compatibility: Model Provider execution remains Runtime-owned; Agent Provider execution remains Job/Worktree-owned.
- Security review: secret references, rotation, expiry, recursive redaction, authorization, isolation, no-shell execution, minimal environment, bounded process lifecycle, and simulated truth are test covered.
- Product truth: adapters do not imply the external executable is installed, configured, licensed, authenticated, or healthy.
- Release isolation: HC-REL-420 evidence is untouched, no release/tag/signing/publication action occurred, and `RISK-REL-001` remains open.

## Evidence

- Local acceptance: `reports/evidence/HC-PROV-301/manifest.json`
- Evidence captures exact command logs and artifact hashes before the independent task commit.
